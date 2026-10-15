import json

from django.conf import settings
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters, sensitive_variables
from django.views.decorators.http import require_GET, require_POST

from .ejabberd import RegistrationError, register_account
from .forms import AccountForm


@require_GET
@never_cache
def index(request):
    return render(request, "cadastro/index.html", {"xmpp_domain": settings.XMPP_DOMAIN})


@require_GET
@never_cache
def chat(request):
    return render(
        request,
        "cadastro/chat.html",
        {
            "xmpp_domain": settings.XMPP_DOMAIN,
            "chat_config": {
                "domain": settings.XMPP_DOMAIN,
                "websocket_url": settings.XMPP_WEBSOCKET_URL,
                "websocket_port": settings.XMPP_WEBSOCKET_PORT,
            },
        },
    )


# O cadastro é público neste laboratório e protegido por CSRF. O navegador não
# recebe a credencial administrativa; somente este backend conversa com a API.
@require_POST
@never_cache
@sensitive_post_parameters("senha")
@sensitive_variables()
def create_account(request):
    if request.content_type != "application/json":
        return JsonResponse(
            {"ok": False, "message": "Envie os dados no formato JSON."}, status=415
        )
    try:
        data = json.loads(request.body)
    except (ValueError, UnicodeDecodeError):
        return JsonResponse(
            {"ok": False, "message": "Os dados enviados não são um JSON válido."},
            status=400,
        )
    if (
        not isinstance(data, dict)
        or set(data) - {"usuario", "senha"}
        or any(not isinstance(value, str) for value in data.values())
    ):
        return JsonResponse(
            {"ok": False, "message": "Envie somente usuário e senha como texto."},
            status=400,
        )

    form = AccountForm(data)
    if not form.is_valid():
        return JsonResponse(
            {"ok": False, "message": "Confira os campos indicados.", "errors": dict(form.errors)},
            status=400,
        )
    try:
        jid = register_account(form.cleaned_data["usuario"], form.cleaned_data["senha"])
    except RegistrationError as error:
        result = {"ok": False, "message": error.message}
        if error.field:
            result["errors"] = {error.field: [error.message]}
        return JsonResponse(result, status=error.status)

    return JsonResponse({"ok": True, "message": "Conta criada com sucesso.", "jid": jid}, status=201)


@require_GET
def health(request):
    return JsonResponse({"status": "ok"})


def csrf_failure(request, reason=""):
    message = "Recarregue a página antes de enviar o cadastro novamente."
    if request.path.startswith("/api/"):
        return JsonResponse({"ok": False, "message": message}, status=403)
    return render(request, "cadastro/error.html", {"message": message}, status=403)
