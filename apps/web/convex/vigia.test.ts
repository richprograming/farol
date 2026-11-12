/// <reference types="vite/client" />
// Agente Vigia: a mudança sai da diferença com a tabela oficial, nasce sem confirmação e segue os bloqueios do Radar.

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { CstOficial } from '@farol/core';

import amostra from '../../../packages/core/test/dados/amostra-cclasstrib-oficial.json?raw';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');
const CNPJ = '22222222000102';
const ANA = { subject: 'user_ana', email: 'ana@contabil.exemplo', name: 'Ana' };

function xml(chave: string, ncm: string, desc: string) {
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave.repeat(44)}"><ide><mod>65</mod><nNF>1</nNF>` +
    `<dhEmi>2026-09-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>${CNPJ}</CNPJ><xNome>FARMACIA TESTE</xNome><CRT>3</CRT></emit>` +
    `<det nItem="1"><prod><cProd>1</cProd><xProd>${desc}</xProd><NCM>${ncm}</NCM><CFOP>5102</CFOP><qCom>1</qCom><vProd>1000.00</vProd></prod>` +
    `<imposto><ICMS><ICMS00><vICMS>180.00</vICMS></ICMS00></ICMS><PIS><PISAliq><vPIS>6.50</vPIS></PISAliq></PIS>` +
    `<COFINS><COFINSAliq><vCOFINS>30.00</vCOFINS></COFINSAliq></COFINS></imposto></det>` +
    `<total><ICMSTot><vNF>1000.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

/**
 * Página do portal com o recorte real da tabela e UMA ALTERAÇÃO DE TESTE (não é norma real):
 * a redução do código 200035 cai de 60% para 30%.
 */
function pagina(reducao200035 = 30): string {
  const csts = JSON.parse(amostra) as CstOficial[];
  for (const c of csts.flatMap((x) => x.ClassificacoesTributarias ?? [])) {
    if (c.CodClassTrib === '200035') Object.assign(c, { PercRedIbs: reducao200035, PercRedCbs: reducao200035 });
  }
  return `<html><script>\n  var dadosOriginais = ${JSON.stringify(csts)};\n</script></html>`;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function preparar() {
  const t = convexTest(schema, modules);
  const ana = t.withIdentity(ANA);
  await ana.mutation(api.conta.criarEscritorio, { nome: 'Contabilidade da Ana' });
  await ana.action(api.notas.importar, { xmls: [{ nome: 'a.xml', conteudo: xml('1', '96190000', 'FRALDA G') }], email: 'cliente@exemplo.com' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const clienteId = (await ana.query(api.carteira.resumo, {})).clientes[0].clienteId;
  const fralda = (await ana.query(api.carteira.cliente, { clienteId })).analise!.produtos[0];
  await ana.mutation(api.carteira.revisar, { chave: fralda.chave, cClassTrib: '200035' }); // contador decidiu: redução de 60%
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  return { t, ana, clienteId };
}

test('vigia: diferença na tabela oficial vira mudança não confirmada; confirmar mostra o impacto; incorporar atualiza a tabela', async () => {
  const { t, ana, clienteId } = await preparar();
  const baixadas: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    baixadas.push(url);
    return new Response(pagina(), { status: 200 });
  });
  const antes = (await ana.query(api.carteira.resumo, {})).clientes[0].exposicao2027;

  const r = await t.action(internal.vigia.verificarDiario, {});
  expect(r).toMatchObject({ status: 'mudou', mudancasCriadas: 1 });
  expect(r.versao).toMatch(/^oficial-\d{4}-\d{2}-\d{2}-[0-9a-f]{8}$/);
  expect(baixadas).toEqual(['https://dfe-portal.svrs.rs.gov.br/DFE/ClassificacaoTributaria']);

  const [m] = await ana.query(api.radar.mudancas, {});
  expect(m).toMatchObject({ origem: 'vigia', ref: r.versao, confirmada: false, afetados: null, fonte: baixadas[0] });
  expect(m.resumo).toMatch(/200035 \(de 60% para 30%\)/);
  expect(m).not.toHaveProperty('efeito'); // a diferença inteira não vai para o navegador
  // Sem confirmação do contador: nada muda na conta e não há impacto.
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await ana.query(api.carteira.resumo, {})).clientes[0].exposicao2027).toBe(antes);
  expect(await ana.query(api.radar.impactos, { mudancaId: m._id })).toEqual([]);

  // Verificar de novo não duplica.
  expect(await t.action(internal.vigia.verificarDiario, {})).toMatchObject({ status: 'sem_mudanca', mudancasCriadas: 0 });
  expect(await ana.query(api.radar.mudancas, {})).toHaveLength(1);
  expect(await ana.query(api.vigia.status, {})).toMatchObject({ status: 'sem_mudanca', versao: r.versao });

  await ana.mutation(api.radar.confirmar, { mudancaId: m._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [impacto] = await ana.query(api.radar.impactos, { mudancaId: m._id });
  expect(impacto.variacaoMensal).toBeGreaterThan(0); // redução menor = cliente paga mais
  expect(impacto.produtosAfetados[0]).toMatchObject({ descricao: 'FRALDA G', de: '200035 (redução 60%)', para: '200035 (redução 30%)' });

  await ana.mutation(api.radar.aplicar, { mudancaId: m._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const resumo = await ana.query(api.carteira.resumo, {});
  expect(resumo.tabela.versao).toMatch(new RegExp(`\\+${r.versao}$`));
  expect(resumo.tabela.exemplo).toBe(false);
  expect(resumo.clientes[0].exposicao2027).toBeGreaterThan(antes);
  const prod = (await ana.query(api.carteira.cliente, { clienteId })).analise!.produtos[0];
  expect(prod.classificacao).toMatchObject({ status: 'revisado', tratamento: { cClassTrib: '200035', reducao: 0.3 } });

  // Tabela do escritório já igual à oficial: a próxima verificação não cria nada.
  expect(await t.action(internal.vigia.verificarDiario, {})).toMatchObject({ status: 'sem_mudanca', mudancasCriadas: 0 });
  expect(await ana.query(api.radar.mudancas, {})).toEqual([]);
});

test('vigia: versão mais nova substitui a pendente; reprocessar refaz sem baixar; demonstração fica de fora', async () => {
  const { t, ana } = await preparar();
  const demo = t.withIdentity({ subject: 'user_demo', email: 'demo@exemplo.test' });
  await demo.mutation(api.conta.criarEscritorio, { nome: 'Escritório de demonstração' });
  await demo.action(api.demo.carregar, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  let reducao = 30;
  let baixadas = 0;
  vi.stubGlobal('fetch', async () => {
    baixadas++;
    return new Response(pagina(reducao), { status: 200 });
  });
  const primeira = await t.action(internal.vigia.verificarDiario, {});
  expect(primeira.mudancasCriadas).toBe(1); // só o escritório real
  expect((await demo.query(api.radar.mudancas, {})).every((m) => m.origem === 'exemplo')).toBe(true);

  reducao = 40;
  const segunda = await t.action(internal.vigia.verificarDiario, {});
  expect(segunda.versao).not.toBe(primeira.versao);
  const pendentes = await ana.query(api.radar.mudancas, {});
  expect(pendentes.map((m) => m.ref)).toEqual([segunda.versao]);
  expect(pendentes[0].resumo).toMatch(/de 60% para 40%/);

  expect(await t.action(internal.vigia.reprocessar, {})).toMatchObject({ status: 'mudou', versao: segunda.versao, mudancasCriadas: 1 });
  expect(baixadas).toBe(2);
  expect(await ana.query(api.radar.mudancas, {})).toHaveLength(1);
  // Mudança já confirmada pelo contador não é trocada pelo reprocessamento.
  const [m] = await ana.query(api.radar.mudancas, {});
  await ana.mutation(api.radar.confirmar, { mudancaId: m._id });
  expect(await t.action(internal.vigia.reprocessar, {})).toMatchObject({ mudancasCriadas: 0 });
  expect((await ana.query(api.radar.mudancas, {}))[0]._id).toBe(m._id);
});

test('vigia: falha da fonte fica registrada e não cria nada; verificar agora exige login e tem intervalo', async () => {
  const { t, ana } = await preparar();
  vi.stubGlobal('fetch', async () => new Response('fora do ar', { status: 503 }));
  expect(await t.action(internal.vigia.verificarDiario, {})).toEqual({ status: 'erro', erro: 'O portal respondeu HTTP 503.', mudancasCriadas: 0 });
  expect(await ana.query(api.vigia.status, {})).toMatchObject({ status: 'erro', erro: 'O portal respondeu HTTP 503.' });
  expect(await ana.query(api.radar.mudancas, {})).toEqual([]);

  vi.stubGlobal('fetch', async () => new Response('<html>sem dados</html>', { status: 200 }));
  await expect(t.action(api.vigia.verificarAgora, {})).rejects.toThrow(/Faça login/);
  await expect(ana.action(api.vigia.verificarAgora, {})).rejects.toThrow(/um minuto/);
  vi.advanceTimersByTime(61_000);
  expect(await ana.action(api.vigia.verificarAgora, {})).toMatchObject({ status: 'erro', erro: expect.stringMatching(/dadosOriginais/) });
});
