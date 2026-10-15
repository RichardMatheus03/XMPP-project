"use strict";

const form = document.querySelector("#account-form");
const username = document.querySelector("#id_usuario");
const password = document.querySelector("#id_senha");
const preview = document.querySelector("#jid-preview");
const submitButton = document.querySelector("#submit-button");
const message = document.querySelector("#form-message");
const success = document.querySelector("#success-panel");
const toggle = document.querySelector("#toggle-password");

function updatePreview() {
  preview.textContent = `${username.value.trim().toLowerCase() || "seu.nome"}@${preview.dataset.domain}`;
}

function clearErrors() {
  message.hidden = true;
  for (const name of ["usuario", "senha"]) {
    document.querySelector(`#${name}-error`).hidden = true;
    form.elements[name].removeAttribute("aria-invalid");
  }
}

function showErrors(data) {
  message.textContent = data.message || "Não foi possível concluir o cadastro.";
  message.hidden = false;
  let firstInvalid;
  for (const name of ["usuario", "senha"]) {
    if (!data.errors?.[name]) continue;
    const error = document.querySelector(`#${name}-error`);
    error.textContent = data.errors[name].join(" ");
    error.hidden = false;
    form.elements[name].setAttribute("aria-invalid", "true");
    firstInvalid ||= form.elements[name];
  }
  firstInvalid?.focus();
}

function hidePassword() {
  password.type = "password";
  toggle.textContent = "Mostrar";
  toggle.setAttribute("aria-pressed", "false");
}

username.addEventListener("input", updatePreview);
toggle.addEventListener("click", () => {
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  toggle.textContent = visible ? "Ocultar" : "Mostrar";
  toggle.setAttribute("aria-pressed", String(visible));
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (submitButton.disabled) return;
  clearErrors();
  submitButton.disabled = true;
  submitButton.textContent = "Criando sua conta…";
  form.setAttribute("aria-busy", "true");

  try {
    const response = await fetch(form.action, {
      method: "POST",
      mode: "same-origin",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "X-CSRFToken": form.elements.csrfmiddlewaretoken.value,
      },
      body: JSON.stringify({ usuario: username.value, senha: password.value }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      showErrors(data);
      return;
    }
    password.value = "";
    hidePassword();
    document.querySelector("#created-jid").textContent = data.jid;
    form.hidden = true;
    document.querySelector(".intro").hidden = true;
    success.hidden = false;
    success.focus();
    document.title = "Conta criada · Conversa";
  } catch {
    showErrors({ message: "Não foi possível confirmar o cadastro. Confira sua conexão e tente entrar com os dados escolhidos antes de repetir." });
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Criar minha conta →";
    form.removeAttribute("aria-busy");
  }
});

document.querySelector("#new-account").addEventListener("click", () => {
  form.reset();
  clearErrors();
  hidePassword();
  updatePreview();
  success.hidden = true;
  document.querySelector(".intro").hidden = false;
  form.hidden = false;
  document.title = "Criar conta · Conversa";
  username.focus();
});

updatePreview();
