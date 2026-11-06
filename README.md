# Loja AURA

Página de venda do fone UGREEN HiTune S3 Air (branco e preto) com pagamento pelo Mercado Pago.

- Site: https://lojaaura.pages.dev
- Painel de pedidos: https://lojaaura.pages.dev/admin.html (senha em `Desktop\13 - LOJA AURA\7 - SENHA DO PAINEL.txt`, fora do repositório)

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
2. Copie o **Access Token de produção** e grave:
   `printf '%s' 'TOKEN' | wrangler pages secret put MP_ACCESS_TOKEN --project-name lojaaura`
3. Em Webhooks, cadastre `https://lojaaura.pages.dev/api/webhook-mp` com o evento **Pagamentos**. Copie a assinatura secreta:
   `printf '%s' 'SEGREDO' | wrangler pages secret put MP_WEBHOOK_SECRET --project-name lojaaura`
4. Publique de novo (`npm run deploy`). O painel mostra o que ainda falta.

Para testar sem dinheiro real: `MP_ACCESS_TOKEN_TESTE` + segredo `MP_MODO` = `teste`.

Avisos de pedido pago (opcionais): `RESEND_API_KEY` + `EMAIL_DONA` (e-mail) ou `NTFY_TOPICO` (app ntfy no celular).

## Comandos

- `npm test` · testes das regras (preço, CPF, validação)
- `npm run dev` · site local em http://localhost:8788 (senha do painel local em `.dev.vars`)
- `npm run deploy` · publica no Cloudflare Pages
- `npm run banco` · aplica migrações no banco remoto

Segredos sempre com `printf | wrangler pages secret put` no bash (nunca pipe no PowerShell).
