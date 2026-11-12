// Sugestão de cClassTrib para produtos na fila de revisão.
//
// A sugestão NUNCA entra na conta: ela só aparece ao lado do produto, com o trecho oficial em
// que se apoia, e o contador decide. Dois sugestores atrás da mesma interface:
//
//   1. Lexical (padrão, sem custo, sem rede): compara a descrição do produto com o texto oficial
//      dos itens de anexo do NCM (os mesmos que o contador vê). Determinístico e auditável.
//      Quando o texto não permite decidir, NÃO sugere nada.
//   2. LLM (opcional): qualquer serviço compatível com a API de chat da OpenAI, inclusive modelo
//      local. Recebe só NCM, descrição do produto e os textos oficiais; nenhum dado pessoal.
//
// Toda sugestão, de qualquer origem, passa por `validarSugestao`: o código tem de estar entre os
// candidatos e o trecho citado tem de existir, letra por letra, no texto oficial enviado.

import { classificarItem, type Revisoes } from './classificar.ts';
import type { ItemNota } from './nfe.ts';
import { regraDoNcm, type TabelaClassificacao, type Tratamento } from './tabela.ts';

export interface SugestaoIA {
  cClassTrib: string;
  confianca: number; // 0 a 1. No lexical é a aderência da descrição ao texto, não uma probabilidade.
  justificativa: string;
  trechoLegal: string; // cópia literal de uma parte do texto oficial
}

export type ResultadoSugestao = { ok: true; sugestao: SugestaoIA } | { ok: false; motivo: string };

export interface PedidoSugestao {
  ncm: string;
  descricao: string;
  candidatos: Tratamento[];
  /** Linhas do critério da regra: a 1ª é o aviso geral; as demais, "CÓDIGO (redução de X%): item do anexo…". */
  linhas: string[];
}

export interface SugestorIA {
  origem: string; // 'lexical' ou 'llm:<modelo>': fica gravado com a sugestão
  sugerir(p: PedidoSugestao): Promise<ResultadoSugestao>;
}

/** Monta o pedido para um item. Devolve null se o NCM não tem mais de um tratamento possível. */
export function pedidoDeSugestao(
  item: Pick<ItemNota, 'ncm' | 'descricao'>,
  tabela: TabelaClassificacao,
): PedidoSugestao | null {
  const regra = regraDoNcm(item.ncm, tabela);
  if (!regra || regra.tratamentos.length < 2) return null;
  return {
    ncm: item.ncm,
    descricao: semDocumentos(item.descricao),
    candidatos: regra.tratamentos,
    linhas: (regra.criterio ?? '').split('\n').filter(Boolean),
  };
}

/** Descrição de produto não deveria trazer CPF/CNPJ; se trouxer, não sai daqui. */
export function semDocumentos(s: string): string {
  return s.replace(/\d[\d.\-/]{9,}\d/g, (m) => (m.replace(/\D/g, '').length >= 11 ? '[número omitido]' : m));
}

export function validarSugestao(s: unknown, p: PedidoSugestao): ResultadoSugestao {
  if (!s || typeof s !== 'object') return { ok: false, motivo: 'Resposta fora do formato esperado.' };
  const { cClassTrib, confianca, justificativa, trechoLegal } = s as Record<string, unknown>;
  if (typeof cClassTrib !== 'string' || !p.candidatos.some((c) => c.cClassTrib === cClassTrib)) {
    return { ok: false, motivo: `O código sugerido (${String(cClassTrib)}) não está entre os candidatos do NCM.` };
  }
  if (typeof confianca !== 'number' || !(confianca >= 0 && confianca <= 1)) {
    return { ok: false, motivo: 'Confiança fora do intervalo de 0 a 1.' };
  }
  if (typeof justificativa !== 'string' || !justificativa.trim()) return { ok: false, motivo: 'Sugestão sem justificativa.' };
  if (typeof trechoLegal !== 'string' || trechoLegal.trim().length < 8 || !p.linhas.some((l) => l.includes(trechoLegal.trim()))) {
    return { ok: false, motivo: 'O trecho citado não existe no texto oficial enviado.' };
  }
  return { ok: true, sugestao: { cClassTrib, confianca, justificativa: justificativa.trim().slice(0, 600), trechoLegal: trechoLegal.trim() } };
}

// ---------------------------------------------------------------------------------------------
// Sugestor lexical

const IGNORAR = new Set([
  'para', 'com', 'sem', 'dos', 'das', 'que', 'por', 'uma', 'uns', 'umas', 'tipo', 'und', 'unid', 'unidade', 'cxa', 'caixa',
  'pct', 'pacote', 'kit', 'pote', 'lata', 'frasco', 'sache', 'emb', 'ref', 'cod', 'novo', 'nova', 'tam', 'tamanho', 'sabor',
  'ncm', 'codigo', 'posicao', 'subposicao', 'seguinte', 'classificado', 'classificada', 'ambos', 'outro', 'outra', 'exceto',
  'produto', 'demais',
]);

