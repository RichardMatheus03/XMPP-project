"""Cadastro de contas pela API HTTPS do ejabberd, com HTTP Basic Auth."""

import json
import logging
import ssl

import urllib3
from django.conf import settings
from django.views.decorators.debug import sensitive_variables

logger = logging.getLogger(__name__)


class RegistrationError(Exception):
    def __init__(self, message, *, status=502, field=None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.field = field


@sensitive_variables()
def register_account(username, password):
    if not settings.EJABBERD_ADMIN_PASSWORD:
        logger.error("A credencial administrativa do ejabberd não foi configurada.")
        raise RegistrationError("O serviço de cadastro está indisponível no momento.")

    payload = json.dumps(
        {"user": username, "host": settings.XMPP_DOMAIN, "password": password}
    ).encode("utf-8")
    headers = urllib3.make_headers(
        basic_auth=f"{settings.EJABBERD_ADMIN_JID}:{settings.EJABBERD_ADMIN_PASSWORD}"
    )
    headers.update(
        {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "Host": settings.EJABBERD_TLS_SERVER_NAME,
        }
    )

    try:
        context = ssl.create_default_context(cafile=settings.EJABBERD_CA_FILE)
        # Docker encontra o serviço por "ejabberd". A identidade TLS é o nome
        # "localhost" do certificado da imagem, validado com a CA configurada.
        with urllib3.HTTPSConnectionPool(
            settings.EJABBERD_API_HOST,
            port=settings.EJABBERD_API_PORT,
            server_hostname=settings.EJABBERD_TLS_SERVER_NAME,
            ssl_context=context,
            timeout=urllib3.Timeout(connect=3, read=7),
            retries=False,
        ) as connection:
            response = connection.request(
                "POST", "/api/register", body=payload, headers=headers,
                redirect=False, assert_same_host=False,
            )
    except urllib3.exceptions.ReadTimeoutError:
        # Não repetimos o POST: o servidor pode já ter criado a conta.
        raise RegistrationError(
            "Não foi possível confirmar o cadastro a tempo. Tente entrar com os dados escolhidos antes de repetir.",
            status=504,
        ) from None
    except (urllib3.exceptions.SSLError, ssl.SSLError, OSError):
        logger.error("Não foi possível validar a conexão HTTPS com o ejabberd.")
        raise RegistrationError(
            "Não foi possível estabelecer uma conexão segura com o servidor de contas."
        ) from None
    except urllib3.exceptions.HTTPError:
        logger.warning("A API do ejabberd está indisponível.")
        raise RegistrationError(
            "O servidor de contas está indisponível. Tente novamente em instantes.",
            status=503,
        ) from None

    if response.status == 409:
        raise RegistrationError(
            "Este usuário já existe. Escolha outro nome.", status=409, field="usuario"
        )
    if response.status == 401:
        logger.error("A API do ejabberd recusou a credencial administrativa (HTTP 401).")
        raise RegistrationError("O serviço de cadastro está indisponível no momento.")
    if response.status == 403:
        logger.error("A API do ejabberd recusou a permissão de cadastro (HTTP 403). Confira api_permissions.")
        raise RegistrationError("O serviço de cadastro está indisponível no momento.")
    if response.status != 200:
        logger.warning("A API de cadastro do ejabberd retornou HTTP %s.", response.status)
        raise RegistrationError("O servidor não conseguiu concluir o cadastro.")

    try:
        result = json.loads(response.data)
    except (ValueError, UnicodeDecodeError):
        raise RegistrationError("O servidor retornou uma confirmação inválida.") from None
    if not isinstance(result, str) or not result.strip():
        raise RegistrationError("O servidor retornou uma confirmação inválida.")

    return f"{username}@{settings.XMPP_DOMAIN}"
