// Envio de avisos aprovados via Resend (https://resend.com/docs/api-reference/emails/send-email).
// Sem RESEND_API_KEY, roda em modo simulação: não envia nada e devolve um id local.

import type { Aviso } from '../core/aviso.ts';

export interface ResultadoEnvio {
  id: string;
  simulado: boolean;
}

export async function enviarAviso(
  aviso: Aviso,
  remetente = process.env.FAROL_REMETENTE ?? 'Farol <avisos@exemplo.com>',
  apiKey = process.env.RESEND_API_KEY,
): Promise<ResultadoEnvio> {
  if (!aviso.aprovado) throw new Error('Aviso não aprovado pelo contador: envio bloqueado.');
  if (!apiKey) return { id: `simulado-${Date.now()}`, simulado: true };
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: remetente, to: [aviso.para], subject: aviso.assunto, html: aviso.html, text: aviso.texto }),
  });
  if (!resp.ok) throw new Error(`Resend HTTP ${resp.status}: ${await resp.text()}`);
  const { id } = (await resp.json()) as { id: string };
  return { id, simulado: false };
}
