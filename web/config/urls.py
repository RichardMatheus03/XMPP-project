from django.urls import path

from cadastro import views

urlpatterns = [
    path("", views.index, name="cadastro"),
    path("chat/", views.chat, name="chat"),
    path("api/contas/", views.create_account, name="create-account"),
    path("healthz/", views.health, name="health"),
]
