import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';

import { lerZip, LIMITES_ZIP, ZipInvalidoError } from '../src/zip.ts';

interface Entrada { nome: string; conteudo: string; guardar?: boolean; senha?: boolean; metodo?: number }

/** Monta um ZIP de teste (só o necessário do formato). */
function zip(entradas: Entrada[]): Uint8Array {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, 'utf8');
    const cru = Buffer.from(e.conteudo, 'utf8');
    const dados = e.guardar ? cru : deflateRawSync(cru);
    const metodo = e.metodo ?? (e.guardar ? 0 : 8);
    const flags = 0x800 | (e.senha ? 1 : 0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(metodo, 8);
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(cru.length, 22);
    local.writeUInt16LE(nome.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(metodo, 10);
    central.writeUInt32LE(dados.length, 20);
    central.writeUInt32LE(cru.length, 24);
    central.writeUInt16LE(nome.length, 28);
    central.writeUInt32LE(offset, 42);
    locais.push(local, nome, dados);
    centrais.push(central, nome);
    offset += 30 + nome.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locais, dir, fim]));
}

const texto = (d?: Uint8Array) => new TextDecoder().decode(d);

test('zip: lê XMLs comprimidos e guardados, em pastas, com acento no nome; ignora o resto', async () => {
  const r = await lerZip(zip([
    { nome: 'notas/', conteudo: '', guardar: true },
    { nome: 'notas/março/a.xml', conteudo: '<nfeProc>ação</nfeProc>'.repeat(50) },
    { nome: 'b.XML', conteudo: '<b/>', guardar: true },
    { nome: 'leia-me.txt', conteudo: 'não é nota' },
  ]));
  assert.deepEqual(r.map((x) => x.nome), ['notas/março/a.xml', 'b.XML']);
  assert.equal(texto(r[0].dados), '<nfeProc>ação</nfeProc>'.repeat(50));
  assert.equal(texto(r[1].dados), '<b/>');
});

test('zip: arquivo ruim vira erro só dele', async () => {
  const r = await lerZip(zip([
    { nome: 'ok.xml', conteudo: '<a/>' },
    { nome: 'senha.xml', conteudo: '<a/>', senha: true },
    { nome: 'estranho.xml', conteudo: '<a/>', guardar: true, metodo: 12 },
    { nome: 'grande.xml', conteudo: 'x'.repeat(2000) },
  ]), undefined, { ...LIMITES_ZIP, maxBytesPorArquivo: 1000 });
  assert.equal(texto(r[0].dados), '<a/>');
  assert.match(r[1].erro!, /senha/);
  assert.match(r[2].erro!, /não suportada/);
  assert.match(r[3].erro!, /grande demais/);

  const corrompido = zip([{ nome: 'c.xml', conteudo: '<a>conteúdo</a>'.repeat(20) }]);
  corrompido.fill(0xff, 40, 50);
  const [c] = await lerZip(corrompido);
  assert.ok(c.erro);
});

test('zip: recusa o que não é ZIP e ZIP acima dos limites', async () => {
  await assert.rejects(lerZip(new TextEncoder().encode('<?xml version="1.0"?><nfeProc/>')), ZipInvalidoError);
  await assert.rejects(lerZip(new Uint8Array(0)), ZipInvalidoError);
  const dois = zip([{ nome: 'a.xml', conteudo: '<a/>' }, { nome: 'b.xml', conteudo: '<b/>' }]);
  await assert.rejects(lerZip(dois, undefined, { ...LIMITES_ZIP, maxArquivos: 1 }), /limite é 1/);
  await assert.rejects(lerZip(dois, undefined, { ...LIMITES_ZIP, maxBytesTotal: 5 }), /grande demais/);
});
