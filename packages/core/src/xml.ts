// Parser XML mínimo, sem dependências, suficiente para NF-e (UTF-8, sem DTD).
// Ignora declaração, comentários e instruções de processamento; trata CDATA e entidades básicas.

export interface XmlNode {
  name: string; // nome local, sem prefixo de namespace
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodificar(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10));
    return ENTIDADES[e] ?? m;
  });
}

function nomeLocal(n: string): string {
  const i = n.indexOf(':');
  return i >= 0 ? n.slice(i + 1) : n;
}

export class XmlError extends Error {}

export function parseXml(fonte: string): XmlNode {
  const s = fonte.replace(/^﻿/, '');
  const raiz: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const pilha: XmlNode[] = [raiz];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const atual = pilha[pilha.length - 1];
    if (lt < 0) {
      atual.text += decodificar(s.slice(i));
      break;
    }
    if (lt > i) atual.text += decodificar(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) {
      const fim = s.indexOf('-->', lt);
      if (fim < 0) throw new XmlError('Comentário não fechado');
      i = fim + 3;
    } else if (s.startsWith('<![CDATA[', lt)) {
      const fim = s.indexOf(']]>', lt);
      if (fim < 0) throw new XmlError('CDATA não fechado');
      atual.text += s.slice(lt + 9, fim);
      i = fim + 3;
    } else if (s.startsWith('<?', lt) || s.startsWith('<!', lt)) {
      const fim = s.indexOf('>', lt);
      if (fim < 0) throw new XmlError('Declaração não fechada');
      i = fim + 1;
    } else if (s.startsWith('</', lt)) {
      const fim = s.indexOf('>', lt);
      if (fim < 0) throw new XmlError('Tag de fechamento incompleta');
      const nome = nomeLocal(s.slice(lt + 2, fim).trim());
      const aberto = pilha.pop();
      if (!aberto || aberto.name !== nome) {
        throw new XmlError(`Esperava </${aberto?.name}>, encontrou </${nome}>`);
      }
      i = fim + 1;
    } else {
      // tag de abertura; procura o '>' respeitando aspas
      let j = lt + 1;
      let aspas: string | null = null;
      while (j < s.length) {
        const c = s[j];
        if (aspas) {
          if (c === aspas) aspas = null;
        } else if (c === '"' || c === "'") aspas = c;
        else if (c === '>') break;
        j++;
      }
      if (j >= s.length) throw new XmlError('Tag de abertura incompleta');
      let corpo = s.slice(lt + 1, j);
      const autoFechada = corpo.endsWith('/');
      if (autoFechada) corpo = corpo.slice(0, -1);
      const m = /^([^\s/>]+)/.exec(corpo);
      if (!m) throw new XmlError('Tag sem nome');
      const no: XmlNode = { name: nomeLocal(m[1]), attrs: {}, children: [], text: '' };
      const reAttr = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      const resto = corpo.slice(m[1].length);
      while ((a = reAttr.exec(resto))) no.attrs[nomeLocal(a[1])] = decodificar(a[3] ?? a[4] ?? '');
      atual.children.push(no);
      if (!autoFechada) pilha.push(no);
      i = j + 1;
    }
  }
  if (pilha.length !== 1) throw new XmlError(`Tag não fechada: <${pilha[pilha.length - 1].name}>`);
  const elementos = raiz.children;
  if (elementos.length !== 1) throw new XmlError('Documento deve ter exatamente um elemento raiz');
  return elementos[0];
}

/** Primeiro filho com o nome dado (nome local). */
export function filho(no: XmlNode | undefined, nome: string): XmlNode | undefined {
  return no?.children.find((c) => c.name === nome);
}

export function filhos(no: XmlNode | undefined, nome: string): XmlNode[] {
  return no ? no.children.filter((c) => c.name === nome) : [];
}

/** Caminho de filhos: caminho(no, 'prod', 'NCM'). */
export function caminho(no: XmlNode | undefined, ...nomes: string[]): XmlNode | undefined {
  let atual = no;
  for (const n of nomes) atual = filho(atual, n);
  return atual;
}

/** Busca em profundidade o primeiro descendente com o nome. */
export function buscar(no: XmlNode | undefined, nome: string): XmlNode | undefined {
  if (!no) return undefined;
  for (const c of no.children) {
    if (c.name === nome) return c;
    const r = buscar(c, nome);
    if (r) return r;
  }
  return undefined;
}

export function texto(no: XmlNode | undefined): string | undefined {
  const t = no?.text.trim();
  return t ? t : undefined;
}
