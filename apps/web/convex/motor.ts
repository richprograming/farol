// Motor no Convex: roda as contas do @farol/core e grava os resultados.
//
// Fluxo: qualquer mudança em notas, revisões, tabela ou mudanças confirmadas agenda
// `recalcularCliente` (ou `recalcularEscritorio`). A action lê as notas em páginas
// (uma query não comporta a carteira inteira), calcula com o core e grava em
// `analises` e `impactos`. As telas leem essas tabelas por useQuery e se atualizam sozinhas.
// Nenhum número aqui sai de IA.

import { v } from 'convex/values';
import {
  analisarCliente, expandirTabela, impactoDaMudanca, rascunharAviso,
  type Cliente, type Mudanca, type NotaFiscal,
} from '@farol/core';

import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { internalAction, internalMutation, internalQuery, type MutationCtx } from './_generated/server';
import { baseCalculo } from './escritorio';
import { vAnalise, vImpacto } from './schema';

const PAGINA_NOTAS = 250;

export async function agendarCliente(ctx: MutationCtx, clienteId: Id<'clientes'>) {
  await ctx.scheduler.runAfter(0, internal.motor.recalcularCliente, { clienteId, pedidoEm: Date.now() });
}

export async function agendarEscritorio(ctx: MutationCtx, escritorioId: Id<'escritorios'>) {
  await ctx.scheduler.runAfter(0, internal.motor.recalcularEscritorio, { escritorioId, pedidoEm: Date.now() });
}

export const contextoCliente = internalQuery({
  args: { clienteId: v.id('clientes') },
  handler: async (ctx, { clienteId }) => {
    const cliente = await ctx.db.get(clienteId);
    if (!cliente) return null;
    const escritorio = (await ctx.db.get(cliente.escritorioId))!;
    const base = await baseCalculo(ctx, escritorio);
    const revisoes = await ctx.db.query('revisoes')
      .withIndex('by_escritorio_chave', (q) => q.eq('escritorioId', cliente.escritorioId)).collect();
    const mudancas = (await ctx.db.query('mudancas')
      .withIndex('by_escritorio', (q) => q.eq('escritorioId', cliente.escritorioId)).collect())
      .filter((m) => m.confirmada && !m.aplicada);
    return { cliente, escritorio, base, revisoes: revisoes.map((r) => [r.chave, r.cClassTrib] as [string, string]), mudancas };
  },
});

export const paginaNotas = internalQuery({
  args: { clienteId: v.id('clientes'), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { clienteId, cursor }) =>
    ctx.db.query('notas').withIndex('by_cliente', (q) => q.eq('clienteId', clienteId))
      .paginate({ cursor, numItems: PAGINA_NOTAS }),
});

function paraNota(n: Doc<'notas'>): NotaFiscal {
  const { _id: _i, _creationTime: _c, escritorioId: _e, clienteId: _cl, ...nota } = n;
  return nota;
}

export function paraMudanca(m: Doc<'mudancas'>): Mudanca {
  return {
    id: m.ref, titulo: m.titulo, resumo: m.resumo, fonte: m.fonte, publicadaEm: m.publicadaEm,
    vigenciaDesde: m.vigenciaDesde, efeito: m.efeito, confirmada: m.confirmada,
  };
}

