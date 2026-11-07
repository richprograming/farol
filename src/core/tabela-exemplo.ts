// TABELA DE EXEMPLO — NÃO É A TABELA OFICIAL DE cClassTrib.
//
// Os códigos começam com "EX" de propósito, para ninguém confundir com códigos reais.
// Antes de qualquer uso com cliente, substituir pela tabela oficial publicada no
// Portal da NF-e / Conformidade Fácil e pelos anexos da LC 214/2025, carregando-a
// com o mesmo formato (ver `RegraClassificacao`).

export interface Tratamento {
  cClassTrib: string;
  descricao: string;
  reducao: number; // fração da alíquota reduzida (0.6 = redução de 60%; 1 = alíquota zero)
  baseLegal: string; // texto curto + referência, exibido como citação
}

export interface RegraClassificacao {
  ncmPrefixo: string; // casa com o início do NCM (2, 4, 6 ou 8 dígitos)
  tratamentos: Tratamento[]; // mais de um = depende da descrição do produto → revisão
  criterio?: string; // o que decide entre os tratamentos (mostrado ao contador)
}

export const VERSAO_TABELA = 'exemplo-0.1';

export const INTEGRAL: Tratamento = {
  cClassTrib: 'EX0001',
  descricao: 'Tributação integral (exemplo)',
  reducao: 0,
  baseLegal: 'Regra geral — LC 214/2025 (exemplo, conferir artigo)',
};

export const TABELA_EXEMPLO: RegraClassificacao[] = [
  {
    ncmPrefixo: '1006',
    tratamentos: [
      { cClassTrib: 'EX2001', descricao: 'Cesta básica — alíquota zero (exemplo)', reducao: 1,
        baseLegal: 'LC 214/2025, Anexo I — produtos da Cesta Básica Nacional (exemplo, conferir)' },
    ],
  },
  {
    ncmPrefixo: '0401',
    tratamentos: [
      { cClassTrib: 'EX2001', descricao: 'Cesta básica — alíquota zero (exemplo)', reducao: 1,
        baseLegal: 'LC 214/2025, Anexo I (exemplo, conferir)' },
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
