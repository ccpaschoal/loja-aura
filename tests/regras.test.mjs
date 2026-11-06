import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpfValido, validarPedido, total, precoUnitario, reais, novoId, RE_ID } from '../worker/regras.js';

const ok = { cor: 'preto', qtd: 1, forma: 'pix', nome: 'Maria Souza', email: 'maria@ex.com', cpf: '529.982.247-25',
  whatsapp: '(21) 98888-7777', cep: '20040-020', rua: 'Rua A', numero: '10', bairro: 'Centro', cidade: 'Rio de Janeiro', uf: 'rj' };

test('CPF', () => {
  assert.ok(cpfValido('52998224725'));
  assert.ok(!cpfValido('52998224724'));
  assert.ok(!cpfValido('11111111111'));
});
test('preços', () => {
  assert.equal(precoUnitario('cartao'), 229.9);
  assert.equal(precoUnitario('pix'), 206.91);
  assert.equal(total('pix', 2), 413.82);
  assert.equal(reais(1234.5), 'R$ 1.234,50');
});
test('pedido válido', () => {
  const { dados, erro } = validarPedido(ok);
  assert.equal(erro, undefined);
  assert.equal(dados.cpf, '52998224725');
  assert.equal(dados.whatsapp, '21988887777');
  assert.equal(dados.endereco.uf, 'RJ');
  assert.equal(dados.valor, 206.91);
});
test('pedido inválido', () => {
  assert.equal(validarPedido({ ...ok, cor: 'azul' }).campo, 'cor');
  assert.equal(validarPedido({ ...ok, qtd: 9 }).campo, 'qtd');
  assert.equal(validarPedido({ ...ok, nome: 'Maria' }).campo, 'nome');
  assert.equal(validarPedido({ ...ok, cpf: '123' }).campo, 'cpf');
  assert.equal(validarPedido({ ...ok, whatsapp: '2133334444' }).campo, 'whatsapp');
  assert.equal(validarPedido({ ...ok, uf: 'XX' }).campo, 'uf');
  assert.ok(validarPedido({ ...ok, site: 'robo' }).erro);
  assert.ok(validarPedido(null).erro);
});
test('código do pedido', () => {
  for (let i = 0; i < 50; i++) assert.match(novoId(), RE_ID);
});
