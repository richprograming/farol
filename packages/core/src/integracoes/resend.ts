// Envio de e-mails via Resend (https://resend.com/docs/api-reference/emails/send-email).
// Sem RESEND_API_KEY, roda em modo simulação: não envia nada e devolve um id local.
//
// `enviarAviso` é o caminho dos avisos a clientes e mantém o bloqueio: sem `aprovado: true`
// (o clique do contador), não envia.

import type { Aviso } from '../aviso.ts';

export interface ResultadoEnvio {
  id: string;
  simulado: boolean;
}

export interface Email {
  de: string;
  para: string;
  assunto: string;
  texto: string;
  html: string;
  responderPara?: string;
  /** Mesmo envio pedido duas vezes (nova tentativa) não sai duas vezes. */
  idempotencia?: string;
  /** Etiquetas para achar o envio no painel do Resend (só letras, números, _ e -). */
  tags?: Record<string, string>;
}

export interface OpcoesEnvio {
  responderPara?: string;
  idempotencia?: string;
  tags?: Record<string, string>;
  buscar?: typeof fetch; // para testes
}

const REMETENTE_PADRAO = 'Farol <avisos@exemplo.com>';
const soTag = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);

/**
 * Remetente com a marca do escritório: "Contabilidade X via Farol <endereço configurado>".
 * O endereço continua sendo o do domínio verificado no Resend; só o nome exibido muda.
 */
export function remetenteDoEscritorio(escritorio: string, remetenteBase = REMETENTE_PADRAO): string {
  const endereco = /<([^>]+)>/.exec(remetenteBase)?.[1] ?? remetenteBase.trim();
  const nome = escritorio.replace(/["<>\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return nome ? `"${nome} via Farol" <${endereco}>` : remetenteBase;
}

export async function enviarEmail(e: Email, apiKey: string | undefined, buscar: typeof fetch = fetch): Promise<ResultadoEnvio> {
  if (!apiKey) return { id: `simulado-${Date.now()}`, simulado: true };
  const corpo: Record<string, unknown> = { from: e.de, to: [e.para], subject: e.assunto, html: e.html, text: e.texto };
  if (e.responderPara) corpo.reply_to = e.responderPara;
  if (e.tags) corpo.tags = Object.entries(e.tags).map(([name, value]) => ({ name: soTag(name), value: soTag(value) }));
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  if (e.idempotencia) headers['Idempotency-Key'] = e.idempotencia.slice(0, 256);
  const resp = await buscar('https://api.resend.com/emails', { method: 'POST', headers, body: JSON.stringify(corpo) });
  if (!resp.ok) throw new Error(`Resend HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const { id } = (await resp.json()) as { id: string };
  return { id, simulado: false };
}

export async function enviarAviso(
  aviso: Aviso,
  remetente = process.env.FAROL_REMETENTE ?? REMETENTE_PADRAO,
  apiKey = process.env.RESEND_API_KEY,
  opcoes: OpcoesEnvio = {},
): Promise<ResultadoEnvio> {
  if (!aviso.aprovado) throw new Error('Aviso não aprovado pelo contador: envio bloqueado.');
  return enviarEmail({
    de: remetente, para: aviso.para, assunto: aviso.assunto, texto: aviso.texto, html: aviso.html,
    responderPara: opcoes.responderPara, idempotencia: opcoes.idempotencia, tags: opcoes.tags,
  }, apiKey, opcoes.buscar);
}

// ---------------------------------------------------------------------------------------------
// Webhook (entrega, abertura, devolução). O Resend assina com Svix:
// HMAC-SHA256 de "<svix-id>.<svix-timestamp>.<corpo cru>" com o segredo (base64 depois de "whsec_").

export interface CabecalhosSvix {
  id: string | null;
  timestamp: string | null;
  assinatura: string | null;
}

const TOLERANCIA_S = 5 * 60;

function igualSemVazarTempo(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function assinarSvix(segredo: string, id: string, timestamp: string, corpo: string): Promise<string> {
  const bytes = Uint8Array.from(atob(segredo.replace(/^whsec_/, '')), (c) => c.charCodeAt(0));
  const chave = await crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(`${id}.${timestamp}.${corpo}`));
  return btoa(String.fromCharCode(...new Uint8Array(mac)));
}

/** Confere a assinatura do webhook. `corpo` tem de ser o texto cru recebido, sem reformatar. */
export async function webhookResendValido(segredo: string, h: CabecalhosSvix, corpo: string, agoraMs = Date.now()): Promise<boolean> {
  if (!segredo || !h.id || !h.timestamp || !h.assinatura) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(agoraMs / 1000 - ts) > TOLERANCIA_S) return false;
  let esperada: string;
  try {
    esperada = await assinarSvix(segredo, h.id, h.timestamp, corpo);
  } catch {
    return false;
  }
  return h.assinatura.split(' ').some((parte) => {
    const [versao, valor] = parte.split(',');
    return versao === 'v1' && !!valor && igualSemVazarTempo(valor, esperada);
  });
}

export type EventoEmail = 'entregue' | 'aberto' | 'devolvido' | 'spam' | 'falhou';

const TIPOS: Record<string, EventoEmail> = {
  'email.delivered': 'entregue', 'email.opened': 'aberto', 'email.bounced': 'devolvido',
  'email.complained': 'spam', 'email.failed': 'falhou',
};

/** Do corpo do webhook, só o que o Farol usa: o id do e-mail e o que aconteceu. Outros eventos → null. */
export function lerEventoResend(corpo: string): { emailId: string; evento: EventoEmail; em: string } | null {
  try {
    const j = JSON.parse(corpo) as { type?: string; created_at?: string; data?: { email_id?: string } };
    const evento = TIPOS[j.type ?? ''];
    if (!evento || !j.data?.email_id) return null;
    return { emailId: j.data.email_id, evento, em: j.created_at ?? '' };
  } catch {
    return null;
  }
}
