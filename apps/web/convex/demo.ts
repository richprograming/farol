// Carteira de DEMONSTRAÇÃO dentro do escritório do próprio usuário.
//
// Gera os XMLs SINTÉTICOS do core (mesmos das fixtures dos testes), importa pelo mesmo
// caminho do upload e cria as mudanças FICTÍCIAS do Radar. Tudo fica marcado como
// sintético/exemplo na interface. "Recomeçar" só apaga se a carteira for 100% sintética.

import { ConvexError, v } from 'convex/values';
import { gerarCarteiraSintetica } from '@farol/core';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, mutation } from './_generated/server';
import { escritorioAtual } from './escritorio';
import { MUDANCAS_EXEMPLO } from './exemplos';
import { importarLote } from './notas';

export const carregar = action({
  args: {},
  handler: async (ctx): Promise<{ clientes: number; notas: number }> => {
    const escritorioId: Id<'escritorios'> = await ctx.runQuery(internal.escritorio.atualId, {});
    let notas = 0;
    const carteira = gerarCarteiraSintetica();
    for (const c of carteira) {
      const r = await importarLote(ctx, escritorioId, { xmls: c.xmls, cnpj: c.cnpj, email: c.email });
      notas += r.novas;
    }
    await ctx.runMutation(internal.demo.criarMudancasExemplo, { escritorioId });
    return { clientes: carteira.length, notas };
  },
});

export const criarMudancasExemplo = internalMutation({
  args: { escritorioId: v.id('escritorios') },
  handler: async (ctx, { escritorioId }) => {
    for (const m of MUDANCAS_EXEMPLO) {
      const existe = await ctx.db.query('mudancas')
        .withIndex('by_escritorio_ref', (q) => q.eq('escritorioId', escritorioId).eq('ref', m.id)).first();
      if (existe) continue;
      const { id, ...resto } = m;
      await ctx.db.insert('mudancas', {
        ...resto, ref: id, escritorioId, origem: 'exemplo', confirmada: false, aplicada: false, criadaEm: Date.now(),
      });
    }
  },
});

/** Apaga a demonstração do escritório (clientes, notas, resultados, mudanças de exemplo, envios, revisões). */
export const recomecar = mutation({
  args: {},
  handler: async (ctx) => {
    const e = await escritorioAtual(ctx);
    const clientes = await ctx.db.query('clientes').withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect();
    if (clientes.some((c) => !c.sintetico)) {
      throw new ConvexError('A carteira tem clientes reais: "Recomeçar demonstração" só apaga carteiras 100% sintéticas.');
    }
    const mudancas = await ctx.db.query('mudancas').withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect();
    if (mudancas.some((m) => m.origem !== 'exemplo')) {
      throw new ConvexError('Há mudanças reais no Radar: "Recomeçar demonstração" só apaga dados de exemplo.');
    }
    for (const t of ['clientes', 'notas', 'analises', 'impactos', 'mudancas', 'revisoes', 'envios'] as const) {
      for (const d of await ctx.db.query(t).withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect()) {
        await ctx.db.delete(d._id);
      }
    }
    // Volta para a tabela base se alguma mudança de exemplo tinha sido incorporada.
    const atual = await ctx.db.get(e.tabelaVersaoId);
    let base = atual;
    while (base?.baseId) base = await ctx.db.get(base.baseId);
    if (base && atual && base._id !== atual._id) await ctx.db.patch(e._id, { tabelaVersaoId: base._id });
    for (const d of await ctx.db.query('versoesTabela').withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect()) {
      await ctx.db.delete(d._id);
    }
  },
});
