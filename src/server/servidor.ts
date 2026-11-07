// Servidor de demonstração do Farol: node:http puro, estado em memória.
// Substituir por Convex (dados, funções, tarefas agendadas) quando o time tiver as contas.
//
//   node src/server/servidor.ts           → http://localhost:3000
//   FAROL_DEMO=0                          → começa com carteira vazia
//   RESEND_API_KEY / FAROL_REMETENTE      → envia e-mails de verdade (senão, simula)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join } from 'node:path';

import { analisarCliente, rankingCarteira, type Cliente } from '../../packages/core/src/analise.ts';
import { rascunharAviso } from '../../packages/core/src/aviso.ts';
import { aplicarMudanca, impactoDaMudanca, type Mudanca } from '../../packages/core/src/mudancas.ts';
import { lerNota, NotaInvalidaError, type NotaFiscal } from '../../packages/core/src/nfe.ts';
import { TRANSICAO, VERSAO_PARAMETROS } from '../../packages/core/src/parametros.ts';
import { TABELA_EXEMPLO, VERSAO_TABELA, type RegraClassificacao } from '../../packages/core/src/tabela-exemplo.ts';
import { enviarAviso } from '../../packages/core/src/integracoes/resend.ts';
import { MUDANCAS_EXEMPLO } from './mudancas-exemplo.ts';

const RAIZ = join(import.meta.dirname, '..', '..');
const FIXTURES = join(RAIZ, 'packages', 'core', 'fixtures');
const PUBLICO = join(RAIZ, 'public');
const PORTA = Number(process.env.PORT ?? 3000);
const ESCRITORIO = process.env.FAROL_ESCRITORIO ?? 'Contabilidade Exemplo';

interface Registro { cliente: Cliente; email: string }
interface Envio { cnpj: string; mudancaId: string; para: string; assunto: string; id: string; simulado: boolean; em: string }

const estado = {
  carteira: new Map<string, Registro>(),
  revisoes: new Map<string, string>(),
  tabela: TABELA_EXEMPLO as RegraClassificacao[],
  mudancas: MUDANCAS_EXEMPLO.map((m) => ({ ...m })) as Mudanca[],
  envios: [] as Envio[],
};

function adicionarNotas(notas: NotaFiscal[], email?: string, nome?: string): Cliente {
  // O cliente é o CNPJ que mais emite entre as notas enviadas.
  const contagem = new Map<string, number>();
  for (const n of notas) if (n.tipo === 'saida') contagem.set(n.emitente.cnpj, (contagem.get(n.emitente.cnpj) ?? 0) + 1);
  const cnpj = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  if (!cnpj) throw new Error('Nenhuma nota de venda encontrada para identificar o cliente.');
  const venda = notas.find((n) => n.emitente.cnpj === cnpj)!;
  const existente = estado.carteira.get(cnpj);
  const chaves = new Set(existente?.cliente.notas.map((n) => n.chave));
  const cliente: Cliente = existente?.cliente ?? { cnpj, nome: nome || venda.emitente.nome, regime: venda.emitente.regime, notas: [] };
  for (const n of notas) if (!chaves.has(n.chave)) cliente.notas.push(n);
  estado.carteira.set(cnpj, { cliente, email: email || existente?.email || '' });
  return cliente;
}

function carregarDemo() {
  const fix = FIXTURES;
  if (!existsSync(fix)) {
    console.log('Sem fixtures: rode `npm run fixtures` para a carteira de demonstração.');
    return;
  }
  const meta = JSON.parse(readFileSync(join(fix, 'clientes.json'), 'utf8')) as { cnpj: string; email: string }[];
  for (const { cnpj, email } of meta) {
    const pasta = join(fix, cnpj);
    const notas = readdirSync(pasta).filter((f) => f.endsWith('.xml')).map((f) => lerNota(readFileSync(join(pasta, f), 'utf8')));
    adicionarNotas(notas, email);
  }
}

