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

  // Strophe cuida do WebSocket, XML, SASL e vínculo da sessão XMPP.
  // Este adaptador traduz seus eventos para a interface e trata as extensões do chat.
  class XmppClient extends EventTarget {
    constructor() {
      super();
      this.state = "offline";
      this.connection = null;
      this.seen = new Set();
    }

    static bareJid(jid) {
      return jid.split("/")[0].toLowerCase();
    }

    static endpointUrl(config) {
      if (config.websocket_url) return config.websocket_url;
      const url = new URL(location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url.port = String(config.websocket_port);
      url.pathname = "/websocket";
      url.search = "";
      url.hash = "";
      return url.href;
    }

    static normalizeJid(value, domain) {
      let jid = value.trim().toLowerCase();
      if (!jid.includes("@")) jid += "@" + domain;
      if (!/^[^@\s/\x00-\x1f\x7f]+@[^@\s/\x00-\x1f\x7f]+$/.test(jid)) {
        throw new Error(
          "Informe um usuário ou endereço válido, como nome@" +
            domain +
            ".",
        );
      }
      return jid;
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
      this.setState("connecting");
      const connection = new Strophe.Connection(url);
      this.connection = connection;
      this.handshakeTimer = setTimeout(() => {
        if (connection === this.connection) {
          this.fail(
            "Não foi possível concluir a conexão com o chat. Verifique o endereço, a porta do WebSocket e o firewall do servidor.",
          );
        }
      }, 15000);
      connection.connect(
        username + "@" + domain + "/" + connection.getUniqueId("navegador"),
        password,
        (status) => this.onStatus(connection, status),
      );
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
          connection.addHandler(
            (stanza) => {
              if (connection !== this.connection) return false;
              this.receiveMessage(stanza);
              return true;
            },
            null,
            "message",
          );
          connection.addHandler(
            (stanza) => {
              if (connection !== this.connection) return false;
              this.receiveIq(stanza);
              return true;
            },
            null,
            "iq",
            ["get", "set"],
          );
          connection.addTimedHandler(30000, () => {
            if (connection !== this.connection) return false;
            connection.sendIQ(
              $iq({ type: "get", to: connection.domain }).c("ping", {
                xmlns: NS.ping,
              }),
              null,
              (stanza) => {
                // Uma resposta de erro também indica que o servidor está respondendo.
                if (!stanza && connection === this.connection) {
                  this.fail(
                    "O servidor parou de responder. Entre novamente para reconectar.",
                  );
                }
              },
              15000,
            );
            return true;
          });
          connection.send($pres());
          this.setState("online");
          break;
        case Strophe.Status.AUTHFAIL:
          this.fail(
            "Não foi possível autenticar sua conta. Confira o usuário e a senha e tente novamente.",
          );
          break;
        case Strophe.Status.ERROR:
        case Strophe.Status.CONNFAIL:
        case Strophe.Status.CONNTIMEOUT:
          this.fail(
            "Não foi possível conectar ao chat. Verifique o domínio, o ejabberd e a porta do WebSocket.",
          );
          break;
        case Strophe.Status.DISCONNECTED:
          clearTimeout(this.handshakeTimer);
          connection.pass = "";
          this.connection = null;
          this.setState(
            "offline",
            "A conexão foi encerrada. Entre novamente para continuar.",
          );
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
        ...(stanza.getAttribute("from")
          ? { to: stanza.getAttribute("from") }
          : {}),
      });
      if (
        stanza.getAttribute("type") === "get" &&
        child(stanza, NS.ping, "ping")
      ) {
        this.connection.send(response);
        return;
      }
      const query = child(stanza, NS.disco, "query");
      if (stanza.getAttribute("type") === "get" && query) {
        response
          .c("query", {
            xmlns: NS.disco,
            ...(query.hasAttribute("node")
              ? { node: query.getAttribute("node") }
              : {}),
          })
          .c("identity", { category: "client", type: "web", name: "Conversa" })
          .up();
        for (const namespace of [NS.disco, NS.ping, NS.receipts]) {
          response.c("feature", { var: namespace }).up();
        }
      } else {
        response
          .attrs({ type: "error" })
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
        this.emit("send-error", { from: XmppClient.bareJid(from), id });
        return;
      }
      if (!["chat", "normal"].includes(type)) return;
      const receipt = child(stanza, NS.receipts, "received");
      if (receipt) {
        this.emit("receipt", {
          from: XmppClient.bareJid(from),
          id: receipt.getAttribute("id"),
        });
      }
      const body = child(stanza, NS.client, "body");
      if (!body?.textContent) return;
      if (id && child(stanza, NS.receipts, "request")) {
        this.connection.send(
          $msg({ type: "chat", to: from }).c("received", {
            xmlns: NS.receipts,
            id,
          }),
        );
      }
      const key = from + "\0" + id;
      if (id && this.seen.has(key)) return;
      if (id) {
        this.seen.add(key);
        if (this.seen.size > 2000)
          this.seen.delete(this.seen.values().next().value);
      }
      const stamp = child(stanza, NS.delay, "delay")?.getAttribute("stamp");
      const date = stamp ? new Date(stamp) : new Date();
      this.emit("message", {
        from: XmppClient.bareJid(from),
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
        $msg({ type: "chat", to, id })
          .c("body")
          .t(body)
          .up()
          .c("request", { xmlns: NS.receipts }),
      );
      return id;
    }
  }

  window.XmppClient = XmppClient;
})();
