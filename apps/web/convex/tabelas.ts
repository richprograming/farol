// Versões BASE da tabela de classificação (as derivadas por mudança aplicada nascem em radar.aplicar).
//
// - Oficial: gerada de packages/core/src/tabela-oficial.ts (npm run tabela:oficial), com fonte,
//   data do download, publicação mais recente e sha256 dos dados. É a de todo escritório novo.
// - Exemplo: só para a carteira de DEMONSTRAÇÃO (as mudanças fictícias usam códigos EX…).
//   Clientes reais nunca são calculados com ela: `notas.gravar` recusa.

import { compactarTabela, TABELA_EXEMPLO, VERSAO_TABELA } from '@farol/core';
import { TABELA_OFICIAL, TABELA_OFICIAL_INFO } from '@farol/core/tabela-oficial';

import type { Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';

export type TabelaBase = 'oficial' | 'exemplo';

export async function versaoBaseTabela(ctx: MutationCtx, qual: TabelaBase): Promise<Id<'versoesTabela'>> {
  const versao = qual === 'oficial' ? TABELA_OFICIAL_INFO.versao : VERSAO_TABELA;
  const existente = await ctx.db.query('versoesTabela').withIndex('by_versao', (q) => q.eq('versao', versao)).first();
  if (existente) return existente._id;
  const i = TABELA_OFICIAL_INFO;
  return ctx.db.insert('versoesTabela', qual === 'oficial'
    ? {
      versao,
      fonte: `${i.fonte} · publicação mais recente ${i.publicacaoMaisRecente} · baixada em ${i.baixadaEm} · sha256 ${i.sha256}`,
      exemplo: false,
      tabela: TABELA_OFICIAL,
      criadaEm: Date.now(),
    }
    : {
      versao,
      fonte: 'Tabela de EXEMPLO do Farol (packages/core/src/tabela-exemplo.ts) — não é a oficial',
      exemplo: true,
      tabela: compactarTabela(TABELA_EXEMPLO),
      criadaEm: Date.now(),
    });
}
