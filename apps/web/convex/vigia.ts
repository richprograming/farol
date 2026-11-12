// Agente Vigia: confere todo dia se a tabela OFICIAL de cClassTrib mudou.
//
// Fluxo: baixa a página oficial (a mesma do importador), guarda os dados extraídos no
// armazenamento de arquivos (para poder reprocessar), converte com o core e, para cada
// escritório, calcula a diferença exata entre a tabela que ele usa e a publicada. Havendo
// diferença, cria uma mudança no Radar, NÃO confirmada. Daí em diante vale o fluxo de sempre:
// o contador confirma a leitura, vê os clientes afetados, aprova avisos e decide se incorpora.
//
// Sem IA: a fonte é estruturada, então a mudança sai por comparação, não por leitura de texto.
// Nada da página vai para log; em caso de erro fica só a mensagem.

import { ConvexError, v } from 'convex/values';
import {
  converterTabelaOficial, expandirTabela, extrairDadosDaPagina, mudancaDaTabelaOficial, URL_TABELA_OFICIAL, type CstOficial,
} from '@farol/core';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalAction, internalMutation, internalQuery, query, type ActionCtx } from './_generated/server';
import { escritorioAtual } from './escritorio';
import { vTabelaCompacta } from './schema';

const FONTE = 'tabela-cclasstrib';
/** A mudança vira um documento do banco (limite de 1 MB). Diferença maior que isso pede o importador. */
const LIMITE_EFEITO = 700_000;
const vOrigem = v.union(v.literal('cron'), v.literal('manual'), v.literal('reprocessar'));
type Origem = 'cron' | 'manual' | 'reprocessar';

export interface ResultadoVigia {
  status: 'sem_mudanca' | 'mudou' | 'erro';
  versao?: string;
  mudancasCriadas: number;
  erro?: string;
}

async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function processar(
  ctx: ActionCtx, json: string, origem: Origem, arquivoId: Id<'_storage'> | undefined, substituir: boolean,
): Promise<ResultadoVigia> {
  const hash = await sha256(json);
  const hoje = new Date().toISOString().slice(0, 10);
  const { tabela, resumo } = converterTabelaOficial(JSON.parse(json) as CstOficial[], hoje);
  const versao = `oficial-${resumo.publicacaoMaisRecente}-${hash.slice(0, 8)}`;
  const escritorios: Id<'escritorios'>[] = await ctx.runQuery(internal.vigia.escritorios, {});
  let mudancasCriadas = 0;
  for (const escritorioId of escritorios) {
    mudancasCriadas += await ctx.runMutation(internal.vigia.gerarMudanca, {
      escritorioId, tabela, substituir,
      versao: { versao, publicacaoMaisRecente: resumo.publicacaoMaisRecente, url: URL_TABELA_OFICIAL, vistaEm: hoje },
    });
  }
  const r: ResultadoVigia = { status: mudancasCriadas > 0 ? 'mudou' : 'sem_mudanca', versao, mudancasCriadas };
  await ctx.runMutation(internal.vigia.registrar, { origem, status: r.status, versao, sha256: hash, arquivoId, mudancasCriadas });
  return r;
}

async function verificar(ctx: ActionCtx, origem: Origem): Promise<ResultadoVigia> {
  try {
    const resp = await fetch(URL_TABELA_OFICIAL, { headers: { 'User-Agent': 'farol-vigia' } });
    if (!resp.ok) throw new Error(`O portal respondeu HTTP ${resp.status}.`);
    const json = extrairDadosDaPagina(await resp.text());
    // Guarda os dados extraídos só quando são diferentes dos últimos guardados.
    const hash = await sha256(json);
    const ultimo: { sha256: string; arquivoId: Id<'_storage'> } | null = await ctx.runQuery(internal.vigia.ultimoArquivo, {});
    const arquivoId = ultimo?.sha256 === hash ? ultimo.arquivoId : await ctx.storage.store(new Blob([json], { type: 'application/json' }));
    return await processar(ctx, json, origem, arquivoId, false);
  } catch (e) {
    const erro = (e instanceof ConvexError ? String(e.data) : e instanceof Error ? e.message : 'Erro inesperado.').slice(0, 300);
    await ctx.runMutation(internal.vigia.registrar, { origem, status: 'erro', erro, mudancasCriadas: 0 });
    return { status: 'erro', erro, mudancasCriadas: 0 };
  }
}

/** Tarefa diária (crons.ts). */
export const verificarDiario = internalAction({
  args: {},
  handler: async (ctx): Promise<ResultadoVigia> => verificar(ctx, 'cron'),
});

/** Botão "Verificar agora" do Radar. */
export const verificarAgora = action({
  args: {},
  handler: async (ctx): Promise<ResultadoVigia> => {
    await ctx.runQuery(internal.escritorio.atualId, {}); // exige login e escritório
    const ultima: { em: number } | null = await ctx.runQuery(internal.vigia.ultima, {});
    if (ultima && Date.now() - ultima.em < 60_000) throw new ConvexError('A fonte acabou de ser verificada. Tente de novo em um minuto.');
    return verificar(ctx, 'manual');
  },
});

