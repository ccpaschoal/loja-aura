/* AURA · API da loja (Cloudflare Pages + D1). O resto do site sai da pasta dist.
   GET  /api/loja            preço e se o pagamento online está ligado
   POST /api/pedido          dados do cliente → link do Mercado Pago (ou WhatsApp, se o MP estiver desligado)
   POST /api/webhook-mp      notificação do Mercado Pago
   GET  /api/status?id=      situação do pedido (só o estado)
   GET/POST /api/admin       painel da dona (login com ADMIN_PASSWORD → token de sessão) */
import { PRODUTO, RE_ID, json, validarPedido, novoId, precoUnitario, reais } from './regras.js';
import {
  modoMP, tokenMP, criarPreferencia, buscarPagamento, assinaturaValida, hmac, iguais, enviarEmail, enviarNtfy, tituloAviso,
} from './servicos.js';

const temMP = (env) => !!tokenMP(env) && !!env.MP_WEBHOOK_SECRET;
const MAX_PEDIDOS_HORA = 6;     // pedidos por conexão em 1 hora
const MAX_TENTATIVAS_SENHA = 10;
const HORAS_SESSAO = 12;
const MAX_CORPO = 16 * 1024;
const DIAS_PAGAR = 3;           // link, Pix e boleto valem 3 dias
const ETAPAS = ['novo', 'comprado', 'enviado', 'entregue', 'cancelado'];

const objeto = (b) => b !== null && typeof b === 'object' && !Array.isArray(b);
async function lerJSON(req) {
  const t = await req.text();
  if (t.length > MAX_CORPO) return undefined;
  try { return JSON.parse(t || 'null'); } catch { return undefined; }
}
const base = (env, req) => (env.SITE_URL || new URL(req.url).origin).replace(/\/$/, '');
const ipHash = async (req, env) => (await hmac(`ip:${env.IP_SALT || env.ADMIN_PASSWORD || 'aura'}`, req.headers.get('CF-Connecting-IP') || 'local')).slice(0, 32);
const isoSP = (ms) => new Date(ms - 3 * 3600e3).toISOString().replace('Z', '-03:00');
const whatsappLoja = (env) => String(env.WHATSAPP_LOJA || '5521982566564').replace(/\D/g, '');

/* ── Loja ── */
function loja(req, env) {
  return json({
    preco: PRODUTO.preco, precoDe: PRODUTO.precoDe, precoPix: precoUnitario('pix'), maxQtd: PRODUTO.maxQtd,
    pagamento: temMP(env) ? 'mercadopago' : 'whatsapp',
  });
}

