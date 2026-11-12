// Cobrança com AbacatePay, API v2 (https://docs.abacatepay.com).
//
// O preço NÃO está no código: o plano é um produto criado no painel da AbacatePay, e o Farol só
// manda o id dele. O valor exibido ao contador é o que a AbacatePay devolve.
// O pagamento só é dado como feito depois de consultar a API (não basta o webhook dizer).

const BASE = 'https://api.abacatepay.com/v2';

export interface Checkout {
  id: string;
  url: string;
  status: string; // PENDING | EXPIRED | CANCELLED | PAID | REFUNDED | REDEEMED
  valorCentavos: number;
  externalId?: string;
  devMode: boolean;
}

interface Resposta {
  data?: { id?: string; url?: string; status?: string; amount?: number; externalId?: string | null; devMode?: boolean } | null;
  error?: unknown;
}

async function chamar(chave: string, caminho: string, init: RequestInit, buscar: typeof fetch): Promise<Checkout> {
  const resp = await buscar(`${BASE}${caminho}`, {
    ...init, headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json' },
  });
  let corpo: Resposta = {};
  try {
    corpo = (await resp.json()) as Resposta;
  } catch { /* corpo vazio ou não JSON: tratado abaixo */ }
  const d = corpo.data;
  if (!resp.ok || !d?.id || !d.status) {
    const motivo = typeof corpo.error === 'string' ? corpo.error : `HTTP ${resp.status}`;
    throw new Error(`AbacatePay: ${motivo}`.slice(0, 300));
  }
  return { id: d.id, url: d.url ?? '', status: d.status, valorCentavos: d.amount ?? 0, externalId: d.externalId ?? undefined, devMode: d.devMode === true };
}

export interface PedidoCheckout {
  chave: string;
  produtoId: string; // produto (plano) criado no painel da AbacatePay
  externalId: string;
  returnUrl: string;
  completionUrl: string;
  buscar?: typeof fetch;
}

export function criarCheckout(p: PedidoCheckout): Promise<Checkout> {
  return chamar(p.chave, '/checkouts/create', {
    method: 'POST',
    body: JSON.stringify({
      items: [{ id: p.produtoId, quantity: 1 }], externalId: p.externalId, returnUrl: p.returnUrl, completionUrl: p.completionUrl,
    }),
  }, p.buscar ?? fetch);
}

export function consultarCheckout(chave: string, id: string, buscar: typeof fetch = fetch): Promise<Checkout> {
  return chamar(chave, `/checkouts/get?id=${encodeURIComponent(id)}`, { method: 'GET' }, buscar);
}

/** Comparação do segredo do webhook em tempo constante. */
export function segredoConfere(recebido: string | null | undefined, esperado: string | undefined): boolean {
  if (!recebido || !esperado || recebido.length !== esperado.length) return false;
  let d = 0;
  for (let i = 0; i < esperado.length; i++) d |= recebido.charCodeAt(i) ^ esperado.charCodeAt(i);
  return d === 0;
}

/** Do corpo do webhook, só o id do checkout pago. Qualquer outro evento → null. */
export function checkoutPagoDoWebhook(corpo: string): string | null {
  try {
    const j = JSON.parse(corpo) as { event?: string; data?: { checkout?: { id?: string } } };
    return j.event === 'checkout.completed' && typeof j.data?.checkout?.id === 'string' ? j.data.checkout.id : null;
  } catch {
    return null;
  }
}
