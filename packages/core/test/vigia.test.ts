import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classificarItem } from '../src/classificar.ts';
import { aplicarMudanca } from '../src/mudancas.ts';
import type { ItemNota } from '../src/nfe.ts';
import { compactarTabela, expandirTabela, type TabelaCompacta } from '../src/tabela.ts';
import { TABELA_OFICIAL } from '../src/tabela-oficial.ts';
import { compararTabelas, mudancaDaTabelaOficial } from '../src/vigia.ts';

const item = (ncm: string): ItemNota => ({ nItem: 1, codigo: 'X', descricao: 'P', ncm, cfop: '5102', quantidade: 1, valor: 100, vICMS: 0, vPIS: 0, vCOFINS: 0 });
const VERSAO = { versao: 'oficial-teste-00000000', publicacaoMaisRecente: '2026-12-01', url: 'https://exemplo.test/tabela', vistaEm: '2026-12-02' };

/** Cópia da tabela oficial com alterações DE TESTE (não são normas reais). */
function alterada(): TabelaCompacta {
  const t = structuredClone(TABELA_OFICIAL) as TabelaCompacta;
  t.tratamentos = t.tratamentos.map((x) => (x.cClassTrib === '200035' ? { ...x, reducao: 0.3 } : x)); // redução muda
  t.tratamentos.push({ cClassTrib: '299999', descricao: 'Código de teste', reducao: 0.5, baseLegal: 'teste' }); // código novo
  t.regras = t.regras.filter((r) => r.ncm !== '19059090'); // NCM sai do anexo
  t.regras.push({ ncm: '84713012', codigos: ['000001', '299999'], textos: [0] }); // NCM entra
  const fralda = t.regras.find((r) => r.ncm === '96190000')!;
  fralda.codigos = fralda.codigos.filter((c) => c !== '200013'); // opção removida de um NCM
  return t;
}

test('vigia: tabelas iguais não geram mudança', () => {
  const a = expandirTabela(TABELA_OFICIAL);
  assert.equal(compararTabelas(a, expandirTabela(structuredClone(TABELA_OFICIAL) as TabelaCompacta)), null);
  assert.equal(mudancaDaTabelaOficial(a, a, VERSAO), null);
});

test('vigia: a diferença é exata — aplicar a mudança leva a tabela do escritório até a nova', () => {
  const antiga = expandirTabela(TABELA_OFICIAL);
  const nova = expandirTabela(alterada());
  const m = mudancaDaTabelaOficial(antiga, nova, VERSAO)!;
  assert.equal(m.confirmada, false, 'nasce sem confirmação: o contador confere antes');
  assert.equal(m.id, VERSAO.versao);
  assert.equal(m.fonte, VERSAO.url);
  assert.equal(m.publicadaEm, '2026-12-01');
  assert.ok(m.efeito.tipo === 'atualiza_tabela');
  assert.deepEqual(m.efeito.tratamentos.map((t) => t.cClassTrib).sort(), ['200035', '299999']);
  assert.deepEqual(m.efeito.regras.map((r) => r.ncm).sort(), ['84713012', '96190000']);
  assert.deepEqual(m.efeito.ncmsRemovidos, ['19059090']);
  assert.match(m.resumo, /200035 \(de 60% para 30%\)/);
  assert.match(m.resumo, /299999 \(redução de 50%\)/);
  assert.match(m.resumo, /19059090/);

  const aplicada = aplicarMudanca(antiga, { ...m, confirmada: true });
  assert.equal(compararTabelas(aplicada, nova), null);
  const [c1, c2] = [compactarTabela(aplicada), compactarTabela(nova)];
  assert.deepEqual(new Map(c1.tratamentos.map((t) => [t.cClassTrib, t])), new Map(c2.tratamentos.map((t) => [t.cClassTrib, t])));
  // e a tabela original não foi tocada
  assert.equal(classificarItem(item('19059090'), antiga).status, 'revisar');
  assert.equal(classificarItem(item('19059090'), aplicada).status, 'padrao');
  assert.deepEqual(classificarItem(item('96190000'), aplicada).candidatos.map((t) => [t.cClassTrib, t.reducao]), [['000001', 0], ['200035', 0.3]]);
  assert.deepEqual(classificarItem(item('84713012'), aplicada).candidatos.map((t) => t.cClassTrib), ['000001', '299999']);
});

test('vigia: código removido some das regras que o citavam', () => {
  const antiga = expandirTabela(TABELA_OFICIAL);
  const t = structuredClone(TABELA_OFICIAL) as TabelaCompacta;
  t.tratamentos = t.tratamentos.filter((x) => x.cClassTrib !== '200035');
  t.regras = t.regras.map((r) => ({ ...r, codigos: r.codigos.filter((c) => c !== '200035') })).filter((r) => r.codigos.length > 1);
  const nova = expandirTabela(t);
  const m = mudancaDaTabelaOficial(antiga, nova, VERSAO)!;
  assert.ok(m.efeito.tipo === 'atualiza_tabela' && m.efeito.codigosRemovidos.includes('200035'));
  assert.equal(compararTabelas(aplicarMudanca(antiga, m), nova), null);
});
