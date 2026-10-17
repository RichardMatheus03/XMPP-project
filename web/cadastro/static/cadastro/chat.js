"use strict";

(() => {
  const NS = {
    client: "jabber:client",
    receipts: "urn:xmpp:receipts",
    ping: "urn:xmpp:ping",
    disco: "http://jabber.org/protocol/disco#info",
    delay: "urn:xmpp:delay",
  };
  const child = (element, namespace, name) =>
    Array.from(element.children).find(
      (node) => node.namespaceURI === namespace && node.localName === name,
    );
  const bare = (jid) => jid.split("/")[0].toLowerCase();

  // Strophe cuida do WebSocket, XML, SASL e vínculo da sessão XMPP.
  // Este adaptador traduz seus eventos para a interface e trata as extensões do chat.
  class XmppClient extends EventTarget {
    constructor() {
      super();
      this.state = "offline";
      this.connection = null;
      this.seen = new Set();
    }

    emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    setState(state, message = "") {
      this.state = state;
      this.emit("state", { state, message, jid: this.jid || "" });
    }

    connect(url, username, password, domain) {
      this.disconnect();
      this.jid = "";
      this.seen.clear();
      if (!window.Strophe) {
        this.fail("Não foi possível carregar a biblioteca do chat. Recarregue a página e tente novamente.");
        return;
      }
      let endpoint;
      try {
        endpoint = new URL(url);
        if (!["ws:", "wss:"].includes(endpoint.protocol)) throw new Error();
        if (location.protocol === "https:" && endpoint.protocol !== "wss:") {
          throw new Error("Esta página HTTPS precisa de uma conexão wss://. Ajuste XMPP_WEBSOCKET_URL.");
        }
      } catch (error) {
        this.fail(error.message.includes("HTTPS") ? error.message : "O endereço de conexão com o chat é inválido.");
        return;
      }
      this.setState("connecting");
      try {
        const connection = new Strophe.Connection(endpoint.href);
        this.connection = connection;
        this.handshakeTimer = setTimeout(() => {
          if (connection === this.connection) {
            this.fail("Não foi possível concluir a conexão com o chat. Verifique o endereço, a porta do WebSocket e o firewall do servidor.");
          }
        }, 15000);
        connection.connect(
          username + "@" + domain + "/" + connection.getUniqueId("navegador"),
          password,
          (status) => this.onStatus(connection, status),
        );
      } catch {
        this.fail("Não foi possível conectar ao chat. Verifique o ejabberd e a porta do WebSocket.");
      }
    }

    onStatus(connection, status) {
      // Eventos de uma tentativa anterior não devem alterar a conexão atual.
      if (connection !== this.connection) return;
      switch (status) {
        case Strophe.Status.AUTHENTICATING:
          this.setState("authenticating");
          break;
        case Strophe.Status.CONNECTED:
          clearTimeout(this.handshakeTimer);
          connection.pass = "";
          this.jid = connection.jid;
          connection.addHandler((stanza) => {
            if (connection !== this.connection) return false;
            this.receiveMessage(stanza);
            return true;
          }, null, "message");
          connection.addHandler((stanza) => {
            if (connection !== this.connection) return false;
            this.receiveIq(stanza);
            return true;
          }, null, "iq", ["get", "set"]);
          connection.addTimedHandler(30000, () => {
            if (connection !== this.connection) return false;
            try {
              connection.sendIQ(
                $iq({ type: "get", to: connection.domain }).c("ping", { xmlns: NS.ping }),
                null,
                (stanza) => {
                  // Uma resposta de erro também indica que o servidor está respondendo.
                  if (!stanza && connection === this.connection) {
                    this.fail("O servidor parou de responder. Entre novamente para reconectar.");
                  }
                },
                15000,
              );
              return true;
            } catch {
              this.fail("A conexão foi interrompida. Entre novamente.");
              return false;
            }
          });
          connection.send($pres());
          this.setState("online");
          break;
        case Strophe.Status.AUTHFAIL:
          this.fail("Não foi possível autenticar sua conta. Confira o usuário e a senha e tente novamente.");
          break;
        case Strophe.Status.ERROR:
        case Strophe.Status.CONNFAIL:
        case Strophe.Status.CONNTIMEOUT:
          this.fail("Não foi possível conectar ao chat. Verifique o domínio, o ejabberd e a porta do WebSocket.");
          break;
        case Strophe.Status.DISCONNECTED:
          clearTimeout(this.handshakeTimer);
          connection.pass = "";
          this.connection = null;
          this.setState("offline", "A conexão foi encerrada. Entre novamente para continuar.");
          break;
      }
    }

    closeConnection() {
      const connection = this.connection;
      this.connection = null;
      clearTimeout(this.handshakeTimer);
      if (connection) {
        connection.pass = "";
        connection.disconnect();
      }
    }

    fail(message) {
      this.closeConnection();
      this.setState("error", message);
    }

    disconnect() {
      this.closeConnection();
      this.setState("offline");
    }

    receiveIq(stanza) {
      const response = $iq({
        type: "result",
        id: stanza.getAttribute("id"),
        ...(stanza.getAttribute("from") ? { to: stanza.getAttribute("from") } : {}),
      });
      if (stanza.getAttribute("type") === "get" && child(stanza, NS.ping, "ping")) {
        this.connection.send(response);
        return;
      }
      const query = child(stanza, NS.disco, "query");
      if (stanza.getAttribute("type") === "get" && query) {
        response.c("query", {
          xmlns: NS.disco,
          ...(query.hasAttribute("node") ? { node: query.getAttribute("node") } : {}),
        }).c("identity", { category: "client", type: "web", name: "Conversa" }).up();
        for (const namespace of [NS.disco, NS.ping, NS.receipts]) {
          response.c("feature", { var: namespace }).up();
        }
      } else {
        response.attrs({ type: "error" })
          .c("error", { type: "cancel" })
          .c("service-unavailable", { xmlns: Strophe.NS.STANZAS });
      }
      this.connection.send(response);
    }

    receiveMessage(stanza) {
      const from = stanza.getAttribute("from") || "";
      const id = stanza.getAttribute("id") || "";
      const type = stanza.getAttribute("type") || "normal";
      if (!from) return;
      if (type === "error") {
        this.emit("send-error", { from: bare(from), id });
        return;
      }
      if (!["chat", "normal"].includes(type)) return;
      const receipt = child(stanza, NS.receipts, "received");
      if (receipt) {
        this.emit("receipt", { from: bare(from), id: receipt.getAttribute("id") });
      }
      const body = child(stanza, NS.client, "body");
      if (!body?.textContent) return;
      if (id && child(stanza, NS.receipts, "request")) {
        this.connection.send(
          $msg({ type: "chat", to: from }).c("received", { xmlns: NS.receipts, id }),
        );
      }
      const key = from + "\0" + id;
      if (id && this.seen.has(key)) return;
      if (id) {
        this.seen.add(key);
        if (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
      }
      const stamp = child(stanza, NS.delay, "delay")?.getAttribute("stamp");
      const date = stamp ? new Date(stamp) : new Date();
      this.emit("message", {
        from: bare(from),
        body: body.textContent,
        id,
        date: Number.isNaN(date.getTime()) ? new Date() : date,
      });
    }

    sendMessage(to, body) {
      if (this.state !== "online" || !this.connection?.authenticated) {
        throw new Error("Entre na sua conta antes de enviar mensagens.");
      }
      const id = this.connection.getUniqueId("message");
      this.connection.send(
        $msg({ type: "chat", to, id }).c("body").t(body).up()
          .c("request", { xmlns: NS.receipts }),
      );
      return id;
    }
  }

  const config = JSON.parse(document.querySelector("#chat-config").textContent);
  const $ = (selector) => document.querySelector(selector);
  const shell = $("#chat-shell");
  const loginPanel = $("#login-panel");
  const loginForm = $("#login-form");
  const userInput = $("#login-user");
  const passwordInput = $("#login-password");
  const loginButton = $("#login-button");
  const loginError = $("#login-error");
  const loginToggle = $("#toggle-password");
  const emptyPanel = $("#empty-panel");
  const messageLog = $("#messages");
  const messageForm = $("#message-form");
  const messageInput = $("#message-input");
  const sendButton = $("#send-message");
  const search = $("#conversation-search");
  const dialog = $("#conversation-dialog");
  const recipientInput = $("#recipient");
  const client = new XmppClient();
  // Histórico e rascunhos existem somente nesta aba, sem armazenamento persistente.
  const conversations = new Map();
  const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" });
  let activeJid = "";
  let accountJid = "";

  function endpointUrl() {
    if (config.websocket_url) return config.websocket_url;
    const url = new URL(location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    url.port = String(config.websocket_port);
    url.pathname = "/websocket";
    url.search = "";
    url.hash = "";
    return url.href;
  }

  function normalizeJid(value) {
    let jid = value.trim().toLowerCase();
    if (!jid.includes("@")) jid += "@" + config.domain;
    if (!/^[^@\s/\x00-\x1f\x7f]+@[^@\s/\x00-\x1f\x7f]+$/.test(jid)) {
      throw new Error("Informe um usuário ou endereço válido, como nome@" + config.domain + ".");
    }
    return jid;
  }

  const displayName = (jid) => jid.split("@")[0];
  const initials = (jid) => displayName(jid).slice(0, 2).toUpperCase();
  const isOnline = () => client.state === "online";
  const showError = (element, message) => { element.textContent = message; element.hidden = !message; };

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function getConversation(jid) {
    if (!conversations.has(jid)) conversations.set(jid, { jid, messages: [], unread: 0, draft: "" });
    return conversations.get(jid);
  }

  function renderConversations() {
    const list = $("#conversation-list");
    const filter = search.value.trim().toLowerCase();
    const items = Array.from(conversations.values()).sort((a, b) =>
      (b.messages.at(-1)?.date.getTime() || 0) - (a.messages.at(-1)?.date.getTime() || 0));
    const fragment = document.createDocumentFragment();
    let visible = 0;
    for (const conversation of items) {
      if (filter && !conversation.jid.includes(filter)) continue;
      visible++;
      const button = makeElement("button", "conversation");
      button.type = "button";
      button.disabled = !isOnline();
      button.setAttribute("aria-label", "Conversa com " + conversation.jid);
      button.setAttribute("aria-current", String(conversation.jid === activeJid));
      button.append(makeElement("span", "avatar", initials(conversation.jid)));
      const info = makeElement("span", "conversation-info");
      const line = makeElement("span", "conversation-line");
      line.append(makeElement("span", "conversation-name", displayName(conversation.jid)));
      const last = conversation.messages.at(-1);
      if (last) line.append(makeElement("time", "conversation-time", timeFormat.format(last.date)));
      info.append(line, makeElement("span", "conversation-preview",
        last ? (last.outgoing ? "Você: " : "") + last.body : "Nenhuma mensagem ainda"));
      button.append(info);
      if (conversation.unread) button.append(makeElement("span", "unread", String(conversation.unread)));
      button.addEventListener("click", () => selectConversation(conversation.jid));
      fragment.append(button);
    }
    list.replaceChildren(fragment);
    $("#sidebar-empty").hidden = visible > 0;
    $("#sidebar-empty-text").textContent = filter ? "Nenhuma conversa encontrada." :
      (isOnline() ? "Sua próxima conversa começa aqui." : "Um lugar para suas conversas.");
    $("#sidebar-empty-help").textContent = filter ? "Tente outro nome." :
      (isOnline() ? "Use o + para falar com alguém." : "Entre na sua conta para começar.");
  }

  function setMessageStatus(message, status) {
    message.status = status;
    if (message.statusElement) {
      message.statusElement.dataset.status = status;
      message.statusElement.textContent = { sent: "Enviada", delivered: "Entregue", failed: "Não entregue" }[status];
    }
  }

  function appendMessage(message) {
    const previousDay = messageLog.lastElementChild?.dataset.day;
    const day = message.date.toLocaleDateString("pt-BR");
    if (previousDay !== day) {
      messageLog.append(makeElement("div", "day-divider",
        day === new Date().toLocaleDateString("pt-BR") ? "Hoje" : dayFormat.format(message.date)));
    }
    const row = makeElement("div", "message-row" + (message.outgoing ? " outgoing" : ""));
    row.dataset.day = day;
    const bubble = makeElement("div", "message-bubble");
    bubble.append(makeElement("p", "message-body", message.body));
    const meta = makeElement("div", "message-meta");
    const time = makeElement("time", "", timeFormat.format(message.date));
    time.dateTime = message.date.toISOString();
    if (message.outgoing) {
      message.statusElement = makeElement("span", "message-status");
      setMessageStatus(message, message.status);
      meta.append(message.statusElement);
    }
    meta.append(time);
    bubble.append(meta);
    row.append(bubble);
    messageLog.append(row);
    messageLog.scrollTop = messageLog.scrollHeight;
  }

  function selectConversation(jid) {
    if (!isOnline()) return;
    if (activeJid && conversations.has(activeJid)) conversations.get(activeJid).draft = messageInput.value;
    activeJid = jid;
    const conversation = getConversation(jid);
    messageInput.value = conversation.draft;
    conversation.unread = 0;
    shell.classList.add("show-thread");
    loginPanel.hidden = true;
    emptyPanel.hidden = true;
    messageLog.hidden = false;
    messageForm.hidden = false;
    $("#thread-name").textContent = displayName(jid);
    $("#thread-detail").textContent = jid;
    $("#thread-avatar").textContent = initials(jid);
    $("#thread-avatar").hidden = false;
    $("#thread-kind").hidden = false;
    showError($("#chat-notice"), "");
    messageLog.replaceChildren();
    for (const message of conversation.messages) appendMessage(message);
    renderConversations();
    updateComposer();
    messageInput.focus();
  }

  function updateComposer() {
    messageInput.disabled = !isOnline() || !activeJid;
    sendButton.disabled = messageInput.disabled || !messageInput.value.trim();
    messageInput.style.height = "auto";
    messageInput.style.height = Math.min(messageInput.scrollHeight, 130) + "px";
  }

  function resetThreadHeading() {
    $("#thread-name").textContent = "Seu espaço de conversa";
    $("#thread-detail").textContent = "Simples. Direto. Do seu jeito.";
    $("#thread-avatar").hidden = true;
    $("#thread-kind").hidden = true;
  }

  function openConversationDialog() {
    if (!isOnline()) return;
    recipientInput.value = "";
    showError($("#recipient-error"), "");
    dialog.showModal();
  }

  client.addEventListener("state", ({ detail }) => {
    const { state, message, jid } = detail;
    const busy = ["connecting", "authenticating"].includes(state);
    const online = state === "online";
    const label = $("#connection-label");
    label.dataset.state = state;
    label.textContent = {
      connecting: "Conectando…", authenticating: "Autenticando…", online: "Conectado",
      offline: "Desconectado", error: "Falha na conexão",
    }[state];
    loginButton.disabled = busy;
    loginButton.textContent = busy ? "Conectando…" : "Entrar no chat →";
    userInput.disabled = busy;
    passwordInput.disabled = busy;
    loginForm.setAttribute("aria-busy", String(busy));
    $("#new-conversation").disabled = !online;
    $("#disconnect").hidden = !online;
    search.disabled = !online;
    shell.classList.toggle("is-online", online);
    if (online) {
      const newAccount = bare(jid);
      if (accountJid !== newAccount) {
        conversations.clear();
        activeJid = "";
        messageInput.value = "";
        search.value = "";
        messageLog.replaceChildren();
      }
      accountJid = newAccount;
      $("#self-name").textContent = accountJid;
      $("#self-avatar").textContent = initials(accountJid);
      loginPanel.hidden = true;
      if (activeJid) selectConversation(activeJid);
      else {
        emptyPanel.hidden = false;
        shell.classList.remove("show-thread");
        resetThreadHeading();
      }
      showError(loginError, "");
    } else if (!busy) {
      loginPanel.hidden = false;
      emptyPanel.hidden = true;
      messageLog.hidden = true;
      messageForm.hidden = true;
      resetThreadHeading();
      shell.classList.remove("show-thread");
      if (dialog.open) dialog.close();
      if (message) showError(loginError, message);
    }
    updateComposer();
    renderConversations();
  });

  loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (loginButton.disabled) return;
    showError(loginError, "");
    let jid;
    try {
      jid = normalizeJid(userInput.value);
      if (jid.split("@")[1] !== config.domain.toLowerCase()) {
        throw new Error("Use sua conta @" + config.domain + " para entrar neste servidor.");
      }
      if (!passwordInput.value) throw new Error("Informe sua senha.");
    } catch (error) {
      showError(loginError, error.message);
      return;
    }
    const password = passwordInput.value;
    passwordInput.value = "";
    passwordInput.type = "password";
    loginToggle.textContent = "Mostrar";
    loginToggle.setAttribute("aria-pressed", "false");
    client.connect(endpointUrl(), jid.split("@")[0], password, config.domain);
  });

  loginToggle.addEventListener("click", () => {
    const visible = passwordInput.type === "password";
    passwordInput.type = visible ? "text" : "password";
    loginToggle.textContent = visible ? "Ocultar" : "Mostrar";
    loginToggle.setAttribute("aria-pressed", String(visible));
  });
  $("#new-conversation").addEventListener("click", openConversationDialog);
  $("#start-conversation").addEventListener("click", openConversationDialog);
  $("#cancel-conversation").addEventListener("click", () => dialog.close());
  $("#recipient-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const jid = normalizeJid(recipientInput.value);
      if (jid === accountJid) throw new Error("Informe a conta de outra pessoa para iniciar a conversa.");
      selectConversation(jid);
      dialog.close();
      messageInput.focus();
    } catch (error) {
      showError($("#recipient-error"), error.message);
    }
  });
  search.addEventListener("input", renderConversations);
  $("#back-to-conversations").addEventListener("click", () => shell.classList.remove("show-thread"));
  $("#disconnect").addEventListener("click", () => {
    client.disconnect();
    conversations.clear();
    activeJid = "";
    accountJid = "";
    search.value = "";
    messageInput.value = "";
    messageLog.replaceChildren();
    $("#self-name").textContent = "Sua conta";
    $("#self-avatar").textContent = "C";
    showError(loginError, "");
    showError($("#chat-notice"), "");
    renderConversations();
    userInput.focus();
  });

  messageInput.addEventListener("input", updateComposer);
  messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      if (!sendButton.disabled) messageForm.requestSubmit();
    }
  });
  messageForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const body = messageInput.value.trim();
    if (!body || !activeJid || !isOnline()) return;
    try {
      const id = client.sendMessage(activeJid, body);
      const message = { id, body, outgoing: true, date: new Date(), status: "sent" };
      getConversation(activeJid).messages.push(message);
      appendMessage(message);
      messageInput.value = "";
      getConversation(activeJid).draft = "";
      showError($("#chat-notice"), "");
      updateComposer();
      renderConversations();
      messageInput.focus();
    } catch (error) {
      showError($("#chat-notice"), error.message);
    }
  });

  client.addEventListener("message", ({ detail }) => {
    const conversation = getConversation(detail.from);
    const message = { ...detail, outgoing: false };
    conversation.messages.push(message);
    if (activeJid === detail.from) appendMessage(message);
    if (activeJid !== detail.from || document.visibilityState !== "visible" ||
        (matchMedia("(max-width: 700px)").matches && !shell.classList.contains("show-thread"))) {
      conversation.unread++;
    }
    renderConversations();
  });
  client.addEventListener("receipt", ({ detail }) => {
    const message = conversations.get(detail.from)?.messages.find((item) => item.outgoing && item.id === detail.id);
    if (message) setMessageStatus(message, "delivered");
  });
  client.addEventListener("send-error", ({ detail }) => {
    const message = conversations.get(detail.from)?.messages.find((item) => item.outgoing && item.id === detail.id);
    if (!message) return;
    setMessageStatus(message, "failed");
    if (activeJid === detail.from) showError($("#chat-notice"),
      "Não foi possível entregar a mensagem. Confira o endereço e se a outra pessoa está conectada.");
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && isOnline() && activeJid &&
        (!matchMedia("(max-width: 700px)").matches || shell.classList.contains("show-thread"))) {
      getConversation(activeJid).unread = 0;
      renderConversations();
    }
  });
  window.addEventListener("pagehide", () => client.disconnect());
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) showError(loginError, "Entre novamente para reconectar ao chat.");
  });
  renderConversations();
})();
