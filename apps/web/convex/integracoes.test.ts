/// <reference types="vite/client" />
// Resend (remetente do escritório, webhook de entrega, resumo diário) e AbacatePay (checkout e confirmação).
// Todos os serviços externos são simulados aqui.

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { assinarSvix } from '@farol/core/integracoes/resend';

import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');
const CNPJ = '22222222000102';
const ANA = { subject: 'user_ana', email: 'ana@contabil.exemplo', name: 'Ana' };
const BETO = { subject: 'user_beto', email: 'beto@outro.exemplo' };
const SEGREDO_RESEND = `whsec_${btoa('segredo-de-teste-com-32-caracteres')}`;
const SEGREDO_ABACATE = 'segredo-do-webhook-abacatepay-de-teste-0001';

function xml(chave: string, ncm: string, desc: string) {
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave.repeat(44)}"><ide><mod>65</mod><nNF>1</nNF>` +
    `<dhEmi>2026-09-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>${CNPJ}</CNPJ><xNome>FARMACIA TESTE (SINTETICO)</xNome><CRT>3</CRT></emit>` +
    `<det nItem="1"><prod><cProd>1</cProd><xProd>${desc}</xProd><NCM>${ncm}</NCM><CFOP>5102</CFOP><qCom>1</qCom><vProd>500.00</vProd></prod>` +
    `<imposto><ICMS><ICMS00><vICMS>90.00</vICMS></ICMS00></ICMS><PIS><PISAliq><vPIS>3.25</vPIS></PISAliq></PIS>` +
    `<COFINS><COFINSAliq><vCOFINS>15.00</vCOFINS></COFINSAliq></COFINS></imposto></det>` +
    `<total><ICMSTot><vNF>500.00</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/** Escritório em demonstração com a mudança fictícia das fraldas confirmada e um cliente afetado. */
async function comImpacto() {
  const t = convexTest(schema, modules);
  const ana = t.withIdentity(ANA);
  const escritorioId = await ana.mutation(api.conta.criarEscritorio, { nome: 'Contabilidade da Ana' });
  await t.mutation(internal.demo.prepararDemo, { escritorioId });
  await t.action(internal.notas.importarInterno, { escritorioId, xmls: [{ nome: 'a.xml', conteudo: xml('1', '96190000', 'FRALDA G') }], sintetico: true });
  await t.mutation(internal.demo.criarMudancasExemplo, { escritorioId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const fraldas = (await ana.query(api.radar.mudancas, {})).find((m) => m.ref === 'exemplo-fraldas')!;
  await ana.mutation(api.radar.confirmar, { mudancaId: fraldas._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [impacto] = await ana.query(api.radar.impactos, { mudancaId: fraldas._id });
  return { t, ana, fraldas, impacto, escritorioId };
}

async function webhookResend(t: ReturnType<typeof convexTest>, tipo: string, emailId: string, segredo = SEGREDO_RESEND) {
  const corpo = JSON.stringify({ type: tipo, created_at: new Date().toISOString(), data: { email_id: emailId, to: ['cliente@exemplo.com'] } });
  const ts = String(Math.floor(Date.now() / 1000));
  return t.fetch('/resend/webhook', {
    method: 'POST', body: corpo,
    headers: { 'svix-id': 'msg_1', 'svix-timestamp': ts, 'svix-signature': `v1,${await assinarSvix(segredo, 'msg_1', ts, corpo)}` },
  });
}

test('resend: aviso aprovado sai com o nome do escritório e resposta para quem aprovou; webhook marca entrega e abertura', async () => {
  const { t, ana, fraldas, impacto } = await comImpacto();
  expect((await webhookResend(t, 'email.delivered', 'email_1')).status).toBe(503); // webhook sem segredo configurado

  vi.stubEnv('RESEND_API_KEY', 're_teste');
  vi.stubEnv('FAROL_REMETENTE', 'Farol <avisos@farol.exemplo>');
  vi.stubEnv('RESEND_WEBHOOK_SECRET', SEGREDO_RESEND);
  const enviados: { headers: Record<string, string>; corpo: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    enviados.push({ headers: init.headers as Record<string, string>, corpo: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  });

  const envioId = await ana.mutation(api.radar.aprovarEnvio, {
    mudancaId: fraldas._id, clienteId: impacto.clienteId, para: 'cliente@exemplo.com', assunto: impacto.aviso.assunto, texto: impacto.aviso.texto,
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(enviados).toHaveLength(1);
  expect(enviados[0].corpo).toMatchObject({
    from: '"Contabilidade da Ana via Farol" <avisos@farol.exemplo>', to: ['cliente@exemplo.com'], reply_to: 'ana@contabil.exemplo',
  });
  expect(enviados[0].headers['Idempotency-Key']).toBe(`farol-envio-${envioId}`);
  const envio = async () => (await ana.query(api.radar.impactos, { mudancaId: fraldas._id }))[0].envio!;
  expect(await envio()).toMatchObject({ status: 'enviado', resendId: 'email_1' });
  expect((await envio()).entregueEm).toBeUndefined();

  expect((await webhookResend(t, 'email.delivered', 'email_1', `whsec_${btoa('segredo-errado')}`)).status).toBe(401);
  expect((await envio()).entregueEm).toBeUndefined();
  expect((await webhookResend(t, 'email.delivered', 'email_1')).status).toBe(204);
  expect((await envio()).entregueEm).toBeTypeOf('number');
  expect((await webhookResend(t, 'email.opened', 'email_1')).status).toBe(204);
  expect((await envio()).abertoEm).toBeTypeOf('number');
  expect((await webhookResend(t, 'email.bounced', 'email_de_outro_sistema')).status).toBe(204); // id desconhecido: ignorado
  expect((await envio()).problemaEntrega).toBeUndefined();
  expect((await webhookResend(t, 'email.complained', 'email_1')).status).toBe(204);
  expect((await envio()).problemaEntrega).toBe('spam');
});

test('resumo diário: só com Resend configurado, só para escritório com pendência real, uma vez por dia', async () => {
  const t = convexTest(schema, modules);
  const ana = t.withIdentity(ANA);
  await ana.mutation(api.conta.criarEscritorio, { nome: 'Contabilidade da Ana' });
  await ana.action(api.notas.importar, { xmls: [{ nome: 'a.xml', conteudo: xml('1', '96190000', 'FRALDA G').replace(' (SINTETICO)', '') }] });
  await t.withIdentity(BETO).mutation(api.conta.criarEscritorio, { nome: 'Escritório do Beto' }); // sem pendências
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  const enviados: { headers: Record<string, string>; corpo: { to: string[]; subject: string; text: string } }[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    enviados.push({ headers: init.headers as Record<string, string>, corpo: JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string } });
    return new Response(JSON.stringify({ id: 'email_r' }), { status: 200 });
  });
  expect(await t.action(internal.resumo.enviarDiario, { dia: '2026-11-12' })).toEqual({ enviados: 0, semPendencia: 0, falhas: 0 });
  expect(enviados).toHaveLength(0);

  vi.stubEnv('RESEND_API_KEY', 're_teste');
  expect(await t.action(internal.resumo.enviarDiario, { dia: '2026-11-12' })).toEqual({ enviados: 1, semPendencia: 1, falhas: 0 });
  expect(enviados[0].corpo.to).toEqual(['ana@contabil.exemplo']);
  expect(enviados[0].corpo.text).toMatch(/1 produto\(s\) para classificar, em 1 cliente\(s\)/);
  expect(enviados[0].corpo.text).not.toMatch(/FRALDA|22222222000102/); // só contagens
  expect(enviados[0].headers['Idempotency-Key']).toBe('farol-resumo-2026-11-12-ana@contabil.exemplo');
});

test('abacatepay: checkout registrado como pendente; só vira pago depois de confirmado na API; webhook exige o segredo', async () => {
  const t = convexTest(schema, modules);
  const ana = t.withIdentity(ANA);
  await ana.mutation(api.conta.criarEscritorio, { nome: 'Contabilidade da Ana' });
  const beto = t.withIdentity(BETO);
  await beto.mutation(api.conta.criarEscritorio, { nome: 'Escritório do Beto' });

  expect(await ana.query(api.plano.atual, {})).toEqual({ configurado: false, paga: null, pendente: null });
  await expect(ana.action(api.plano.assinar, { origem: 'http://localhost:3000' })).rejects.toThrow(/não está configurada/);
  await expect(t.action(api.plano.assinar, { origem: 'http://localhost:3000' })).rejects.toThrow(/Faça login/);

  vi.stubEnv('ABACATEPAY_API_KEY', 'abc_dev_teste');
  vi.stubEnv('ABACATEPAY_PRODUTO_ID', 'prod_plano');
  vi.stubEnv('ABACATEPAY_WEBHOOK_SECRET', SEGREDO_ABACATE);
  let statusNaApi = 'PENDING';
  const chamadas: string[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    chamadas.push(`${init.method} ${url}`);
    return new Response(JSON.stringify({
      data: { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1', status: statusNaApi, amount: 9900, devMode: true }, success: true, error: null,
    }), { status: 200 });
  });

  await expect(ana.action(api.plano.assinar, { origem: 'javascript:alert(1)' })).rejects.toThrow(/inválido/);
  expect(await ana.action(api.plano.assinar, { origem: 'http://localhost:3000' })).toEqual({ url: 'https://app.abacatepay.com/pay/bill_1' });
  expect(chamadas).toEqual(['POST https://api.abacatepay.com/v2/checkouts/create']);
  expect(await ana.query(api.plano.atual, {})).toMatchObject({ configurado: true, paga: null, pendente: { valorCentavos: 9900, teste: true } });
  expect(await beto.query(api.plano.atual, {})).toMatchObject({ paga: null, pendente: null }); // isolado por escritório

  const corpo = JSON.stringify({ id: 'log_1', event: 'checkout.completed', apiVersion: 2, devMode: true, data: { checkout: { id: 'bill_1', status: 'PAID' } } });
  expect((await t.fetch('/abacatepay/webhook', { method: 'POST', body: corpo })).status).toBe(401);
  expect((await t.fetch('/abacatepay/webhook?webhookSecret=errado', { method: 'POST', body: corpo })).status).toBe(401);

  // Webhook legítimo, mas a API ainda diz PENDING: não vira pago só porque o webhook disse.
  expect((await t.fetch(`/abacatepay/webhook?webhookSecret=${SEGREDO_ABACATE}`, { method: 'POST', body: corpo })).status).toBe(204);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect((await ana.query(api.plano.atual, {})).paga).toBeNull();
  expect(await ana.action(api.plano.conferir, {})).toBe(false);

  statusNaApi = 'PAID';
  expect((await t.fetch('/abacatepay/webhook', { method: 'POST', body: corpo, headers: { 'X-Webhook-Secret': SEGREDO_ABACATE } })).status).toBe(204);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(await ana.query(api.plano.atual, {})).toMatchObject({ paga: { valorCentavos: 9900, teste: true }, pendente: null });
  await expect(ana.action(api.plano.assinar, { origem: 'http://localhost:3000' })).rejects.toThrow(/já está pago/);

  // Checkout que o Farol não abriu é ignorado, sem nem consultar a API.
  const antes = chamadas.length;
  const alheio = corpo.replace(/bill_1/g, 'bill_alheio');
  expect((await t.fetch(`/abacatepay/webhook?webhookSecret=${SEGREDO_ABACATE}`, { method: 'POST', body: alheio })).status).toBe(204);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(chamadas.length).toBe(antes);
});
