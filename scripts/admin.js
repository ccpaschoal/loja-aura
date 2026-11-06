/* AURA · painel de pedidos: login, lista, dados de entrega para o AliExpress e acompanhamento */
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const COR = { branco: 'Branco', preto: 'Preto' };
  const STATUS = { pago: 'Pago', conferir: 'Pago com valor diferente', pendente: 'Aguardando pagamento', whatsapp: 'Pedido pelo WhatsApp', estornado: 'Estornado' };
  const METODO = { bank_transfer: 'Pix', ticket: 'boleto', credit_card: 'cartão', debit_card: 'débito', account_money: 'saldo MP' };
  const reais = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',');
  const data = (ms) => new Date(ms).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const fone = (n) => `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  const cpf = (c) => c.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  let token = '';
  try { token = sessionStorage.getItem('aura-token') || ''; } catch {}
  let pedidos = [];
  let filtro = 'comprar';

  async function api(metodo, corpo) {
    const r = await fetch('api/admin', {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 && corpo?.acao !== 'entrar') { sair(); throw new Error(d.erro); }
    if (!r.ok) throw new Error(d.erro || 'Erro ao falar com o servidor.');
    return d;
  }
  function sair() {
    token = '';
    try { sessionStorage.removeItem('aura-token'); } catch {}
    $('#area').hidden = true;
    $('#login').hidden = false;
  }

  $('#login').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    $('#login-erro').textContent = '';
    try {
      const d = await api('POST', { acao: 'entrar', senha: ev.target.senha.value });
      token = d.token;
      try { sessionStorage.setItem('aura-token', token); } catch {}
      ev.target.reset();
      carregar();
    } catch (e) { $('#login-erro').textContent = e.message; }
  });

  async function carregar() {
    try {
      const d = await api('GET');
      pedidos = d.pedidos;
      $('#pendencias').replaceChildren(...d.pendencias.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
      $('#login').hidden = true;
      $('#area').hidden = false;
      desenhar();
    } catch (e) { if (token) alertaLista(e.message); }
  }
  const alertaLista = (t) => $('#lista').replaceChildren(Object.assign(document.createElement('p'), { className: 'vazio', textContent: t }));

  const entra = (p) => filtro === 'todos'
    || (filtro === 'comprar' && ['pago', 'conferir', 'whatsapp'].includes(p.status) && p.etapa === 'novo')
    || (filtro === 'caminho' && ['comprado', 'enviado'].includes(p.etapa));

  function textoEntrega(p) {
    const e = p.endereco;
    return [p.nome, `CPF ${cpf(p.cpf)}`, `Celular ${fone(p.whatsapp)}`,
      `${e.rua}, ${e.numero}${e.complemento ? ` - ${e.complemento}` : ''}`, `${e.bairro} - ${e.cidade}/${e.uf}`, `CEP ${p.cep.replace(/(\d{5})(\d{3})/, '$1-$2')}`].join('\n');
  }

  function desenhar() {
    const lista = pedidos.filter(entra);
    if (!lista.length) return alertaLista(filtro === 'comprar' ? 'Nenhum pedido pago esperando compra no AliExpress.' : 'Nenhum pedido aqui.');
    $('#lista').replaceChildren(...lista.map((p) => {
      const el = $('#modelo').content.firstElementChild.cloneNode(true);
      $('.p-titulo', el).textContent = `${p.id} · ${p.qtd}x ${COR[p.cor] || p.cor}`;
      const st = $('.p-status', el);
      st.textContent = `${STATUS[p.status] || p.status}${p.metodo ? ` · ${METODO[p.metodo] || p.metodo}` : ''}`;
      st.classList.add(p.status);
      $('.p-cliente', el).textContent = `${data(p.criado_em)} · ${reais(p.valor_pago ?? p.valor)} · ${p.email}${p.ambiente === 'teste' ? ' · TESTE' : ''}`;
      $('pre', el).textContent = textoEntrega(p);
      $('.p-copiar', el).addEventListener('click', async (ev) => {
        try { await navigator.clipboard.writeText(textoEntrega(p)); ev.target.textContent = 'Copiado!'; } catch { ev.target.textContent = 'Selecione e copie o texto'; }
        setTimeout(() => { ev.target.textContent = 'Copiar dados de entrega'; }, 2000);
      });
      const f = $('.p-form', el);
      for (const k of ['etapa', 'ali_pedido', 'rastreio', 'obs']) f[k].value = p[k] || (k === 'etapa' ? 'novo' : '');
      const whats = $('.p-whats', el);
      const linkWhats = () => {
        const msg = `Oi, ${p.nome.split(' ')[0]}! Aqui é da AURA. Seu pedido ${p.id} foi enviado.${f.rastreio.value ? ` Código de rastreio: ${f.rastreio.value}` : ''} O prazo é de 15 a 30 dias úteis.`;
        whats.href = `https://wa.me/55${p.whatsapp}?text=${encodeURIComponent(msg)}`;
      };
      f.rastreio.addEventListener('input', linkWhats);
      linkWhats();
      f.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const salvo = $('.p-salvo', el);
        salvo.textContent = 'Salvando…';
        try {
          const dados = { acao: 'atualizar', id: p.id, etapa: f.etapa.value, ali_pedido: f.ali_pedido.value, rastreio: f.rastreio.value, obs: f.obs.value };
          await api('POST', dados);
          Object.assign(p, dados);
          salvo.textContent = 'Salvo.';
        } catch (e) { salvo.textContent = e.message; }
      });
      return el;
    }));
  }

  document.querySelectorAll('[data-filtro]').forEach((b) => b.addEventListener('click', () => {
    filtro = b.dataset.filtro;
    document.querySelectorAll('[data-filtro]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    desenhar();
  }));
  $('#atualizar').addEventListener('click', carregar);

  if (token) carregar(); else sair();
})();
