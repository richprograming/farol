// Projeção de carga e de caixa por cliente, e ranking da carteira.
//
// Tudo aqui é conta determinística: nenhuma IA participa dos números.
// Premissas (exibidas ao contador junto com cada resultado):
//   - base de CBS/IBS = valor do item na nota (vProd − vDesc);
//   - crédito de CBS/IBS só sobre compras com nota no período enviado;
//   - ICMS atual = destacado nas vendas − destacado nas compras;
//   - PIS/Cofins atuais = destacados nas vendas, sem crédito (regime cumulativo);
//   - ISS não aparece na NF-e de mercadorias e fica fora da conta;
//   - valores mensais = total do período ÷ número de meses com notas.

import { chaveProduto, classificarItem, type Classificacao, type Revisoes } from './classificar.ts';
import type { ItemNota, NotaFiscal, Regime } from './nfe.ts';
import { DIAS_FLOAT_PADRAO, TRANSICAO, VERSAO_PARAMETROS, type AnoTransicao } from './parametros.ts';
import type { TabelaClassificacao } from './tabela.ts';
import { VERSAO_TABELA } from './tabela-exemplo.ts';

export interface Cliente {
  cnpj: string;
  nome: string;
  regime: Regime;
  diasFloat?: number;
  notas: NotaFiscal[];
}

export interface ProdutoAnalisado {
  chave: string;
  ncm: string;
  descricao: string;
  valorVendas: number; // total no período
  valorCompras: number;
  classificacao: Classificacao;
}

export interface ProjecaoAno {
  ano: number;
  cargaMensal: number;
  diferencaMensal: number; // vs. hoje; positivo = paga mais
  cbs: number;
  ibs: number;
  icms: number;
  pisCofins: number;
  estimativa: boolean;
}

export interface AnaliseCliente {
  cnpj: string;
  nome: string;
  regime: Regime;
  meses: number;
  vendasMensais: number;
  cargaAtualMensal: number;
  projecao: ProjecaoAno[];
  /** Diferença mensal em 2027, o primeiro ano com CBS cheia. */
  exposicao2027: number;
  /** false para Simples/MEI: a carga de hoje (DAS) não está nas notas, então a diferença não se compara. */
  comparavel: boolean;
  /** Capital de giro que deixa de ficar no caixa com split payment (cenário, 2027). */
  efeitoCaixaSplit: number;
  produtos: ProdutoAnalisado[];
  itensParaRevisar: number;
  avisos: string[];
  versoes: { parametros: string; tabela: string };
}

/** Tabela e parâmetros usados num cálculo, com as versões que aparecem para o contador. */
export interface ContextoCalculo {
  transicao: AnoTransicao[];
  versoes: { parametros: string; tabela: string };
  diasFloatPadrao?: number;
}

export const CONTEXTO_PADRAO: ContextoCalculo = {
  transicao: TRANSICAO,
  versoes: { parametros: VERSAO_PARAMETROS, tabela: VERSAO_TABELA },
  diasFloatPadrao: DIAS_FLOAT_PADRAO,
};

const centavos = (v: number) => Math.round(v * 100) / 100;

function mesesDistintos(notas: NotaFiscal[]): number {
  const s = new Set(notas.map((n) => n.emissao.slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)));
  return Math.max(1, s.size);
}

/** Separa as notas do cliente em vendas (ele emitiu) e compras (ele é o destinatário). */
export function separarNotas(cliente: Pick<Cliente, 'cnpj' | 'notas'>) {
  const cnpj = cliente.cnpj.replace(/\D/g, '');
  const vendas: NotaFiscal[] = [];
  const compras: NotaFiscal[] = [];
  for (const n of cliente.notas) {
    if (n.emitente.cnpj === cnpj && n.tipo === 'saida') vendas.push(n);
    else if (n.destinatario?.documento === cnpj) compras.push(n);
  }
  return { vendas, compras };
}

interface Soma {
  valor: number;
  icms: number;
  pisCofins: number;
  baseIva: number; // valor × (1 − redução), soma por item
}

function somar(itens: { item: ItemNota; c: Classificacao }[]): Soma {
  const s: Soma = { valor: 0, icms: 0, pisCofins: 0, baseIva: 0 };
  for (const { item, c } of itens) {
    s.valor += item.valor;
    s.icms += item.vICMS;
    s.pisCofins += item.vPIS + item.vCOFINS;
    s.baseIva += item.valor * (1 - c.tratamento.reducao);
  }
  return s;
}

