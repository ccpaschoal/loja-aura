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
  const pendente = () => mostrar('Falta pagar',
    'Seu pedido está guardado. Pague o Pix ou o boleto em até 3 dias para confirmar. Assim que o pagamento cair, avisamos por e-mail.');
  const falhou = () => mostrar('O pagamento não foi aprovado',
    'Nada foi cobrado. Você pode tentar de novo com outra forma de pagamento.', 'Tentar de novo', './#comprar');

  if (!/^AU[0-9A-Z]{8}$/.test(id)) {
    if (mpStatus === 'approved') return pago();
    return mostrar('Não encontramos o pedido', 'Se você pagou, guarde o comprovante e fale com a gente pelo WhatsApp.');
  }

  let tentativas = 0;
  async function conferir() {
    tentativas++;
    try {
      const r = await fetch(`api/status?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
      const d = await r.json();
      if (d.status === 'pago' || d.status === 'conferir') return pago();
    } catch {}
    // O aviso do Mercado Pago pode chegar alguns segundos depois da volta para o site
    if (mpStatus === 'approved' && tentativas < 8) return setTimeout(conferir, 2500);
    if (mpStatus === 'approved') return mostrar('Pagamento recebido', 'O Mercado Pago aprovou seu pagamento. A confirmação aparece aqui em alguns minutos; você também recebe por e-mail.');
    if (['rejected', 'null', 'failure'].includes(mpStatus)) return falhou();
    return pendente();
  }
  conferir();
})();
