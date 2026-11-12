import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resumoDiario } from '../src/aviso.ts';
import { checkoutPagoDoWebhook, consultarCheckout, criarCheckout, segredoConfere } from '../src/integracoes/abacatepay.ts';
import {
  assinarSvix, enviarAviso, enviarEmail, lerEventoResend, remetenteDoEscritorio, webhookResendValido,
} from '../src/integracoes/resend.ts';

const AVISO = { clienteCnpj: '1', para: 'cliente@exemplo.com', assunto: 'Assunto', texto: 'Texto', html: '<p>Texto</p>', aprovado: true };

test('resend: remetente leva o nome do escritório e mantém o endereço configurado', () => {
  assert.equal(remetenteDoEscritorio('Contabilidade "Ana" <x>', 'Farol <avisos@farol.exemplo>'), '"Contabilidade Ana x via Farol" <avisos@farol.exemplo>');
  assert.equal(remetenteDoEscritorio('', 'Farol <avisos@farol.exemplo>'), 'Farol <avisos@farol.exemplo>');
  assert.equal(remetenteDoEscritorio('Ana', 'avisos@farol.exemplo'), '"Ana via Farol" <avisos@farol.exemplo>');
});

test('resend: envio leva responder-para, chave de idempotência e etiquetas; sem aprovação não sai', async () => {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const buscar: typeof fetch = async (url, init) => {
    pedidos.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
  };
  const opcoes = { responderPara: 'ana@contabil.exemplo', idempotencia: 'farol-envio-1', tags: { tipo: 'aviso', envio: 'a;b' }, buscar };
  await assert.rejects(() => enviarAviso({ ...AVISO, aprovado: false }, 'x', 're_teste', opcoes), /não aprovado/);
  assert.equal(pedidos.length, 0);

  assert.deepEqual(await enviarAviso(AVISO, 'Farol <a@b.c>', 're_teste', opcoes), { id: 'email_1', simulado: false });
  const [{ url, init }] = pedidos;
  assert.equal(url, 'https://api.resend.com/emails');
  const h = init.headers as Record<string, string>;
  assert.equal(h.Authorization, 'Bearer re_teste');
  assert.equal(h['Idempotency-Key'], 'farol-envio-1');
  assert.deepEqual(JSON.parse(String(init.body)), {
    from: 'Farol <a@b.c>', to: ['cliente@exemplo.com'], subject: 'Assunto', html: '<p>Texto</p>', text: 'Texto',
    reply_to: 'ana@contabil.exemplo', tags: [{ name: 'tipo', value: 'aviso' }, { name: 'envio', value: 'a_b' }],
  });

  assert.equal((await enviarEmail({ de: 'a', para: 'b', assunto: 'c', texto: 'd', html: 'e' }, undefined, buscar)).simulado, true);
  await assert.rejects(() => enviarEmail({ de: 'a', para: 'b', assunto: 'c', texto: 'd', html: 'e' }, 're_x',
    async () => new Response('domínio não verificado', { status: 403 })), /Resend HTTP 403/);
});

test('resend: webhook só vale com assinatura certa, sobre o corpo cru e dentro do prazo', async () => {
  const segredo = `whsec_${btoa('segredo-de-teste-com-32-caracteres')}`;
  const corpo = JSON.stringify({ type: 'email.delivered', created_at: '2026-11-12T10:00:00Z', data: { email_id: 'email_1', to: ['x@y.z'] } });
  const agora = 1_800_000_000_000;
  const ts = String(agora / 1000);
  const assinatura = `v1,${await assinarSvix(segredo, 'msg_1', ts, corpo)}`;
  const h = { id: 'msg_1', timestamp: ts, assinatura };

  assert.equal(await webhookResendValido(segredo, h, corpo, agora), true);
  assert.equal(await webhookResendValido(segredo, { ...h, assinatura: `v1,invalida ${assinatura}` }, corpo, agora), true, 'aceita várias assinaturas');
  assert.equal(await webhookResendValido(segredo, h, corpo.replace('email_1', 'email_2'), agora), false, 'corpo alterado');
  assert.equal(await webhookResendValido(segredo, { ...h, id: 'msg_2' }, corpo, agora), false);
  assert.equal(await webhookResendValido(`whsec_${btoa('outro-segredo')}`, h, corpo, agora), false);
  assert.equal(await webhookResendValido(segredo, h, corpo, agora + 6 * 60_000), false, 'fora do prazo');
  assert.equal(await webhookResendValido(segredo, { ...h, assinatura: null }, corpo, agora), false);
  assert.equal(await webhookResendValido('', h, corpo, agora), false);

  assert.deepEqual(lerEventoResend(corpo), { emailId: 'email_1', evento: 'entregue', em: '2026-11-12T10:00:00Z' });
  assert.equal(lerEventoResend(JSON.stringify({ type: 'email.opened', data: { email_id: 'e' } }))?.evento, 'aberto');
  assert.equal(lerEventoResend(JSON.stringify({ type: 'email.bounced', data: { email_id: 'e' } }))?.evento, 'devolvido');
  assert.equal(lerEventoResend(JSON.stringify({ type: 'email.sent', data: { email_id: 'e' } })), null);
  assert.equal(lerEventoResend('não é json'), null);
});

