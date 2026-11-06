/* AURA · serviços externos: Mercado Pago (API REST), Resend (e-mail) e ntfy (aviso no celular). Base: site do Aconchego. */
import { PRODUTO, reais } from './regras.js';

/* ── Mercado Pago ── */
export const modoMP = (env) => ((env.MP_MODO || '').toLowerCase() === 'teste' ? 'teste' : 'producao');
export const tokenMP = (env) => (modoMP(env) === 'teste' ? env.MP_ACCESS_TOKEN_TESTE : env.MP_ACCESS_TOKEN);

async function mp(env, caminho, { metodo = 'GET', corpo, idempotencia } = {}) {
  const token = tokenMP(env);
  if (!token) throw Object.assign(new Error(`Access Token do Mercado Pago (${modoMP(env)}) não configurado`), { status: 0 });
  const r = await fetch(`https://api.mercadopago.com${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(idempotencia ? { 'X-Idempotency-Key': idempotencia } : {}),
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || `Mercado Pago ${r.status}`), { status: r.status, detalhe: j });
  return j;
}
export const criarPreferencia = (env, corpo, idempotencia) => mp(env, '/checkout/preferences', { metodo: 'POST', corpo, idempotencia });
export const buscarPagamento = (env, id) => mp(env, `/v1/payments/${encodeURIComponent(id)}`);

/* x-signature "ts=...,v1=..." = HMAC-SHA256(MP_WEBHOOK_SECRET, "id:<data.id>;request-id:<x-request-id>;ts:<ts>;") */
export async function assinaturaValida(env, headers, dataId) {
  const segredo = env.MP_WEBHOOK_SECRET;
  if (!segredo) return false;
  const partes = {};
  for (const pedaco of (headers.get('x-signature') || '').split(',')) {
    const [k, v] = pedaco.split('=').map((s) => (s || '').trim());
    if (k && v) partes[k] = v;
  }
  if (!partes.ts || !partes.v1) return false;
  let id = String(dataId || '');
  if (/^[a-z0-9]+$/i.test(id)) id = id.toLowerCase();
  const reqId = headers.get('x-request-id');
  const manifesto = `${id ? `id:${id};` : ''}${reqId ? `request-id:${reqId};` : ''}ts:${partes.ts};`;
  return iguais(await hmac(segredo, manifesto), partes.v1);
}

export async function hmac(segredo, texto) {
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* comparação em tempo constante */
export function iguais(a, b) {
  const x = new TextEncoder().encode(String(a)), y = new TextEncoder().encode(String(b));
  let dif = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) dif |= (x[i] || 0) ^ (y[i] || 0);
  return dif === 0;
}

/* ── Avisos para a dona ── */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const METODO = { bank_transfer: 'Pix', ticket: 'boleto', credit_card: 'cartão de crédito', debit_card: 'cartão de débito', account_money: 'saldo Mercado Pago' };
const fone = (n = '') => (n.length >= 10 ? `(${n.slice(0, 2)}) ${n.slice(2, -4)}-${n.slice(-4)}` : n);

export const tituloAviso = (p) => ({
  pago: '✅ PEDIDO PAGO · compre no AliExpress',
  conferir: '⚠️ PAGAMENTO COM VALOR DIFERENTE · confira no Mercado Pago',
  whatsapp: '📩 PEDIDO SEM PAGAMENTO ONLINE · o cliente vai chamar no WhatsApp',
}[p.status] || `Pedido ${p.status}`);

function linhas(p) {
  const e = JSON.parse(p.endereco || '{}');
  return [
    ['Pedido', p.id],
    ['Produto', `${p.qtd}x ${PRODUTO.nome} ${PRODUTO.cores[p.cor] || p.cor}`],
    ['Valor', `${reais(p.valor_pago ?? p.valor)}${p.metodo ? ` · ${METODO[p.metodo] || p.metodo}` : ''}`],
    ['Cliente', p.nome],
    ['CPF', p.cpf],
    ['E-mail', p.email],
    ['WhatsApp', fone(p.whatsapp)],
    ['Endereço', `${e.rua}, ${e.numero}${e.complemento ? ` ${e.complemento}` : ''} · ${e.bairro} · ${e.cidade}/${e.uf} · CEP ${p.cep}`],
  ];
}
export const textoAviso = (p) => [tituloAviso(p), '', ...linhas(p).map(([k, v]) => `${k}: ${v}`)].join('\n');

export async function enviarEmail(env, p) {
  if (!env.RESEND_API_KEY || !env.EMAIL_DONA) return null;
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: env.EMAIL_REMETENTE || 'Loja AURA <onboarding@resend.dev>',
        to: env.EMAIL_DONA.split(',').map((s) => s.trim()).filter(Boolean),
        subject: `${p.status === 'pago' ? 'Pedido pago' : 'Pedido'} ${p.id} · ${reais(p.valor_pago ?? p.valor)}`,
        html: `<div style="font-family:Arial,sans-serif"><h2>${esc(tituloAviso(p))}</h2><table cellpadding="6">${linhas(p)
          .map(([k, v]) => `<tr><td><b>${esc(k)}</b></td><td>${esc(v)}</td></tr>`).join('')}</table></div>`,
        text: textoAviso(p),
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) console.error('Resend:', r.status, (await r.text()).slice(0, 300));
    return r.ok;
  } catch (e) {
    console.error('Resend:', e?.message);
    return false;
  }
}

/* ntfy é público: vai só o código e o valor; os dados do cliente ficam no painel */
export async function enviarNtfy(env, p) {
  if (!env.NTFY_TOPICO) return null;
  try {
    const r = await fetch('https://ntfy.sh/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: env.NTFY_TOPICO,
        title: `${p.status === 'pago' ? 'Pedido pago' : 'Pedido'} ${p.id}`,
        message: `${tituloAviso(p)}\n${p.qtd}x ${PRODUTO.cores[p.cor] || p.cor} · ${reais(p.valor_pago ?? p.valor)}\nDetalhes no painel.`,
        tags: [p.status === 'pago' ? 'moneybag' : 'warning'],
        priority: 4,
        click: `${(env.SITE_URL || '').replace(/\/$/, '')}/admin.html`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return r.ok;
  } catch (e) {
    console.error('ntfy:', e?.message);
    return false;
  }
}
