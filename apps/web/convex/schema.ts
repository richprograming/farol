// Schema do Farol no Convex.
//
// Regras que o schema ajuda a garantir:
//   - todo dado de cliente carrega `escritorioId` e só é lido filtrado por ele;
//   - notas guardam só itens normalizados: nenhum XML bruto é gravado;
//   - CPF de consumidor chega já mascarado (lerNota, no core);
//   - `analises` e `impactos` são resultados do motor determinístico (@farol/core),
//     recalculados quando notas, revisões, tabela ou parâmetros mudam.

import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';

export const vRegime = v.union(v.literal('simples'), v.literal('mei'), v.literal('normal'), v.literal('desconhecido'));

export const vTratamento = v.object({
  cClassTrib: v.string(),
  descricao: v.string(),
  reducao: v.number(),
  baseLegal: v.string(),
  ressalva: v.optional(v.string()),
});

/** Tabela de classificação na forma compacta do core (TabelaCompacta). */
export const vTabelaCompacta = v.object({
  padrao: v.string(),
  tratamentos: v.array(vTratamento),
  textos: v.array(v.string()),
  regras: v.array(v.object({ ncm: v.string(), codigos: v.array(v.string()), textos: v.optional(v.array(v.number())) })),
});

export const vAnoTransicao = v.object({
  ano: v.number(),
  cbs: v.number(),
  ibs: v.number(),
  pisCofinsExiste: v.boolean(),
  fracaoIcmsIss: v.number(),
  compensavel: v.boolean(),
  estimativa: v.boolean(),
  nota: v.string(),
});

export const vItemNota = v.object({
  nItem: v.number(),
  codigo: v.string(),
  descricao: v.string(),
  ncm: v.string(),
  cfop: v.string(),
  quantidade: v.number(),
  valor: v.number(),
  vICMS: v.number(),
  vPIS: v.number(),
  vCOFINS: v.number(),
  cClassTrib: v.optional(v.string()),
});

export const vNota = v.object({
  chave: v.string(),
  modelo: v.string(),
  numero: v.string(),
  emissao: v.string(),
  tipo: v.union(v.literal('entrada'), v.literal('saida')),
  emitente: v.object({ cnpj: v.string(), nome: v.string(), regime: vRegime }),
  destinatario: v.optional(v.object({ documento: v.string(), nome: v.string(), pessoaFisica: v.boolean() })),
  itens: v.array(vItemNota),
  valorTotal: v.number(),
});

export const vEfeito = v.union(
  v.object({ tipo: v.literal('novo_tratamento_ncm'), ncmPrefixos: v.array(v.string()), tratamento: vTratamento, criterio: v.optional(v.string()) }),
  v.object({ tipo: v.literal('altera_reducao'), cClassTrib: v.string(), novaReducao: v.number() }),
  v.object({
    tipo: v.literal('atualiza_tabela'),
    tratamentos: v.array(vTratamento),
    codigosRemovidos: v.array(v.string()),
    regras: v.array(v.object({ ncm: v.string(), codigos: v.array(v.string()), criterio: v.optional(v.string()) })),
    ncmsRemovidos: v.array(v.string()),
  }),
);

const vVersoes = v.object({ parametros: v.string(), tabela: v.string() });

const vClassificacao = v.object({
  status: v.union(v.literal('revisado'), v.literal('da_nota'), v.literal('tabela'), v.literal('padrao'), v.literal('revisar')),
  tratamento: vTratamento,
  candidatos: v.array(vTratamento),
  precisaRevisao: v.boolean(),
  motivo: v.string(),
});

/** Sugestão de classificação (core: SugestaoIA). Nunca entra na conta. */
export const vSugestao = v.object({ cClassTrib: v.string(), confianca: v.number(), justificativa: v.string(), trechoLegal: v.string() });

const vProdutoAfetado = v.object({ descricao: v.string(), ncm: v.string(), de: v.string(), para: v.string(), valorVendas: v.number() });