/* ── Novo pedido ── */
async function pedido(req, env) {
  const b = await lerJSON(req);
  const v = validarPedido(b);
  if (v.erro) return json(v, 400);
  const d = v.dados;
  const db = env.DB;
  const agora = Date.now();
  const ip = await ipHash(req, env);
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM pedidos WHERE ip_hash = ? AND criado_em > ?').bind(ip, agora - 3600e3).first()).n;
  if (n >= MAX_PEDIDOS_HORA) return json({ erro: 'Muitos pedidos seguidos. Fale com a gente pelo WhatsApp.' }, 429);

  const id = novoId();
  const online = temMP(env);
  await db.prepare(`INSERT INTO pedidos (id, criado_em, status, etapa, cor, qtd, forma, valor, nome, email, cpf, whatsapp, cep, endereco, ip_hash, ambiente)
    VALUES (?, ?, ?, 'novo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, agora, online ? 'pendente' : 'whatsapp', d.cor, d.qtd, d.forma, d.valor, d.nome, d.email, d.cpf, d.whatsapp, d.cep,
      JSON.stringify(d.endereco), ip, online ? modoMP(env) : 'whatsapp').run();

  const cor = PRODUTO.cores[d.cor];
  if (!online) {
    const p = await db.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
    await avisar(env, p).catch((e) => console.error('avisar:', e.message));
    const texto = [`Olá! Fiz o pedido ${id} na loja AURA:`, `${d.qtd}x ${PRODUTO.nome} ${cor}`,
      `Valor: ${reais(d.valor)} (${d.forma === 'pix' ? 'Pix ou boleto' : 'cartão'})`, `Nome: ${d.nome}`].join('\n');
    return json({ id, whatsapp: `https://wa.me/${whatsappLoja(env)}?text=${encodeURIComponent(texto)}` });
  }

  const site = base(env, req);
  const [primeiro, ...resto] = d.nome.split(' ');
  const pix = d.forma === 'pix';
  try {
    const pref = await criarPreferencia(env, {
      items: [{
        id: `s3air-${d.cor}`,
        title: `${PRODUTO.nome} ${cor}`,
        description: 'Fone Bluetooth open-ear com clipe',
        picture_url: `${site}/assets/fone-${d.cor}-480.webp`,
        category_id: 'electronics',
        quantity: d.qtd,
        unit_price: precoUnitario(d.forma),
        currency_id: 'BRL',
      }],
      payer: {
        name: primeiro, surname: resto.join(' '), email: d.email,
        identification: { type: 'CPF', number: d.cpf },
        phone: { area_code: d.whatsapp.slice(0, 2), number: d.whatsapp.slice(2) },
        address: { zip_code: d.cep, street_name: d.endereco.rua, street_number: d.endereco.numero },
      },
      external_reference: id,
      notification_url: `${site}/api/webhook-mp?source_news=webhooks`,
      back_urls: { success: `${site}/retorno.html`, pending: `${site}/retorno.html`, failure: `${site}/retorno.html` },
      auto_return: 'approved',
      expires: true,
      expiration_date_from: isoSP(agora - 60e3),
      expiration_date_to: isoSP(agora + DIAS_PAGAR * 864e5),
      date_of_expiration: isoSP(agora + DIAS_PAGAR * 864e5),
      // Pix/boleto têm o desconto: nesse link só eles aparecem. Cartão: preço cheio, até 12x.
      payment_methods: pix
        ? { excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'prepaid_card' }, { id: 'atm' }] }
        : { excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }], installments: 12 },
      statement_descriptor: 'AURA',
      metadata: { pedido_id: id },
    }, id);
    if (!/^https:\/\//.test(pref?.init_point || '')) throw new Error('Mercado Pago respondeu sem link de pagamento');
    await db.prepare('UPDATE pedidos SET preferencia_id = ? WHERE id = ?').bind(String(pref.id || ''), id).run();
    return json({ id, init_point: pref.init_point });
  } catch (e) {
    console.error('Mercado Pago:', e?.message, JSON.stringify(e?.detalhe || ''));
    if (e?.name !== 'TimeoutError') await db.prepare("UPDATE pedidos SET status = 'falhou' WHERE id = ?").bind(id).run();
    return json({ erro: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes.' }, 502);
  }
}

/* ── Webhook do Mercado Pago ── */
async function avisar(env, p) {
  const chave = `${p.id}_${p.status}`;
  const trava = await env.DB.prepare('INSERT INTO alertas (chave, em) VALUES (?, ?) ON CONFLICT(chave) DO NOTHING').bind(chave, Date.now()).run();
  if (!trava.meta.changes) return; // já avisado
  try {
    const canais = await Promise.all([enviarEmail(env, p), enviarNtfy(env, p)]);
    console.log('avisos', p.id, tituloAviso(p), canais);
    if (!canais.includes(true) && canais.includes(false)) throw new Error('Nenhum aviso foi enviado'); // o MP reenvia depois
  } catch (e) {
    await env.DB.prepare('DELETE FROM alertas WHERE chave = ?').bind(chave).run().catch(() => {});
    throw e;
  }
}

async function webhook(req, env) {
  const url = new URL(req.url);
  let corpo = await lerJSON(req);
  if (!objeto(corpo)) corpo = {};
  const tipo = corpo.type || url.searchParams.get('type') || url.searchParams.get('topic');
  const pagamentoId = url.searchParams.get('data.id') || corpo?.data?.id;
  if (tipo !== 'payment' || !pagamentoId) return new Response('ignorado');
  if (!(await assinaturaValida(env, req.headers, pagamentoId))) return new Response('assinatura inválida', { status: 401 });
  let pg;
  try { pg = await buscarPagamento(env, pagamentoId); } catch (e) {
    if (e.status === 404) return new Response('pagamento não encontrado');
    console.error('webhook: consulta', e?.message);
    return new Response('erro', { status: 500 });
  }
  const id = String(pg.external_reference || '');
  if (!RE_ID.test(id)) return new Response('sem pedido');
  const db = env.DB;
  let p = await db.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) { console.error('webhook: pagamento sem pedido', pagamentoId, id); return new Response('pedido não encontrado'); }

  if (pg.status === 'approved') {
    if (!['pago', 'conferir'].includes(p.status)) {
      const valorOk = Number(pg.transaction_amount) + 0.009 >= Number(p.valor);
      await db.prepare('UPDATE pedidos SET status = ?, pago_em = ?, pagamento_id = ?, metodo = ?, valor_pago = ? WHERE id = ?')
        .bind(valorOk ? 'pago' : 'conferir', Date.now(), String(pg.id), pg.payment_type_id || null, pg.transaction_amount ?? null, id).run();
      p = await db.prepare('SELECT * FROM pedidos WHERE id = ?').bind(id).first();
    }
    try { await avisar(env, p); } catch (e) { console.error(e.message); return new Response('erro', { status: 500 }); }
  } else if (['refunded', 'charged_back'].includes(pg.status) && p.pagamento_id === String(pg.id)) {
    await db.prepare("UPDATE pedidos SET status = 'estornado' WHERE id = ?").bind(id).run();
  } else if (['rejected', 'cancelled'].includes(pg.status) && p.status === 'pendente') {
    await db.prepare("UPDATE pedidos SET metodo = ? WHERE id = ?").bind(pg.payment_type_id || null, id).run();
  }
  return new Response('ok');
}

