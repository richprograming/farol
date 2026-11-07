// Interface do Farol: JavaScript puro, sem build. Todo texto vindo de XML entra via textContent.

const brl = (v) => (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const sinal = (v) => (v > 0 ? `+${brl(v)}` : brl(v));
const REGIME = { normal: 'Regime normal', simples: 'Simples Nacional', mei: 'MEI', desconhecido: '—' };
const STATUS = {
  revisado: ['Revisado', 'bom'], da_nota: ['Da nota', ''], tabela: ['Tabela', ''], padrao: ['Integral', ''], revisar: ['Revisar', 'alerta'],
};

function el(tag, attrs = {}, ...filhos) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat(Infinity)) if (f != null && f !== false) n.append(f instanceof Node ? f : String(f));
  return n;
}

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, { headers: { 'Content-Type': 'application/json' }, ...opcoes,
    body: opcoes.body ? JSON.stringify(opcoes.body) : undefined });
  const corpo = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(corpo.erro ?? `Erro ${r.status}`), { corpo });
  return corpo;
}

const estado = { selecionado: null, impactos: {} };

// ------------------------------------------------------------------ abas
for (const b of document.querySelectorAll('[data-aba]')) {
  b.addEventListener('click', () => mostrarAba(b.dataset.aba));
}
function mostrarAba(nome) {
  for (const b of document.querySelectorAll('[data-aba]')) b.setAttribute('aria-selected', String(b.dataset.aba === nome));
  document.getElementById('aba-carteira').hidden = nome !== 'carteira';
  document.getElementById('aba-radar').hidden = nome !== 'radar';
  if (nome === 'radar') carregarRadar();
}

// ------------------------------------------------------------------ carteira
async function carregarCarteira() {
  const dados = await api('/api/carteira');
  document.getElementById('escritorio').textContent = dados.escritorio;
  const c = dados.clientes;
  const exposicao = c.filter((x) => x.comparavel).reduce((s, x) => s + x.exposicao2027, 0);
  const caixa = c.reduce((s, x) => s + x.efeitoCaixaSplit, 0);
  const revisar = c.reduce((s, x) => s + x.itensParaRevisar, 0);
  document.getElementById('numeros').replaceChildren(
    numero('Clientes na carteira', c.length),
    numero('Variação mensal em 2027 (regime normal)', sinal(exposicao)),
    numero('Caixa que o split payment retém', brl(caixa)),
    numero('Produtos para revisar', revisar),
  );

  const tabela = document.getElementById('tabela-carteira');
  if (c.length === 0) {
    tabela.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'vazio' }, 'Nenhum cliente ainda. Use "Adicionar cliente" para subir os XMLs.'))));
    return;
  }
  tabela.replaceChildren(
    el('thead', {}, el('tr', {},
      el('th', {}, 'Cliente'), el('th', {}, 'Regime'), el('th', { class: 'num' }, 'Vendas/mês'),
      el('th', { class: 'num' }, 'Tributos hoje/mês'), el('th', { class: 'num' }, 'Variação 2027/mês'),
      el('th', { class: 'num' }, 'Caixa (split)'), el('th', {}, 'Revisar'))),
    el('tbody', {}, c.map((x) => el('tr', {
      class: `clicavel${estado.selecionado === x.cnpj ? ' ativo' : ''}`, tabindex: '0',
      onclick: () => abrirCliente(x.cnpj), onkeydown: (e) => e.key === 'Enter' && abrirCliente(x.cnpj),
    },
      el('td', {}, el('div', { class: 'nome-cliente' }, x.nome), el('div', { class: 'citacao' }, formatarCnpj(x.cnpj))),
      el('td', {}, REGIME[x.regime]),
      el('td', { class: 'num' }, brl(x.vendasMensais)),
      el('td', { class: 'num' }, x.comparavel ? brl(x.cargaAtualMensal) : el('span', { class: 'citacao', title: 'O DAS não aparece nas notas' }, 'DAS')),
      x.comparavel
        ? el('td', { class: `num ${x.exposicao2027 > 0 ? 'mais' : 'menos'}` }, sinal(x.exposicao2027))
        : el('td', { class: 'num' }, el('span', { class: 'pilula', title: 'Simular a opção pelo regime regular' }, 'avaliar opção')),
      el('td', { class: 'num' }, brl(x.efeitoCaixaSplit)),
      el('td', {}, x.itensParaRevisar ? el('span', { class: 'pilula alerta' }, x.itensParaRevisar) : '—'),
    ))),
  );
  if (!estado.selecionado) abrirCliente(c[0].cnpj);
}

function numero(rotulo, valor) {
  return el('div', { class: 'numero' }, el('div', { class: 'rotulo' }, rotulo), el('div', { class: 'valor' }, valor));
}
const formatarCnpj = (c) => c.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');

