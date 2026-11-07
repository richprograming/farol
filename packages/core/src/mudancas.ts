// Mudança normativa → clientes afetados (núcleo do Agente Impacto).
//
// Uma mudança é descrita num formato fixo — o mesmo que o Agente Vigia extrai
// das páginas oficiais via Firecrawl. Aqui ela é aplicada à tabela e a carteira
// é recalculada com a tabela antes e depois, só por conta (sem IA).

import { analisarCliente, CONTEXTO_PADRAO, type AnaliseCliente, type Cliente, type ContextoCalculo } from './analise.ts';
import type { Revisoes } from './classificar.ts';
import type { RegraClassificacao, Tratamento } from './tabela-exemplo.ts';

export type EfeitoMudanca =
  | { tipo: 'novo_tratamento_ncm'; ncmPrefixos: string[]; tratamento: Tratamento; criterio?: string }
  | { tipo: 'altera_reducao'; cClassTrib: string; novaReducao: number };

export interface Mudanca {
  id: string;
  titulo: string;
  resumo: string;
  fonte: string; // URL da página oficial
  publicadaEm: string; // AAAA-MM-DD
  vigenciaDesde?: string;
  efeito: EfeitoMudanca;
  confirmada: boolean; // o contador confirmou que a extração está certa
}

export function aplicarMudanca(tabela: RegraClassificacao[], m: Mudanca): RegraClassificacao[] {
  const e = m.efeito;
  if (e.tipo === 'altera_reducao') {
    return tabela.map((r) => ({
      ...r,
      tratamentos: r.tratamentos.map((t) => (t.cClassTrib === e.cClassTrib ? { ...t, reducao: e.novaReducao } : t)),
    }));
  }
  const semEsses = tabela.filter((r) => !e.ncmPrefixos.includes(r.ncmPrefixo));
  const novas = e.ncmPrefixos.map((p) => ({ ncmPrefixo: p, tratamentos: [e.tratamento], criterio: e.criterio }));
  return [...semEsses, ...novas];
}

export interface ClienteAfetado {
  cnpj: string;
  nome: string;
  antes: number; // diferença mensal em 2027 antes da mudança
  depois: number;
  variacaoMensal: number; // depois − antes; negativo = cliente paga menos
  produtosAfetados: { descricao: string; ncm: string; de: string; para: string; valorVendas: number }[];
  analiseDepois: AnaliseCliente;
}

export function impactoDaMudanca(
  carteira: Cliente[],
  tabela: RegraClassificacao[],
  m: Mudanca,
  revisoes: Revisoes = new Map(),
  contexto: ContextoCalculo = CONTEXTO_PADRAO,
): ClienteAfetado[] {
  if (!m.confirmada) throw new Error('A mudança precisa ser confirmada pelo contador antes de gerar impacto.');
  const nova = aplicarMudanca(tabela, m);
  const contextoDepois: ContextoCalculo = { ...contexto, versoes: { ...contexto.versoes, tabela: `${contexto.versoes.tabela}+${m.id}` } };
  const afetados: ClienteAfetado[] = [];
  for (const cliente of carteira) {
    const antes = analisarCliente(cliente, tabela, revisoes, contexto);
    const depois = analisarCliente(cliente, nova, revisoes, contextoDepois);
    const produtosAfetados = depois.produtos
      .map((p) => {
        const a = antes.produtos.find((x) => x.chave === p.chave)!;
        const ta = a.classificacao.tratamento;
        const td = p.classificacao.tratamento;
        if (ta.cClassTrib === td.cClassTrib && ta.reducao === td.reducao) return null;
        return {
          descricao: p.descricao,
          ncm: p.ncm,
          de: `${ta.cClassTrib} (redução ${Math.round(ta.reducao * 100)}%)`,
          para: `${td.cClassTrib} (redução ${Math.round(td.reducao * 100)}%)`,
          valorVendas: p.valorVendas,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    if (produtosAfetados.length === 0) continue;
    afetados.push({
      cnpj: cliente.cnpj,
      nome: cliente.nome,
      antes: antes.exposicao2027,
      depois: depois.exposicao2027,
      variacaoMensal: Math.round((depois.exposicao2027 - antes.exposicao2027) * 100) / 100,
      produtosAfetados,
      analiseDepois: depois,
    });
  }
  return afetados.sort((a, b) => Math.abs(b.variacaoMensal) - Math.abs(a.variacaoMensal));
}