/** Palavras úteis de um texto: sem acento, sem números, sem unidades; plural simples removido. */
export function termos(texto: string): string[] {
  const palavras = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/[^a-z]+/);
  const vistos = new Set<string>();
  for (const p of palavras) {
    if (p.length < 3) continue;
    const s = singular(p);
    if (!IGNORAR.has(p) && !IGNORAR.has(s)) vistos.add(s);
  }
  return [...vistos];
}

function singular(p: string): string {
  if (p.length > 5 && /(oes|aes)$/.test(p)) return `${p.slice(0, -3)}ao`;
  if (p.length > 5 && /[aeiou]is$/.test(p)) return `${p.slice(0, -2)}l`; // descartáveis → descartavel
  if (p.length > 4 && /(res|zes|ses)$/.test(p)) return p.slice(0, -2);
  if (p.length > 3 && p.endsWith('s')) return p.slice(0, -1);
  return p;
}

/** Igual, ou um é abreviação do outro (nota fiscal abrevia: "DESCART" ↔ "descartavel"). */
function casa(a: string, b: string): boolean {
  if (a === b) return true;
  const [curto, longo] = a.length <= b.length ? [a, b] : [b, a];
  return curto.length >= 4 && longo.startsWith(curto);
}

interface LinhaAnexo { codigo: string; linha: string; item: string; excecao: string }

function lerLinha(linha: string): LinhaAnexo | null {
  const m = /^(\S+) \(redução de \d+%\): (.*)$/.exec(linha);
  if (!m) return null;
  const [antesExceto, excecao = ''] = m[2].split(' Exceto: ');
  const item = antesExceto.split(' Condição: ')[0];
  return { codigo: m[1], linha, item, excecao };
}

export const sugestorLexical: SugestorIA = {
  origem: 'lexical',
  async sugerir(p) {
    const doProduto = termos(p.descricao);
    if (doProduto.length === 0) return { ok: false, motivo: 'A descrição do produto não tem palavras que permitam comparar com o anexo.' };
    const linhas = p.linhas.map(lerLinha).filter((l): l is LinhaAnexo => l !== null);
    if (linhas.length === 0) return { ok: false, motivo: 'A tabela não traz o texto dos itens de anexo para este NCM.' };

    const avaliadas = linhas.map((l) => {
      const doItem = termos(l.item);
      const daExcecao = termos(l.excecao);
      const achados = doProduto.filter((t) => doItem.some((x) => casa(t, x)));
      const naExcecao = doProduto.filter((t) => daExcecao.some((x) => casa(t, x)));
      return { ...l, achados, naExcecao, aderencia: achados.length / doProduto.length };
    }).sort((a, b) => b.aderencia - a.aderencia);

    const melhor = avaliadas[0];
    if (melhor.aderencia === 0) {
      return { ok: false, motivo: 'Nenhuma palavra da descrição aparece nos itens do anexo para este NCM. Decida pelo texto do anexo.' };
    }
    const empate = avaliadas.find((x) => x.codigo !== melhor.codigo && x.aderencia === melhor.aderencia);
    if (empate) {
      return { ok: false, motivo: `A descrição combina igualmente com itens dos códigos ${melhor.codigo} e ${empate.codigo}. Decida pelo texto do anexo.` };
    }
    let confianca = Math.round(melhor.aderencia * 100) / 100;
    let justificativa = `${melhor.achados.length} de ${doProduto.length} palavra(s) da descrição aparecem no item do anexo (${melhor.achados.join(', ')}).`;
    if (melhor.naExcecao.length > 0) {
      confianca = Math.round(confianca * 50) / 100;
      justificativa += ` Atenção: "${melhor.naExcecao.join(', ')}" também aparece nas exceções do item.`;
    }
    justificativa += ' Comparação de palavras, sem interpretação: confira a condição do item.';
    return validarSugestao({ cClassTrib: melhor.codigo, confianca, justificativa, trechoLegal: melhor.linha }, p);
  },
};

// ---------------------------------------------------------------------------------------------
// Sugestor por LLM (opcional)

export interface ConfigLLM {
  url: string; // base da API compatível com OpenAI, ex.: http://localhost:11434/v1
  modelo: string;
  chave?: string;
  buscar?: typeof fetch; // para testes
}

const INSTRUCOES = [
  'Você ajuda um contador brasileiro a classificar um produto em cClassTrib (reforma tributária, LC 214/2025).',
  'Escolha UM código entre os candidatos, usando somente os textos oficiais fornecidos.',
  'Se o produto não se enquadrar claramente em nenhum item do anexo, escolha o código de tributação integral.',
  'Responda só com JSON: {"cClassTrib": string, "confianca": número de 0 a 1, "justificativa": string curta em português,',
  '"trechoLegal": string copiada LETRA POR LETRA de um dos textos oficiais (o trecho que sustenta a escolha)}.',
  'Não invente texto legal. Não calcule valores.',
].join(' ');

