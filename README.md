# Cadastro e chat XMPP com Django e ejabberd

Uma aplicação Django serve a página de cadastro e recebe usuário e senha pela
API `POST /api/contas/`. Seu backend chama `POST /api/register` no ejabberd por
HTTPS, autenticado com a conta administrativa do `.env`.

```text
Navegador → página e API Django → API HTTPS do ejabberd → conta XMPP
           localhost:80          ejabberd:5443            nome@localhost
```

O Compose tem dois serviços:

- `web`: Django 5.2, Gunicorn e arquivos estáticos servidos pelo WhiteNoise.
- `ejabberd`: imagem oficial `ghcr.io/processone/ejabberd:26.09`, com contas
  persistidas em volumes Docker.

As contas são armazenadas pelo ejabberd. O Django não usa um banco de dados
próprio para esse cadastro, então não há modelos ou migrações nesta aplicação.
As credenciais administrativas são usadas exclusivamente no backend.

A configuração `ejabberd/ejabberd.yml` é baseada na imagem oficial e montada
somente para leitura. Ela acrescenta a permissão HTTP `django registration`,
que permite executar apenas `register` com autenticação de uma conta da ACL
`admin`. A regra HTTP original exige administrador **e** origem loopback;
outro container Docker não atende à condição de loopback.

## Iniciar

É necessário ter Docker e Docker Compose disponíveis. Nesta máquina, o `.env`
já contém a credencial administrativa existente e uma chave Django gerada.

```bash
cd "/home/richard/Documentos/UFRN 2026.2/unidade II/aplicacao-ejabberd"
docker compose up -d --build --wait
```

Abra **http://localhost**. Preencha usuário e senha e clique em **Criar
minha conta**. O endereço completo da conta aparece após a confirmação do
ejabberd. Por exemplo, o usuário `ana` resulta em `ana@localhost`.

O cadastro é público para quem consegue acessar a página. O Django é publicado
na porta `80` em todas as interfaces da máquina. As portas do ejabberd continuam
limitadas à máquina local (`127.0.0.1`). Para acesso ao Django pela VPS, inclua
seu IP ou domínio em `DJANGO_ALLOWED_HOSTS` e libere TCP `80` no firewall.

O formulário aceita nomes de 3 a 64 caracteres, começando com letra ou número,
e contendo letras, números, ponto, hífen ou sublinhado. Os nomes são convertidos
para minúsculas. A senha deve ter de 8 a 128 caracteres e é enviada sem remover
espaços. Ela não é armazenada no Django nem devolvida na resposta da API.

## Chat no navegador

Abra **http://localhost/chat/** (ou `/chat`, que redireciona para essa rota).
Entre com o usuário ou JID completo, como `ana@localhost`, e a senha escolhida
no cadastro. Use **+ / Nova conversa** para informar outra conta e conversar.
Enter envia; Shift + Enter insere uma linha. A busca filtra as conversas abertas.

O Django entrega o template e a configuração pública. O JavaScript nativo
conecta diretamente a `ws://localhost:5280/websocket`, negocia o fluxo XMPP,
autentica com SASL PLAIN, vincula um recurso e envia presença. Nenhuma credencial
administrativa é enviada ao navegador e não há dependências JavaScript externas.

```text
Navegador → Django /chat/ → template + JavaScript
Navegador ⇄ WebSocket :5280/websocket ⇄ ejabberd
```

O listener HTTP sem TLS é intencional para este laboratório local, com a porta
publicada somente em `127.0.0.1`. A conexão HTTPS de cadastro entre Django e
ejabberd continua usando o certificado existente. Para usar o chat por HTTPS,
configure `XMPP_WEBSOCKET_URL=wss://seu-servidor/websocket` e um endpoint TLS
com certificado confiável no navegador.

Sem `XMPP_WEBSOCKET_URL`, o cliente usa o host da página e a porta publicada
`EJABBERD_WEB_PORT`. O nome Docker `ejabberd` é utilizado apenas no backend.
Após mudar essa configuração, recrie o serviço web.

