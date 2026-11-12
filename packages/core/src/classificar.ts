// Classificação de itens em cClassTrib.
//
// Ordem de decisão (a primeira que resolve vence):
//   1. decisão do contador já registrada para esse produto (revisões)
//   2. cClassTrib que veio na própria nota, se a tabela conhece o código
//   3. tabela: NCM com um único tratamento possível
//   4. NCM com vários tratamentos → fila de revisão (sugestor.ts pode sugerir; nunca decide nem entra na conta)

import type { ItemNota } from './nfe.ts';
import { regraDoNcm, tratamentoConhecido, type TabelaClassificacao, type Tratamento } from './tabela.ts';

export type StatusClassificacao = 'revisado' | 'da_nota' | 'tabela' | 'padrao' | 'revisar';

export interface Classificacao {
  status: StatusClassificacao;
  tratamento: Tratamento; // o usado na conta (em 'revisar', o mais conservador: menor redução)
  candidatos: Tratamento[];
  precisaRevisao: boolean;
  motivo: string;
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