export function criarSugestorLLM(cfg: ConfigLLM): SugestorIA {
  const buscar = cfg.buscar ?? fetch;
  return {
    origem: `llm:${cfg.modelo}`,
    async sugerir(p) {
      const usuario = [
        `NCM: ${p.ncm}`,
        `Descrição do produto na nota: ${p.descricao}`,
        'Candidatos:',
        ...p.candidatos.map((c) => `- ${c.cClassTrib}: ${c.descricao} (redução de ${Math.round(c.reducao * 100)}%)`),
        'Textos oficiais:',
        ...p.linhas.map((l) => `- ${l}`),
      ].join('\n');
      let resp: Response;
      try {
        resp = await buscar(`${cfg.url.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(cfg.chave ? { Authorization: `Bearer ${cfg.chave}` } : {}) },
          body: JSON.stringify({
            model: cfg.modelo,
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [{ role: 'system', content: INSTRUCOES }, { role: 'user', content: usuario }],
          }),
        });
      } catch {
        return { ok: false, motivo: 'Não foi possível falar com o serviço de IA.' };
      }
      if (!resp.ok) return { ok: false, motivo: `O serviço de IA respondeu HTTP ${resp.status}.` };
      try {
        const corpo = (await resp.json()) as { choices?: { message?: { content?: string } }[] };
        const texto = corpo.choices?.[0]?.message?.content ?? '';
        const json = texto.slice(texto.indexOf('{'), texto.lastIndexOf('}') + 1);
        return validarSugestao(JSON.parse(json), p);
      } catch {
        return { ok: false, motivo: 'A resposta do serviço de IA não veio no formato pedido.' };
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Avaliação com o conjunto-ouro (rotulado por contador)

export interface LinhaOuro { ncm: string; descricao: string; cClassTrib: string }

/** CSV com cabeçalho `ncm;descricao;cclasstrib` (aceita `,` ou `;`; sem separador dentro dos campos). */
export function lerConjuntoOuro(csv: string): LinhaOuro[] {
  const linhas = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (linhas.length === 0) throw new Error('Conjunto-ouro vazio.');
  const sep = linhas[0].includes(';') ? ';' : ',';
  const limpo = (s: string) => s.trim().replace(/^"(.*)"$/, '$1');
  const cab = linhas[0].split(sep).map((c) => limpo(c).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const [iN, iD, iC] = [cab.indexOf('ncm'), cab.indexOf('descricao'), cab.indexOf('cclasstrib')];
  if (iN < 0 || iD < 0 || iC < 0) throw new Error('O cabeçalho precisa ter as colunas ncm, descricao e cclasstrib.');
  return linhas.slice(1).map((l, n) => {
    const c = l.split(sep).map(limpo);
    const linha = { ncm: (c[iN] ?? '').replace(/\D/g, ''), descricao: c[iD] ?? '', cClassTrib: c[iC] ?? '' };
    if (linha.ncm.length !== 8 || !linha.descricao || !linha.cClassTrib) throw new Error(`Linha ${n + 2} do conjunto-ouro incompleta.`);
    return linha;
  });
}

export interface ResultadoAvaliacao {
  origem: string;
  total: number;
  /** Produtos que a tabela resolve sozinha (sem sugestão): quantos batem com o rótulo. */
  pelaTabela: { total: number; acertos: number };
  /** Produtos que vão para revisão: quantos receberam sugestão e quantas estavam certas. */
  revisao: { total: number; comSugestao: number; acertos: number };
  erros: { ncm: string; descricao: string; esperado: string; obtido: string }[];
}

export async function avaliarSugestor(
  ouro: LinhaOuro[],
  tabela: TabelaClassificacao,
  sugestor: SugestorIA,
  revisoes: Revisoes = new Map(),
): Promise<ResultadoAvaliacao> {
  const r: ResultadoAvaliacao = {
    origem: sugestor.origem, total: ouro.length,
    pelaTabela: { total: 0, acertos: 0 }, revisao: { total: 0, comSugestao: 0, acertos: 0 }, erros: [],
  };
  for (const l of ouro) {
    const item: ItemNota = { nItem: 1, codigo: '', descricao: l.descricao, ncm: l.ncm, cfop: '', quantidade: 1, valor: 0, vICMS: 0, vPIS: 0, vCOFINS: 0 };
    const pedido = pedidoDeSugestao(item, tabela);
    if (!pedido) {
      const obtido = classificarItem(item, tabela, revisoes).tratamento.cClassTrib;
      r.pelaTabela.total++;
      if (obtido === l.cClassTrib) r.pelaTabela.acertos++;
      else r.erros.push({ ncm: l.ncm, descricao: l.descricao, esperado: l.cClassTrib, obtido: `${obtido} (tabela)` });
      continue;
    }
    r.revisao.total++;
    const s = await sugestor.sugerir(pedido);
    if (!s.ok) {
      r.erros.push({ ncm: l.ncm, descricao: l.descricao, esperado: l.cClassTrib, obtido: 'sem sugestão' });
      continue;
    }
    r.revisao.comSugestao++;
    if (s.sugestao.cClassTrib === l.cClassTrib) r.revisao.acertos++;
    else r.erros.push({ ncm: l.ncm, descricao: l.descricao, esperado: l.cClassTrib, obtido: s.sugestao.cClassTrib });
  }
  return r;
}