async function abrirCliente(cnpj) {
  estado.selecionado = cnpj;
  for (const tr of document.querySelectorAll('#tabela-carteira tbody tr')) tr.classList.remove('ativo');
  const a = await api(`/api/clientes/${cnpj}`);
  const linhas = [...document.querySelectorAll('#tabela-carteira tbody tr')];
  linhas.find((tr) => tr.textContent.includes(formatarCnpj(cnpj)))?.classList.add('ativo');

  // Regime normal: diferença contra hoje. Simples/MEI: carga simulada no regime regular (o DAS não está nas notas).
  const valor = (p) => (a.comparavel ? p.diferencaMensal : p.cargaMensal);
  const maxAbs = Math.max(1, ...a.projecao.map((p) => Math.abs(valor(p))));
  const barras = el('div', { class: 'barras' }, a.projecao.map((p) => {
    const v = valor(p);
    const w = (Math.abs(v) / maxAbs) * 50;
    const esquerda = v >= 0 ? 50 : 50 - w;
    return [
      el('div', {}, p.ano),
      el('div', { class: 'trilho', title: `${p.ano}: carga estimada ${brl(p.cargaMensal)}/mês` },
        el('div', { class: 'eixo' }),
        el('div', { class: `barra ${v >= 0 ? 'mais' : 'menos'}`, style: `left:${esquerda}%;width:${w}%` })),
      el('div', { class: `num ${p.estimativa ? 'estimativa' : ''}` }, a.comparavel ? sinal(v) : brl(v)),
    ];
  }));
  const tituloBarras = a.comparavel ? 'Variação mensal estimada contra hoje' : 'Carga mensal simulada no regime regular';

  const produtos = el('table', { class: 'tabela' },
    el('thead', {}, el('tr', {}, el('th', {}, 'Produto'), el('th', {}, 'NCM'), el('th', { class: 'num' }, 'Vendas no período'), el('th', {}, 'Tratamento'))),
    el('tbody', {}, a.produtos.map((p) => linhaProduto(p))));

  document.getElementById('detalhe').replaceChildren(
    el('div', { class: 'cartao' },
      el('h2', {}, a.nome),
      el('p', { class: 'sub' }, `${REGIME[a.regime]} · ${a.meses} ${a.meses === 1 ? 'mês' : 'meses'} de notas · parâmetros ${a.versoes.parametros} · tabela ${a.versoes.tabela}`),
      a.avisos.length ? el('ul', { class: 'avisos' }, a.avisos.map((t) => el('li', {}, t))) : null,
      el('div', { class: 'grade-detalhe' },
        el('div', {},
          el('h3', {}, tituloBarras),
          barras,
          el('p', { class: 'citacao' }, 'Vermelho = paga mais; verde = paga menos. Valores em cinza usam alíquotas ainda estimadas.')),
        el('div', {},
          el('h3', {}, 'Split payment (cenário 2027)'),
          el('p', { class: 'sub' }, `Com o imposto separado no recebimento, cerca de ${brl(a.efeitoCaixaSplit)} deixam de ficar no caixa do cliente. Premissa: hoje o tributo sai ~25 dias depois do recebimento.`),
          el('h3', {}, 'Premissas da conta'),
          el('p', { class: 'citacao' }, 'Base de CBS/IBS = valor do item. Crédito só sobre compras com nota enviada. ICMS = vendas − compras. PIS/Cofins cumulativos. ISS fora. Média mensal do período.'))),
      el('h3', {}, `Produtos (${a.produtos.length})`),
      produtos),
  );
}

function linhaProduto(p) {
  const c = p.classificacao;
  const [rotulo, tom] = STATUS[c.status];
  let tratamento;
  if (c.precisaRevisao) {
    const sel = el('select', { 'aria-label': `Tratamento de ${p.descricao}` },
      c.candidatos.map((t) => el('option', { value: t.cClassTrib, selected: t.cClassTrib === c.tratamento.cClassTrib }, `${t.cClassTrib} · ${t.descricao}`)));
    tratamento = el('div', { class: 'revisao' },
      el('span', { class: `pilula ${tom}` }, rotulo), ' ', sel, ' ',
      el('button', { class: 'botao secundario', onclick: async (e) => {
        e.target.disabled = true;
        await api('/api/revisoes', { method: 'POST', body: { chave: p.chave, cClassTrib: sel.value } });
        await carregarCarteira();
        await abrirCliente(estado.selecionado);
      } }, 'Confirmar'),
      el('div', { class: 'citacao' }, c.motivo));
  } else {
    tratamento = el('div', {}, el('span', { class: `pilula ${tom}` }, rotulo), ' ', `${c.tratamento.cClassTrib} · ${c.tratamento.descricao}`,
      el('div', { class: 'citacao' }, c.tratamento.baseLegal));
  }
  return el('tr', {}, el('td', {}, p.descricao), el('td', {}, p.ncm), el('td', { class: 'num' }, brl(p.valorVendas)), el('td', {}, tratamento));
}

