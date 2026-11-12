/// <reference types="vite/client" />
// Sugestões de classificação: nunca entram na conta, têm cache e não levam dado pessoal para fora.

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');
const CNPJ = '22222222000102';
const ANA = { subject: 'user_ana', email: 'ana@contabil.exemplo', name: 'Ana' };
const BETO = { subject: 'user_beto', email: 'beto@outro.exemplo' };

/** NF-e mínima e SINTÉTICA com um item. */
function xml(chave: string, ncm: string, desc: string) {
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave.repeat(44)}"><ide><mod>65</mod><nNF>1</nNF>` +
    `<dhEmi>2026-09-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>${CNPJ}</CNPJ><xNome>PADARIA TESTE</xNome><CRT>3</CRT></emit>` +
    `<dest><CPF>12345678901</CPF><xNome>MARIA DA SILVA</xNome></dest>` +
    `<det nItem="1"><prod><cProd>1</cProd><xProd>${desc}</xProd><NCM>${ncm}</NCM><CFOP>5102</CFOP><qCom>1</qCom><vProd>100.00</vProd></prod>` +
    `<imposto><ICMS><ICMS00><vICMS>18.00</vICMS></ICMS00></ICMS><PIS><PISAliq><vPIS>0.65</vPIS></PISAliq></PIS>` +
    `<COFINS><COFINSAliq><vCOFINS>3.00</vCOFINS></COFINSAliq></COFINS></imposto></det>` +
    `<total><ICMSTot><vNF>100.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function preparar() {
  const t = convexTest(schema, modules);
  const ana = t.withIdentity(ANA);
  await ana.mutation(api.conta.criarEscritorio, { nome: 'Contabilidade da Ana' });
  await ana.action(api.notas.importar, { xmls: [
    { nome: 'a.xml', conteudo: xml('1', '19059090', 'PAO FRANCES KG') },
    { nome: 'b.xml', conteudo: xml('2', '19059090', 'BOLO DE CENOURA') },
    { nome: 'c.xml', conteudo: xml('3', '84713012', 'NOTEBOOK') },
  ] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const cliente = (await ana.query(api.carteira.resumo, {})).clientes[0];
  return { t, ana, cliente, clienteId: cliente.clienteId };
}

test('sugestão lexical: aparece com o trecho oficial, não muda a conta e não roda duas vezes', async () => {
  const { t, ana, cliente, clienteId } = await preparar();
  expect(await ana.query(api.sugestoes.doCliente, { clienteId })).toMatchObject({ origem: 'lexical', pendentes: 2, itens: [] });

  expect(await ana.action(api.sugestoes.sugerir, { clienteId })).toEqual({ novas: 2, doCache: 0, semSugestao: 1, adiadas: 0 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const { itens } = await ana.query(api.sugestoes.doCliente, { clienteId });
  const pao = itens.find((i) => i.chave.includes('pao frances'))!;
  expect(pao).toMatchObject({ origem: 'lexical', sugestao: { cClassTrib: '200003', confianca: 1 } });
  expect(pao.sugestao!.trechoLegal).toMatch(/^200003 \(redução de 100%\): Pão comumente denominado pão francês/);
  expect(itens.find((i) => i.chave.includes('bolo'))).toMatchObject({ sugestao: null, motivo: expect.stringMatching(/Nenhuma palavra/) });

  // A sugestão não entrou na conta: o produto segue em revisão, com a integral, e o número é o mesmo.
  const depois = await ana.query(api.carteira.cliente, { clienteId });
  const prod = depois.analise!.produtos.find((p) => p.descricao === 'PAO FRANCES KG')!;
  expect(prod.classificacao).toMatchObject({ status: 'revisar', tratamento: { cClassTrib: '000001' } });
  expect(depois.analise!.exposicao2027).toBe(cliente.exposicao2027);
  expect(await t.run((ctx) => ctx.db.query('revisoes').collect())).toEqual([]);

  // Cache: pedir de novo não refaz nada.
  expect(await ana.action(api.sugestoes.sugerir, { clienteId })).toEqual({ novas: 0, doCache: 2, semSugestao: 0, adiadas: 0 });

  // Só a confirmação do contador muda a conta; depois dela o produto sai da fila de sugestões.
  await ana.mutation(api.carteira.revisar, { chave: prod.chave, cClassTrib: '200003' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await ana.query(api.carteira.cliente, { clienteId })).analise!.exposicao2027).toBeLessThan(cliente.exposicao2027);
  expect((await ana.query(api.sugestoes.doCliente, { clienteId })).pendentes).toBe(1);
});

test('sugestão: outro escritório não pede nem lê; produto fora da fila é recusado', async () => {
  const { t, ana, clienteId } = await preparar();
  const beto = t.withIdentity(BETO);
  await beto.mutation(api.conta.criarEscritorio, { nome: 'Escritório do Beto' });
  await expect(beto.action(api.sugestoes.sugerir, { clienteId })).rejects.toThrow(/não encontrado/);
  await expect(beto.query(api.sugestoes.doCliente, { clienteId })).rejects.toThrow(/não encontrado/);
  await expect(t.action(api.sugestoes.sugerir, { clienteId })).rejects.toThrow(/Faça login/);
  await expect(ana.action(api.sugestoes.sugerir, { clienteId, chave: '84713012|notebook' })).rejects.toThrow(/fila de revisão/);
});

test('sugestão por IA: só vão NCM, descrição e texto oficial; resposta inventada cai para o lexical', async () => {
  const { ana, clienteId } = await preparar();
  vi.stubEnv('FAROL_IA_URL', 'http://ia.local/v1');
  vi.stubEnv('FAROL_IA_MODELO', 'modelo-teste');
  const enviados: string[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const corpo = String(init.body);
    enviados.push(corpo);
    const resposta = corpo.includes('PAO FRANCES')
      ? { cClassTrib: '200003', confianca: 0.93, justificativa: 'É pão francês.', trechoLegal: 'Pão comumente denominado pão francês' }
      : { cClassTrib: '200003', confianca: 0.9, justificativa: 'Bolo é pão.', trechoLegal: 'Art. 999: todo bolo tem alíquota zero.' };
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(resposta) } }] }), { status: 200 });
  });

  expect(await ana.action(api.sugestoes.sugerir, { clienteId })).toMatchObject({ novas: 2, semSugestao: 1 });
  const { origem, itens } = await ana.query(api.sugestoes.doCliente, { clienteId });
  expect(origem).toBe('llm:modelo-teste');
  expect(itens.find((i) => i.chave.includes('pao frances'))).toMatchObject({ origem: 'llm:modelo-teste', sugestao: { cClassTrib: '200003', confianca: 0.93 } });
  expect(itens.find((i) => i.chave.includes('bolo'))).toMatchObject({ origem: 'lexical+falha-ia', sugestao: null });

  expect(enviados).toHaveLength(2);
  for (const corpo of enviados) {
    expect(corpo).not.toMatch(/12345678901|MARIA|SILVA|22222222000102|PADARIA TESTE/);
  }
  expect(await ana.action(api.sugestoes.sugerir, { clienteId })).toMatchObject({ novas: 0, doCache: 2 });
  expect(enviados).toHaveLength(2);
});
