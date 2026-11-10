// Escritório da sessão e contexto de cálculo.
//
// ÚNICO ponto que decide "de qual escritório é este pedido": lê a identidade do
// usuário (token do WorkOS, validado pelo Convex), acha o usuário e o vínculo dele
// com um escritório. Toda função pública passa por aqui; sem login, nada é lido.

import { ConvexError, v } from 'convex/values';
import type { ContextoCalculo, RegraClassificacao } from '@farol/core';

import { internalQuery, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';

export const SEM_LOGIN = 'Faça login para continuar.';
export const SEM_ESCRITORIO = 'Crie o seu escritório para continuar.';

/** Usuário da sessão, ou null se ainda não fez o 1º acesso. Lança se não houver login. */
export async function usuarioAtual(ctx: QueryCtx): Promise<Doc<'usuarios'> | null> {
  const identidade = await ctx.auth.getUserIdentity();
  if (!identidade) throw new ConvexError(SEM_LOGIN);
  return ctx.db.query('usuarios').withIndex('by_workos', (q) => q.eq('workosId', identidade.subject)).unique();
}

export async function escritorioDoUsuario(ctx: QueryCtx, usuarioId: Id<'usuarios'>): Promise<Doc<'escritorios'> | null> {
  const vinculo = await ctx.db.query('membros').withIndex('by_usuario', (q) => q.eq('usuarioId', usuarioId)).first();
  return vinculo ? ctx.db.get(vinculo.escritorioId) : null;
}

export async function escritorioAtual(ctx: QueryCtx): Promise<Doc<'escritorios'>> {
  const usuario = await usuarioAtual(ctx);
  const escritorio = usuario ? await escritorioDoUsuario(ctx, usuario._id) : null;
  if (!escritorio) throw new ConvexError(SEM_ESCRITORIO);
  return escritorio;
}

/** Para actions, que não leem o banco direto. A identidade do chamador é repassada pelo runQuery. */
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

