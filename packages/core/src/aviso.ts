// Rascunho do aviso ao cliente (Comunicador).
//
// Versão por modelo de texto: números já calculados pelo motor, linguagem simples.
// Uma versão com LLM pode reescrever o texto, mas recebe estes mesmos números e
// não pode trocá-los. Nada é enviado sem `aprovado: true`, marcado pelo contador.

import type { ClienteAfetado, Mudanca } from './mudancas.ts';

export interface Aviso {
  clienteCnpj: string;
  para: string;
  assunto: string;
  texto: string;
  html: string;
  aprovado: boolean;
}

export interface PendenciasDoDia {
  mudancasParaConferir: string[]; // títulos das mudanças do Radar ainda sem confirmação
  produtosParaRevisar: number;
  clientesComRevisao: number;
  avisosComProblema: number; // envio falhou, voltou ou foi marcado como spam
}

/** Resumo diário para o contador. Só contagens; devolve null quando não há nada pendente. */
export function resumoDiario(escritorio: string, p: PendenciasDoDia, urlApp?: string): { assunto: string; texto: string; html: string } | null {
  const linhas: string[] = [];
  if (p.mudancasParaConferir.length) {
    linhas.push(`${p.mudancasParaConferir.length} mudança(s) no Radar esperando a sua conferência:`);
    linhas.push(...p.mudancasParaConferir.slice(0, 5).map((t) => `- ${t}`));
    if (p.mudancasParaConferir.length > 5) linhas.push(`- e mais ${p.mudancasParaConferir.length - 5}`);
  }
  if (p.produtosParaRevisar) linhas.push(`${p.produtosParaRevisar} produto(s) para classificar, em ${p.clientesComRevisao} cliente(s).`);
  if (p.avisosComProblema) linhas.push(`${p.avisosComProblema} aviso(s) a clientes com problema de envio ou entrega.`);
  if (linhas.length === 0) return null;
  const texto = [`Olá,`, ``, `Pendências de hoje em ${escritorio}:`, ``, ...linhas, ``,
    ...(urlApp ? [`Abrir o Farol: ${urlApp}`, ``] : []), `Farol`].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">` +
    texto.split('\n').map((l) => (l ? `<p style="margin:0 0 8px">${escapar(l)}</p>` : '')).join('') + `</div>`;
  return { assunto: `Farol: pendências de ${escritorio}`, texto, html };
}

const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const escapar = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function rascunharAviso(
  escritorio: string,
  afetado: ClienteAfetado,
  mudanca: Mudanca,
  emailCliente: string,
): Aviso {
  const sobe = afetado.variacaoMensal > 0;
  const efeito = afetado.variacaoMensal === 0
    ? 'não muda o valor estimado dos seus tributos'
    : `${sobe ? 'aumenta' : 'reduz'} a estimativa dos seus tributos em cerca de ${brl(Math.abs(afetado.variacaoMensal))} por mês a partir de 2027`;
  const produtos = afetado.produtosAfetados.slice(0, 5)
    .map((p) => `- ${p.descricao} (NCM ${p.ncm}): ${p.de} → ${p.para}`)
    .join('\n');
  const assunto = `Reforma tributária: mudança que afeta ${afetado.nome}`;
  const texto = [
    `Olá,`,
    ``,
    `Uma norma publicada em ${mudanca.publicadaEm.split('-').reverse().join('/')} ${efeito}.`,
    ``,
    `O que mudou: ${mudanca.resumo}`,
    ``,
    `Produtos seus afetados:`,
    produtos,
    ``,
    `Estimativa feita com as notas fiscais do período enviado e com alíquotas de referência ainda provisórias. ` +
      `Vamos conversar sobre preço e cadastro desses itens antes da virada.`,
    ``,
    `Fonte: ${mudanca.fonte}`,
    ``,
    escritorio,
  ].join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1a1a1a">` +
    texto.split('\n').map((l) => (l ? `<p style="margin:0 0 8px">${escapar(l)}</p>` : '')).join('') + `</div>`;
  return { clienteCnpj: afetado.cnpj, para: emailCliente, assunto, texto, html, aprovado: false };
}
