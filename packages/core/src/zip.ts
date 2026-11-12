// Leitor mínimo de ZIP, para o contador subir a pasta de XMLs de uma vez.
//
// Roda no navegador (o ZIP é aberto na máquina do contador; para o servidor seguem só os XMLs,
// pelo mesmo caminho do upload avulso) e no Node. Sem dependências: usa DecompressionStream.
// Cada arquivo devolve o conteúdo OU um erro; um arquivo ruim não derruba os outros.

export interface ArquivoDoZip {
  nome: string;
  dados?: Uint8Array;
  erro?: string;
}

export interface LimitesZip {
  maxArquivos: number;
  maxBytesPorArquivo: number;
  maxBytesTotal: number;
}

/** XML de nota fiscal tem dezenas de KB; os limites existem para barrar ZIP malicioso ("bomba"). */
export const LIMITES_ZIP: LimitesZip = { maxArquivos: 20_000, maxBytesPorArquivo: 5 * 1024 * 1024, maxBytesTotal: 400 * 1024 * 1024 };

export class ZipInvalidoError extends Error {}

const FIM = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Lê as entradas do ZIP que passam em `querer` (por padrão, as que terminam em .xml). Pastas são ignoradas. */
export async function lerZip(
  bytes: Uint8Array,
  querer: (nome: string) => boolean = (n) => n.toLowerCase().endsWith('.xml'),
  limites: LimitesZip = LIMITES_ZIP,
): Promise<ArquivoDoZip[]> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // O registro de fim fica nos últimos bytes (22 + comentário de até 65535).
  let fim = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (v.getUint32(i, true) === FIM) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new ZipInvalidoError('O arquivo não é um ZIP válido.');
  const total = v.getUint16(fim + 10, true);
  const inicio = v.getUint32(fim + 16, true);
  if (total === 0xffff || inicio === 0xffffffff) throw new ZipInvalidoError('ZIP no formato ZIP64 (muito grande): divida em arquivos menores.');
  if (total > limites.maxArquivos) throw new ZipInvalidoError(`O ZIP tem ${total} arquivos; o limite é ${limites.maxArquivos}.`);

  const utf8 = new TextDecoder('utf-8');
  const latin1 = new TextDecoder('latin1');
  const saida: ArquivoDoZip[] = [];
  let p = inicio;
  let somaBytes = 0;
  for (let n = 0; n < total; n++) {
    if (p + 46 > bytes.length || v.getUint32(p, true) !== CENTRAL) throw new ZipInvalidoError('O índice do ZIP está corrompido.');
    const flags = v.getUint16(p + 8, true);
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const tamanho = v.getUint32(p + 24, true);
    const [lenNome, lenExtra, lenComentario] = [v.getUint16(p + 28, true), v.getUint16(p + 30, true), v.getUint16(p + 32, true)];
    const local = v.getUint32(p + 42, true);
    const nome = ((flags & 0x800) ? utf8 : latin1).decode(bytes.subarray(p + 46, p + 46 + lenNome));
    p += 46 + lenNome + lenExtra + lenComentario;
    if (nome.endsWith('/') || !querer(nome)) continue;

    const erro = (msg: string) => saida.push({ nome, erro: msg });
    if (flags & 1) { erro('Arquivo protegido por senha dentro do ZIP.'); continue; }
    if (metodo !== 0 && metodo !== 8) { erro('Compressão não suportada dentro do ZIP.'); continue; }
    if (tamanho > limites.maxBytesPorArquivo) { erro('Arquivo grande demais para ser uma nota fiscal.'); continue; }
    somaBytes += tamanho;
    if (somaBytes > limites.maxBytesTotal) throw new ZipInvalidoError('O conteúdo do ZIP é grande demais: divida em arquivos menores.');
    if (local + 30 > bytes.length || v.getUint32(local, true) !== LOCAL) { erro('Entrada corrompida no ZIP.'); continue; }
    const comeco = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    if (comeco + comprimido > bytes.length) { erro('Entrada corrompida no ZIP.'); continue; }
    const cru = bytes.subarray(comeco, comeco + comprimido);
    try {
      const dados = metodo === 0 ? cru : await inflar(cru, limites.maxBytesPorArquivo);
      if (dados.length !== tamanho) erro('Entrada corrompida no ZIP.');
      else saida.push({ nome, dados });
    } catch {
      erro('Não foi possível descompactar este arquivo.');
    }
  }
  return saida;
}

async function inflar(cru: Uint8Array, maximo: number): Promise<Uint8Array> {
  const fluxo = new Blob([cru as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const leitor = fluxo.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.length;
    if (total > maximo) {
      await leitor.cancel();
      throw new Error('grande demais');
    }
    partes.push(value);
  }
  const tudo = new Uint8Array(total);
  let o = 0;
  for (const parte of partes) {
    tudo.set(parte, o);
    o += parte.length;
  }
  return tudo;
}
