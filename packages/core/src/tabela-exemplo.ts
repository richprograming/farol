// TABELA DE EXEMPLO — NÃO É A TABELA OFICIAL DE cClassTrib.
//
// Os códigos começam com "EX" de propósito, para ninguém confundir com códigos reais.
// Antes de qualquer uso com cliente, substituir pela tabela oficial publicada no
// Portal da NF-e / Conformidade Fácil e pelos anexos da LC 214/2025, carregando-a
// com o mesmo formato (ver `TabelaClassificacao` em tabela.ts).

import type { RegraClassificacao, TabelaClassificacao, Tratamento } from './tabela.ts';

export const VERSAO_TABELA = 'exemplo-0.2';

export const INTEGRAL: Tratamento = {
  cClassTrib: 'EX0001',
  descricao: 'Tributação integral (exemplo)',
  reducao: 0,
  baseLegal: 'Regra geral — LC 214/2025 (exemplo, conferir artigo)',
};

// Um código tem um só conteúdo em toda a tabela (a forma compacta exige).
const CESTA_BASICA: Tratamento = {
  cClassTrib: 'EX2001', descricao: 'Cesta básica — alíquota zero (exemplo)', reducao: 1,
  baseLegal: 'LC 214/2025, Anexo I — produtos da Cesta Básica Nacional (exemplo, conferir)',
};

const REGRAS_EXEMPLO: RegraClassificacao[] = [
  {
    ncmPrefixo: '1006',
    tratamentos: [
      CESTA_BASICA,
    ],
  },
  {
    ncmPrefixo: '0401',
    tratamentos: [
      CESTA_BASICA,
    ],
  },
  {
    ncmPrefixo: '3004',
    criterio: 'Depende de o medicamento estar na lista de alíquota zero ou na de redução de 60%.',
    tratamentos: [
      { cClassTrib: 'EX2060', descricao: 'Medicamentos — redução de 60% (exemplo)', reducao: 0.6,
        baseLegal: 'LC 214/2025, medicamentos com redução de 60% (exemplo, conferir anexo)' },
      { cClassTrib: 'EX2002', descricao: 'Medicamentos — alíquota zero (exemplo)', reducao: 1,
        baseLegal: 'LC 214/2025, medicamentos com alíquota zero (exemplo, conferir anexo)' },
    ],
  },
  {
    ncmPrefixo: '9018',
    criterio: 'Depende de o dispositivo médico estar listado no anexo de redução.',
    tratamentos: [
      { cClassTrib: 'EX2061', descricao: 'Dispositivos médicos — redução de 60% (exemplo)', reducao: 0.6,
        baseLegal: 'LC 214/2025, dispositivos médicos (exemplo, conferir anexo)' },
      INTEGRAL,
    ],
  },
];

export const TABELA_EXEMPLO: TabelaClassificacao = { padrao: INTEGRAL, regras: REGRAS_EXEMPLO, avulsos: [] };
