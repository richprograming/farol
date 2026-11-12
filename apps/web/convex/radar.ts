// Radar: mudanças normativas, impacto na carteira e envio de avisos.
//
// Bloqueios (iguais aos do protótipo):
//   - impacto só é calculado para mudança confirmada pelo contador;
//   - aviso só sai depois do clique de aprovação, que fica gravado em `envios`.

import { ConvexError, v } from 'convex/values';
import { aplicarMudanca, compactarTabela, expandirTabela, type Aviso } from '@farol/core';
import { enviarAviso, remetenteDoEscritorio } from '@farol/core/integracoes/resend';

import { internal } from './_generated/api';
import { internalAction, internalMutation, internalQuery, mutation, query } from './_generated/server';
import { doEscritorio, escritorioAtual, usuarioAtual } from './escritorio';
import { agendarEscritorio, paraMudanca } from './motor';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const mudancas = query({
  args: {},
  handler: async (ctx) => {
    const escritorio = await escritorioAtual(ctx);
    const lista = (await ctx.db.query('mudancas').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect())
      .filter((m) => !m.aplicada)
      .sort((a, b) => b.publicadaEm.localeCompare(a.publicadaEm));
    const clientes = await ctx.db.query('clientes').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect();
    const analises = await ctx.db.query('analises').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect();
    // O efeito (que pode ser a diferença inteira entre duas tabelas) fica no servidor: a tela usa título e resumo.
    return Promise.all(lista.map(async ({ efeito: _e, ...m }) => {
      if (!m.confirmada) return { ...m, afetados: null, calculando: false };
      const impactos = await ctx.db.query('impactos').withIndex('by_mudanca', (q) => q.eq('mudancaId', m._id)).collect();
      // Ainda calculando enquanto algum cliente não foi recalculado depois da confirmação.
      const calculando = clientes.some((c) => {
        const a = analises.find((x) => x.clienteId === c._id);
        return !a || a.calculadaEm < (m.confirmadaEm ?? 0);
      });
      return { ...m, afetados: impactos.length, calculando };
    }));
  },
});

export const impactos = query({
  args: { mudancaId: v.id('mudancas') },
  handler: async (ctx, { mudancaId }) => {
    const escritorio = await escritorioAtual(ctx);
    const m = doEscritorio(await ctx.db.get(mudancaId), escritorio._id, 'Mudança');
    if (!m.confirmada) return [];
    const lista = await ctx.db.query('impactos').withIndex('by_mudanca', (q) => q.eq('mudancaId', mudancaId)).collect();
    const envios = await ctx.db.query('envios').withIndex('by_mudanca', (q) => q.eq('mudancaId', mudancaId)).collect();
    return lista
      .sort((a, b) => Math.abs(b.variacaoMensal) - Math.abs(a.variacaoMensal))
      .map((i) => ({ ...i, envio: envios.filter((e) => e.clienteId === i.clienteId).at(-1) ?? null }));
  },
});

export const confirmar = mutation({
  args: { mudancaId: v.id('mudancas') },
  handler: async (ctx, { mudancaId }) => {
    const escritorio = await escritorioAtual(ctx);
    const m = doEscritorio(await ctx.db.get(mudancaId), escritorio._id, 'Mudança');
    if (m.confirmada) return;
    await ctx.db.patch(m._id, { confirmada: true, confirmadaEm: Date.now() });
    await agendarEscritorio(ctx, escritorio._id);
  },
});

/** Incorpora a mudança a uma nova versão da tabela, só deste escritório. */
export const aplicar = mutation({
  args: { mudancaId: v.id('mudancas') },
  handler: async (ctx, { mudancaId }) => {
    const escritorio = await escritorioAtual(ctx);
    const m = doEscritorio(await ctx.db.get(mudancaId), escritorio._id, 'Mudança');
    if (!m.confirmada) throw new ConvexError('Confirme a mudança antes de incorporá-la à tabela.');
    if (m.aplicada) return;
    const base = await ctx.db.get(escritorio.tabelaVersaoId);
    if (!base) throw new ConvexError('Tabela vigente não encontrada.');
    const versaoId = await ctx.db.insert('versoesTabela', {
      versao: `${base.versao}+${m.ref}`,
      fonte: `${base.fonte} + mudança "${m.titulo}" (${m.fonte})`,
      exemplo: base.exemplo || m.origem === 'exemplo',
      tabela: compactarTabela(aplicarMudanca(expandirTabela(base.tabela), paraMudanca(m))),
      escritorioId: escritorio._id,
      baseId: base._id,
      mudancaId: m._id,
      criadaEm: Date.now(),
    });
    await ctx.db.patch(escritorio._id, { tabelaVersaoId: versaoId });
    await ctx.db.patch(m._id, { aplicada: true, aplicadaEm: Date.now() });
    for (const i of await ctx.db.query('impactos').withIndex('by_mudanca', (q) => q.eq('mudancaId', m._id)).collect()) {
      await ctx.db.delete(i._id);
    }
    await agendarEscritorio(ctx, escritorio._id);
  },
});