/* ── Situação do pedido (página de retorno) ── */
async function status(req, env) {
  const id = new URL(req.url).searchParams.get('id') || '';
  if (!RE_ID.test(id)) return json({ erro: 'Pedido inválido.' }, 400);
  const p = await env.DB.prepare('SELECT status, etapa FROM pedidos WHERE id = ?').bind(id).first();
  if (!p) return json({ erro: 'Pedido não encontrado.' }, 404);
  return json({ status: p.status, etapa: p.etapa });
}

/* ── Painel ── */
const assinarSessao = async (env, exp) => `${exp}.${await hmac(`sessao:${String(env.ADMIN_PASSWORD).trim()}`, String(exp))}`;
async function sessaoValida(env, token) {
  const n = Number(String(token || '').split('.')[0]);
  if (!Number.isInteger(n) || n < Date.now() || n > Date.now() + HORAS_SESSAO * 3600e3) return false;
  return iguais(await assinarSessao(env, n), String(token));
}

async function entrar(req, env, senha) {
  const db = env.DB;
  const ip = await ipHash(req, env);
  const agora = Date.now();
  const [registro] = await db.batch([
    db.prepare('INSERT INTO tentativas (ip_hash, em) VALUES (?, ?)').bind(ip, agora),
    db.prepare('DELETE FROM tentativas WHERE em < ?').bind(agora - 864e5),
  ]);
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM tentativas WHERE ip_hash = ? AND em > ?').bind(ip, agora - 15 * 60e3).first()).n;
  if (n > MAX_TENTATIVAS_SENHA) return json({ erro: 'Muitas tentativas. Espere 15 minutos.' }, 429);
  if (!iguais(String(senha ?? ''), String(env.ADMIN_PASSWORD).trim())) {
    await new Promise((r) => setTimeout(r, 800));
    return json({ erro: 'Senha incorreta.' }, 401);
  }
  if (registro?.meta?.last_row_id) await db.prepare('DELETE FROM tentativas WHERE rowid = ?').bind(registro.meta.last_row_id).run();
  return json({ token: await assinarSessao(env, agora + HORAS_SESSAO * 3600e3) });
}

