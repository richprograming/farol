// Mudanças FICTÍCIAS para a demo. Não correspondem a normas reais.
// Na versão final, a lista vem do Agente Vigia (Firecrawl + extração por LLM).

import type { Mudanca } from '@farol/core';

export const MUDANCAS_EXEMPLO: Omit<Mudanca, 'confirmada'>[] = [
  {
    id: 'exemplo-fraldas',
    titulo: 'EXEMPLO FICTÍCIO: fraldas entram na lista de higiene pessoal com redução de 60%',
    resumo: 'Fraldas (NCM 9619.00) passam a ter redução de 60% nas alíquotas de CBS e IBS.',
    fonte: 'https://exemplo.gov.br/norma-ficticia-1',
    publicadaEm: '2026-11-06',
    vigenciaDesde: '2027-01-01',
    efeito: {
      tipo: 'novo_tratamento_ncm',
      ncmPrefixos: ['961900'],
      tratamento: { cClassTrib: 'EX2063', descricao: 'Higiene pessoal — redução de 60% (exemplo)', reducao: 0.6,
        baseLegal: 'Norma fictícia de exemplo' },
    },
  },
  {
    id: 'exemplo-detergentes',
    titulo: 'EXEMPLO FICTÍCIO: produtos de higiene e limpeza com redução de 60%',
    resumo: 'Detergentes (NCM 3402.20) passam a ter redução de 60% nas alíquotas de CBS e IBS.',
    fonte: 'https://exemplo.gov.br/norma-ficticia-2',
    publicadaEm: '2026-11-07',
    vigenciaDesde: '2027-01-01',
    efeito: {
      tipo: 'novo_tratamento_ncm',
      ncmPrefixos: ['340220'],
      tratamento: { cClassTrib: 'EX2062', descricao: 'Higiene e limpeza — redução de 60% (exemplo)', reducao: 0.6,
        baseLegal: 'Norma fictícia de exemplo' },
    },
  },
];
