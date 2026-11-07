// Carteira, detalhe do cliente e revisão de classificação.

import { ConvexError, v } from 'convex/values';
import { INTEGRAL, rankingCarteira, type AnaliseCliente } from '@farol/core';

import { mutation, query } from './_generated/server';
import { baseCalculo, doEscritorio, escritorioAtual } from './escritorio';
import { agendarEscritorio } from './motor';

export const resumo = query({
  args: {},
  handler: async (ctx) => {
    const escritorio = await escritorioAtual(ctx);
    const base = await baseCalculo(ctx, escritorio);
    const clientes = await ctx.db.query('clientes').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect();
    const analises = await ctx.db.query('analises').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect();
    const porCliente = new Map(analises.map((a) => [a.clienteId, a]));
    // rankingCarteira só usa campos que estão em `analises`.
    const ordenadas = rankingCarteira(analises as unknown as AnaliseCliente[]) as unknown as typeof analises;
    const calculados = ordenadas.map(({ produtos: _p, projecao: _pr, ...resto }) => {
      const c = clientes.find((x) => x._id === resto.clienteId)!;
      return { ...resto, email: c.email, sintetico: c.sintetico, calculando: false };
    });
    const pendentes = clientes.filter((c) => !porCliente.has(c._id))
      .map((c) => ({ clienteId: c._id, cnpj: c.cnpj, nome: c.nome, regime: c.regime, email: c.email, sintetico: c.sintetico, calculando: true as const }));
    return {
      escritorio: escritorio.nome,
      tabela: base.tabelaInfo,
      parametros: base.parametrosInfo,
      clientes: calculados,
      pendentes,
      algumSintetico: clientes.some((c) => c.sintetico),
    };
  },
});

export const cliente = query({
  args: { clienteId: v.id('clientes') },
  handler: async (ctx, { clienteId }) => {
    const escritorio = await escritorioAtual(ctx);
    const c = doEscritorio(await ctx.db.get(clienteId), escritorio._id, 'Cliente');
    const analise = await ctx.db.query('analises').withIndex('by_cliente', (q) => q.eq('clienteId', clienteId)).unique();
    return { cliente: { _id: c._id, cnpj: c.cnpj, nome: c.nome, email: c.email, regime: c.regime, sintetico: c.sintetico }, analise };
  },
});

export const revisar = mutation({
  args: { chave: v.string(), cClassTrib: v.string() },
  handler: async (ctx, { chave, cClassTrib }) => {
    const escritorio = await escritorioAtual(ctx);
    const { tabela } = await baseCalculo(ctx, escritorio);
    const conhecidos = new Set([INTEGRAL.cClassTrib, ...tabela.flatMap((r) => r.tratamentos.map((t) => t.cClassTrib))]);
    if (!conhecidos.has(cClassTrib)) throw new ConvexError(`cClassTrib ${cClassTrib} não está na tabela vigente.`);
    const existente = await ctx.db.query('revisoes')
      .withIndex('by_escritorio_chave', (q) => q.eq('escritorioId', escritorio._id).eq('chave', chave)).unique();
    if (existente) await ctx.db.patch(existente._id, { cClassTrib, revisadaEm: Date.now() });
    else await ctx.db.insert('revisoes', { escritorioId: escritorio._id, chave, cClassTrib, revisadaEm: Date.now() });
    await agendarEscritorio(ctx, escritorio._id);
  },
});