function pendencias(env) {
  const p = [];
  if (!tokenMP(env)) p.push('Mercado Pago desligado: falta o Access Token. Os pedidos chegam pelo WhatsApp, sem pagamento online.');
  else if (!env.MP_WEBHOOK_SECRET) p.push('Falta o segredo MP_WEBHOOK_SECRET: sem ele o pagamento não é confirmado e a loja usa o WhatsApp.');
  if (modoMP(env) === 'teste') p.push('Mercado Pago em modo TESTE: pagamentos não são reais.');
  if (!(env.RESEND_API_KEY && env.EMAIL_DONA) && !env.NTFY_TOPICO) p.push('Nenhum aviso configurado (e-mail ou ntfy): confira os pedidos aqui no painel.');
  return p;
}

async function admin(req, env) {
  if (!env.ADMIN_PASSWORD) return json({ erro: 'Painel indisponível: falta a senha (ADMIN_PASSWORD).' }, 503);
  const db = env.DB;
  let b = null;
  if (req.method === 'POST') {
    b = await lerJSON(req);
    if (!objeto(b)) return json({ erro: 'Dados inválidos.' }, 400);
    if (b.acao === 'entrar') return entrar(req, env, b.senha);
  }
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!(await sessaoValida(env, token))) return json({ erro: 'Sessão expirada. Entre de novo.' }, 401);

  if (req.method === 'GET') {
    const { results } = await db.prepare(`SELECT * FROM pedidos WHERE status <> 'falhou' AND (status <> 'pendente' OR criado_em > ?)
      ORDER BY criado_em DESC LIMIT 300`).bind(Date.now() - 7 * 864e5).all();
    return json({ pedidos: results.map(({ ip_hash, ...p }) => ({ ...p, endereco: JSON.parse(p.endereco || '{}') })), pendencias: pendencias(env) });
  }
  if (b.acao === 'atualizar') {
    if (!RE_ID.test(b.id || '')) return json({ erro: 'Pedido inválido.' }, 400);
    if (!ETAPAS.includes(b.etapa)) return json({ erro: 'Etapa inválida.' }, 400);
    const limpo = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);
    const r = await db.prepare('UPDATE pedidos SET etapa = ?, ali_pedido = ?, rastreio = ?, obs = ? WHERE id = ?')
      .bind(b.etapa, limpo(b.ali_pedido, 40), limpo(b.rastreio, 40), limpo(b.obs, 300), b.id).run();
    if (!r.meta.changes) return json({ erro: 'Pedido não encontrado.' }, 404);
    return json({ ok: true });
  }
  return json({ erro: 'Ação desconhecida.' }, 400);
}

/* ── Roteamento ── */
const ROTAS = {
  'GET /api/loja': loja,
  'POST /api/pedido': pedido,
  'POST /api/webhook-mp': webhook,
  'GET /api/status': status,
  'GET /api/admin': admin,
  'POST /api/admin': admin,
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      if (!url.pathname.startsWith('/api/')) return await env.ASSETS.fetch(req);
      const rota = ROTAS[`${req.method} ${url.pathname.replace(/\/$/, '')}`];
      if (!rota) return json({ erro: 'Não encontrado.' }, 404);
      if (Number(req.headers.get('Content-Length') || 0) > MAX_CORPO) return json({ erro: 'Dados grandes demais.' }, 413);
      return await rota(req, env, ctx);
    } catch (e) {
      console.error(url.pathname, e?.stack || e);
      return json({ erro: 'Erro no servidor. Tente de novo.' }, 500);
    }
  },
};
