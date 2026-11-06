/* AURA · página do produto: troca de cor, resumo do pedido, CEP e envio para o Mercado Pago */
(() => {
  const PRECO = { cartao: 229.9, pix: 206.91 };
  const COR = { branco: 'Branco', preto: 'Preto' };
  const reais = (v) => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const $ = (s, el = document) => el.querySelector(s);
  const form = $('#pedido');
  const f = form.elements;
  let modo = 'mercadopago';

  /* Cor: a vitrine e o formulário andam juntos */
  function mostrarCor(cor) {
    const img = $('#foto-fone');
    if (!img.src.includes(`fone-${cor}.`)) {
      img.classList.add('trocando');
      const nova = new Image();
      nova.src = `assets/fone-${cor}.webp`;
      const trocar = () => {
        img.src = nova.src;
        $('#foto-fonte').srcset = `assets/fone-${cor}-480.webp`;
        img.alt = `Fone S3 Air ${COR[cor].toLowerCase()}: os dois fones com clipe e o estojo de carga`;
        img.classList.remove('trocando');
      };
      nova.decode ? nova.decode().then(trocar, trocar) : (nova.onload = trocar);
    }
    $('#botao-abertura').textContent = `Comprar o ${COR[cor].toLowerCase()}`;
    document.querySelectorAll('input[name="cor-vitrine"]').forEach((r) => { r.checked = r.value === cor; });
    f.cor.value = cor;
    resumo();
  }
  document.querySelectorAll('input[name="cor-vitrine"]').forEach((r) => r.addEventListener('change', () => mostrarCor(r.value)));
  form.querySelectorAll('input[name="cor"]').forEach((r) => r.addEventListener('change', () => mostrarCor(r.value)));

  function resumo() {
    const cor = f.cor.value, qtd = Number(f.qtd.value) || 1, forma = f.forma.value;
    $('#resumo-nome').textContent = `S3 Air ${COR[cor]}`;
    $('#resumo-foto').src = `assets/fone-${cor}-480.webp`;
    $('#resumo-qtd').textContent = qtd;
    $('#resumo-total').textContent = reais(PRECO[forma] * qtd);
    $('#resumo-forma').textContent = forma === 'pix' ? 'no Pix ou boleto' : `ou 12x de ${reais(PRECO.cartao * qtd / 12)} no cartão`;
    form.querySelectorAll('.forma-valor').forEach((el) => { el.textContent = reais(PRECO[el.dataset.forma] * qtd); });
  }
  f.qtd.addEventListener('change', resumo);
  form.querySelectorAll('input[name="forma"]').forEach((r) => r.addEventListener('change', resumo));

  /* Máscaras simples */
  const mascara = (el, fn) => el.addEventListener('input', () => { el.value = fn(el.value.replace(/\D/g, '')); });
  mascara(f.cpf, (d) => d.slice(0, 11).replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d)/, '$1.$2').replace(/(\d{3})(\d{1,2})$/, '$1-$2'));
  mascara(f.whatsapp, (d) => d.slice(0, 11).replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2'));
  mascara(f.cep, (d) => d.slice(0, 8).replace(/^(\d{5})(\d)/, '$1-$2'));

  /* CEP: preenche o endereço pelo ViaCEP */
  let ultimoCep = '';
  f.cep.addEventListener('input', async () => {
    const cep = f.cep.value.replace(/\D/g, '');
    if (cep.length !== 8 || cep === ultimoCep) return;
    ultimoCep = cep;
    const ajuda = $('#cep-ajuda');
    ajuda.textContent = 'Buscando endereço…';
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { signal: AbortSignal.timeout(6000) });
      const d = await r.json();
      if (d.erro) { ajuda.textContent = 'CEP não encontrado. Preencha o endereço abaixo.'; return; }
      if (d.logradouro) f.rua.value = d.logradouro;
      if (d.bairro) f.bairro.value = d.bairro;
      f.cidade.value = d.localidade || f.cidade.value;
      f.uf.value = d.uf || f.uf.value;
      ajuda.textContent = '';
      (d.logradouro ? f.numero : f.rua).focus();
    } catch {
      ajuda.textContent = 'Não deu para buscar o CEP. Preencha o endereço abaixo.';
    }
  });

  /* Modo da loja: sem Mercado Pago ligado, o pedido vai pelo WhatsApp */
  fetch('api/loja').then((r) => r.json()).then((d) => {
    modo = d.pagamento;
    if (modo === 'whatsapp') $('#enviar').textContent = 'Enviar pedido pelo WhatsApp';
  }).catch(() => {});

  /* Envio */
  const erro = $('#erro');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    erro.textContent = '';
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    const vazio = [...form.querySelectorAll('[required]')].find((el) => !el.value.trim());
    if (vazio) return falhar('Preencha todos os campos de entrega e contato.', vazio.name);

    const dados = Object.fromEntries(new FormData(form));
    dados.qtd = Number(dados.qtd);
    const botao = $('#enviar');
    const texto = botao.textContent;
    botao.disabled = true;
    botao.textContent = 'Abrindo o pagamento…';
    try {
      const r = await fetch('api/pedido', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dados) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.erro || 'Não foi possível enviar o pedido. Tente de novo.'), { campo: d.campo });
      try { sessionStorage.setItem('aura-pedido', d.id); } catch {}
      location.href = d.init_point || d.whatsapp;
    } catch (e) {
      falhar(e.message === 'Failed to fetch' ? 'Sem conexão. Confira a internet e tente de novo.' : e.message, e.campo);
      botao.disabled = false;
      botao.textContent = texto;
    }
  });

  function falhar(msg, campo) {
    erro.textContent = msg;
    const el = campo && f[campo];
    if (el && el.focus) { if (el.setAttribute) el.setAttribute('aria-invalid', 'true'); el.focus(); }
  }

  resumo();
})();
