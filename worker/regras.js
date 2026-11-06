/* AURA · regras da loja (preço, validação do pedido). Funções puras: testadas em tests/regras.test.mjs */

export const PRODUTO = {
  nome: 'Fone UGREEN HiTune S3 Air',
  preco: 229.9,          // preço no cartão (até 12x; o "sem juros" é configurado na conta do Mercado Pago)
  precoDe: 279.9,        // preço riscado
  descontoPix: 0.10,     // Pix e boleto
  cores: { branco: 'Branco', preto: 'Preto' },
  maxQtd: 3,
};

export const RE_ID = /^AU[0-9A-Z]{8}$/;
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const centavos = (v) => Math.round(v * 100) / 100;
export const precoUnitario = (forma) => (forma === 'pix' ? centavos(PRODUTO.preco * (1 - PRODUTO.descontoPix)) : PRODUTO.preco);
export const total = (forma, qtd) => centavos(precoUnitario(forma) * qtd);
export const reais = (v) => `R$ ${Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;

export function cpfValido(cpf) {
  const d = String(cpf || '').replace(/\D/g, '');
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    if ((soma * 10) % 11 % 10 !== Number(d[n])) return false;
  }
  return true;
}

const texto = (v, max) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

/* Confere o corpo do pedido. Devolve { dados } ou { erro, campo } */
export function validarPedido(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { erro: 'Dados inválidos.' };
  if (b.site) return { erro: 'Dados inválidos.' }; // campo-isca contra robôs
  const cor = String(b.cor || '');
  if (!PRODUTO.cores[cor]) return { erro: 'Escolha a cor do fone.', campo: 'cor' };
  const qtd = Number(b.qtd);
  if (!Number.isInteger(qtd) || qtd < 1 || qtd > PRODUTO.maxQtd) return { erro: `Escolha de 1 a ${PRODUTO.maxQtd} unidades.`, campo: 'qtd' };
  const forma = b.forma === 'pix' ? 'pix' : b.forma === 'cartao' ? 'cartao' : null;
  if (!forma) return { erro: 'Escolha a forma de pagamento.', campo: 'forma' };

  const nome = texto(b.nome, 80);
  if (nome.split(' ').filter(Boolean).length < 2) return { erro: 'Informe nome e sobrenome.', campo: 'nome' };
  const email = texto(b.email, 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return { erro: 'Confira o e-mail.', campo: 'email' };
  const cpf = String(b.cpf || '').replace(/\D/g, '');
  if (!cpfValido(cpf)) return { erro: 'Confira o CPF.', campo: 'cpf' };
  let whatsapp = String(b.whatsapp || '').replace(/\D/g, '');
  if (whatsapp.length >= 12 && whatsapp.startsWith('55')) whatsapp = whatsapp.slice(2);
  if (!/^[1-9]{2}9\d{8}$/.test(whatsapp)) return { erro: 'Informe o celular com DDD.', campo: 'whatsapp' };

  const cep = String(b.cep || '').replace(/\D/g, '');
  if (cep.length !== 8) return { erro: 'Confira o CEP.', campo: 'cep' };
  const endereco = {
    rua: texto(b.rua, 120), numero: texto(b.numero, 12), complemento: texto(b.complemento, 60),
    bairro: texto(b.bairro, 60), cidade: texto(b.cidade, 60), uf: String(b.uf || '').toUpperCase(),
  };
  if (endereco.rua.length < 3) return { erro: 'Informe a rua.', campo: 'rua' };
  if (!endereco.numero) return { erro: 'Informe o número (ou "s/n").', campo: 'numero' };
  if (endereco.bairro.length < 2) return { erro: 'Informe o bairro.', campo: 'bairro' };
  if (endereco.cidade.length < 2) return { erro: 'Informe a cidade.', campo: 'cidade' };
  if (!UFS.includes(endereco.uf)) return { erro: 'Escolha o estado.', campo: 'uf' };

  return { dados: { cor, qtd, forma, nome, email, cpf, whatsapp, cep, endereco, valor: total(forma, qtd) } };
}

/* Código curto do pedido, fácil de ditar: AU + 8 letras/números sem ambíguos */
export function novoId() {
  const abc = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const r = crypto.getRandomValues(new Uint8Array(8));
  return 'AU' + [...r].map((n) => abc[n % abc.length]).join('');
}

export const json = (dados, status = 200, extra = {}) => new Response(JSON.stringify(dados), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
});
