// Classificação de itens em cClassTrib.
//
// Ordem de decisão (a primeira que resolve vence):
//   1. decisão do contador já registrada para esse produto (revisões)
//   2. cClassTrib que veio na própria nota, se a tabela conhece o código
//   3. tabela: NCM com um único tratamento possível
//   4. NCM com vários tratamentos → fila de revisão (a IA pode sugerir, nunca decide sozinha)
// A IA entra só no passo 4, por meio de `SugestorIA`, e sempre devolve a base legal.

import type { ItemNota } from './nfe.ts';
import { INTEGRAL, type RegraClassificacao, type Tratamento } from './tabela-exemplo.ts';

export type StatusClassificacao = 'revisado' | 'da_nota' | 'tabela' | 'padrao' | 'revisar';

export interface Classificacao {
  status: StatusClassificacao;
  tratamento: Tratamento; // o usado na conta (em 'revisar', o mais conservador: menor redução)
  candidatos: Tratamento[];
  precisaRevisao: boolean;
  motivo: string;
  sugestaoIA?: SugestaoIA;
}

export interface SugestaoIA {
  cClassTrib: string;
  confianca: number; // 0 a 1
  justificativa: string;
  trechoLegal: string;
}

export interface SugestorIA {
  sugerir(item: ItemNota, candidatos: Tratamento[], criterio?: string): Promise<SugestaoIA>;
}

/** Chave estável de um produto para guardar a decisão do contador. */
export function chaveProduto(item: Pick<ItemNota, 'ncm' | 'descricao'>): string {
  const desc = item.descricao
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${item.ncm}|${desc}`;
}

export type Revisoes = Map<string, string>; // chaveProduto → cClassTrib escolhido

export function regraDoNcm(ncm: string, tabela: RegraClassificacao[]): RegraClassificacao | undefined {
  let melhor: RegraClassificacao | undefined;
  for (const r of tabela) {
    if (ncm.startsWith(r.ncmPrefixo) && (!melhor || r.ncmPrefixo.length > melhor.ncmPrefixo.length)) melhor = r;
  }
  return melhor;
}

function todosTratamentos(tabela: RegraClassificacao[]): Map<string, Tratamento> {
  const m = new Map<string, Tratamento>([[INTEGRAL.cClassTrib, INTEGRAL]]);
  for (const r of tabela) for (const t of r.tratamentos) m.set(t.cClassTrib, t);
  return m;
}

export function classificarItem(
  item: ItemNota,
  tabela: RegraClassificacao[],
  revisoes: Revisoes = new Map(),
): Classificacao {
  const conhecidos = todosTratamentos(tabela);
  const regra = regraDoNcm(item.ncm, tabela);
  const candidatos = regra?.tratamentos ?? [INTEGRAL];

  const decidido = revisoes.get(chaveProduto(item));
  if (decidido && conhecidos.has(decidido)) {
    return { status: 'revisado', tratamento: conhecidos.get(decidido)!, candidatos, precisaRevisao: false,
      motivo: 'Decisão registrada pelo contador.' };
  }

  if (item.cClassTrib) {
    const t = conhecidos.get(item.cClassTrib);
    if (t) {
      const coerente = candidatos.some((c) => c.cClassTrib === t.cClassTrib);
      return { status: 'da_nota', tratamento: t, candidatos, precisaRevisao: !coerente,
        motivo: coerente ? 'Código informado na nota, coerente com o NCM.'
          : 'Código informado na nota não bate com os tratamentos esperados para o NCM.' };
    }
  }

  if (!regra) {
    return { status: 'padrao', tratamento: INTEGRAL, candidatos, precisaRevisao: false,
      motivo: 'NCM sem tratamento diferenciado na tabela: tributação integral.' };
  }

  if (candidatos.length === 1) {
    return { status: 'tabela', tratamento: candidatos[0], candidatos, precisaRevisao: false,
      motivo: `NCM ${regra.ncmPrefixo}* tem um único tratamento na tabela.` };
  }

  const conservador = [...candidatos].sort((a, b) => a.reducao - b.reducao)[0];
  return { status: 'revisar', tratamento: conservador, candidatos, precisaRevisao: true,
    motivo: regra.criterio ?? 'O NCM admite mais de um tratamento.' };
}

/** Pede sugestão à IA para itens em revisão. Não muda o tratamento usado na conta. */
export async function sugerirComIA(
  item: ItemNota,
  c: Classificacao,
  tabela: RegraClassificacao[],
  sugestor: SugestorIA,
): Promise<Classificacao> {
  if (c.status !== 'revisar') return c;
  const regra = regraDoNcm(item.ncm, tabela);
  const s = await sugestor.sugerir(item, c.candidatos, regra?.criterio);
  if (!c.candidatos.some((t) => t.cClassTrib === s.cClassTrib)) {
    return { ...c, motivo: `${c.motivo} A sugestão da IA (${s.cClassTrib}) não está entre os candidatos e foi descartada.` };
  }
  return { ...c, sugestaoIA: s };
}