/** O clique do contador em "Aprovar e enviar". Grava a aprovação e agenda o envio. */
export const aprovarEnvio = mutation({
  args: { mudancaId: v.id('mudancas'), clienteId: v.id('clientes'), para: v.string(), assunto: v.string(), texto: v.string() },
  handler: async (ctx, a) => {
    const escritorio = await escritorioAtual(ctx);
    const m = doEscritorio(await ctx.db.get(a.mudancaId), escritorio._id, 'Mudança');
    if (!m.confirmada) throw new ConvexError('Confirme a mudança antes de enviar avisos.');
    doEscritorio(await ctx.db.get(a.clienteId), escritorio._id, 'Cliente');
    const impacto = (await ctx.db.query('impactos').withIndex('by_mudanca', (q) => q.eq('mudancaId', m._id)).collect())
      .find((i) => i.clienteId === a.clienteId);
    if (!impacto) throw new ConvexError('Cliente não afetado por esta mudança.');
    const para = a.para.trim();
    if (!EMAIL.test(para)) throw new ConvexError('E-mail do cliente inválido.');
    if (!a.assunto.trim() || !a.texto.trim()) throw new ConvexError('Assunto e texto não podem ficar vazios.');
    const anterior = (await ctx.db.query('envios')
      .withIndex('by_mudanca_cliente', (q) => q.eq('mudancaId', m._id).eq('clienteId', a.clienteId)).collect())
      .find((e) => e.status !== 'erro');
    if (anterior) throw new ConvexError('Este aviso já foi aprovado.');
    const envioId = await ctx.db.insert('envios', {
      escritorioId: escritorio._id, mudancaId: m._id, clienteId: a.clienteId,
      para, assunto: a.assunto.trim(), texto: a.texto, status: 'enviando', aprovadoEm: Date.now(),
      aprovadoPor: (await usuarioAtual(ctx))?._id,
    });
    await ctx.scheduler.runAfter(0, internal.radar.enviar, { envioId });
    return envioId;
  },
});

export const envioParaEnviar = internalQuery({
  args: { envioId: v.id('envios') },
  handler: async (ctx, { envioId }) => {
    const e = await ctx.db.get(envioId);
    if (!e || e.status !== 'enviando') return null;
    const cliente = await ctx.db.get(e.clienteId);
    const escritorio = await ctx.db.get(e.escritorioId);
    const aprovador = e.aprovadoPor ? await ctx.db.get(e.aprovadoPor) : null;
    return {
      ...e, cnpj: cliente?.cnpj ?? '', escritorio: escritorio?.nome ?? '',
      responderPara: aprovador && EMAIL.test(aprovador.email) ? aprovador.email : undefined,
    };
  },
});

const escapar = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export const enviar = internalAction({
  args: { envioId: v.id('envios') },
  handler: async (ctx, { envioId }) => {
    const e = await ctx.runQuery(internal.radar.envioParaEnviar, { envioId });
    if (!e) return;
    const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">${
      e.texto.split('\n').map(escapar).join('<br>')}</div>`;
    const aviso: Aviso = { clienteCnpj: e.cnpj, para: e.para, assunto: e.assunto, texto: e.texto, html, aprovado: true };
    try {
      // Sai com o nome do escritório; a resposta do cliente vai para quem aprovou; nova tentativa não duplica.
      const r = await enviarAviso(aviso, remetenteDoEscritorio(e.escritorio, process.env.FAROL_REMETENTE), process.env.RESEND_API_KEY ?? '', {
        responderPara: e.responderPara, idempotencia: `farol-envio-${envioId}`, tags: { tipo: 'aviso', envio: envioId },
      });
      await ctx.runMutation(internal.radar.registrarEnvio, { envioId, status: r.simulado ? 'simulado' : 'enviado', resendId: r.id });
    } catch (err) {
      await ctx.runMutation(internal.radar.registrarEnvio, { envioId, status: 'erro', erro: (err as Error).message.slice(0, 300) });
    }
  },
});

export const registrarEnvio = internalMutation({
  args: {
    envioId: v.id('envios'),
    status: v.union(v.literal('enviado'), v.literal('simulado'), v.literal('erro')),
    resendId: v.optional(v.string()),
    erro: v.optional(v.string()),
  },
  handler: async (ctx, { envioId, ...resto }) => {
    await ctx.db.patch(envioId, { ...resto, enviadoEm: Date.now() });
  },
});

/** Evento do webhook do Resend (entrega, abertura, devolução). Só marca envios que o Farol fez. */
export const registrarEvento = internalMutation({
  args: {
    resendId: v.string(),
    evento: v.union(v.literal('entregue'), v.literal('aberto'), v.literal('devolvido'), v.literal('spam'), v.literal('falhou')),
  },
  handler: async (ctx, { resendId, evento }) => {
    const e = await ctx.db.query('envios').withIndex('by_resend', (q) => q.eq('resendId', resendId)).first();
    if (!e || e.status !== 'enviado') return;
    if (evento === 'entregue') await ctx.db.patch(e._id, { entregueEm: e.entregueEm ?? Date.now() });
    else if (evento === 'aberto') await ctx.db.patch(e._id, { abertoEm: e.abertoEm ?? Date.now(), entregueEm: e.entregueEm ?? Date.now() });
    else await ctx.db.patch(e._id, { problemaEntrega: evento });
  },
});
