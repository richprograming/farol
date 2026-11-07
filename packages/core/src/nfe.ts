// Leitura de XML de NF-e (modelo 55) e NFC-e (modelo 65).
// Extrai só o que o Farol usa e mascara dados de pessoa física (LGPD) já na entrada.

import { buscar, caminho, filho, filhos, parseXml, texto, type XmlNode } from './xml.ts';

export type Regime = 'simples' | 'mei' | 'normal' | 'desconhecido';

export interface ItemNota {
  nItem: number;
  codigo: string;
  descricao: string;
  ncm: string; // 8 dígitos
  cfop: string;
  quantidade: number;
  valor: number; // vProd - vDesc, em R$
  vICMS: number;
  vPIS: number;
  vCOFINS: number;
  cClassTrib?: string; // quando a nota já traz o grupo IBSCBS
}

export interface NotaFiscal {
  chave: string;
  modelo: '55' | '65' | string;
  numero: string;
  emissao: string; // ISO (data e hora como veio no XML)
  tipo: 'entrada' | 'saida';
  emitente: { cnpj: string; nome: string; regime: Regime };
  destinatario?: { documento: string; nome: string; pessoaFisica: boolean };
  itens: ItemNota[];
  valorTotal: number;
}

export class NotaInvalidaError extends Error {}

const num = (n: XmlNode | undefined): number => {
  const t = texto(n);
  if (!t) return 0;
  const v = Number(t);
  return Number.isFinite(v) ? v : 0;
};

export function mascararCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '');
  if (d.length !== 11) return '***';
  return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
}

function regimeDoCrt(crt: string | undefined): Regime {
  switch (crt) {
    case '1':
    case '2':
      return 'simples';
    case '4':
      return 'mei';
    case '3':
      return 'normal';
    default:
      return 'desconhecido';
  }
}

/** Soma o primeiro valor encontrado com a tag dada dentro de um grupo de imposto. */
function valorDoGrupo(imposto: XmlNode | undefined, grupo: string, tag: string): number {
  return num(buscar(filho(imposto, grupo), tag));
}

function lerItem(det: XmlNode): ItemNota {
  const prod = filho(det, 'prod');
  const imposto = filho(det, 'imposto');
  const ncm = texto(filho(prod, 'NCM')) ?? '';
  if (!prod) throw new NotaInvalidaError('Item sem grupo <prod>');
  const ibscbs = filho(imposto, 'IBSCBS');
  return {
    nItem: Number(det.attrs.nItem ?? 0),
    codigo: texto(filho(prod, 'cProd')) ?? '',
    descricao: texto(filho(prod, 'xProd')) ?? '',
    ncm: ncm.replace(/\D/g, ''),
    cfop: texto(filho(prod, 'CFOP')) ?? '',
    quantidade: num(filho(prod, 'qCom')),
    valor: num(filho(prod, 'vProd')) - num(filho(prod, 'vDesc')),
    vICMS: valorDoGrupo(imposto, 'ICMS', 'vICMS'),
    vPIS: valorDoGrupo(imposto, 'PIS', 'vPIS'),
    vCOFINS: valorDoGrupo(imposto, 'COFINS', 'vCOFINS'),
    cClassTrib: texto(filho(ibscbs, 'cClassTrib')),
  };
}

export function lerNota(xml: string): NotaFiscal {
  let raiz: XmlNode;
  try {
    raiz = parseXml(xml);
  } catch (e) {
    throw new NotaInvalidaError(`XML malformado: ${(e as Error).message}`);
  }
  const inf = raiz.name === 'infNFe' ? raiz : buscar(raiz, 'infNFe');
  if (!inf) throw new NotaInvalidaError('Não é uma NF-e: grupo <infNFe> não encontrado');

  const ide = filho(inf, 'ide');
  const emit = filho(inf, 'emit');
  const dest = filho(inf, 'dest');
  const cnpjEmit = texto(filho(emit, 'CNPJ'));
  if (!cnpjEmit) throw new NotaInvalidaError('Emitente sem CNPJ');

  let destinatario: NotaFiscal['destinatario'];
  if (dest) {
    const cpf = texto(filho(dest, 'CPF'));
    const cnpj = texto(filho(dest, 'CNPJ'));
    if (cpf) destinatario = { documento: mascararCpf(cpf), nome: 'Consumidor (dados mascarados)', pessoaFisica: true };
    else if (cnpj) destinatario = { documento: cnpj, nome: texto(filho(dest, 'xNome')) ?? '', pessoaFisica: false };
  }

  const itens = filhos(inf, 'det').map(lerItem);
  if (itens.length === 0) throw new NotaInvalidaError('Nota sem itens');

  return {
    chave: (inf.attrs.Id ?? '').replace(/^NFe/, ''),
    modelo: texto(filho(ide, 'mod')) ?? '',
    numero: texto(filho(ide, 'nNF')) ?? '',
    emissao: texto(filho(ide, 'dhEmi')) ?? texto(filho(ide, 'dEmi')) ?? '',
    tipo: texto(filho(ide, 'tpNF')) === '0' ? 'entrada' : 'saida',
    emitente: {
      cnpj: cnpjEmit,
      nome: texto(filho(emit, 'xNome')) ?? '',
      regime: regimeDoCrt(texto(filho(emit, 'CRT'))),
    },
    destinatario,
    itens,
    valorTotal: num(caminho(inf, 'total', 'ICMSTot', 'vNF')),
  };
}
