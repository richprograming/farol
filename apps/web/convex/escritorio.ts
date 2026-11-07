// Escritório da sessão e contexto de cálculo.
//
// ÚNICO ponto que decide "de qual escritório é este pedido". Até o login (WorkOS,
// tarefa 3), devolve o escritório de demonstração; depois, vai ler a identidade do
// usuário e o vínculo dele com um escritório. Toda função pública passa por aqui.

import { ConvexError, v } from 'convex/values';
import type { ContextoCalculo, RegraClassificacao } from '@farol/core';

import { internalQuery, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

export const SLUG_DEMO = 'demo';

export async function escritorioAtual(ctx: QueryCtx): Promise<Doc<'escritorios'>> {
  const e = await ctx.db.query('escritorios').withIndex('by_slug', (q) => q.eq('slug', SLUG_DEMO)).unique();
  if (!e) throw new ConvexError('Escritório não encontrado. Rode `npm run semear -w @farol/web` para criar a demonstração.');
  return e;
}

/** Para actions, que não leem o banco direto. */
export const atualId = internalQuery({
  args: {},
  handler: async (ctx): Promise<Id<'escritorios'>> => (await escritorioAtual(ctx))._id,
});

/** Garante que o documento pertence ao escritório da sessão. */
export function doEscritorio<T extends { escritorioId: Id<'escritorios'> }>(
  doc: T | null,
  escritorioId: Id<'escritorios'>,
  oQue: string,
): T {
  if (!doc || doc.escritorioId !== escritorioId) throw new ConvexError(`${oQue} não encontrado.`);
  return doc;
}

export interface BaseCalculo {
  tabela: RegraClassificacao[];
  contexto: ContextoCalculo;
  tabelaInfo: { versao: string; fonte: string; exemplo: boolean };
  parametrosInfo: { versao: string; fonte: string; estimativa: boolean };
}

export async function baseCalculo(ctx: QueryCtx, escritorio: Doc<'escritorios'>): Promise<BaseCalculo> {
  const tabela = await ctx.db.get(escritorio.tabelaVersaoId);
  const parametros = await ctx.db.get(escritorio.parametrosVersaoId);
  if (!tabela || !parametros) throw new ConvexError('Versão de tabela ou de parâmetros não encontrada.');
  return {
    tabela: tabela.regras,
    contexto: {
      transicao: parametros.transicao,
      versoes: { parametros: parametros.versao, tabela: tabela.versao },
      diasFloatPadrao: parametros.diasFloatPadrao,
    },
    tabelaInfo: { versao: tabela.versao, fonte: tabela.fonte, exemplo: tabela.exemplo },
    parametrosInfo: { versao: parametros.versao, fonte: parametros.fonte, estimativa: parametros.estimativa },
  };
}

