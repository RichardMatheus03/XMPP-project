from django import forms


class AccountForm(forms.Form):
    usuario = forms.RegexField(
        regex=r"^[a-z0-9][a-z0-9._-]*$",
        min_length=3,
        max_length=64,
        error_messages={
            "required": "Escolha um nome de usuário.",
            "invalid": "Use letras, números, ponto, hífen ou sublinhado. Comece com uma letra ou número.",
            "min_length": "Use pelo menos 3 caracteres.",
            "max_length": "Use no máximo 64 caracteres.",
        },
    )
    senha = forms.CharField(
        min_length=8,
        max_length=128,
        strip=False,
        widget=forms.PasswordInput,
        error_messages={
            "required": "Escolha uma senha.",
            "min_length": "A senha precisa ter pelo menos 8 caracteres.",
            "max_length": "A senha pode ter no máximo 128 caracteres.",
        },
    )

    def __init__(self, data=None, *args, **kwargs):
        if data is not None:
            data = data.copy()
            if isinstance(data.get("usuario"), str):
                data["usuario"] = data["usuario"].strip().lower()
        super().__init__(data, *args, **kwargs)
