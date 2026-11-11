// Conversão da tabela OFICIAL de cClassTrib para o formato do Farol.
//
// Fonte: Portal da Conformidade Fácil (SVRS), página "Classificação Tributária"
// (https://dfe-portal.svrs.rs.gov.br/DFE/ClassificacaoTributaria). A página traz embutida a
// lista de CSTs, cada um com seus cClassTrib e, por código, os NCMs dos anexos da LC 214/2025
// com condição, exceções e vigência. O botão "Exportar para JSON" da página perde os anexos;
// por isso o importador lê a própria página.
//
// Nada aqui é inventado: descrição, percentual de redução, link da lei, NCMs e textos de
// condição vêm dos campos oficiais. As decisões do Farol sobre como USAR os dados são:
//   1. NCM listado em anexo → sempre vai para revisão. Opções: tributação integral + os
//      códigos do anexo. Até o contador decidir, a conta usa a integral (nenhuma redução presumida).
//   2. Códigos cuja mecânica não é redução de alíquota (diferimento, suspensão, monofásica,
//      imunidade…) recebem uma ressalva e também vão para revisão: a conta só modela redução.
//   3. Só entram códigos válidos para NF-e ou NFC-e e ainda vigentes na data de referência.

import type { TabelaCompacta, Tratamento } from './tabela.ts';

export const URL_TABELA_OFICIAL = 'https://dfe-portal.svrs.rs.gov.br/DFE/ClassificacaoTributaria';
export const CODIGO_INTEGRAL_OFICIAL = '000001';

/** Campos usados de cada CST da página oficial (nomes como vêm da fonte). */
export interface CstOficial {
  Cst: string;
  NomeCst: string;
  ClassificacoesTributarias?: ClassTribOficial[] | null;
}

export interface ClassTribOficial {
  CodClassTrib: string;
  NomeClassTrib: string;
  NomeReduzido?: string | null;
  Cst: string;
  PercRedIbs: number;
  PercRedCbs: number;
  IndNfe: boolean;
  IndNfce: boolean;
  DthPublicacao?: string | null;
  DthFimVig?: string | null;
  TexUrlLegislacao?: string | null;
  Anexos?: AnexoOficial[] | null;
}

export interface AnexoOficial {
  CodNcmNbs: string;
  TipoCodigo: string; // 'NCM' | 'NBS'
  TipoPermissao: string; // 'PERMITIDO' | 'VEDADO'
  DescCondicao?: string | null;
  DescExcecao?: string | null;
  DescItemAnexo?: string | null;
  DthFimVig?: string | null;
}

export interface ResumoImportacao {
  publicacaoMaisRecente: string; // AAAA-MM-DD
  codigos: number;
  ncms: number;
  ncmsComVariasOpcoes: number;
  comRessalva: string[];
}

/** CSTs em que o código é só tributação normal ou redução de alíquota: a conta do Farol cobre. */
const CST_MODELADOS = new Set(['000', '200']);

export const CRITERIO_ANEXO =
  'Produto listado em anexo da LC 214/2025: a redução só vale se o produto se enquadrar no item do anexo e na condição. ' +
  `Se não se enquadrar, é tributação integral (${CODIGO_INTEGRAL_OFICIAL}). Até a sua decisão, a conta usa a tributação integral.`;

/** Extrai da página oficial o JSON dos CSTs (variável `dadosOriginais`). Não executa nada da página. */
export function extrairDadosDaPagina(html: string): string {
  const marca = 'var dadosOriginais = ';
  const linha = html.split('\n').find((l) => l.trimStart().startsWith(marca));
  if (!linha) throw new Error('A página não tem a lista de CSTs (dadosOriginais). O formato do portal mudou?');
  return linha.trim().slice(marca.length).replace(/;\s*$/, '');
}

const pct = (r: number) => `${Math.round(r * 100)}%`;
const vigente = (fim: string | null | undefined, ref: string) => !fim || fim.slice(0, 10) > ref;
const limpar = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

function baseLegal(c: ClassTribOficial): string {
  const url = limpar(c.TexUrlLegislacao);
  const art = /lcp214\.htm#art(\d+)/i.exec(url)?.[1];
  if (art) return `LC 214/2025, art. ${art} — ${url}`;
  return url || `Tabela oficial de cClassTrib (CST ${c.Cst})`;
}