test('resumo diário: só contagens; sem pendência não há e-mail', () => {
  assert.equal(resumoDiario('Contabilidade Ana', { mudancasParaConferir: [], produtosParaRevisar: 0, clientesComRevisao: 0, avisosComProblema: 0 }), null);
  const r = resumoDiario('Contabilidade Ana', { mudancasParaConferir: ['Tabela oficial atualizada'], produtosParaRevisar: 7, clientesComRevisao: 2, avisosComProblema: 1 }, 'https://farol.exemplo')!;
  assert.match(r.assunto, /Contabilidade Ana/);
  assert.match(r.texto, /1 mudança\(s\) no Radar/);
  assert.match(r.texto, /- Tabela oficial atualizada/);
  assert.match(r.texto, /7 produto\(s\) para classificar, em 2 cliente\(s\)/);
  assert.match(r.texto, /1 aviso\(s\) a clientes com problema/);
  assert.match(r.texto, /https:\/\/farol\.exemplo/);
  assert.ok(r.texto.split('\n').length > 5);
});

test('abacatepay: cria e consulta checkout na API v2; erro vem com o motivo', async () => {
  const pedidos: { url: string; init: RequestInit }[] = [];
  const resposta = (status: string) => ({ data: { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1', status, amount: 9900, externalId: 'farol-1', devMode: true }, success: true, error: null });
  const buscar: typeof fetch = async (url, init) => {
    pedidos.push({ url: String(url), init: init! });
    return new Response(JSON.stringify(resposta(String(url).includes('/get') ? 'PAID' : 'PENDING')), { status: 200 });
  };
  const k = await criarCheckout({ chave: 'abc_dev_x', produtoId: 'prod_1', externalId: 'farol-1', returnUrl: 'https://f/plano', completionUrl: 'https://f/plano?pago=1', buscar });
  assert.deepEqual(k, { id: 'bill_1', url: 'https://app.abacatepay.com/pay/bill_1', status: 'PENDING', valorCentavos: 9900, externalId: 'farol-1', devMode: true });
  assert.equal(pedidos[0].url, 'https://api.abacatepay.com/v2/checkouts/create');
  assert.equal((pedidos[0].init.headers as Record<string, string>).Authorization, 'Bearer abc_dev_x');
  assert.deepEqual(JSON.parse(String(pedidos[0].init.body)), {
    items: [{ id: 'prod_1', quantity: 1 }], externalId: 'farol-1', returnUrl: 'https://f/plano', completionUrl: 'https://f/plano?pago=1',
  });

  assert.equal((await consultarCheckout('abc_dev_x', 'bill_1', buscar)).status, 'PAID');
  assert.equal(pedidos[1].url, 'https://api.abacatepay.com/v2/checkouts/get?id=bill_1');

  await assert.rejects(() => consultarCheckout('k', 'bill_9', async () => new Response(JSON.stringify({ error: 'Billing not found' }), { status: 404 })), /AbacatePay: Billing not found/);
  await assert.rejects(() => consultarCheckout('k', 'bill_9', async () => new Response('', { status: 500 })), /AbacatePay: HTTP 500/);
});

test('abacatepay: webhook — segredo em tempo constante e só o evento de checkout pago', () => {
  assert.equal(segredoConfere('s'.repeat(32), 's'.repeat(32)), true);
  assert.equal(segredoConfere('s'.repeat(31) + 'x', 's'.repeat(32)), false);
  assert.equal(segredoConfere('', ''), false);
  assert.equal(segredoConfere(null, 's'), false);
  assert.equal(segredoConfere('s', undefined), false);
  assert.equal(checkoutPagoDoWebhook(JSON.stringify({ event: 'checkout.completed', data: { checkout: { id: 'bill_1', status: 'PAID' } } })), 'bill_1');
  assert.equal(checkoutPagoDoWebhook(JSON.stringify({ event: 'checkout.refunded', data: { checkout: { id: 'bill_1' } } })), null);
  assert.equal(checkoutPagoDoWebhook('{'), null);
});