function projetarAno(p: AnoTransicao, v: Soma, c: Soma, meses: number, atual: number): ProjecaoAno {
  const icmsLiquido = Math.max(0, v.icms - c.icms);
  const icms = icmsLiquido * p.fracaoIcmsIss;
  const pisCofins = p.pisCofinsExiste ? v.pisCofins : 0;
  const cbs = Math.max(0, (v.baseIva - c.baseIva) * p.cbs);
  const ibs = Math.max(0, (v.baseIva - c.baseIva) * p.ibs);
  // 2026: CBS/IBS compensados com PIS/Cofins → carga igual à de hoje.
  const total = p.compensavel ? icms + pisCofins : icms + pisCofins + cbs + ibs;
  const mensal = total / meses;
  return {
    ano: p.ano,
    cargaMensal: centavos(mensal),
    diferencaMensal: centavos(mensal - atual),
    cbs: centavos(cbs / meses),
    ibs: centavos(ibs / meses),
    icms: centavos(icms / meses),
    pisCofins: centavos(pisCofins / meses),
    estimativa: p.estimativa,
  };
}

export function analisarCliente(
  cliente: Cliente,
  tabela: TabelaClassificacao,
  revisoes: Revisoes = new Map(),
  contexto: ContextoCalculo = CONTEXTO_PADRAO,
): AnaliseCliente {
  const { transicao } = contexto;
  const { vendas, compras } = separarNotas(cliente);
  const avisos: string[] = [];
  if (cliente.regime === 'simples' || cliente.regime === 'mei') {
    avisos.push('Cliente do Simples Nacional/MEI: a projeção abaixo simula o regime regular e serve para avaliar a opção, não para estimar o DAS.');
  }
  if (vendas.length === 0) avisos.push('Nenhuma nota de venda deste CNPJ no período enviado.');
  if (compras.length === 0) avisos.push('Nenhuma nota de compra enviada: a projeção não considera créditos e tende a superestimar a carga.');

  const produtos = new Map<string, ProdutoAnalisado>();
  const classificar = (item: ItemNota) => {
    const chave = chaveProduto(item);
    let p = produtos.get(chave);
    if (!p) {
      p = { chave, ncm: item.ncm, descricao: item.descricao, valorVendas: 0, valorCompras: 0,
        classificacao: classificarItem(item, tabela, revisoes) };
      produtos.set(chave, p);
    }
    return p;
  };

  const itensVenda = vendas.flatMap((n) => n.itens).map((item) => {
    const p = classificar(item);
    p.valorVendas += item.valor;
    return { item, c: p.classificacao };
  });
  const itensCompra = compras.flatMap((n) => n.itens).map((item) => {
    const p = classificar(item);
    p.valorCompras += item.valor;
    return { item, c: p.classificacao };
  });

  const meses = mesesDistintos([...vendas, ...compras]);
  const v = somar(itensVenda);
  const c = somar(itensCompra);
  const atual = (Math.max(0, v.icms - c.icms) + v.pisCofins) / meses;
  const projecao = transicao.map((p) => projetarAno(p, v, c, meses, atual));
  const p2027 = projecao.find((p) => p.ano === 2027);
  const diasFloat = cliente.diasFloat ?? contexto.diasFloatPadrao ?? DIAS_FLOAT_PADRAO;
  // Split payment (cenário): o débito de CBS/IBS das vendas sai no recebimento,
  // em vez de ficar ~diasFloat dias no caixa. Efeito de estoque, não mensal.
  const t2027 = transicao.find((t) => t.ano === 2027);
  const debitoMensal2027 = t2027 ? (v.baseIva / meses) * (t2027.cbs + t2027.ibs) : 0;
  const efeitoCaixaSplit = centavos(debitoMensal2027 * (diasFloat / 30));

  const lista = [...produtos.values()].sort((a, b) => b.valorVendas - a.valorVendas);
  for (const p of lista) {
    p.valorVendas = centavos(p.valorVendas);
    p.valorCompras = centavos(p.valorCompras);
  }

  return {
    cnpj: cliente.cnpj,
    nome: cliente.nome,
    regime: cliente.regime,
    meses,
    vendasMensais: centavos(v.valor / meses),
    cargaAtualMensal: centavos(atual),
    projecao,
    exposicao2027: p2027?.diferencaMensal ?? 0,
    comparavel: cliente.regime === 'normal',
    efeitoCaixaSplit,
    produtos: lista,
    itensParaRevisar: lista.filter((p) => p.classificacao.precisaRevisao).length,
    avisos,
    versoes: { ...contexto.versoes },
  };
}

/**
 * Ordena a carteira: clientes de regime normal primeiro, por quanto mais pagam em 2027;
 * depois Simples/MEI (sem comparação direta); empate desfeito por itens a revisar.
 */
export function rankingCarteira(analises: AnaliseCliente[]): AnaliseCliente[] {
  return [...analises].sort((a, b) =>
    Number(b.comparavel) - Number(a.comparavel) ||
    b.exposicao2027 - a.exposicao2027 ||
    b.itensParaRevisar - a.itensParaRevisar);
}