export function converterTabelaOficial(
  csts: CstOficial[],
  dataReferencia: string, // AAAA-MM-DD: códigos e itens de anexo encerrados até aqui ficam de fora
): { tabela: TabelaCompacta; resumo: ResumoImportacao } {
  const nomeCst = new Map(csts.map((c) => [c.Cst, limpar(c.NomeCst)]));
  const codigos = csts
    .flatMap((c) => c.ClassificacoesTributarias ?? [])
    .filter((c) => (c.IndNfe || c.IndNfce) && vigente(c.DthFimVig, dataReferencia));
  if (codigos.length === 0) throw new Error('Nenhum cClassTrib válido para NF-e/NFC-e na fonte.');

  const tratamentos = new Map<string, Tratamento>();
  for (const c of codigos) {
    if (c.PercRedIbs !== c.PercRedCbs) {
      throw new Error(`cClassTrib ${c.CodClassTrib} tem reduções diferentes para IBS (${c.PercRedIbs}%) e CBS (${c.PercRedCbs}%); o Farol ainda não modela isso.`);
    }
    if (tratamentos.has(c.CodClassTrib)) throw new Error(`cClassTrib ${c.CodClassTrib} repetido na fonte.`);
    const t: Tratamento = {
      cClassTrib: c.CodClassTrib,
      descricao: limpar(c.NomeReduzido) || limpar(c.NomeClassTrib),
      reducao: c.PercRedCbs / 100,
      baseLegal: baseLegal(c),
    };
    if (!CST_MODELADOS.has(c.Cst)) {
      t.ressalva = `CST ${c.Cst} (${nomeCst.get(c.Cst) ?? 'sem nome'}): a conta do Farol só modela redução de alíquota e aqui usa ` +
        `${pct(t.reducao)} de redução. Confira o efeito real antes de usar o número.`;
    }
    tratamentos.set(c.CodClassTrib, t);
  }
  if (!tratamentos.has(CODIGO_INTEGRAL_OFICIAL)) throw new Error(`A fonte não tem o código de tributação integral ${CODIGO_INTEGRAL_OFICIAL}.`);

  // NCM → código → linhas de texto (item do anexo, condição, exceção).
  const vedados = new Set<string>();
  const porNcm = new Map<string, Map<string, Set<string>>>();
  for (const c of codigos) {
    for (const a of c.Anexos ?? []) {
      if (a.TipoCodigo !== 'NCM' || !vigente(a.DthFimVig, dataReferencia)) continue;
      const ncm = a.CodNcmNbs.replace(/\D/g, '');
      if (!ncm) continue;
      if (a.TipoPermissao === 'VEDADO') {
        vedados.add(`${ncm}|${c.CodClassTrib}`);
        continue;
      }
      if (a.TipoPermissao !== 'PERMITIDO') throw new Error(`Tipo de permissão desconhecido na fonte: ${a.TipoPermissao}.`);
      const t = tratamentos.get(c.CodClassTrib)!;
      let linha = `${c.CodClassTrib} (redução de ${pct(t.reducao)}): ${limpar(a.DescItemAnexo) || limpar(c.NomeClassTrib)}`;
      if (limpar(a.DescCondicao)) linha += ` Condição: ${limpar(a.DescCondicao)}.`;
      if (limpar(a.DescExcecao)) linha += ` Exceto: ${limpar(a.DescExcecao)}.`;
      const codigosDoNcm = porNcm.get(ncm) ?? new Map<string, Set<string>>();
      porNcm.set(ncm, codigosDoNcm);
      const linhas = codigosDoNcm.get(c.CodClassTrib) ?? new Set<string>();
      codigosDoNcm.set(c.CodClassTrib, linhas);
      linhas.add(linha);
    }
  }

  const textos: string[] = [CRITERIO_ANEXO];
  const indiceTexto = new Map<string, number>([[CRITERIO_ANEXO, 0]]);
  const texto = (s: string) => {
    let i = indiceTexto.get(s);
    if (i === undefined) {
      i = textos.push(s) - 1;
      indiceTexto.set(s, i);
    }
    return i;
  };
  const regras: TabelaCompacta['regras'] = [];
  let ncmsComVariasOpcoes = 0;
  for (const ncm of [...porNcm.keys()].sort()) {
    const opcoes = [...porNcm.get(ncm)!.entries()]
      .filter(([codigo]) => !vedados.has(`${ncm}|${codigo}`))
      .sort(([a], [b]) => a.localeCompare(b));
    if (opcoes.length === 0) continue;
    if (opcoes.length > 1) ncmsComVariasOpcoes++;
    regras.push({
      ncm,
      codigos: [CODIGO_INTEGRAL_OFICIAL, ...opcoes.map(([codigo]) => codigo)],
      textos: [0, ...opcoes.flatMap(([, linhas]) => [...linhas].map(texto))],
    });
  }

  const publicacoes = codigos.map((c) => c.DthPublicacao ?? '').filter(Boolean).sort();
  return {
    tabela: {
      padrao: CODIGO_INTEGRAL_OFICIAL,
      tratamentos: [...tratamentos.values()].sort((a, b) => a.cClassTrib.localeCompare(b.cClassTrib)),
      textos,
      regras,
    },
    resumo: {
      publicacaoMaisRecente: (publicacoes.at(-1) ?? '').slice(0, 10),
      codigos: tratamentos.size,
      ncms: regras.length,
      ncmsComVariasOpcoes,
      comRessalva: [...tratamentos.values()].filter((t) => t.ressalva).map((t) => t.cClassTrib),
    },
  };
}
