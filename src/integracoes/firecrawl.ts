// Agente Vigia — coleta com Firecrawl (change tracking na API v2).
// Docs: https://docs.firecrawl.dev/features/change-tracking
//
// Fluxo: para cada fonte oficial, raspa a página com change tracking (modo git-diff).
// Se mudou, o diff vai para um `ExtratorMudanca` (LLM) que devolve uma `Mudanca`
// no formato fixo, com `confirmada: false` até o contador conferir.

import type { Mudanca } from '../core/mudancas.ts';

export interface FonteOficial {
  id: string;
  nome: string;
  url: string;
}

// Lista inicial: são as páginas de entrada dos portais. TROCAR pela página exata de cada
// lista (informes técnicos, tabela cClassTrib, notícias da reforma) e verificar se há
// feed ou API oficial antes de raspar.
export const FONTES: FonteOficial[] = [
  { id: 'portal-nfe', nome: 'Portal Nacional da NF-e', url: 'https://www.nfe.fazenda.gov.br/portal/principal.aspx' },
  { id: 'receita-federal', nome: 'Receita Federal', url: 'https://www.gov.br/receitafederal/pt-br' },
];

export interface ResultadoVigia {
  fonte: FonteOficial;
  status: 'new' | 'same' | 'changed' | 'removed' | 'erro';
  diff?: string;
  erro?: string;
}

export interface ExtratorMudanca {
  extrair(fonte: FonteOficial, diff: string): Promise<Mudanca[]>;
}

export async function verificarFonte(
  fonte: FonteOficial,
  apiKey = process.env.FIRECRAWL_API_KEY,
): Promise<ResultadoVigia> {
  if (!apiKey) return { fonte, status: 'erro', erro: 'FIRECRAWL_API_KEY não definida' };
  const resp = await fetch('https://api.firecrawl.dev/v2/scrape', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: fonte.url,
      formats: ['markdown', { type: 'changeTracking', modes: ['git-diff'], tag: 'farol-diario' }],
    }),
  });
  if (!resp.ok) return { fonte, status: 'erro', erro: `Firecrawl HTTP ${resp.status}` };
  const corpo = (await resp.json()) as {
    data?: { changeTracking?: { changeStatus?: ResultadoVigia['status']; diff?: { text?: string } } };
  };
  const ct = corpo.data?.changeTracking;
  return { fonte, status: ct?.changeStatus ?? 'erro', diff: ct?.diff?.text };
}

export async function rodarVigia(extrator: ExtratorMudanca, fontes = FONTES): Promise<Mudanca[]> {
  const mudancas: Mudanca[] = [];
  for (const f of fontes) {
    const r = await verificarFonte(f);
    if (r.status === 'changed' && r.diff) mudancas.push(...(await extrator.extrair(f, r.diff)));
  }
  return mudancas.map((m) => ({ ...m, confirmada: false }));
}
