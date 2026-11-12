// Sugestões de cClassTrib para os produtos na fila de revisão.
//
// Bloqueios:
//   - a sugestão fica nesta tabela, separada: o motor (motor.ts) nunca a lê, então ela não entra
//     em conta nenhuma. Só a decisão do contador (carteira.revisar) muda o cálculo;
//   - só roda quando o contador pede; o mesmo produto, na mesma versão da tabela, não é
//     processado duas vezes (cache por chave do produto = NCM + descrição normalizada);
//   - para o serviço de IA (se configurado) vão só NCM, descrição do produto e textos oficiais.
//
// Sem FAROL_IA_URL/FAROL_IA_MODELO, usa o sugestor lexical do core: sem custo e sem rede.

import { ConvexError, v } from 'convex/values';
import {
  criarSugestorLLM, expandirTabela, pedidoDeSugestao, sugestorLexical,
  type ResultadoSugestao, type SugestorIA, type TabelaCompacta,
} from '@farol/core';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation, internalQuery, query } from './_generated/server';
import { baseCalculo, doEscritorio, escritorioAtual } from './escritorio';
import { vSugestao } from './schema';

/** Chamadas ao serviço de IA por clique (o lexical não tem limite: não custa nada). */
const LIMITE_LLM_POR_PEDIDO = 40;

function sugestorConfigurado(): SugestorIA {
  const { FAROL_IA_URL: url, FAROL_IA_MODELO: modelo, FAROL_IA_CHAVE: chave } = process.env;
  return url && modelo ? criarSugestorLLM({ url, modelo, chave }) : sugestorLexical;
}

/** Sugestões já calculadas para os produtos em revisão do cliente, na versão vigente da tabela. */
export const doCliente = query({
  args: { clienteId: v.id('clientes') },
  handler: async (ctx, { clienteId }) => {
    const escritorio = await escritorioAtual(ctx);
    doEscritorio(await ctx.db.get(clienteId), escritorio._id, 'Cliente');
    const { tabelaInfo } = await baseCalculo(ctx, escritorio);
    const analise = await ctx.db.query('analises').withIndex('by_cliente', (q) => q.eq('clienteId', clienteId)).unique();
    const chaves = new Set((analise?.produtos ?? []).filter((p) => p.classificacao.status === 'revisar').map((p) => p.chave));
    const todas = await ctx.db.query('sugestoes').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect();
    return {
      origem: sugestorConfigurado().origem,
      pendentes: chaves.size,
      itens: todas.filter((s) => chaves.has(s.chave) && s.tabelaVersao === tabelaInfo.versao)
        .map((s) => ({ chave: s.chave, origem: s.origem, sugestao: s.sugestao, motivo: s.motivo })),
    };
  },
});

interface Contexto {
  escritorioId: Id<'escritorios'>;
  tabelaVersao: string;
  tabela: TabelaCompacta;
  produtos: { chave: string; ncm: string; descricao: string }[];
  prontas: { chave: string; origem: string }[];
}

export const contexto = internalQuery({
  args: { clienteId: v.id('clientes'), chave: v.optional(v.string()) },
  handler: async (ctx, { clienteId, chave }): Promise<Contexto> => {
    const escritorio = await escritorioAtual(ctx);
    doEscritorio(await ctx.db.get(clienteId), escritorio._id, 'Cliente');
    const base = await baseCalculo(ctx, escritorio);
    const analise = await ctx.db.query('analises').withIndex('by_cliente', (q) => q.eq('clienteId', clienteId)).unique();
    const produtos = (analise?.produtos ?? [])
      .filter((p) => p.classificacao.status === 'revisar' && (chave === undefined || p.chave === chave))
      .map((p) => ({ chave: p.chave, ncm: p.ncm, descricao: p.descricao }));
    if (chave !== undefined && produtos.length === 0) throw new ConvexError('Este produto não está na fila de revisão.');
    const prontas = (await ctx.db.query('sugestoes').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorio._id)).collect())
      .filter((s) => s.tabelaVersao === base.tabelaInfo.versao)
      .map((s) => ({ chave: s.chave, origem: s.origem }));
    return { escritorioId: escritorio._id, tabelaVersao: base.tabelaInfo.versao, tabela: base.tabela, produtos, prontas };
  },
});

/** O clique do contador em "Sugerir". Sem `chave`, sugere para todos os produtos em revisão do cliente. */
export const sugerir = action({
  args: { clienteId: v.id('clientes'), chave: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ novas: number; doCache: number; semSugestao: number; adiadas: number }> => {
    const c: Contexto = await ctx.runQuery(internal.sugestoes.contexto, args);
    const tabela = expandirTabela(c.tabela);
    const principal = sugestorConfigurado();
    const usaLLM = principal !== sugestorLexical;
    const jaTem = new Set(c.prontas.filter((s) => s.origem === principal.origem || (usaLLM && s.origem === 'lexical+falha-ia')).map((s) => s.chave));

    const itens: { chave: string; origem: string; resultado: ResultadoSugestao }[] = [];
    let doCache = 0;
    let adiadas = 0;
    let chamadasLLM = 0;
    for (const p of c.produtos) {
      if (jaTem.has(p.chave)) {
        doCache++;
        continue;
      }
      const pedido = pedidoDeSugestao(p, tabela);
      if (!pedido) continue;
      if (!usaLLM) {
        itens.push({ chave: p.chave, origem: principal.origem, resultado: await sugestorLexical.sugerir(pedido) });
        continue;
      }
      if (chamadasLLM >= LIMITE_LLM_POR_PEDIDO) {
        adiadas++;
        continue;
      }
      chamadasLLM++;
      const r = await principal.sugerir(pedido);
      // Resposta inválida ou serviço fora: cai para o lexical e registra que foi assim.
      if (r.ok) itens.push({ chave: p.chave, origem: principal.origem, resultado: r });
      else itens.push({ chave: p.chave, origem: 'lexical+falha-ia', resultado: await sugestorLexical.sugerir(pedido) });
    }
    if (itens.length > 0) {
      await ctx.runMutation(internal.sugestoes.gravar, {
        escritorioId: c.escritorioId, tabelaVersao: c.tabelaVersao,
        itens: itens.map((i) => (i.resultado.ok
          ? { chave: i.chave, origem: i.origem, sugestao: i.resultado.sugestao }
          : { chave: i.chave, origem: i.origem, sugestao: null, motivo: i.resultado.motivo })),
      });
    }
    return { novas: itens.length, doCache, semSugestao: itens.filter((i) => !i.resultado.ok).length, adiadas };
  },
});

export const gravar = internalMutation({
  args: {
    escritorioId: v.id('escritorios'),
    tabelaVersao: v.string(),
    itens: v.array(v.object({ chave: v.string(), origem: v.string(), sugestao: v.union(vSugestao, v.null()), motivo: v.optional(v.string()) })),
  },
  handler: async (ctx, { escritorioId, tabelaVersao, itens }) => {
    for (const i of itens) {
      const anteriores = await ctx.db.query('sugestoes')
        .withIndex('by_escritorio_chave', (q) => q.eq('escritorioId', escritorioId).eq('chave', i.chave)).collect();
      for (const a of anteriores) await ctx.db.delete(a._id);
      await ctx.db.insert('sugestoes', { ...i, escritorioId, tabelaVersao, criadaEm: Date.now() });
    }
  },
});