export const recalcularCliente = internalAction({
  args: { clienteId: v.id('clientes'), pedidoEm: v.number() },
  handler: async (ctx, { clienteId, pedidoEm }) => {
    const dados = await ctx.runQuery(internal.motor.contextoCliente, { clienteId });
    if (!dados) return;
    const notas: NotaFiscal[] = [];
    let cursor: string | null = null;
    for (;;) {
      const p: { page: Doc<'notas'>[]; isDone: boolean; continueCursor: string } =
        await ctx.runQuery(internal.motor.paginaNotas, { clienteId, cursor });
      notas.push(...p.page.map(paraNota));
      if (p.isDone) break;
      cursor = p.continueCursor;
    }
    const { cliente: c, escritorio, base, mudancas } = dados;
    const cliente: Cliente = { cnpj: c.cnpj, nome: c.nome, regime: c.regime, diasFloat: c.diasFloat, notas };
    const revisoes = new Map(dados.revisoes);
    const tabela = expandirTabela(base.tabela);

    const a = analisarCliente(cliente, tabela, revisoes, base.contexto);
    const impactos = mudancas.map((m) => {
      const [afetado] = impactoDaMudanca([cliente], tabela, paraMudanca(m), revisoes, base.contexto);
      if (!afetado) return { mudancaId: m._id, afetado: null };
      const aviso = rascunharAviso(escritorio.nome, afetado, paraMudanca(m), c.email);
      return {
        mudancaId: m._id,
        afetado: {
          cnpj: afetado.cnpj, nome: afetado.nome, antes: afetado.antes, depois: afetado.depois,
          variacaoMensal: afetado.variacaoMensal, produtosAfetados: afetado.produtosAfetados,
          aviso: { para: aviso.para, assunto: aviso.assunto, texto: aviso.texto },
          versoes: afetado.analiseDepois.versoes,
        },
      };
    });

    await ctx.runMutation(internal.motor.salvar, {
      clienteId, pedidoEm,
      analise: {
        cnpj: a.cnpj, nome: a.nome, regime: a.regime, meses: a.meses, vendasMensais: a.vendasMensais,
        cargaAtualMensal: a.cargaAtualMensal, projecao: a.projecao, exposicao2027: a.exposicao2027,
        comparavel: a.comparavel, efeitoCaixaSplit: a.efeitoCaixaSplit, produtos: a.produtos,
        itensParaRevisar: a.itensParaRevisar, avisos: a.avisos, versoes: a.versoes,
      },
      impactos,
    });
  },
});

export const salvar = internalMutation({
  args: {
    clienteId: v.id('clientes'),
    pedidoEm: v.number(),
    analise: vAnalise,
    impactos: v.array(v.object({ mudancaId: v.id('mudancas'), afetado: v.union(vImpacto, v.null()) })),
  },
  handler: async (ctx, { clienteId, pedidoEm, analise, impactos }) => {
    const cliente = await ctx.db.get(clienteId);
    if (!cliente) return;
    const existente = await ctx.db.query('analises').withIndex('by_cliente', (q) => q.eq('clienteId', clienteId)).unique();
    // Um recálculo pedido antes do que já está gravado chegou atrasado: descarta.
    if (existente && existente.calculadaEm > pedidoEm) return;
    const doc = { ...analise, escritorioId: cliente.escritorioId, clienteId, calculadaEm: pedidoEm };
    if (existente) await ctx.db.replace(existente._id, doc);
    else await ctx.db.insert('analises', doc);

    for (const { mudancaId, afetado } of impactos) {
      const anteriores = (await ctx.db.query('impactos').withIndex('by_mudanca', (q) => q.eq('mudancaId', mudancaId)).collect())
        .filter((i) => i.clienteId === clienteId);
      for (const i of anteriores) await ctx.db.delete(i._id);
      const mudanca = await ctx.db.get(mudancaId);
      if (!afetado || !mudanca || !mudanca.confirmada || mudanca.aplicada) continue;
      await ctx.db.insert('impactos', {
        ...afetado,
        escritorioId: cliente.escritorioId, mudancaId, clienteId, calculadoEm: pedidoEm,
      });
    }
  },
});

export const clientesDoEscritorio = internalQuery({
  args: { escritorioId: v.id('escritorios') },
  handler: async (ctx, { escritorioId }) =>
    (await ctx.db.query('clientes').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorioId)).collect()).map((c) => c._id),
});

export const recalcularEscritorio = internalAction({
  args: { escritorioId: v.id('escritorios'), pedidoEm: v.number() },
  handler: async (ctx, { escritorioId, pedidoEm }) => {
    const ids = await ctx.runQuery(internal.motor.clientesDoEscritorio, { escritorioId });
    for (const clienteId of ids) await ctx.scheduler.runAfter(0, internal.motor.recalcularCliente, { clienteId, pedidoEm });
  },
});
