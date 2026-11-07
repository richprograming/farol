// Semente da demonstração: escritório, versões de EXEMPLO da tabela e dos parâmetros,
// e as mudanças FICTÍCIAS do Radar. Idempotente.
//
//   npx convex run seed:base          (o script `npm run semear` chama isto e sobe os XMLs sintéticos)

import { v } from 'convex/values';
import { TABELA_EXEMPLO, TRANSICAO, VERSAO_PARAMETROS, VERSAO_TABELA, DIAS_FLOAT_PADRAO } from '@farol/core';

import { internalMutation } from './_generated/server';
import { SLUG_DEMO } from './escritorio';
import { MUDANCAS_EXEMPLO } from './exemplos';

export const base = internalMutation({
  args: { nome: v.optional(v.string()) },
  handler: async (ctx, { nome }) => {
    const agora = Date.now();
    let tabela = await ctx.db.query('versoesTabela').withIndex('by_versao', (q) => q.eq('versao', VERSAO_TABELA)).first();
    if (!tabela) {
      const id = await ctx.db.insert('versoesTabela', {
        versao: VERSAO_TABELA, fonte: 'Tabela de EXEMPLO do Farol (packages/core/src/tabela-exemplo.ts) — não é a oficial',
        exemplo: true, regras: TABELA_EXEMPLO, criadaEm: agora,
      });
      tabela = (await ctx.db.get(id))!;
    }
    let parametros = await ctx.db.query('versoesParametros').withIndex('by_versao', (q) => q.eq('versao', VERSAO_PARAMETROS)).first();
    if (!parametros) {
      const id = await ctx.db.insert('versoesParametros', {
        versao: VERSAO_PARAMETROS, fonte: 'Estimativas do Farol (packages/core/src/parametros.ts) — alíquotas de 2027 em diante não oficiais',
        estimativa: true, transicao: TRANSICAO, diasFloatPadrao: DIAS_FLOAT_PADRAO, criadaEm: agora,
      });
      parametros = (await ctx.db.get(id))!;
    }
    let escritorio = await ctx.db.query('escritorios').withIndex('by_slug', (q) => q.eq('slug', SLUG_DEMO)).unique();
    if (!escritorio) {
      const id = await ctx.db.insert('escritorios', {
        nome: nome ?? 'Contabilidade Exemplo', slug: SLUG_DEMO, tabelaVersaoId: tabela._id, parametrosVersaoId: parametros._id,
      });
      escritorio = (await ctx.db.get(id))!;
    }
    for (const m of MUDANCAS_EXEMPLO) {
      const existe = await ctx.db.query('mudancas')
        .withIndex('by_escritorio_ref', (q) => q.eq('escritorioId', escritorio._id).eq('ref', m.id)).first();
      if (existe) continue;
      const { id, ...resto } = m;
      await ctx.db.insert('mudancas', {
        ...resto, ref: id, escritorioId: escritorio._id, origem: 'exemplo', confirmada: false, aplicada: false, criadaEm: agora,
      });
    }
    return { escritorioId: escritorio._id };
  },
});

/** Apaga TODOS os dados do escritório de demonstração (para recomeçar a demo do zero). */
export const limparDemo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const e = await ctx.db.query('escritorios').withIndex('by_slug', (q) => q.eq('slug', SLUG_DEMO)).unique();
    if (!e) return { apagados: 0 };
    let apagados = 0;
    const tabelas = ['clientes', 'notas', 'analises', 'impactos', 'mudancas', 'revisoes', 'envios'] as const;
    for (const t of tabelas) {
      for (const d of await ctx.db.query(t).withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect()) {
        await ctx.db.delete(d._id);
        apagados++;
      }
    }
    for (const d of (await ctx.db.query('versoesTabela').collect()).filter((x) => x.escritorioId === e._id)) await ctx.db.delete(d._id);
    await ctx.db.delete(e._id);
    return { apagados: apagados + 1 };
  },
});