const analisar = (r: Registro) => analisarCliente(r.cliente, estado.tabela, estado.revisoes);

function resumo() {
  const ranking = rankingCarteira([...estado.carteira.values()].map(analisar));
  return {
    escritorio: ESCRITORIO,
    versoes: { parametros: VERSAO_PARAMETROS, tabela: VERSAO_TABELA },
    transicao: TRANSICAO,
    clientes: ranking.map(({ produtos: _p, projecao: _pr, ...resto }) => ({ ...resto, email: estado.carteira.get(resto.cnpj)?.email ?? '' })),
  };
}

// ---------------------------------------------------------------- HTTP

async function lerCorpo(req: IncomingMessage, limite = 60 * 1024 * 1024): Promise<unknown> {
  const partes: Buffer[] = [];
  let total = 0;
  for await (const p of req) {
    total += (p as Buffer).length;
    if (total > limite) throw new ErroHttp(413, 'Envio grande demais (limite de 60 MB).');
    partes.push(p as Buffer);
  }
  if (total === 0) return {};
  try {
    return JSON.parse(Buffer.concat(partes).toString('utf8'));
  } catch {
    throw new ErroHttp(400, 'JSON inválido.');
  }
}

class ErroHttp extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

function json(res: ServerResponse, status: number, corpo: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(corpo));
}

const TIPOS: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function estatico(res: ServerResponse, caminho: string) {
  const nome = caminho === '/' ? 'index.html' : caminho.slice(1);
  if (!/^[a-z0-9-]+\.(html|js|css|svg)$/.test(nome)) throw new ErroHttp(404, 'Não encontrado.');
  const arquivo = join(PUBLICO, nome);
  if (!existsSync(arquivo)) throw new ErroHttp(404, 'Não encontrado.');
  res.writeHead(200, { 'Content-Type': TIPOS[extname(nome)] ?? 'application/octet-stream' });
  res.end(readFileSync(arquivo));
}

function mudancaPorId(id: string): Mudanca {
  const m = estado.mudancas.find((x) => x.id === id);
  if (!m) throw new ErroHttp(404, 'Mudança não encontrada.');
  return m;
}

function impacto(m: Mudanca) {
  const carteira = [...estado.carteira.values()];
  return impactoDaMudanca(carteira.map((r) => r.cliente), estado.tabela, m, estado.revisoes).map((a) => {
    const email = estado.carteira.get(a.cnpj)?.email ?? '';
    const { analiseDepois: _d, ...resto } = a;
    return { ...resto, email, aviso: rascunharAviso(ESCRITORIO, a, m, email),
      enviado: estado.envios.find((e) => e.cnpj === a.cnpj && e.mudancaId === m.id) ?? null };
  });
}

