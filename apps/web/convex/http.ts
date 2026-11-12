// Entradas HTTP do Convex: webhooks do Resend e da AbacatePay.
//
// Os dois conferem a origem antes de qualquer leitura do corpo como dado, e nenhum grava o
// corpo recebido: do Resend sai só (id do e-mail, evento); da AbacatePay, só o id do checkout,
// que depois é confirmado direto na API.

import { httpRouter } from 'convex/server';
import { checkoutPagoDoWebhook, segredoConfere } from '@farol/core/integracoes/abacatepay';
import { lerEventoResend, webhookResendValido } from '@farol/core/integracoes/resend';

import { internal } from './_generated/api';
import { httpAction } from './_generated/server';

const http = httpRouter();

http.route({
  path: '/resend/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const segredo = process.env.RESEND_WEBHOOK_SECRET;
    if (!segredo) return new Response('Webhook do Resend não configurado.', { status: 503 });
    const corpo = await req.text();
    const valido = await webhookResendValido(segredo, {
      id: req.headers.get('svix-id'), timestamp: req.headers.get('svix-timestamp'), assinatura: req.headers.get('svix-signature'),
    }, corpo);
    if (!valido) return new Response('Assinatura inválida.', { status: 401 });
    const evento = lerEventoResend(corpo);
    if (evento) await ctx.runMutation(internal.radar.registrarEvento, { resendId: evento.emailId, evento: evento.evento });
    return new Response(null, { status: 204 });
  }),
});

http.route({
  path: '/abacatepay/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const segredo = process.env.ABACATEPAY_WEBHOOK_SECRET;
    if (!segredo) return new Response('Webhook da AbacatePay não configurado.', { status: 503 });
    const recebido = req.headers.get('x-webhook-secret') ?? new URL(req.url).searchParams.get('webhookSecret');
    if (!segredoConfere(recebido, segredo)) return new Response('Segredo inválido.', { status: 401 });
    const checkoutId = checkoutPagoDoWebhook(await req.text());
    // O webhook só avisa; quem diz que está pago é a consulta à API (plano.confirmar).
    if (checkoutId) await ctx.scheduler.runAfter(0, internal.plano.confirmar, { checkoutId });
    return new Response(null, { status: 204 });
  }),
});

export default http;
