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
