import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  avaliarSugestor, criarSugestorLLM, lerConjuntoOuro, pedidoDeSugestao, semDocumentos, sugestorLexical, termos, validarSugestao,
  type SugestorIA,
} from '../src/sugestor.ts';
import { expandirTabela } from '../src/tabela.ts';
import { TABELA_OFICIAL } from '../src/tabela-oficial.ts';

const OFICIAL = expandirTabela(TABELA_OFICIAL);
const pedido = (ncm: string, descricao: string) => pedidoDeSugestao({ ncm, descricao }, OFICIAL)!;

test('pedido de sugestão: só para NCM com mais de um tratamento, com o texto oficial do anexo', () => {
  assert.equal(pedidoDeSugestao({ ncm: '99999999', descricao: 'X' }, OFICIAL), null);
  const p = pedido('19059090', 'PAO FRANCES');
  assert.deepEqual(p.candidatos.map((c) => c.cClassTrib), ['000001', '200003']);
  assert.ok(p.linhas.some((l) => l.startsWith('200003 (redução de 100%): ')));
});

test('descrição nunca leva CPF/CNPJ para fora', () => {
  assert.equal(semDocumentos('VENDA CPF 123.456.789-01 FRALDA'), 'VENDA CPF [número omitido] FRALDA');
  assert.equal(semDocumentos('CNPJ 12345678000190'), 'CNPJ [número omitido]');
  assert.equal(semDocumentos('DIPIRONA 500MG 10CP'), 'DIPIRONA 500MG 10CP');
});

test('termos: sem acento, sem unidades e números, plural simples removido', () => {
  assert.deepEqual(termos('Fraldas descartáveis 5KG c/ 2 UND'), ['fralda', 'descartavel']);
});

test('lexical: sugere o código do item de anexo que cita o produto e copia o trecho oficial', async () => {
  const p = pedido('19059090', 'PAO FRANCES KG');
  const r = await sugestorLexical.sugerir(p);
  assert.ok(r.ok);
  assert.equal(r.sugestao.cClassTrib, '200003');
  assert.equal(r.sugestao.confianca, 1);
  assert.ok(p.linhas.includes(r.sugestao.trechoLegal), 'o trecho é uma linha do texto oficial, sem alteração');
});

test('lexical: quando o texto não decide, não sugere nada (nem a integral)', async () => {
  const bolo = await sugestorLexical.sugerir(pedido('19059090', 'BOLO DE CENOURA'));
  assert.deepEqual(bolo.ok, false);
  const vazio = await sugestorLexical.sugerir(pedido('19059090', '12 UND'));
  assert.deepEqual(vazio.ok, false);
});

test('lexical: empate entre códigos diferentes fica sem sugestão', async () => {
  const p = pedido('96190000', 'FRALDA');
  const r = await sugestorLexical.sugerir({
    ...p, linhas: [p.linhas[0], '200013 (redução de 100%): Fraldas para doação.', '200035 (redução de 60%): Fraldas em geral.'],
  });
  assert.ok(!r.ok);
  assert.match(r.motivo, /200013 e 200035|200035 e 200013/);
});

test('validação: recusa código fora dos candidatos, confiança inválida e trecho que não está no texto', () => {
  const p = pedido('19059090', 'PAO FRANCES');
  const boa = { cClassTrib: '200003', confianca: 0.8, justificativa: 'É pão francês.', trechoLegal: 'Pão comumente denominado pão francês' };
  assert.ok(validarSugestao(boa, p).ok);
  assert.ok(!validarSugestao({ ...boa, cClassTrib: '200013' }, p).ok);
  assert.ok(!validarSugestao({ ...boa, confianca: 1.2 }, p).ok);
  assert.ok(!validarSugestao({ ...boa, trechoLegal: 'Pão de qualquer tipo tem alíquota zero' }, p).ok);
  assert.ok(!validarSugestao({ ...boa, justificativa: '' }, p).ok);
  assert.ok(!validarSugestao('200003', p).ok);
});

test('LLM: manda só NCM, descrição e textos oficiais; resposta inválida é descartada', async () => {
  const p = pedido('19059090', 'PAO FRANCES');
  const enviados: string[] = [];
  const falso = (conteudo: string, status = 200): typeof fetch => async (_url, init) => {
    enviados.push(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), { status });
  };
  const cfg = { url: 'http://ia.local/v1/', modelo: 'teste' };

  const ok = await criarSugestorLLM({ ...cfg, buscar: falso(JSON.stringify({
    cClassTrib: '200003', confianca: 0.9, justificativa: 'Pão francês.', trechoLegal: 'Pão comumente denominado pão francês' })) }).sugerir(p);
  assert.ok(ok.ok);
  const corpo = JSON.parse(enviados[0]) as { model: string; messages: { content: string }[] };
  assert.equal(corpo.model, 'teste');
  assert.match(corpo.messages[1].content, /NCM: 19059090/);
  assert.match(corpo.messages[1].content, /PAO FRANCES/);

  const inventou = await criarSugestorLLM({ ...cfg, buscar: falso(JSON.stringify({
    cClassTrib: '200003', confianca: 0.9, justificativa: 'x', trechoLegal: 'Art. 999: todo pão é isento.' })) }).sugerir(p);
  assert.ok(!inventou.ok);
  assert.ok(!(await criarSugestorLLM({ ...cfg, buscar: falso('não sei') }).sugerir(p)).ok);
  assert.ok(!(await criarSugestorLLM({ ...cfg, buscar: falso('{}', 500) }).sugerir(p)).ok);
  assert.ok(!(await criarSugestorLLM({ ...cfg, buscar: async () => { throw new Error('rede'); } }).sugerir(p)).ok);
  assert.equal(criarSugestorLLM(cfg).origem, 'llm:teste');
});

test('conjunto-ouro: lê o CSV e mede acerto separando tabela e revisão', async () => {
  // Rótulos de TESTE (não são de contador): servem só para exercitar a conta do acerto.
  const ouro = lerConjuntoOuro('NCM;Descrição;cClassTrib\n1905.90.90;PAO FRANCES;200003\n19059090;BOLO;000001\n99999999;PARAFUSO;000001\n99999999;PORCA;200003\n');
  assert.equal(ouro.length, 4);
  assert.equal(ouro[0].ncm, '19059090');
  const r = await avaliarSugestor(ouro, OFICIAL, sugestorLexical);
  assert.deepEqual(r.pelaTabela, { total: 2, acertos: 1 });
  assert.deepEqual(r.revisao, { total: 2, comSugestao: 1, acertos: 1 });
  assert.deepEqual(r.erros.map((e) => e.obtido), ['sem sugestão', '000001 (tabela)']);

  const sempreIntegral: SugestorIA = { origem: 'fixo', sugerir: async (p) => validarSugestao({ cClassTrib: '000001', confianca: 1, justificativa: 'x', trechoLegal: p.linhas[0] }, p) };
  assert.deepEqual((await avaliarSugestor(ouro, OFICIAL, sempreIntegral)).revisao, { total: 2, comSugestao: 2, acertos: 1 });

  assert.throws(() => lerConjuntoOuro('a;b\n1;2'), /colunas/);
  assert.throws(() => lerConjuntoOuro('ncm;descricao;cclasstrib\n123;X;000001'), /Linha 2/);
});
