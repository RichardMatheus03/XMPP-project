FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .
# Esta chave é usada somente na coleta dos arquivos estáticos durante o build.
# A chave real é fornecida pelo Compose quando o container é iniciado.
RUN DJANGO_SECRET_KEY=chave-utilizada-somente-no-build python manage.py collectstatic --noinput \
    && useradd --uid 10001 --create-home app

USER app
EXPOSE 8000

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "2", "--timeout", "20", "--access-logfile", "-", "--error-logfile", "-"]
