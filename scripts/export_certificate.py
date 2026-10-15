"""Exporta apenas o certificado público do ejabberd para o container Django."""

import re
import subprocess
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent


def main():
    result = subprocess.run(
        ["docker", "compose", "exec", "-T", "ejabberd", "cat", "/opt/ejabberd/conf/server.pem"],
        cwd=PROJECT_DIR,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise SystemExit(
            "Inicie o ejabberd com 'docker compose up -d --wait ejabberd' antes de exportar o certificado."
        )
    certificates = re.findall(
        rb"-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----",
        result.stdout,
        re.DOTALL,
    )
    if not certificates:
        raise SystemExit("O arquivo do servidor não contém um certificado público.")
    destination = PROJECT_DIR / "certs" / "ejabberd.crt"
    destination.parent.mkdir(exist_ok=True)
    destination.write_bytes(b"\n".join(certificates) + b"\n")
    print(f"Certificado público exportado para {destination}")


if __name__ == "__main__":
    main()