// ------------------------------------------------------------------ envio de XMLs
const form = document.getElementById('envio');
document.getElementById('abrir-envio').addEventListener('click', () => { form.hidden = false; });
document.getElementById('cancelar-envio').addEventListener('click', () => { form.hidden = true; });
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const arquivos = [...document.getElementById('arquivos').files];
  const saida = document.getElementById('resultado-envio');
  saida.textContent = `Lendo ${arquivos.length} arquivos…`;
  const xmls = await Promise.all(arquivos.map(async (f) => ({ nome: f.name, conteudo: await f.text() })));
  try {
    const r = await api('/api/clientes', { method: 'POST', body: { xmls, email: document.getElementById('email-novo').value } });
    saida.textContent = `${r.lidas} notas lidas${r.erros.length ? `, ${r.erros.length} com erro (${r.erros.slice(0, 3).map((x) => `${x.arquivo}: ${x.erro}`).join('; ')})` : ''}.`;
    estado.selecionado = r.cnpj;
    await carregarCarteira();
    await abrirCliente(r.cnpj);
  } catch (err) {
    saida.textContent = err.corpo?.erros ? `Nenhuma nota válida: ${err.corpo.erros.slice(0, 3).map((x) => x.erro).join('; ')}` : err.message;
  }
});

// ------------------------------------------------------------------ radar
async function carregarRadar() {
  const lista = await api('/api/mudancas');
  const cont = document.getElementById('contador-radar');
  const pendentes = lista.filter((m) => !m.confirmada).length;
  cont.hidden = pendentes === 0;
  cont.textContent = pendentes;
  const alvo = document.getElementById('lista-mudancas');
  if (lista.length === 0) return alvo.replaceChildren(el('div', { class: 'cartao vazio' }, 'Nenhuma mudança pendente.'));
  alvo.replaceChildren(...lista.map(cartaoMudanca));
}

function cartaoMudanca(m) {
  const corpo = el('div', {});
  const cartao = el('div', { class: 'cartao mudanca' },
    el('h2', {}, m.titulo),
    el('div', { class: 'meta' }, `Publicada em ${m.publicadaEm.split('-').reverse().join('/')}`,
      m.vigenciaDesde ? ` · vigência ${m.vigenciaDesde.split('-').reverse().join('/')}` : '', ' · ',
      el('a', { href: m.fonte, target: '_blank', rel: 'noopener' }, 'fonte')),
    el('p', { class: 'sub' }, m.resumo),
    m.confirmada
      ? el('p', { class: 'sub' }, el('span', { class: 'pilula bom' }, 'Confirmada'), ` ${m.afetados} cliente(s) afetado(s)`)
      : el('div', { class: 'acoes' }, el('button', { class: 'botao', onclick: async () => {
        estado.impactos[m.id] = await api(`/api/mudancas/${m.id}/confirmar`, { method: 'POST' });
        carregarRadar();
      } }, 'Leitura correta: calcular impacto')),
    corpo);
  if (m.confirmada) {
    const carregar = estado.impactos[m.id]
      ? Promise.resolve(estado.impactos[m.id])
      : api(`/api/mudancas/${m.id}/impacto`, { method: 'POST' });
    carregar.then((r) => { estado.impactos[m.id] = r; corpo.replaceChildren(...afetados(r)); });
  }
  return cartao;
}

function afetados(r) {
  if (r.afetados.length === 0) return [el('p', { class: 'sub' }, 'Nenhum cliente da carteira vende produtos afetados.')];
  return r.afetados.map((a) => {
    const para = el('input', { type: 'email', value: a.enviado?.para ?? a.email, 'aria-label': 'E-mail do cliente' });
    const assunto = el('input', { type: 'text', value: a.aviso.assunto, 'aria-label': 'Assunto' });
    const texto = el('textarea', { 'aria-label': 'Texto do aviso' });
    texto.value = a.aviso.texto;
    const status = el('span', { class: 'sub', role: 'status' });
    const botao = el('button', { class: 'botao', disabled: Boolean(a.enviado), onclick: async () => {
      botao.disabled = true;
      status.textContent = 'Enviando…';
      try {
        const e = await api('/api/avisos/enviar', { method: 'POST', body: { cnpj: a.cnpj, mudancaId: r.mudanca.id, para: para.value, assunto: assunto.value, texto: texto.value } });
        status.textContent = e.simulado ? `Aprovado. Envio simulado (sem RESEND_API_KEY) para ${e.para}.` : `Enviado para ${e.para} · id ${e.id}`;
      } catch (err) {
        status.textContent = err.message;
        botao.disabled = false;
      }
    } }, a.enviado ? 'Enviado' : 'Aprovar e enviar');
    if (a.enviado) status.textContent = `${a.enviado.simulado ? 'Envio simulado' : 'Enviado'} para ${a.enviado.para}`;
    return el('div', { class: 'afetado' },
      el('div', { class: 'afetado-topo' },
        el('div', {}, el('div', { class: 'nome-cliente' }, a.nome),
          el('div', { class: 'citacao' }, a.produtosAfetados.map((p) => `${p.descricao}: ${p.de} → ${p.para}`).join(' · '))),
        el('div', { class: a.variacaoMensal > 0 ? 'mais' : 'menos' }, `${sinal(a.variacaoMensal)}/mês em 2027`)),
      el('div', { class: 'linha-form' }, el('span', {}, 'Para'), para),
      el('div', { class: 'linha-form' }, el('span', {}, 'Assunto'), assunto),
      texto,
      el('div', { class: 'acoes' }, botao, status));
  });
}

carregarCarteira();
carregarRadar();
