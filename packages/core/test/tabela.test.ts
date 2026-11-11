import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { classificarItem } from '../src/classificar.ts';
import type { ItemNota } from '../src/nfe.ts';
import { CRITERIO_ANEXO, converterTabelaOficial, extrairDadosDaPagina, type CstOficial } from '../src/oficial.ts';
import { compactarTabela, criterioDoNcm, expandirTabela, regraDoNcm, todosTratamentos } from '../src/tabela.ts';
import { TABELA_EXEMPLO } from '../src/tabela-exemplo.ts';
import { TABELA_OFICIAL, TABELA_OFICIAL_INFO } from '../src/tabela-oficial.ts';

// Recorte da página oficial (Portal da Conformidade Fácil), com os nomes de campo da fonte.
const AMOSTRA = JSON.parse(readFileSync(join(import.meta.dirname, 'dados', 'amostra-cclasstrib-oficial.json'), 'utf8')) as CstOficial[];

const item = (ncm: string, descricao = 'PRODUTO', extra: Partial<ItemNota> = {}): ItemNota => ({
  nItem: 1, codigo: 'X', descricao, ncm, cfop: '5102', quantidade: 1, valor: 100, vICMS: 18, vPIS: 0.65, vCOFINS: 3, ...extra,
});

test('tabela compacta: ida e volta preserva a classificação', () => {
  const volta = expandirTabela(compactarTabela(TABELA_EXEMPLO));
  for (const ncm of ['10063021', '22021000', '30049069', '90183111', '96190000']) {
    assert.deepEqual(classificarItem(item(ncm), volta), classificarItem(item(ncm), TABELA_EXEMPLO), ncm);
  }
  assert.deepEqual([...todosTratamentos(volta).keys()].sort(), [...todosTratamentos(TABELA_EXEMPLO).keys()].sort());
});

test('tabela compacta: a oficial volta idêntica e continua pequena', () => {
  const de_novo = compactarTabela(expandirTabela(TABELA_OFICIAL));
  assert.deepEqual(de_novo.regras, TABELA_OFICIAL.regras);
  assert.deepEqual(new Set(de_novo.textos), new Set(TABELA_OFICIAL.textos));
  assert.ok(JSON.stringify(de_novo).length < 600_000, 'cabe com folga num documento do Convex (1 MB)');
  assert.ok(de_novo.textos.length < 8192 && de_novo.regras.length < 8192, 'limite de itens por array do Convex');
});

test('tabela compacta: recusa o mesmo código com dois conteúdos', () => {
  const t = structuredClone(TABELA_EXEMPLO);
  t.regras[0].tratamentos[0] = { ...t.regras[0].tratamentos[0], reducao: 0.5 };
  t.regras.push({ ncmPrefixo: '9999', tratamentos: [TABELA_EXEMPLO.regras[0].tratamentos[0]] });
  assert.throws(() => compactarTabela(t), /dois conteúdos/);
});

