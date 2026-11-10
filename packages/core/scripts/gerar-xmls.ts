// Escreve as NF-e/NFC-e SINTÉTICAS de src/sinteticos.ts em fixtures/ (usadas pelos testes).
// Uso: node scripts/gerar-xmls.ts

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { gerarCarteiraSintetica } from '../src/sinteticos.ts';

const raiz = join(import.meta.dirname, '..', 'fixtures');
rmSync(raiz, { recursive: true, force: true });
const clientes = gerarCarteiraSintetica();
for (const c of clientes) {
  const pasta = join(raiz, c.cnpj);
  mkdirSync(pasta, { recursive: true });
  for (const x of c.xmls) writeFileSync(join(pasta, x.nome), x.conteudo);
}
writeFileSync(join(raiz, 'clientes.json'), JSON.stringify(clientes.map(({ cnpj, nome, email }) => ({ cnpj, nome, email })), null, 2));
console.log(`XMLs sintéticos gerados em ${raiz} para ${clientes.length} clientes.`);
