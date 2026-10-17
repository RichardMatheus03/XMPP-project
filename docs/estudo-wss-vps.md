Estudo de WSS direto no ejabberd, usando o IP público
====================================================

Atualizado em 16/10/2026. Escopo esclarecido pelo usuário: proteger somente a
conexão WebSocket entre o cliente JavaScript no navegador e o servidor XMPP.
A proposta anterior de Nginx e HTTPS para a aplicação Django foi substituída
pelo cenário abaixo. Não há necessidade de proxy reverso para este objetivo.
Nenhuma configuração de execução foi alterada e nenhum teste foi executado.

1. **Arquitetura**

   ```text
   Cliente JavaScript / Strophe no navegador
                  ⇅
        WSS: TCP + TLS + WebSocket
                  ⇅
            ejabberd na VPS
                  ⇅
        Sessão XMPP do usuário @tiot
   ```

   O próprio ejabberd recebe a conexão TLS, apresenta seu certificado e trata o
   WebSocket. O TLS desse canal termina no servidor XMPP, sem intermediário.
   O transporte WSS não exige configurar HTTPS na aplicação Django.

   O WebSocket usa um handshake HTTP Upgrade dentro do canal TLS. Por isso o
   módulo do ejabberd se chama `ejabberd_http`, mesmo quando se publica apenas
   `/websocket`. Esse funcionamento não exige um site, Nginx nem porta HTTP
   sem TLS aberta para o chat.
   [Fonte: WebSocket no ejabberd](https://docs.ejabberd.im/archive/26.09/listen/#ejabberd_http_ws).

2. **Configuração já existente**

   O listener interno 5443 já tem `module: ejabberd_http`, `tls: true` e
   `/websocket: ejabberd_http_ws` em
   [ejabberd.yml](</home/richard/Documentos/UFRN 2026.2/unidade II/aplicacao-ejabberd/ejabberd/ejabberd.yml:68>).
   Portanto, o servidor já contém a combinação necessária para WSS.

   Atualmente, o Compose publica essa porta apenas em `127.0.0.1`, e o
   certificado configurado identifica `localhost`. Isso impede usar esse
   endpoint diretamente pelo IP público com validação TLS normal do navegador.

   O cliente em
   [xmpp-client.js](</home/richard/Documentos/UFRN 2026.2/unidade II/aplicacao-ejabberd/web/cadastro/static/cadastro/xmpp-client.js:30>)
   já aceita a URL explícita recebida de `XMPP_WEBSOCKET_URL`. O domínio das
   contas pode continuar como `tiot`; ele é independente do IP usado no WSS.

3. **O que configurar na VPS**

   - Instalar no ejabberd um certificado com o IP público no SAN do tipo
     `iPAddress`, sua cadeia e a chave privada correspondente. A cadeia precisa
     ser confiável para os navegadores que acessarão o chat.
   - Montar os arquivos necessários no container, somente para leitura, com
     permissões que permitam ao processo ejabberd ler a chave.
   - Configurar os certificados em `certfiles` e garantir que o certificado do
     IP seja apresentado nas conexões WSS, inclusive sem SNI de nome DNS.
   - Publicar a porta TLS escolhida no Compose e liberá-la no firewall da VPS
     e nas regras de entrada do provedor.
   - Definir `XMPP_WEBSOCKET_URL` com o IP e a porta pública corretos; recriar
     o container web para aplicar a variável.
   - Para certificados com expiração, renovar e fazer o ejabberd carregar os
     arquivos atualizados.

   O certificado atual de `localhost` não autentica `20.87.218.69`. Um
   certificado autoassinado para o IP funcionaria somente com a confiança
   instalada nos dispositivos. Para acesso comum pelos navegadores, usar uma
   CA pública que emita certificados de IP.

   O Let's Encrypt disponibiliza certificados de IP com validade de 160 horas;
   a renovação automática precisa acompanhar essa validade.
   [Fonte: certificados para IP](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability).

4. **Porta existente ou listener exclusivo**

   Reutilizar 5443 é possível, publicando, por exemplo, a porta 5443 do host para
   5443 do container e configurando:

   ```dotenv
   XMPP_WEBSOCKET_URL=wss://20.87.218.69:5443/websocket
   ```

   Porém, o listener atual também atende `/admin`, `/api` e outros handlers.
   Para publicar exclusivamente o WebSocket, a proposta é acrescentar um
   listener com TLS e apenas este handler, por exemplo:

   ```yaml
   # Novo item na lista listen; certificados configurados em certfiles.
   - port: 5444
     ip: "::"
     module: ejabberd_http
     tls: true
     request_handlers:
       /websocket: ejabberd_http_ws
   ```

   No Compose, acrescentar ao serviço ejabberd:

   ```yaml
   ports:
     # Acrescentar aos mapeamentos existentes; não substituir toda a lista.
     - "0.0.0.0:443:5444"
   ```

   O mapeamento Docker encaminha TCP; não termina TLS. O próprio ejabberd
   continua recebendo o handshake TLS e os dados cifrados. Com isso:

   ```dotenv
   XMPP_WEBSOCKET_URL=wss://20.87.218.69/websocket
   XMPP_DOMAIN=tiot
   ```

   Se for preferível usar outra porta pública, por exemplo 5444, publicar
   `0.0.0.0:5444:5444` e incluir `:5444` na URL. A porta 443 é uma escolha,
   não um requisito do WSS.
   [Fonte: TLS nos listeners](https://docs.ejabberd.im/archive/26.09/listen-options/#tls).

5. **Certificados e a integração de cadastro existente**

   A seleção de certificados do ejabberd é compartilhada e configurada em
   `certfiles`. Criar outra porta não garante isolamento de certificados.
   A implantação precisa conferir qual certificado é apresentado para o IP
   público e qual é apresentado ao backend Django, que atualmente pede a
   identidade TLS `localhost`.

   Se o certificado utilizado pelo endpoint interno mudar, atualizar também a
   confiança em `certs/ejabberd.crt` e, quando necessário,
   `EJABBERD_TLS_SERVER_NAME` para a identidade validada. O backend pode continuar
   conectando ao nome Docker `ejabberd`: o código já separa o destino de rede da
   identidade TLS esperada.

   A conexão HTTPS interna de cadastro já existe no projeto e é independente
   do objetivo de WSS direto. Este estudo não propõe removê-la.

6. **WSS e emissão de certificado são etapas diferentes**

   A conexão do chat por WSS não exige porta 80. A emissão do certificado pode
   ter requisitos próprios:

   - HTTP-01 valida o IP pela porta 80. É possível usar um cliente ACME
     standalone, sem Nginx, mas a porta deve estar disponível em cada emissão
     e renovação. Neste projeto ela já é ocupada pelo Django, então esse método
     exigiria planejar o acesso ao desafio.
   - Se a exigência também proibir HTTP sem TLS para a validação, TLS-ALPN-01
     permite validar IP pela porta 443 com um cliente ACME compatível com IP e
     esse desafio. É necessário coordenar a posse da porta com o ejabberd,
     possivelmente com breve interrupção durante a validação.
   - Uma CA privada ou um certificado autoassinado evita o desafio de uma CA
     pública, mas exige distribuir a confiança aos dispositivos clientes.

   TLS-ALPN-01 não equivale a servir um WebSocket na porta 443: é um protocolo
   específico de validação que o cliente ACME precisa atender. Não foi
   selecionado ou instalado um cliente ACME nesta etapa.
   [Fonte: desafios e suporte a IP](https://letsencrypt.org/docs/challenge-types/).

7. **Limites e critérios de aceite**

   A página pode continuar sendo entregue por HTTP e abrir a conexão WSS. Nesse
   caso, a proteção TLS solicitada cobre o canal WebSocket; a entrega da página
   e o cadastro HTTP mantêm sua configuração atual. Não é necessário alterar
   configurações HTTPS do Django para habilitar esse WSS direto.

   Os critérios de aceite de uma implementação futura são: certificado
   confiável e correspondente ao IP, handshake WebSocket 101, autenticação XMPP
   e mensagens usando a URL WSS, além do carregamento de certificados renovados.
   O listener público dedicado deve atender somente `/websocket`.

   O IP de exemplo veio do `.env` local e ainda precisa ser confirmado na VPS.
   A instalação depende também do sistema operacional e da forma escolhida para
   emitir o certificado. Este documento é um estudo, sem implantação ou testes.