/**
 * Modo "reprocessar": refaz as mudanças a partir dos últimos dados guardados, sem baixar de novo.
 * Serve para quando o conversor é corrigido. Só troca mudanças que o contador ainda não confirmou.
 *   npx convex run vigia:reprocessar
 */
export const reprocessar = internalAction({
  args: {},
  handler: async (ctx): Promise<ResultadoVigia> => {
    const ultimo: { sha256: string; arquivoId: Id<'_storage'> } | null = await ctx.runQuery(internal.vigia.ultimoArquivo, {});
    const blob = ultimo && await ctx.storage.get(ultimo.arquivoId);
    if (!ultimo || !blob) return { status: 'erro', erro: 'Não há dados guardados para reprocessar.', mudancasCriadas: 0 };
    return processar(ctx, await blob.text(), 'reprocessar', ultimo.arquivoId, true);
  },
});

export const escritorios = internalQuery({
  args: {},
  handler: async (ctx) => (await ctx.db.query('escritorios').collect()).map((e) => e._id),
});

export const ultima = internalQuery({
  args: {},
  handler: async (ctx) => ctx.db.query('vigiaExecucoes').order('desc').first(),
});

export const ultimoArquivo = internalQuery({
  args: {},
  handler: async (ctx) => {
    for await (const e of ctx.db.query('vigiaExecucoes').order('desc')) {
      if (e.arquivoId && e.sha256) return { sha256: e.sha256, arquivoId: e.arquivoId };
    }
    return null;
  },
});

export const registrar = internalMutation({
  args: {
    origem: vOrigem,
    status: v.union(v.literal('sem_mudanca'), v.literal('mudou'), v.literal('erro')),
    versao: v.optional(v.string()),
    sha256: v.optional(v.string()),
    arquivoId: v.optional(v.id('_storage')),
    mudancasCriadas: v.number(),
    erro: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    await ctx.db.insert('vigiaExecucoes', { ...a, fonte: FONTE, url: URL_TABELA_OFICIAL, em: Date.now() });
  },
});

/** Cria (ou refaz) a mudança que leva a tabela do escritório até a oficial vista. Devolve quantas criou (0 ou 1). */
export const gerarMudanca = internalMutation({
  args: {
    escritorioId: v.id('escritorios'),
    tabela: vTabelaCompacta,
    versao: v.object({ versao: v.string(), publicacaoMaisRecente: v.string(), url: v.string(), vistaEm: v.string() }),
    substituir: v.boolean(),
  },
  handler: async (ctx, { escritorioId, tabela, versao, substituir }): Promise<number> => {
    const escritorio = await ctx.db.get(escritorioId);
    const atual = escritorio && await ctx.db.get(escritorio.tabelaVersaoId);
    // Escritório em demonstração usa a tabela de EXEMPLO: não se mistura com a oficial.
    if (!atual || atual.exemplo) return 0;

    const doVigia = (await ctx.db.query('mudancas').withIndex('by_escritorio', (q) => q.eq('escritorioId', escritorioId)).collect())
      .filter((m) => m.origem === 'vigia' && m.efeito.tipo === 'atualiza_tabela');
    const mesma = doVigia.find((m) => m.ref === versao.versao);
    if (mesma && (!substituir || mesma.confirmada)) return 0;

    const m = mudancaDaTabelaOficial(expandirTabela(atual.tabela), expandirTabela(tabela), versao);
    // Uma diferença nova substitui as anteriores que ainda não foram incorporadas: todas partem da tabela atual.
    for (const velha of doVigia.filter((x) => !x.aplicada && (x.ref !== versao.versao || substituir))) {
      for (const i of await ctx.db.query('impactos').withIndex('by_mudanca', (q) => q.eq('mudancaId', velha._id)).collect()) {
        await ctx.db.delete(i._id);
      }
      await ctx.db.delete(velha._id);
    }
    if (!m) return 0;
    if (JSON.stringify(m.efeito).length > LIMITE_EFEITO) {
      throw new ConvexError('A tabela oficial mudou demais para virar uma mudança do Radar. Atualize pelo importador (npm run tabela:oficial).');
    }
    const { id, confirmada: _c, ...resto } = m;
    await ctx.db.insert('mudancas', { ...resto, ref: id, escritorioId, origem: 'vigia', confirmada: false, aplicada: false, criadaEm: Date.now() });
    return 1;
  },
});

/** Última verificação, para o Radar mostrar quando a fonte foi olhada. */
export const status = query({
  args: {},
  handler: async (ctx) => {
    await escritorioAtual(ctx);
    const e = await ctx.db.query('vigiaExecucoes').order('desc').first();
    return e ? { em: e.em, status: e.status, versao: e.versao, erro: e.erro, url: e.url } : null;
  },
});
