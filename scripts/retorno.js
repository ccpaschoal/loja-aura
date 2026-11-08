/* AURA · volta do Mercado Pago: confere o pedido na API antes de dizer que foi pago */
(() => {
  const q = new URLSearchParams(location.search);
  let id = q.get('external_reference') || '';
  try { id = id || sessionStorage.getItem('aura-pedido') || ''; } catch {}
  const mpStatus = q.get('collection_status') || q.get('status') || '';
  const $ = (s) => document.getElementById(s);

  function mostrar(titulo, texto, botao = 'Voltar para a loja', href = './') {
    $('ret-titulo').textContent = titulo;
    $('ret-texto').textContent = texto;
    $('ret-botao').textContent = botao;
    $('ret-botao').href = href;
    $('ret-botao').hidden = false;
    if (/^AU[0-9A-Z]{8}$/.test(id)) { $('ret-codigo').textContent = id; $('ret-codigo-linha').hidden = false; }
  }
  const pago = () => mostrar('Pagamento aprovado!',
    'Recebemos seu pedido. Você recebe por e-mail o código de rastreio quando ele for despachado. O prazo é de 15 a 30 dias úteis.');
  const pendente = () => mostrar('Ainda sem confirmação',
    'Seu pedido está guardado, mas o pagamento ainda não foi confirmado. Se for Pix ou boleto, pague em até 3 dias; assim que cair, avisamos por e-mail. Se o pagamento não passou, você pode tentar de novo.');
  const falhou = () => mostrar('O pagamento não foi aprovado',
    'Nada foi cobrado. Você pode tentar de novo com outra forma de pagamento.', 'Tentar de novo', './#comprar');
  const naoConfirmado = () => mostrar('Não encontramos o pedido',
    'Se você pagou, guarde o comprovante e fale com a gente pelo WhatsApp.');

  if (!/^AU[0-9A-Z]{8}$/.test(id)) {
    return naoConfirmado();
  }

  let tentativas = 0;
  async function conferir() {
    tentativas++;
    try {
      const r = await fetch(`api/status?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('Pedido não confirmado');
      const d = await r.json();
      if (d.status === 'pago' || d.status === 'conferir') return pago();
      if (d.status === 'falhou' || d.status === 'recusado') return falhou();
    } catch {}
    // O aviso do Mercado Pago pode chegar alguns segundos depois da volta para o site
    if (mpStatus === 'approved' && tentativas < 8) return setTimeout(conferir, 2500);
    if (mpStatus === 'approved') return naoConfirmado();
    return pendente();
  }
  conferir();
})();
