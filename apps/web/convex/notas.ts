// Entrada de XMLs de NF-e/NFC-e.
//
// A action lê cada XML com o core (que já mascara CPF), descarta o XML e grava só os
// itens normalizados. Erros voltam por arquivo, só com a mensagem: o conteúdo do XML
// nunca vai para log nem para o banco.

import { ConvexError, v } from 'convex/values';
import { lerNota, NotaInvalidaError, type NotaFiscal } from '@farol/core';

import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { action, internalMutation } from './_generated/server';
import { agendarCliente } from './motor';
import { vNota, vRegime } from './schema';

/** Limite por chamada; a interface manda os arquivos em lotes abaixo disso. */
export const LIMITE_LOTE_BYTES = 6 * 1024 * 1024;

export interface ResultadoImportacao {
  cnpj: string | null;
  clienteId: Id<'clientes'> | null;
  lidas: number;
  novas: number;
  duplicadas: number;
  erros: { arquivo: string; erro: string }[];
}

const somenteDigitos = (s: string) => s.replace(/\D/g, '');

/**
 * O cliente é o CNPJ que aparece em mais notas do lote: como emitente das vendas ou como
 * destinatário das compras. (Contar só emitentes elegeria o fornecedor quando o lote tem
 * mais compras que vendas.) Empate = não dá para saber: devolve null em vez de chutar.
 */
export function identificarCliente(notas: NotaFiscal[]): string | null {
  const contagem = new Map<string, number>();
  const somar = (cnpj: string) => contagem.set(cnpj, (contagem.get(cnpj) ?? 0) + 1);
  for (const n of notas) {
    if (n.tipo === 'saida') somar(n.emitente.cnpj);
    if (n.destinatario && !n.destinatario.pessoaFisica) somar(n.destinatario.documento);
  }
  const [primeiro, segundo] = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
  if (!primeiro || (segundo && segundo[1] === primeiro[1])) return null;
  return primeiro[0];
}

export const importar = action({
  args: {
    xmls: v.array(v.object({ nome: v.string(), conteudo: v.string() })),
    cnpj: v.optional(v.string()), // lotes seguintes do mesmo envio já sabem o cliente
    email: v.optional(v.string()),
    nome: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ResultadoImportacao> => {
    const escritorioId = await ctx.runQuery(internal.escritorio.atualId, {});
    const tamanho = args.xmls.reduce((s, x) => s + x.conteudo.length, 0);
    if (tamanho > LIMITE_LOTE_BYTES) throw new ConvexError('Lote grande demais: envie em partes menores.');

    const erros: ResultadoImportacao['erros'] = [];
    const lidas: { arquivo: string; nota: NotaFiscal }[] = [];
    for (const x of args.xmls) {
      try {
        lidas.push({ arquivo: x.nome, nota: lerNota(x.conteudo) });
      } catch (e) {
        erros.push({ arquivo: x.nome, erro: e instanceof NotaInvalidaError ? e.message : 'Falha ao ler o arquivo.' });
      }
    }

    const cnpj = args.cnpj ? somenteDigitos(args.cnpj) : identificarCliente(lidas.map((l) => l.nota));
    if (!cnpj) {
      if (lidas.length) erros.push({ arquivo: '(lote)', erro: 'Não deu para identificar o cliente por estas notas. Envie também notas de venda dele.' });
      return { cnpj: null, clienteId: null, lidas: 0, novas: 0, duplicadas: 0, erros };
    }

    const doCliente: NotaFiscal[] = [];
    for (const { arquivo, nota } of lidas) {
      const envolve = nota.emitente.cnpj === cnpj || nota.destinatario?.documento === cnpj;
      if (envolve) doCliente.push(nota);
      else erros.push({ arquivo, erro: `A nota não tem o CNPJ ${cnpj} como emitente nem como destinatário.` });
    }
    if (doCliente.length === 0) return { cnpj, clienteId: null, lidas: 0, novas: 0, duplicadas: 0, erros };

    const venda = doCliente.find((n) => n.emitente.cnpj === cnpj);
    const r = await ctx.runMutation(internal.notas.gravar, {
      escritorioId, cnpj,
      nome: args.nome?.trim() || venda?.emitente.nome || cnpj,
      regime: venda?.emitente.regime ?? 'desconhecido',
      email: args.email?.trim() ?? '',
      notas: doCliente,
    });
    return { cnpj, clienteId: r.clienteId, lidas: doCliente.length, novas: r.novas, duplicadas: r.duplicadas, erros };
  },
});

export const gravar = internalMutation({
  args: {
    escritorioId: v.id('escritorios'),
    cnpj: v.string(),
    nome: v.string(),
    regime: vRegime,
    email: v.string(),
    notas: v.array(vNota),
  },
  handler: async (ctx, a) => {
    let cliente = await ctx.db.query('clientes')
      .withIndex('by_escritorio_cnpj', (q) => q.eq('escritorioId', a.escritorioId).eq('cnpj', a.cnpj)).unique();
    if (!cliente) {
      const id = await ctx.db.insert('clientes', {
        escritorioId: a.escritorioId, cnpj: a.cnpj, nome: a.nome, regime: a.regime, email: a.email,
        sintetico: a.nome.includes('(SINTETICO)'),
      });
      cliente = (await ctx.db.get(id))!;
    } else if (a.email && !cliente.email) {
      await ctx.db.patch(cliente._id, { email: a.email });
    }

    let novas = 0;
    let duplicadas = 0;
    const vistas = new Set<string>();
    for (const n of a.notas) {
      const repetida = vistas.has(n.chave) || (await ctx.db.query('notas')
        .withIndex('by_cliente_chave', (q) => q.eq('clienteId', cliente._id).eq('chave', n.chave)).first()) !== null;
      vistas.add(n.chave);
      if (repetida) {
        duplicadas++;
        continue;
      }
      await ctx.db.insert('notas', { ...n, escritorioId: a.escritorioId, clienteId: cliente._id });
      novas++;
    }
    if (novas > 0) await agendarCliente(ctx, cliente._id);
    return { clienteId: cliente._id, novas, duplicadas };
  },
});

