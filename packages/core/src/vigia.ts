// Agente Vigia, parte determinística: o que mudou entre duas versões da tabela de cClassTrib.
//
// A fonte vigiada é a própria tabela oficial (ver oficial.ts). Como ela é estruturada, a
// "extração da mudança" não precisa de IA: é a diferença exata entre a tabela que o escritório
// usa e a que o portal publica hoje. O resultado é uma `Mudanca` com efeito `atualiza_tabela`,
// que nasce NÃO confirmada: o contador confere, vê os clientes afetados e decide se incorpora.
//
// Fontes em texto livre (notícias, informes técnicos) continuam em integracoes/firecrawl.ts e
// dependem de um extrator por LLM, ainda não ligado.

import type { EfeitoMudanca, Mudanca } from './mudancas.ts';
import { todosTratamentos, type TabelaClassificacao, type Tratamento } from './tabela.ts';

export type EfeitoAtualizaTabela = Extract<EfeitoMudanca, { tipo: 'atualiza_tabela' }>;

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const semUndefined = (t: Tratamento): Tratamento => JSON.parse(JSON.stringify(t)) as Tratamento;

/** Diferença que leva `antiga` até `nova`. Devolve null se as duas classificam tudo igual. */
export function compararTabelas(antiga: TabelaClassificacao, nova: TabelaClassificacao): EfeitoAtualizaTabela | null {
  if (antiga.padrao.cClassTrib !== nova.padrao.cClassTrib) {
    throw new Error('As tabelas têm códigos de tributação integral diferentes: não dá para comparar.');
  }
  const [tAntes, tDepois] = [todosTratamentos(antiga), todosTratamentos(nova)];
  const tratamentos = [...tDepois.values()].filter((t) => !igual(semUndefined(t), tAntes.get(t.cClassTrib) && semUndefined(tAntes.get(t.cClassTrib)!)));
  const codigosRemovidos = [...tAntes.keys()].filter((c) => !tDepois.has(c));

  const forma = (r: TabelaClassificacao['regras'][number]) => ({ codigos: r.tratamentos.map((t) => t.cClassTrib), criterio: r.criterio });
  const rAntes = new Map(antiga.regras.map((r) => [r.ncmPrefixo, forma(r)]));
  const rDepois = new Map(nova.regras.map((r) => [r.ncmPrefixo, forma(r)]));
  const regras = [...rDepois.entries()]
    .filter(([ncm, r]) => !igual(r, rAntes.get(ncm)))
    .map(([ncm, r]) => (r.criterio === undefined ? { ncm, codigos: r.codigos } : { ncm, codigos: r.codigos, criterio: r.criterio }));
  const ncmsRemovidos = [...rAntes.keys()].filter((n) => !rDepois.has(n));

  if (tratamentos.length + codigosRemovidos.length + regras.length + ncmsRemovidos.length === 0) return null;
  return { tipo: 'atualiza_tabela', tratamentos: tratamentos.map(semUndefined), codigosRemovidos, regras, ncmsRemovidos };
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const alguns = (xs: string[], n = 6) => (xs.length <= n ? xs.join(', ') : `${xs.slice(0, n).join(', ')} e mais ${xs.length - n}`);

/** Resumo em português do que a atualização muda, só com dados das duas tabelas. */
export function resumirAtualizacao(e: EfeitoAtualizaTabela, antiga: TabelaClassificacao): string {
  const antes = todosTratamentos(antiga);
  const partes: string[] = [];
  const reducoes = e.tratamentos.filter((t) => antes.has(t.cClassTrib) && antes.get(t.cClassTrib)!.reducao !== t.reducao);
  const textos = e.tratamentos.filter((t) => antes.has(t.cClassTrib) && antes.get(t.cClassTrib)!.reducao === t.reducao);
  const novos = e.tratamentos.filter((t) => !antes.has(t.cClassTrib));
  if (reducoes.length) {
    partes.push(`Redução alterada em ${reducoes.length} código(s): ` +
      alguns(reducoes.map((t) => `${t.cClassTrib} (de ${pct(antes.get(t.cClassTrib)!.reducao)} para ${pct(t.reducao)})`)) + '.');
  }
  if (novos.length) partes.push(`${novos.length} código(s) novo(s): ${alguns(novos.map((t) => `${t.cClassTrib} (redução de ${pct(t.reducao)})`))}.`);
  if (e.codigosRemovidos.length) partes.push(`${e.codigosRemovidos.length} código(s) deixaram de valer: ${alguns(e.codigosRemovidos)}.`);
  if (textos.length) partes.push(`Descrição ou base legal alterada em ${textos.length} código(s): ${alguns(textos.map((t) => t.cClassTrib))}.`);
  if (e.regras.length) partes.push(`${e.regras.length} NCM(s) com opções ou texto de anexo alterados: ${alguns(e.regras.map((r) => r.ncm))}.`);
  if (e.ncmsRemovidos.length) partes.push(`${e.ncmsRemovidos.length} NCM(s) saíram dos anexos: ${alguns(e.ncmsRemovidos)}.`);
  return partes.join(' ');
}

export interface VersaoOficial {
  versao: string; // oficial-<publicação>-<sha8>
  publicacaoMaisRecente: string; // AAAA-MM-DD ('' se a fonte não trouxer)
  url: string;
  vistaEm: string; // AAAA-MM-DD
}

/** Mudança (não confirmada) que leva a tabela do escritório até a versão oficial vista. Null = nada a fazer. */
export function mudancaDaTabelaOficial(atual: TabelaClassificacao, oficial: TabelaClassificacao, v: VersaoOficial): Mudanca | null {
  const efeito = compararTabelas(atual, oficial);
  if (!efeito) return null;
  return {
    id: v.versao,
    titulo: `Tabela oficial de cClassTrib atualizada${v.publicacaoMaisRecente ? ` (publicação de ${v.publicacaoMaisRecente.split('-').reverse().join('/')})` : ''}`,
    resumo: resumirAtualizacao(efeito, atual),
    fonte: v.url,
    publicadaEm: v.publicacaoMaisRecente || v.vistaEm,
    efeito,
    confirmada: false,
  };
}