export const vAnalise = v.object({
  cnpj: v.string(),
  nome: v.string(),
  regime: vRegime,
  meses: v.number(),
  vendasMensais: v.number(),
  cargaAtualMensal: v.number(),
  projecao: v.array(v.object({
    ano: v.number(), cargaMensal: v.number(), diferencaMensal: v.number(), cbs: v.number(), ibs: v.number(),
    icms: v.number(), pisCofins: v.number(), estimativa: v.boolean(),
  })),
  exposicao2027: v.number(),
  comparavel: v.boolean(),
  efeitoCaixaSplit: v.number(),
  produtos: v.array(v.object({
    chave: v.string(), ncm: v.string(), descricao: v.string(), valorVendas: v.number(), valorCompras: v.number(),
    classificacao: vClassificacao,
  })),
  itensParaRevisar: v.number(),
  avisos: v.array(v.string()),
  versoes: vVersoes,
});

export const vImpacto = v.object({
  cnpj: v.string(),
  nome: v.string(),
  antes: v.number(),
  depois: v.number(),
  variacaoMensal: v.number(),
  produtosAfetados: v.array(vProdutoAfetado),
  aviso: v.object({ para: v.string(), assunto: v.string(), texto: v.string() }),
  versoes: vVersoes,
});

export default defineSchema({
  escritorios: defineTable({
    nome: v.string(),
    tabelaVersaoId: v.id('versoesTabela'),
    parametrosVersaoId: v.id('versoesParametros'),
    criadoPor: v.id('usuarios'),
    criadoEm: v.number(),
  }),

  /** Usuário autenticado pelo WorkOS. Guarda só o necessário para identificar e exibir. */
  usuarios: defineTable({
    workosId: v.string(), // `sub` do token
    email: v.string(),
    nome: v.optional(v.string()),
  }).index('by_workos', ['workosId']),

  /** Vínculo usuário ↔ escritório. Hoje cada usuário tem um escritório (o que ele criou no 1º login). */
  membros: defineTable({
    usuarioId: v.id('usuarios'),
    escritorioId: v.id('escritorios'),
    papel: v.union(v.literal('dono'), v.literal('membro')),
  })
    .index('by_usuario', ['usuarioId'])
    .index('by_escritorio', ['escritorioId']),

  /** Versões da tabela de classificação. Sem escritorioId = versão base; com = derivada por mudança aplicada. */
  versoesTabela: defineTable({
    versao: v.string(),
    fonte: v.string(), // de onde veio (arquivo oficial + data, ou "exemplo")
    exemplo: v.boolean(), // true = não é a tabela oficial
    tabela: vTabelaCompacta, // ver TabelaCompacta no core; a oficial ocupa ~280 KB
    escritorioId: v.optional(v.id('escritorios')),
    baseId: v.optional(v.id('versoesTabela')),
    mudancaId: v.optional(v.id('mudancas')),
    criadaEm: v.number(),
  })
    .index('by_versao', ['versao'])
    .index('by_escritorio', ['escritorioId']),

  versoesParametros: defineTable({
    versao: v.string(),
    fonte: v.string(),
    estimativa: v.boolean(), // true = alíquotas ainda não oficiais
    transicao: v.array(vAnoTransicao),
    diasFloatPadrao: v.number(),
    criadaEm: v.number(),
  }).index('by_versao', ['versao']),

  clientes: defineTable({
    escritorioId: v.id('escritorios'),
    cnpj: v.string(),
    nome: v.string(),
    regime: vRegime,
    email: v.string(),
    diasFloat: v.optional(v.number()),
    sintetico: v.boolean(),
  })
    .index('by_escritorio', ['escritorioId'])
    .index('by_escritorio_cnpj', ['escritorioId', 'cnpj']),

  /** Notas normalizadas (sem XML). A mesma chave pode existir em dois clientes (venda de um é compra do outro). */
  notas: defineTable({
    escritorioId: v.id('escritorios'),
    clienteId: v.id('clientes'),
    ...vNota.fields,
  })
    .index('by_escritorio', ['escritorioId'])
    .index('by_cliente', ['clienteId'])
    .index('by_cliente_chave', ['clienteId', 'chave']),

  /** Decisão do contador sobre o cClassTrib de um produto (chaveProduto do core). */
  revisoes: defineTable({
    escritorioId: v.id('escritorios'),
    chave: v.string(),
    cClassTrib: v.string(),
    revisadaEm: v.number(),
  })
    .index('by_escritorio', ['escritorioId'])
    .index('by_escritorio_chave', ['escritorioId', 'chave']),

  /**
   * Sugestão de cClassTrib para um produto em revisão (cache por produto + versão da tabela).
   * `sugestao: null` = o sugestor não conseguiu decidir (o motivo fica em `motivo`).
   */
  sugestoes: defineTable({
    escritorioId: v.id('escritorios'),
    chave: v.string(), // chaveProduto do core
    tabelaVersao: v.string(),
    origem: v.string(), // 'lexical', 'llm:<modelo>' ou 'lexical+falha-ia'
    sugestao: v.union(vSugestao, v.null()),
    motivo: v.optional(v.string()),
    criadaEm: v.number(),
  })
    .index('by_escritorio', ['escritorioId'])
    .index('by_escritorio_chave', ['escritorioId', 'chave']),

  mudancas: defineTable({
    escritorioId: v.id('escritorios'),
    ref: v.string(), // id estável da mudança (ex.: "exemplo-fraldas"); entra na versão da tabela derivada
    titulo: v.string(),
    resumo: v.string(),
    fonte: v.string(),
    publicadaEm: v.string(),
    vigenciaDesde: v.optional(v.string()),
    efeito: vEfeito,
    origem: v.union(v.literal('exemplo'), v.literal('vigia'), v.literal('manual')),
    confirmada: v.boolean(),
    confirmadaEm: v.optional(v.number()),
    aplicada: v.boolean(),
    aplicadaEm: v.optional(v.number()),
    criadaEm: v.number(),
  })
    .index('by_escritorio', ['escritorioId'])
    .index('by_escritorio_ref', ['escritorioId', 'ref']),

  /** Cada verificação do Agente Vigia (global: a fonte é pública e não tem dado de cliente). */
  vigiaExecucoes: defineTable({
    fonte: v.string(),
    url: v.string(),
    origem: v.union(v.literal('cron'), v.literal('manual'), v.literal('reprocessar')),
    status: v.union(v.literal('sem_mudanca'), v.literal('mudou'), v.literal('erro')),
    versao: v.optional(v.string()),
    sha256: v.optional(v.string()), // dos dados extraídos da página
    arquivoId: v.optional(v.id('_storage')), // dados extraídos, guardados para reprocessar
    mudancasCriadas: v.number(),
    erro: v.optional(v.string()),
    em: v.number(),
  }),

  /** Resultado do motor por cliente (cache reativo; a fonte da verdade são notas + revisões + versões). */
  analises: defineTable({
    escritorioId: v.id('escritorios'),
    clienteId: v.id('clientes'),
    ...vAnalise.fields,
    calculadaEm: v.number(),
  })
    .index('by_escritorio', ['escritorioId'])
    .index('by_cliente', ['clienteId']),

  /** Impacto de uma mudança confirmada em cada cliente afetado, com o rascunho do aviso. */
  impactos: defineTable({
    escritorioId: v.id('escritorios'),
    mudancaId: v.id('mudancas'),
    clienteId: v.id('clientes'),
    ...vImpacto.fields,
    calculadoEm: v.number(),
  })
    .index('by_mudanca', ['mudancaId'])
    .index('by_escritorio', ['escritorioId']),

  /** Avisos aprovados pelo contador e o resultado do envio. */
  envios: defineTable({
    escritorioId: v.id('escritorios'),
    mudancaId: v.id('mudancas'),
    clienteId: v.id('clientes'),
    para: v.string(),
    assunto: v.string(),
    texto: v.string(),
    status: v.union(v.literal('enviando'), v.literal('enviado'), v.literal('simulado'), v.literal('erro')),
    resendId: v.optional(v.string()),
    erro: v.optional(v.string()),
    aprovadoEm: v.number(),
    enviadoEm: v.optional(v.number()),
  })
    .index('by_escritorio', ['escritorioId'])
    .index('by_mudanca', ['mudancaId'])
    .index('by_mudanca_cliente', ['mudancaId', 'clienteId']),
});