A senha é usada durante a autenticação e removida do campo e da memória do
cliente após o envio SASL. Ela não é salva em cookies, localStorage ou
sessionStorage. Conversas, mensagens e rascunhos ficam somente em um `Map`
na memória do JavaScript da aba e são limpos ao sair, recarregar ou fechar a
página. Não há banco de dados de mensagens no Django nem recuperação de histórico.

O ejabberd está configurado sem `mod_mam` (arquivamento) e sem `mod_offline`
(fila persistente para usuários desconectados), impedindo o armazenamento de
novas mensagens por esses módulos. Os dois participantes precisam estar
conectados para trocar mensagens; não haverá entrega posterior a quem estiver
offline. A fila temporária de gerenciamento de fluxo usa RAM. Essa configuração
não apaga dados antigos que já existam nos volumes Docker.

“Entregue” aparece apenas quando o destinatário confirma o recebimento
(XEP-0184); “Enviada” indica envio pela conexão, sem confirmação de entrega.
Este cliente cobre conversas diretas; salas, anexos e lista de contatos não
fazem parte desta tela.

Para validar manualmente, crie duas contas de teste, abra o chat em duas abas
e entre com uma conta em cada uma. Inicie uma conversa pelo JID da outra,
envie mensagens nos dois sentidos e confira o conteúdo recebido. Confira
também senha incorreta e **Sair da conta**. Não é necessário executar uma
suíte de testes para esse roteiro.

## Usar as contas em outros clientes

No Pidgin, selecione XMPP e use:

| Campo | Exemplo |
| --- | --- |
| Usuário | `ana` |
| Domínio | `localhost` |
| Senha | A senha escolhida no cadastro |
| Servidor de conexão, se necessário | `127.0.0.1` |
| Porta | `5222` |

O Compose exige STARTTLS nas conexões XMPP. Configure a confiança no certificado
do servidor também no cliente de chat. O cliente Python utiliza a mesma conta
XMPP. O cadastro não implementa a ponte MQTT da atividade.

## Painel administrativo

O Web Admin nativo continua disponível em **http://localhost:5280/admin/**.
Entre com `admin@localhost` e a senha de `EJABBERD_ADMIN_PASSWORD` no `.env`.
As contas criadas na aplicação aparecem em **Hosts virtuais → localhost →
Utilizadores**. Essa página também permite ao administrador criar contas.

## Configuração no `.env`

O `.env` é ignorado pelo Git. Use `.env.example` como referência ao copiar o
projeto para outra máquina e gere suas próprias senhas e chave Django.

| Variável | Uso |
| --- | --- |
| `XMPP_DOMAIN` | Domínio das contas; padrão `localhost` |
| `EJABBERD_ADMIN_USER` | Nome da conta administrativa; padrão `admin` |
| `EJABBERD_ADMIN_PASSWORD` | Senha dessa conta, usada para autenticar o backend |
| `DJANGO_SECRET_KEY` | Chave aleatória exclusiva do Django |
| `DJANGO_WEB_PORT` | Porta da página na máquina; padrão `80` |
| `DJANGO_ALLOWED_HOSTS` | Nomes HTTP aceitos pelo Django, separados por vírgulas |
| `EJABBERD_API_HOST` | Nome de rede do container; padrão `ejabberd` |
| `EJABBERD_API_PORT` | Porta HTTPS interna; padrão `5443` |
| `EJABBERD_TLS_SERVER_NAME` | Identidade esperada no certificado; padrão `localhost` |

Para gerar uma nova chave Django, por exemplo:

