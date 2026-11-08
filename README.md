# Loja AURA

Página de venda do fone UGREEN HiTune S3 Air (branco e preto) com pagamento pelo Mercado Pago.

- Site: https://lojaaura.pages.dev
- Painel de pedidos: https://lojaaura.pages.dev/admin.html (senha em `Desktop\4 - LOJA AURA\6 - SENHA DO PAINEL.txt`, fora do repositório)

## Como funciona

1. A cliente escolhe cor, quantidade e forma de pagamento e preenche os dados de entrega.
2. A API (`worker/`) guarda o pedido no banco D1 e cria o pagamento no Mercado Pago (Checkout Pro).
   - Pix ou boleto: 10% de desconto, só essas formas aparecem no link.
   - Cartão: preço cheio, até 12x. Parcelas sem juros são configuradas na conta do Mercado Pago.
3. Quando o pagamento é aprovado, o Mercado Pago avisa a API (webhook) e o pedido aparece como **Pago** no painel.
4. No painel: copiar os dados de entrega, comprar no AliExpress, anotar o nº do pedido e o rastreio, mandar o rastreio no WhatsApp.

Sem Mercado Pago configurado, a loja continua funcionando: o pedido é salvo e a cliente é levada ao WhatsApp da loja.

## Ligar o Mercado Pago

1. Em https://www.mercadopago.com.br/developers/panel crie uma aplicação (Checkout Pro).
2. Copie o **Access Token de produção** e grave pelo prompt interativo:
   `wrangler pages secret put MP_ACCESS_TOKEN --project-name lojaaura`
3. Em Webhooks, cadastre `https://lojaaura.pages.dev/api/webhook-mp` com o evento **Pagamentos**. Copie a assinatura secreta:
   `wrangler pages secret put MP_WEBHOOK_SECRET --project-name lojaaura`
4. Publique de novo (`npm run deploy`). O painel mostra o que ainda falta.

Para testar sem dinheiro real: `MP_ACCESS_TOKEN_TESTE` + segredo `MP_MODO` = `teste`.

Avisos de pedido pago (opcionais): `RESEND_API_KEY` + `EMAIL_DONA` (e-mail) ou `NTFY_TOPICO` (app ntfy no celular).

## Comandos

- `npm test` · testes das regras (preço, CPF, validação)
- `npm run dev` · site local em http://localhost:8788 (senha do painel local em `.dev.vars`)
- `npm run deploy` · publica no Cloudflare Pages
- `npm run banco` · aplica migrações no banco remoto

Informe os valores apenas no prompt do Wrangler ou no painel de segredos do
Cloudflare Pages. Não coloque credenciais em comandos, histórico do shell, logs,
HTML, JavaScript público, `wrangler.jsonc` ou arquivos versionados.

## Configurações públicas e privadas

O projeto usa HTML/CSS/JavaScript puro e Cloudflare Pages com API no `worker/` e
banco D1. Não há framework, dependência de produção, autenticação de clientes ou
necessidade de migrar para Netlify. O painel já tem autenticação própria.

| Nome | Uso | Onde configurar |
| --- | --- | --- |
| `SITE_URL`, `WHATSAPP_LOJA` | URLs públicas da loja e contato | `wrangler.jsonc`, sem credenciais |
| `DB` | Binding do banco D1 | Configuração Cloudflare; não é API Key |
| `ADMIN_PASSWORD` | Login e assinatura da sessão do painel | Segredo no Cloudflare; `.dev.vars` local |
| `IP_SALT` | Sal para limitar tentativas sem armazenar o IP em claro | Segredo opcional; o comportamento atual usa a senha como alternativa |
| `MP_ACCESS_TOKEN`, `MP_ACCESS_TOKEN_TESTE`, `MP_WEBHOOK_SECRET` | Checkout e confirmação autenticada do pagamento | Segredos do Cloudflare |
| `MP_MODO` | `teste` ou `producao` | Configuração somente do servidor |
| `RESEND_API_KEY`, `EMAIL_DONA`, `EMAIL_REMETENTE` | Avisos de pedidos por e-mail, opcionais | Configuração privada do servidor |
| `NTFY_TOPICO` | Canal de avisos, opcional | Configuração privada; não divulgar o nome do canal |

O arquivo `.dev.vars` existente deve ser preservado. `.dev.vars.example` contém
somente valores fictícios/vazios para desenvolvimento; copie-o apenas se não houver
configuração local. O Wrangler usa `.dev.vars`, portanto não é necessário adicionar
um carregador `.env` nem duplicar a configuração. Variantes de `.env` e `.dev.vars`
são ignoradas pelo Git; apenas os arquivos de exemplo são permitidos.

O build copia uma lista explícita de arquivos públicos para `dist` e empacota
`worker/` como `_worker.js`. Não copia `.dev.vars`, `.env`, README ou configuração
do projeto. Não adicione segredos à lista pública nem substitua valores privados
durante o build. Nunca envie `worker/` como pasta estática de outro provedor.

O navegador usa ViaCEP para endereço e a API da própria loja para pedidos. Tokens
de Mercado Pago/Resend permanecem no servidor. O painel guarda a sessão em
`sessionStorage`, limitada à aba, e a envia como Bearer; isso reduz persistência,
mas continua exigindo proteção contra XSS. A CSP, os scripts locais e a renderização
por `textContent` são mantidos. Não há token sensível no `localStorage`.

O preço válido é sempre calculado pela API em `worker/regras.js`; os preços públicos
em HTML/`scripts/app.js` devem acompanhá-lo quando houver uma alteração comercial.
Os tokens visuais permanecem no `:root` de `styles/style.css`.

## Verificações e correções de segurança

`npm test` usa o runner nativo do Node, sem instalar dependências. Além de preço,
CPF e pedido, cobre rejeição de cores fora do catálogo (inclusive propriedades
herdadas), proteção de mensagens do provedor, limite de corpo em bytes e confirmação
de pagamento pela API. O corpo JSON é interrompido acima de 16 KiB, inclusive sem
`Content-Length`, antes de carregar o restante do stream.
Um parâmetro `status=approved` no endereço não comprova pagamento. A confirmação
real depende do webhook assinado e do estado consultado no servidor.

Os logs de erro conservam categoria/status, sem corpo de resposta do provedor nem
stack completa. Erros ao cliente continuam genéricos. Se uma credencial vazar,
removê-la do código não resolve o histórico: avalie revogação/rotação no serviço,
com autorização do responsável.

Respostas antigas da consulta de CEP e do carregamento da foto não substituem uma
seleção mais recente no formulário.

Antes de publicar, execute `npm test`, confira o build e rode os testes de navegador.
Não aplique migrações remotas nem faça pedidos/pagamentos reais como teste de deploy.
