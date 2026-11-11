// Classificação de itens em cClassTrib.
//
// Ordem de decisão (a primeira que resolve vence):
//   1. decisão do contador já registrada para esse produto (revisões)
//   2. cClassTrib que veio na própria nota, se a tabela conhece o código
//   3. tabela: NCM com um único tratamento possível
//   4. NCM com vários tratamentos → fila de revisão (a IA pode sugerir, nunca decide sozinha)
// A IA entra só no passo 4, por meio de `SugestorIA`, e sempre devolve a base legal.

import type { ItemNota } from './nfe.ts';
import { regraDoNcm, tratamentoConhecido, type TabelaClassificacao, type Tratamento } from './tabela.ts';

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

export function classificarItem(
  item: ItemNota,
  tabela: TabelaClassificacao,
  revisoes: Revisoes = new Map(),
): Classificacao {
  const regra = regraDoNcm(item.ncm, tabela);
  const candidatos = regra?.tratamentos ?? [tabela.padrao];

  const decidido = revisoes.get(chaveProduto(item));
  const escolhido = decidido ? tratamentoConhecido(tabela, decidido) : undefined;
  if (escolhido) {
    return { status: 'revisado', tratamento: escolhido, candidatos, precisaRevisao: false,
      motivo: comRessalva('Decisão registrada pelo contador.', escolhido) };
  }

  const daNota = item.cClassTrib ? tratamentoConhecido(tabela, item.cClassTrib) : undefined;
  if (daNota) {
    const coerente = candidatos.some((c) => c.cClassTrib === daNota.cClassTrib);
    return { status: 'da_nota', tratamento: daNota, candidatos, precisaRevisao: !coerente || !!daNota.ressalva,
      motivo: comRessalva(coerente ? 'Código informado na nota, coerente com o NCM.'
        : 'Código informado na nota não bate com os tratamentos esperados para o NCM.', daNota) };
  }

  if (!regra) {
    return { status: 'padrao', tratamento: tabela.padrao, candidatos, precisaRevisao: false,
      motivo: 'NCM sem tratamento diferenciado na tabela: tributação integral.' };
  }

  if (candidatos.length === 1) {
    const [unico] = candidatos;
    return { status: 'tabela', tratamento: unico, candidatos, precisaRevisao: !!unico.ressalva,
      motivo: comRessalva(`NCM ${regra.ncmPrefixo}* tem um único tratamento na tabela.`, unico) };
  }

  // Na dúvida, a conta usa o tratamento de menor redução (o primeiro, em caso de empate)
  // até o contador decidir.
  const conservador = [...candidatos].sort((a, b) => a.reducao - b.reducao)[0];
  return { status: 'revisar', tratamento: conservador, candidatos, precisaRevisao: true,
    // Só a 1ª linha do critério: o resto (itens do anexo) é consultado na tabela quando o contador abre.
    motivo: regra.criterio?.split('\n')[0] ??'O NCM admite mais de um tratamento.' };
}

function comRessalva(motivo: string, t: Tratamento): string {
  return t.ressalva ? `${motivo} Atenção: ${t.ressalva}` : motivo;
}

/** Pede sugestão à IA para itens em revisão. Não muda o tratamento usado na conta. */
export async function sugerirComIA(
  item: ItemNota,
  c: Classificacao,
  tabela: TabelaClassificacao,
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