```bash
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

As portas do painel HTTP, HTTPS e XMPP podem ser alteradas com
`EJABBERD_WEB_PORT`, `EJABBERD_HTTPS_PORT` e `EJABBERD_XMPP_PORT`.
Esses valores são portas da máquina; a comunicação interna do Django continua
usando `ejabberd:5443`.

A imagem cria o administrador na primeira inicialização. Alterar apenas a
senha no `.env` não troca a senha de uma conta já existente: nesse caso, altere
a conta no ejabberd e mantenha a credencial do backend correspondente.

## Certificado HTTPS entre os containers

`certs/ejabberd.crt` contém apenas o certificado público extraído do ejabberd
usado neste ambiente. Ele é montado no serviço `web` como arquivo somente de
leitura. A chave privada permanece no container do ejabberd.

O nome usado na rede Docker é `ejabberd`, mas o certificado da imagem usada
neste laboratório identifica `localhost`. O cliente configura esse nome como
SNI e verifica o certificado com a confiança fornecida pelo arquivo público.
A verificação TLS permanece ativa.

Se o certificado do servidor mudar, exporte o novo certificado público e
recrie o serviço web para atualizar a montagem:

```bash
docker compose up -d --wait ejabberd
python3 scripts/export_certificate.py
docker compose up -d --force-recreate --wait web
```

Se mudar a identidade no certificado, ajuste também
`EJABBERD_TLS_SERVER_NAME`. Configurar outro domínio XMPP exige configurar sua
resolução de nome e os certificados correspondentes para os clientes.

## API Django

`POST /api/contas/` recebe somente:

```json
{"usuario": "ana", "senha": "uma-senha-escolhida"}
```

O frontend envia o token CSRF recebido no formulário pelo cabeçalho
`X-CSRFToken`, junto com o cookie da mesma origem. A API é pública para cadastro;
o usuário final não precisa fornecer credenciais administrativas.

Sucesso (`201`):

```json
{"ok": true, "message": "Conta criada com sucesso.", "jid": "ana@localhost"}
```

Outras respostas: `400` para campos inválidos, `403` para falha de CSRF, `409`
para usuário existente, `415` para conteúdo que não seja JSON e `502/503/504`
para falhas na comunicação com o ejabberd. Detalhes administrativos e a resposta
bruta do servidor não são enviados ao navegador.

O cliente usa limites de tempo e não repete automaticamente um POST de cadastro.
Se a confirmação demorar, a conta pode ter sido criada mesmo sem o retorno;
a página orienta tentar entrar antes de cadastrar novamente.

`GET /healthz/` informa se o serviço Django responde. Esse endpoint não faz uma
chamada ao ejabberd nem verifica as credenciais da integração.

## Código e operação

```text
compose.yaml                  serviços e rede Docker
ejabberd/ejabberd.yml          configuração e permissão HTTP de cadastro
.env                          senhas e configuração local
certs/ejabberd.crt             certificado público confiável
scripts/export_certificate.py exportação do certificado público
web/config/                   configuração e rotas Django
web/cadastro/forms.py         validação dos campos
web/cadastro/views.py         página, API e respostas
web/cadastro/ejabberd.py       integração HTTPS autenticada
web/cadastro/templates/       página de cadastro
web/cadastro/static/          CSS e JavaScript
web/cadastro/tests/           testes com o ejabberd simulado
```

Para acompanhar os serviços:

```bash
docker compose ps
docker compose logs -f web ejabberd
```

Depois de alterar o código, reconstrua o serviço web:

```bash
docker compose up -d --build --wait web
```

Para parar os containers mantendo as contas nos volumes:

```bash
docker compose down
```

A suíte em `cadastro/tests/` cobre validação, CSRF, conflitos, erros de
autenticação e tempo limite. As chamadas ao ejabberd são substituídas por mocks;
os testes não criam usuários reais. Quando sua execução estiver autorizada:

```bash
docker compose exec web python manage.py test cadastro.tests
```

## Referências

- [API de cadastro do ejabberd](https://docs.ejabberd.im/developer/ejabberd-api/admin-api/#register)
- [HTTP Basic Auth no ejabberd](https://docs.ejabberd.im/developer/ejabberd-api/simple-configuration/#basic-authentication)
- [Certificados e SNI no urllib3](https://urllib3.readthedocs.io/en/stable/advanced-usage.html#custom-sni-hostname)
- [Proteção CSRF no Django](https://docs.djangoproject.com/en/5.2/howto/csrf/)
