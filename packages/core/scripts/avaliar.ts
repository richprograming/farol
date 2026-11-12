// Mede o acerto do sugestor de cClassTrib contra um conjunto-ouro rotulado por contador.
//
//   npm run avaliar -w @farol/core -- ouro.csv          sugestor lexical (sem custo)
//   npm run avaliar -w @farol/core -- ouro.csv --llm    LLM configurado em FAROL_IA_URL / FAROL_IA_MODELO / FAROL_IA_CHAVE
//
// O CSV tem cabeçalho `ncm;descricao;cclasstrib`. O Farol não traz um conjunto-ouro: os rótulos
// têm de vir de um contador. A tabela usada é a oficial que está no repositório.

import { readFileSync } from 'node:fs';

import { avaliarSugestor, criarSugestorLLM, lerConjuntoOuro, sugestorLexical } from '../src/sugestor.ts';
import { expandirTabela } from '../src/tabela.ts';
import { TABELA_OFICIAL, TABELA_OFICIAL_INFO } from '../src/tabela-oficial.ts';

const arquivo = process.argv.slice(2).find((a) => !a.startsWith('--'));
if (!arquivo) {
  console.error('Informe o CSV do conjunto-ouro: npm run avaliar -w @farol/core -- ouro.csv [--llm]');
  process.exit(1);
}
let sugestor = sugestorLexical;
if (process.argv.includes('--llm')) {
  const { FAROL_IA_URL: url, FAROL_IA_MODELO: modelo, FAROL_IA_CHAVE: chave } = process.env;
  if (!url || !modelo) {
    console.error('Para --llm, defina FAROL_IA_URL e FAROL_IA_MODELO (e FAROL_IA_CHAVE, se o serviço exigir).');
    process.exit(1);
  }
  sugestor = criarSugestorLLM({ url, modelo, chave });
}

const pct = (a: number, b: number) => (b === 0 ? '—' : `${((a / b) * 100).toFixed(1)}%`);
const ouro = lerConjuntoOuro(readFileSync(arquivo, 'utf8'));
const r = await avaliarSugestor(ouro, expandirTabela(TABELA_OFICIAL), sugestor);

console.log(`Tabela ${TABELA_OFICIAL_INFO.versao} · sugestor ${r.origem} · ${r.total} produtos`);
console.log(`Resolvidos pela tabela (sem sugestão): ${r.pelaTabela.acertos} de ${r.pelaTabela.total} corretos (${pct(r.pelaTabela.acertos, r.pelaTabela.total)})`);
console.log(`Na fila de revisão: ${r.revisao.total}`);
console.log(`  receberam sugestão: ${r.revisao.comSugestao} (${pct(r.revisao.comSugestao, r.revisao.total)})`);
console.log(`  sugestões corretas: ${r.revisao.acertos} (${pct(r.revisao.acertos, r.revisao.comSugestao)} das sugestões; ${pct(r.revisao.acertos, r.revisao.total)} da fila)`);
if (r.erros.length) {
  console.log('\nDiferenças:');
  for (const e of r.erros) console.log(`  ${e.ncm} ${e.descricao}: esperado ${e.esperado}, obtido ${e.obtido}`);
}