test('conversor oficial: códigos, reduções, base legal e ressalvas vêm da fonte', () => {
  const { tabela, resumo } = converterTabelaOficial(AMOSTRA, '2026-11-11');
  const porCodigo = new Map(tabela.tratamentos.map((t) => [t.cClassTrib, t]));
  assert.equal(tabela.padrao, '000001');
  assert.equal(porCodigo.get('000001')?.reducao, 0);
  assert.equal(porCodigo.get('200003')?.reducao, 1);
  assert.equal(porCodigo.get('200035')?.reducao, 0.6);
  assert.match(porCodigo.get('200003')!.baseLegal, /^LC 214\/2025, art\. 125 — https:\/\/www\.planalto\.gov\.br\//);
  assert.ok(!porCodigo.has('000002'), 'código que não vale para NF-e/NFC-e fica de fora');
  assert.ok(!porCodigo.has('220001'), 'código com vigência encerrada fica de fora');
  assert.match(porCodigo.get('550001')!.ressalva!, /CST 550/);
  assert.equal(porCodigo.get('200003')!.ressalva, undefined);
  assert.deepEqual(resumo.comRessalva, ['550001']);
});

test('conversor oficial: NCM de anexo sempre oferece a integral e respeita VEDADO', () => {
  const { tabela } = converterTabelaOficial(AMOSTRA, '2026-11-11');
  const regra = (ncm: string) => tabela.regras.find((r) => r.ncm === ncm);
  assert.deepEqual(regra('04011010')?.codigos, ['000001', '200003']);
  assert.deepEqual(regra('96190000')?.codigos, ['000001', '200013', '200035']);
  assert.equal(regra('03021900'), undefined, 'NCM vedado para o único código não vira regra');
  assert.equal(tabela.textos[regra('04011010')!.textos![0]], CRITERIO_ANEXO);
  const textoLeite = regra('04011010')!.textos!.slice(1).map((i) => tabela.textos[i]).join(' ');
  assert.match(textoLeite, /^200003 \(redução de 100%\): .*Condição: /);
});

test('conversor oficial: recusa reduções diferentes para IBS e CBS em vez de escolher uma', () => {
  const alterada = structuredClone(AMOSTRA);
  const c = alterada.flatMap((x) => x.ClassificacoesTributarias ?? []).find((x) => x.CodClassTrib === '200035')!;
  c.PercRedIbs = 40;
  assert.throws(() => converterTabelaOficial(alterada, '2026-11-11'), /IBS .* CBS/);
});

test('extração da página oficial: lê só a variável de dados', () => {
  const html = `<html><script>\n  var outra = 1;\n        var dadosOriginais = [{"Cst":"000"}];\n</script></html>`;
  assert.equal(extrairDadosDaPagina(html), '[{"Cst":"000"}]');
  assert.throws(() => extrairDadosDaPagina('<html></html>'), /dadosOriginais/);
});

test('tabela oficial gerada: rastreável e coerente', () => {
  assert.match(TABELA_OFICIAL_INFO.versao, /^oficial-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
  assert.ok(TABELA_OFICIAL_INFO.versao.endsWith(TABELA_OFICIAL_INFO.sha256.slice(0, 8)));
  assert.match(TABELA_OFICIAL_INFO.fonte, /dfe-portal\.svrs\.rs\.gov\.br/);
  const t = expandirTabela(TABELA_OFICIAL); // lança se alguma regra citar código inexistente
  assert.equal(t.padrao.cClassTrib, '000001');
  assert.equal(t.regras.length, TABELA_OFICIAL_INFO.ncms);
  assert.equal(todosTratamentos(t).size, TABELA_OFICIAL_INFO.codigos);
  for (const r of t.regras) assert.equal(r.tratamentos[0].cClassTrib, '000001', `${r.ncmPrefixo} oferece a integral`);
});

test('tabela oficial: NCM de anexo vai para revisão com a integral na conta; fora de anexo é integral', () => {
  const t = expandirTabela(TABELA_OFICIAL);
  const leite = classificarItem(item('04011010', 'LEITE UHT INTEGRAL 1L'), t);
  assert.equal(leite.status, 'revisar');
  assert.equal(leite.tratamento.cClassTrib, '000001');
  assert.ok(leite.candidatos.some((c) => c.cClassTrib === '200003'));
  assert.equal(leite.motivo, CRITERIO_ANEXO, 'guarda só a 1ª linha; os itens do anexo são consultados à parte');
  const linhas = criterioDoNcm(TABELA_OFICIAL, '04011010');
  assert.equal(linhas[0], CRITERIO_ANEXO);
  assert.match(linhas[1], /^200003 /);
  assert.deepEqual(criterioDoNcm(TABELA_OFICIAL, '22021000'), []);

  const refri = classificarItem(item('22021000', 'REFRIGERANTE'), t);
  assert.equal(refri.status, 'padrao');
  assert.equal(refri.tratamento.cClassTrib, '000001');

  const decidido = classificarItem(item('04011010', 'LEITE UHT INTEGRAL 1L'), t, new Map([['04011010|leite uht integral 1l', '200003']]));
  assert.equal(decidido.status, 'revisado');
  assert.equal(decidido.tratamento.reducao, 1);

  const exportacao = classificarItem(item('22021000', 'REFRIGERANTE', { cClassTrib: '550001' }), t);
  assert.equal(exportacao.status, 'da_nota');
  assert.equal(exportacao.precisaRevisao, true, 'código com ressalva vai para revisão');
  assert.match(exportacao.motivo, /Atenção: CST 550/);
  assert.equal(regraDoNcm('2202', t), undefined);
});
