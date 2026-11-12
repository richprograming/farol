// Plano do escritório, cobrado pela AbacatePay.
//
// O plano é um produto criado no painel da AbacatePay (ABACATEPAY_PRODUTO_ID): o Farol não tem
// preço no código e mostra o valor que a AbacatePay devolve. O pagamento só vale depois de
// confirmado na API da AbacatePay. Hoje o plano NÃO libera nem bloqueia nenhuma função: fica
// registrado, e a decisão do que ele libera é do time.

import { ConvexError, v } from 'convex/values';
import { consultarCheckout, criarCheckout } from '@farol/core/integracoes/abacatepay';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalAction, internalMutation, internalQuery, query } from './_generated/server';
import { escritorioAtual, usuarioAtual } from './escritorio';

const configurado = () => !!process.env.ABACATEPAY_API_KEY && !!process.env.ABACATEPAY_PRODUTO_ID;

export const atual = query({
  args: {},
  handler: async (ctx) => {
    const escritorio = await escritorioAtual(ctx);
    const todas = await ctx.db.query('assinaturas').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect();
    const paga = todas.filter((a) => a.status === 'paga').sort((a, b) => (b.pagaEm ?? 0) - (a.pagaEm ?? 0))[0];
    const pendente = todas.filter((a) => a.status === 'pendente').sort((a, b) => b.criadaEm - a.criadaEm)[0];
    return {
      configurado: configurado(),
      paga: paga ? { pagaEm: paga.pagaEm!, valorCentavos: paga.valorCentavos, teste: paga.devMode } : null,
      pendente: !paga && pendente ? { url: pendente.url, valorCentavos: pendente.valorCentavos, criadaEm: pendente.criadaEm, teste: pendente.devMode } : null,
    };
  },
});

export const contexto = internalQuery({
  args: {},
  handler: async (ctx) => {
    const escritorio = await escritorioAtual(ctx);
    const usuario = await usuarioAtual(ctx);
    const paga = (await ctx.db.query('assinaturas').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect())
      .some((a) => a.status === 'paga');
    return { escritorioId: escritorio._id, usuarioId: usuario!._id, paga };
  },
});

/** Abre um checkout na AbacatePay e devolve o endereço da página de pagamento. */
export const assinar = action({
  args: { origem: v.string() }, // endereço do app, para a AbacatePay devolver o contador depois de pagar
  handler: async (ctx, { origem }): Promise<{ url: string }> => {
    const c: { escritorioId: Id<'escritorios'>; usuarioId: Id<'usuarios'>; paga: boolean } = await ctx.runQuery(internal.plano.contexto, {});
    const { ABACATEPAY_API_KEY: chave, ABACATEPAY_PRODUTO_ID: produtoId } = process.env;
    if (!chave || !produtoId) throw new ConvexError('A cobrança ainda não está configurada neste ambiente.');
    if (c.paga) throw new ConvexError('O plano deste escritório já está pago.');
    let base: URL;
    try {
      base = new URL(origem);
    } catch {
      throw new ConvexError('Endereço de retorno inválido.');
    }
    if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new ConvexError('Endereço de retorno inválido.');
    try {
      const k = await criarCheckout({
        chave, produtoId, externalId: `farol-${c.escritorioId}-${Date.now()}`,
        returnUrl: `${base.origin}/plano`, completionUrl: `${base.origin}/plano?pago=1`,
      });
      if (!k.url) throw new Error('AbacatePay: resposta sem o endereço de pagamento.');
      await ctx.runMutation(internal.plano.registrar, {
        escritorioId: c.escritorioId, criadaPor: c.usuarioId, checkoutId: k.id, url: k.url, valorCentavos: k.valorCentavos, devMode: k.devMode,
      });
      return { url: k.url };
    } catch (e) {
      throw new ConvexError(e instanceof Error ? e.message : 'Não foi possível abrir a cobrança.');
    }
  },
});

export const registrar = internalMutation({
  args: {
    escritorioId: v.id('escritorios'), criadaPor: v.id('usuarios'), checkoutId: v.string(), url: v.string(),
    valorCentavos: v.number(), devMode: v.boolean(),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert('assinaturas', { ...a, status: 'pendente', criadaEm: Date.now() });
  },
});

/** Chamado pelo webhook (e pelo botão "Já paguei"): pergunta à AbacatePay se o checkout foi pago. */
export const confirmar = internalAction({
  args: { checkoutId: v.string() },
  handler: async (ctx, { checkoutId }): Promise<boolean> => {
    const chave = process.env.ABACATEPAY_API_KEY;
    if (!chave) return false;
    const conhecida: boolean = await ctx.runQuery(internal.plano.existe, { checkoutId });
    if (!conhecida) return false; // checkout que o Farol não abriu
    const k = await consultarCheckout(chave, checkoutId);
    if (k.id !== checkoutId) return false;
    const status = k.status === 'PAID' ? 'paga' : k.status === 'PENDING' ? 'pendente' : 'encerrada';
    await ctx.runMutation(internal.plano.atualizar, { checkoutId, status, valorCentavos: k.valorCentavos });
    return status === 'paga';
  },
});

export const existe = internalQuery({
  args: { checkoutId: v.string() },
  handler: async (ctx, { checkoutId }) =>
    (await ctx.db.query('assinaturas').withIndex('by_checkout', (q) => q.eq('checkoutId', checkoutId)).first()) !== null,
});

export const atualizar = internalMutation({
  args: { checkoutId: v.string(), status: v.union(v.literal('pendente'), v.literal('paga'), v.literal('encerrada')), valorCentavos: v.number() },
  handler: async (ctx, { checkoutId, status, valorCentavos }) => {
    const a = await ctx.db.query('assinaturas').withIndex('by_checkout', (q) => q.eq('checkoutId', checkoutId)).first();
    if (!a || a.status === 'paga') return;
    await ctx.db.patch(a._id, { status, valorCentavos, ...(status === 'paga' ? { pagaEm: Date.now() } : {}) });
  },
});

export const pendenteDoEscritorio = internalQuery({
  args: {},
  handler: async (ctx) => {
    const escritorio = await escritorioAtual(ctx);
    const pendentes = (await ctx.db.query('assinaturas').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect())
      .filter((a) => a.status === 'pendente').sort((a, b) => b.criadaEm - a.criadaEm);
    return pendentes[0]?.checkoutId ?? null;
  },
});

/** Botão "Já paguei": confere na hora, sem esperar o webhook. */
export const conferir = action({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const checkoutId: string | null = await ctx.runQuery(internal.plano.pendenteDoEscritorio, {});
    if (!checkoutId) return false;
    try {
      return await ctx.runAction(internal.plano.confirmar, { checkoutId });
    } catch (e) {
      throw new ConvexError(e instanceof Error ? e.message : 'Não foi possível conferir o pagamento.');
    }
  },
});
