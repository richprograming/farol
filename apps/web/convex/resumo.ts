// Resumo diário para o dono do escritório: o que está esperando por ele no Farol.
//
// Só contagens lidas do banco (nenhum texto de IA, nenhum dado de consumidor). Só sai se houver
// pendência e se o Resend estiver configurado; sem RESEND_API_KEY não faz nada.

import { v } from 'convex/values';
import { resumoDiario, type PendenciasDoDia } from '@farol/core';
import { enviarEmail, remetenteDoEscritorio } from '@farol/core/integracoes/resend';

import { internal } from './_generated/api';
import { internalAction, internalQuery } from './_generated/server';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const pendencias = internalQuery({
  args: {},
  handler: async (ctx) => {
    const saida: { escritorio: string; para: string; pendencias: PendenciasDoDia }[] = [];
    for (const e of await ctx.db.query('escritorios').collect()) {
      const dono = await ctx.db.get(e.criadoPor);
      if (!dono || !EMAIL.test(dono.email)) continue;
      const mudancas = (await ctx.db.query('mudancas').withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect())
        .filter((m) => !m.confirmada && m.origem !== 'exemplo');
      const clientes = await ctx.db.query('clientes').withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect();
      const reais = new Set(clientes.filter((c) => !c.sintetico).map((c) => c._id));
      const analises = (await ctx.db.query('analises').withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect())
        .filter((a) => reais.has(a.clienteId) && a.itensParaRevisar > 0);
      const envios = (await ctx.db.query('envios').withIndex('by_escritorio', (q) => q.eq('escritorioId', e._id)).collect())
        .filter((x) => x.status === 'erro' || x.problemaEntrega !== undefined);
      saida.push({
        escritorio: e.nome, para: dono.email,
        pendencias: {
          mudancasParaConferir: mudancas.map((m) => m.titulo),
          produtosParaRevisar: analises.reduce((s, a) => s + a.itensParaRevisar, 0),
          clientesComRevisao: analises.length,
          avisosComProblema: envios.length,
        },
      });
    }
    return saida;
  },
});

export const enviarDiario = internalAction({
  args: { dia: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ enviados: number; semPendencia: number; falhas: number }> => {
    const chave = process.env.RESEND_API_KEY;
    const r = { enviados: 0, semPendencia: 0, falhas: 0 };
    if (!chave) return r;
    const dia = args.dia ?? new Date().toISOString().slice(0, 10);
    for (const e of await ctx.runQuery(internal.resumo.pendencias, {})) {
      const texto = resumoDiario(e.escritorio, e.pendencias, process.env.FAROL_URL);
      if (!texto) {
        r.semPendencia++;
        continue;
      }
      try {
        await enviarEmail({
          de: remetenteDoEscritorio('', process.env.FAROL_REMETENTE), para: e.para, ...texto,
          idempotencia: `farol-resumo-${dia}-${e.para}`, tags: { tipo: 'resumo-diario' },
        }, chave);
        r.enviados++;
      } catch {
        r.falhas++; // sem log do conteúdo; o próximo dia tenta de novo
      }
    }
    return r;
  },
});
