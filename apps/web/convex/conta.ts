// Conta: quem está logado e o 1º acesso.
//
// Decisão de produto (tarefa 3): o 1º login cria o escritório e o usuário vira o dono.
// Convites para outros membros ficam para depois (a tabela `membros` já comporta).

import { ConvexError, v } from 'convex/values';
import { DIAS_FLOAT_PADRAO, TABELA_EXEMPLO, TRANSICAO, VERSAO_PARAMETROS, VERSAO_TABELA } from '@farol/core';

import type { Id } from './_generated/dataModel';
import { mutation, query, type MutationCtx } from './_generated/server';
import { escritorioDoUsuario, SEM_LOGIN } from './escritorio';

/** Estado da sessão para a interface decidir entre login, criação do escritório e o app. Nunca lança. */
export const eu = query({
  args: {},
  handler: async (ctx) => {
    const identidade = await ctx.auth.getUserIdentity();
    if (!identidade) return { logado: false as const };
    const usuario = await ctx.db.query('usuarios').withIndex('by_workos', (q) => q.eq('workosId', identidade.subject)).unique();
    const escritorio = usuario ? await escritorioDoUsuario(ctx, usuario._id) : null;
    return {
      logado: true as const,
      email: usuario?.email ?? identidade.email ?? '',
      escritorio: escritorio ? { _id: escritorio._id, nome: escritorio.nome } : null,
    };
  },
});

/** Versões de partida de todo escritório: tabela de EXEMPLO e parâmetros ESTIMADOS (até haver os oficiais). */
export async function versoesBase(ctx: MutationCtx): Promise<{ tabelaId: Id<'versoesTabela'>; parametrosId: Id<'versoesParametros'> }> {
  const agora = Date.now();
  const tabela = await ctx.db.query('versoesTabela').withIndex('by_versao', (q) => q.eq('versao', VERSAO_TABELA)).first();
  const tabelaId = tabela?._id ?? await ctx.db.insert('versoesTabela', {
    versao: VERSAO_TABELA, fonte: 'Tabela de EXEMPLO do Farol (packages/core/src/tabela-exemplo.ts) — não é a oficial',
    exemplo: true, regras: TABELA_EXEMPLO, criadaEm: agora,
  });
  const parametros = await ctx.db.query('versoesParametros').withIndex('by_versao', (q) => q.eq('versao', VERSAO_PARAMETROS)).first();
  const parametrosId = parametros?._id ?? await ctx.db.insert('versoesParametros', {
    versao: VERSAO_PARAMETROS, fonte: 'Estimativas do Farol (packages/core/src/parametros.ts) — alíquotas de 2027 em diante não oficiais',
    estimativa: true, transicao: TRANSICAO, diasFloatPadrao: DIAS_FLOAT_PADRAO, criadaEm: agora,
  });
  return { tabelaId, parametrosId };
}

export const criarEscritorio = mutation({
  args: { nome: v.string() },
  handler: async (ctx, { nome }) => {
    const identidade = await ctx.auth.getUserIdentity();
    if (!identidade) throw new ConvexError(SEM_LOGIN);
    const limpo = nome.trim().replace(/\s+/g, ' ');
    if (limpo.length < 2 || limpo.length > 120) throw new ConvexError('Informe o nome do escritório (2 a 120 caracteres).');

    const existente = await ctx.db.query('usuarios').withIndex('by_workos', (q) => q.eq('workosId', identidade.subject)).unique();
    const usuarioId = existente?._id ?? await ctx.db.insert('usuarios', {
      workosId: identidade.subject, email: identidade.email ?? '', nome: identidade.name ?? undefined,
    });
    if (await escritorioDoUsuario(ctx, usuarioId)) throw new ConvexError('Você já tem um escritório.');

    const { tabelaId, parametrosId } = await versoesBase(ctx);
    const escritorioId = await ctx.db.insert('escritorios', {
      nome: limpo, tabelaVersaoId: tabelaId, parametrosVersaoId: parametrosId, criadoPor: usuarioId, criadoEm: Date.now(),
    });
    await ctx.db.insert('membros', { usuarioId, escritorioId, papel: 'dono' });
    return escritorioId;
  },
});