async function rotear(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const p = url.pathname;
  const metodo = req.method ?? 'GET';

  if (metodo === 'GET' && !p.startsWith('/api/')) return estatico(res, p);

  if (metodo === 'GET' && p === '/api/carteira') return json(res, 200, resumo());

  let m = /^\/api\/clientes\/(\d{14})$/.exec(p);
  if (metodo === 'GET' && m) {
    const r = estado.carteira.get(m[1]);
    if (!r) throw new ErroHttp(404, 'Cliente não encontrado.');
    return json(res, 200, { ...analisar(r), email: r.email });
  }

  if (metodo === 'POST' && p === '/api/clientes') {
    const corpo = (await lerCorpo(req)) as { email?: string; nome?: string; xmls?: { nome: string; conteudo: string }[] };
    const xmls = corpo.xmls ?? [];
    if (xmls.length === 0) throw new ErroHttp(400, 'Envie pelo menos um XML.');
    const notas: NotaFiscal[] = [];
    const erros: { arquivo: string; erro: string }[] = [];
    for (const x of xmls) {
      try {
        notas.push(lerNota(x.conteudo));
      } catch (e) {
        erros.push({ arquivo: x.nome, erro: e instanceof NotaInvalidaError ? e.message : 'Falha ao ler o arquivo.' });
      }
    }
    if (notas.length === 0) return json(res, 422, { erros });
    const cliente = adicionarNotas(notas, corpo.email, corpo.nome);
    return json(res, 200, { cnpj: cliente.cnpj, lidas: notas.length, erros });
  }

  if (metodo === 'POST' && p === '/api/revisoes') {
    const { chave, cClassTrib } = (await lerCorpo(req)) as { chave?: string; cClassTrib?: string };
    if (!chave || !cClassTrib) throw new ErroHttp(400, 'Informe chave e cClassTrib.');
    estado.revisoes.set(chave, cClassTrib);
    return json(res, 200, { ok: true });
  }

  if (metodo === 'GET' && p === '/api/mudancas') {
    return json(res, 200, estado.mudancas.map((x) => ({ ...x, afetados: x.confirmada ? impacto(x).length : null })));
  }

  m = /^\/api\/mudancas\/([\w-]+)\/(confirmar|impacto|aplicar)$/.exec(p);
  if (metodo === 'POST' && m) {
    const mud = mudancaPorId(m[1]);
    if (m[2] === 'confirmar') mud.confirmada = true;
    if (m[2] === 'aplicar') {
      // Incorpora a mudança à tabela vigente (depois de avisar os clientes).
      estado.tabela = aplicarMudanca(estado.tabela, mud);
      estado.mudancas = estado.mudancas.filter((x) => x.id !== mud.id);
      return json(res, 200, { ok: true });
    }
    if (!mud.confirmada) throw new ErroHttp(409, 'Confirme a mudança antes de calcular o impacto.');
    return json(res, 200, { mudanca: mud, afetados: impacto(mud) });
  }

  if (metodo === 'POST' && p === '/api/avisos/enviar') {
    const c = (await lerCorpo(req)) as { cnpj?: string; mudancaId?: string; para?: string; assunto?: string; texto?: string };
    const mud = mudancaPorId(c.mudancaId ?? '');
    const alvo = impacto(mud).find((a) => a.cnpj === c.cnpj);
    if (!alvo) throw new ErroHttp(404, 'Cliente não afetado por esta mudança.');
    const para = (c.para ?? alvo.email).trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) throw new ErroHttp(400, 'E-mail do cliente inválido.');
    const texto = c.texto ?? alvo.aviso.texto;
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5">${texto
      .split('\n').map((l) => l.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x]!)).join('<br>')}</div>`;
    // A aprovação é o clique do contador neste botão.
    const r = await enviarAviso({ ...alvo.aviso, para, assunto: c.assunto ?? alvo.aviso.assunto, texto, html, aprovado: true });
    const envio: Envio = { cnpj: alvo.cnpj, mudancaId: mud.id, para, assunto: c.assunto ?? alvo.aviso.assunto, id: r.id, simulado: r.simulado, em: new Date().toISOString() };
    estado.envios.push(envio);
    return json(res, 200, envio);
  }

  throw new ErroHttp(404, 'Rota não encontrada.');
}

export function criarServidor() {
  return createServer((req, res) => {
    rotear(req, res).catch((e: unknown) => {
      const status = e instanceof ErroHttp ? e.status : 500;
      if (status === 500) console.error(e);
      json(res, status, { erro: e instanceof Error && status !== 500 ? e.message : 'Erro interno.' });
    });
  });
}

if (import.meta.main) {
  if (process.env.FAROL_DEMO !== '0') carregarDemo();
  criarServidor().listen(PORTA, () => {
    console.log(`Farol em http://localhost:${PORTA}  ·  ${estado.carteira.size} clientes  ·  e-mail ${process.env.RESEND_API_KEY ? 'real (Resend)' : 'simulado'}`);
  });
}
