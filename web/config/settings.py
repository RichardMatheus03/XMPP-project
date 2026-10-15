import os
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
if not SECRET_KEY:
    raise ImproperlyConfigured("Defina DJANGO_SECRET_KEY no ambiente.")

DEBUG = False
ALLOWED_HOSTS = [
    host.strip()
    for host in os.environ.get(
        "DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,[::1]"
    ).split(",")
    if host.strip()
]

INSTALLED_APPS = ["django.contrib.staticfiles", "cadastro"]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]
ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.template.context_processors.csrf",
            ]
        },
    }
]

# O ejabberd armazena as contas XMPP; esta aplicação não mantém uma cópia delas.
DATABASES = {}
LANGUAGE_CODE = "pt-br"
TIME_ZONE = "America/Fortaleza"
USE_I18N = True
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"
    },
}
CSRF_COOKIE_HTTPONLY = True
CSRF_COOKIE_SAMESITE = "Strict"
CSRF_FAILURE_VIEW = "cadastro.views.csrf_failure"
DATA_UPLOAD_MAX_MEMORY_SIZE = 4096
X_FRAME_OPTIONS = "DENY"
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"

XMPP_DOMAIN = os.environ.get("XMPP_DOMAIN", "localhost")
# Endereço público acessado pelo navegador, separado da API interna do Docker.
XMPP_WEBSOCKET_URL = os.environ.get("XMPP_WEBSOCKET_URL", "")
XMPP_WEBSOCKET_PORT = int(os.environ.get("XMPP_WEBSOCKET_PORT", "5280"))
EJABBERD_ADMIN_JID = (
    f"{os.environ.get('EJABBERD_ADMIN_USER', 'admin')}@{XMPP_DOMAIN}"
)
EJABBERD_ADMIN_PASSWORD = os.environ.get("EJABBERD_ADMIN_PASSWORD", "")
EJABBERD_API_HOST = os.environ.get("EJABBERD_API_HOST", "ejabberd")
EJABBERD_API_PORT = int(os.environ.get("EJABBERD_API_PORT", "5443"))
EJABBERD_TLS_SERVER_NAME = os.environ.get("EJABBERD_TLS_SERVER_NAME", "localhost")
EJABBERD_CA_FILE = os.environ.get(
    "EJABBERD_CA_FILE", str(BASE_DIR.parent / "certs" / "ejabberd.crt")
)
