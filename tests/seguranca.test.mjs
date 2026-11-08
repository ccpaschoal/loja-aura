import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { criarPreferencia } from '../worker/servicos.js';
import worker from '../worker/index.js';

test('API rejeita JSON null, arrays e JSON inválido antes de acessar banco', async () => {
  for (const caminho of ['pedido', 'admin']) {
    for (const body of ['null', '[]', '{']) {
      const response = await worker.fetch(new Request(`https://aura.invalid/api/${caminho}`, { method: 'POST', body }), { ADMIN_PASSWORD: 'senha-ficticia-local' });
      assert.equal(response.status, 400);
    }
  }
});

test('API limita corpo em bytes, incluindo caracteres UTF-8 multibyte', async () => {
  const body = JSON.stringify({ x: 'ç'.repeat(9000) });
  const response = await worker.fetch(new Request('https://aura.invalid/api/pedido', { method: 'POST', body }), {});
  assert.equal(response.status, 413);
});

test('API cancela stream finito acima de 16 KiB sem consumir o restante', async () => {
  const chunks = [new Uint8Array(16000), new Uint8Array(1000), new Uint8Array(1000)];
  let cancelado = false;
  const stream = new ReadableStream({
    pull(controller) { if (chunks.length) controller.enqueue(chunks.shift()); else controller.close(); },
    cancel() { cancelado = true; },
  }, { highWaterMark: 0 });
  const request = new Request('https://aura.invalid/api/pedido', { method: 'POST', body: stream, duplex: 'half' });
  const response = await worker.fetch(request, {});
  assert.equal(response.status, 413);
  assert.equal(cancelado, true);
  assert.equal(chunks.length, 1);
});

test('falhas do Mercado Pago não propagam corpo externo nem mensagens sensíveis', async (t) => {
  const marcador = 'dado-ficticio-do-provedor';
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ message: marcador, cause: [marcador] }), { status: 401 }));
  await assert.rejects(criarPreferencia({ MP_ACCESS_TOKEN: 'valor-ficticio-nao-funcional' }, {}, 'teste'), (erro) => {
    assert.equal(erro.status, 401);
    assert.ok(!erro.message.includes(marcador));
    assert.equal(erro.detalhe, undefined);
    return true;
  });
});

const retorno = readFileSync(new URL('../scripts/retorno.js', import.meta.url), 'utf8');
async function simularRetorno(search, resposta = {}) {
  const elementos = new Map();
  const timers = [];
  const sandbox = {
    URLSearchParams,
    location: { search },
    sessionStorage: { getItem: () => '' },
    document: { getElementById: (id) => {
      if (!elementos.has(id)) elementos.set(id, {});
      return elementos.get(id);
    } },
    fetch: async () => ({ ok: true, json: async () => resposta }),
    setTimeout: (fn) => timers.push(fn),
  };
  vm.runInNewContext(retorno, sandbox);
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    timers.shift()?.();
  }
  await new Promise((resolve) => setImmediate(resolve));
  return elementos.get('ret-titulo')?.textContent;
}

test('query string aprovada sem pedido não confirma pagamento', async () => {
  assert.equal(await simularRetorno('?status=approved'), 'Não encontramos o pedido');
});

test('query string aprovada não substitui a confirmação da API', async () => {
  assert.equal(await simularRetorno('?external_reference=AU23456789&status=approved', { status: 'pendente' }), 'Não encontramos o pedido');
});

test('retorno confirma pagamento apenas com estado confirmado pela API', async () => {
  assert.equal(await simularRetorno('?external_reference=AU23456789', { status: 'pago' }), 'Pagamento aprovado!');
});

/* Cartão recusado/cancelado: o estado vem do servidor (webhook + API do MP), nunca da querystring */
import { hmac } from '../worker/servicos.js';
function bancoFalso(pedido) {
  return { prepare(sql) {
    return { bind(...a) { return {
      async first() { return /FROM pedidos WHERE id/.test(sql) ? { ...pedido } : null; },
      async run() {
        if (/SET metodo = \?/.test(sql)) pedido.metodo = a[0];
        return { meta: { changes: 1 } };
      },
    }; } };
  } };
}
async function webhookMP(env, pagamento) {
  const ts = '1700000000', reqId = 'req-1', dataId = '123456';
  const v1 = await hmac(env.MP_WEBHOOK_SECRET, `id:${dataId};request-id:${reqId};ts:${ts};`);
  return worker.fetch(new Request(`https://aura.invalid/api/webhook-mp?type=payment&data.id=${dataId}`, {
    method: 'POST', headers: { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': reqId }, body: '{}',
  }), env);
}
const statusDe = async (env) => (await (await worker.fetch(new Request('https://aura.invalid/api/status?id=AU23456789'), env)).json()).status;

for (const estado of ['rejected', 'cancelled']) {
  test(`pagamento ${estado} confirmado pela API do MP vira "recusado" no status do pedido`, async (t) => {
    const pedido = { id: 'AU23456789', status: 'pendente', etapa: 'novo', metodo: null, valor: 100 };
    const env = { DB: bancoFalso(pedido), MP_ACCESS_TOKEN: 'valor-ficticio', MP_WEBHOOK_SECRET: 'segredo-ficticio' };
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ id: 123456, status: estado, payment_type_id: 'credit_card', external_reference: 'AU23456789' })));
    assert.equal(await statusDe(env), 'pendente'); // sem confirmação: continua neutro
    assert.equal((await webhookMP(env, {})).status, 200);
    assert.equal(pedido.status, 'pendente');       // nada é marcado como pago
    assert.equal(await statusDe(env), 'recusado');
  });
}

test('webhook com assinatura inválida não altera o pedido nem muda o status', async (t) => {
  const pedido = { id: 'AU23456789', status: 'pendente', etapa: 'novo', metodo: null };
  const env = { DB: bancoFalso(pedido), MP_ACCESS_TOKEN: 'valor-ficticio', MP_WEBHOOK_SECRET: 'segredo-ficticio' };
  const r = await worker.fetch(new Request('https://aura.invalid/api/webhook-mp?type=payment&data.id=1', { method: 'POST', headers: { 'x-signature': 'ts=1,v1=00' }, body: '{}' }), env);
  assert.equal(r.status, 401);
  assert.equal(await statusDe(env), 'pendente');
});

test('retorno mostra recusa só com status "recusado" da API; querystring rejected não basta', async () => {
  assert.equal(await simularRetorno('?external_reference=AU23456789', { status: 'recusado' }), 'O pagamento não foi aprovado');
  assert.equal(await simularRetorno('?external_reference=AU23456789&status=rejected', { status: 'pendente' }), 'Ainda sem confirmação');
});
