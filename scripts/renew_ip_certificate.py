"""Renova o certificado de IP por TLS-ALPN-01 e o instala para o ejabberd.

Executado como root pelo systemd, com configuração em /etc/ejabberd-acme.env.
As chaves permanecem na VPS. Não cria contas XMPP nem envia mensagens.
"""

import fcntl
import ipaddress
import os
from pathlib import Path
import subprocess
import tempfile


def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def install_certificate(acme_dir, tls_dir, public_ip):
    """Confere SAN, cadeia e par de chaves antes de substituir o PEM ativo."""
    certificate = acme_dir / "certificates" / f"{public_ip}.crt"
    private_key = acme_dir / "certificates" / f"{public_ip}.key"
    run(["openssl", "x509", "-in", str(certificate), "-noout", "-checkip", public_ip])
    run(["openssl", "x509", "-in", str(certificate), "-noout", "-checkend", "3600"])
    run([
        "openssl", "verify", "-verify_ip", public_ip,
        "-CAfile", "/etc/ssl/certs/ca-certificates.crt",
        "-untrusted", str(certificate), str(certificate),
    ])
    cert_key = run(
        ["openssl", "x509", "-in", str(certificate), "-pubkey", "-noout"],
        capture_output=True,
    ).stdout
    key = run(
        ["openssl", "pkey", "-in", str(private_key), "-pubout"],
        capture_output=True,
    ).stdout
    if cert_key != key:
        raise RuntimeError("O certificado e a chave privada não correspondem.")

    tls_dir.mkdir(parents=True, exist_ok=True, mode=0o750)
    os.chown(tls_dir, 0, 9000)
    tls_dir.chmod(0o750)
    # Monta-se o diretório no Docker para permitir troca atômica do arquivo.
    with tempfile.NamedTemporaryFile(dir=tls_dir, delete=False) as output:
        temporary = Path(output.name)
        try:
            os.fchown(output.fileno(), 0, 9000)
            os.fchmod(output.fileno(), 0o640)
            output.write(certificate.read_bytes().rstrip() + b"\n")
            output.write(private_key.read_bytes().rstrip() + b"\n")
            output.flush()
            os.fsync(output.fileno())
            os.replace(temporary, tls_dir / "server.pem")
        finally:
            temporary.unlink(missing_ok=True)
    print("Certificado instalado com leitura para o grupo 9000.", flush=True)


def main():
    if os.geteuid() != 0:
        raise SystemExit("Execute como root para acessar a chave e a porta 443.")
    public_ip = str(ipaddress.ip_address(os.environ["TLS_PUBLIC_IP"]))
    acme_dir = Path(os.environ.get("ACME_DIR", "/var/lib/ejabberd-acme"))
    tls_dir = Path(os.environ.get("TLS_DIR", "/opt/ejabberd-tls"))
    project_dir = Path(os.environ["EJABBERD_PROJECT_DIR"])
    certificate = acme_dir / "certificates" / f"{public_ip}.crt"
    if not certificate.is_file():
        raise SystemExit("Emita o certificado inicial com lego antes de ativar a renovação.")

    with open("/run/ejabberd-acme.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        # Apenas instalações explícitas ou certificados com menos de 72h
        # restantes modificam o serviço. O timer fornece jitter antes disso.
        if os.environ.get("INSTALL_CERTIFICATE_ONLY") == "1":
            install_certificate(acme_dir, tls_dir, public_ip)
            return
        valid = subprocess.run([
            "openssl", "x509", "-in", str(certificate), "-noout",
            "-checkend", "259200",
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if valid.returncode == 0:
            print("Certificado válido por mais de 72h; renovação dispensada.")
            return

        compose = ["/usr/bin/docker", "compose"]
        running = bool(run(
            compose + ["ps", "--status", "running", "-q", "ejabberd"],
            cwd=project_dir, capture_output=True, text=True,
        ).stdout.strip())
        try:
            if running:
                run(compose + ["stop", "-t", "20", "ejabberd"], cwd=project_dir)
            run([
                "/usr/local/bin/lego", "run", "--path", str(acme_dir),
                "--email", os.environ["ACME_EMAIL"], "--accept-tos",
                "--domains", public_ip, "--profile", "shortlived", "--tls",
                "--cert.timeout", "120", "--renew-force", "--no-random-sleep",
            ], timeout=240)
            install_certificate(acme_dir, tls_dir, public_ip)
        finally:
            # Restaura o serviço mesmo se a autoridade falhar. Nesse caso,
            # o certificado ativo anterior permanece instalado.
            if running:
                run(
                    compose + ["start", "--wait", "--wait-timeout", "120", "ejabberd"],
                    cwd=project_dir,
                )


if __name__ == "__main__":
    main()
