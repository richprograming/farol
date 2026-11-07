// Semeia a demonstração: escritório, tabela e parâmetros de EXEMPLO, mudanças FICTÍCIAS
// e a carteira de XMLs SINTÉTICOS de packages/core/fixtures.
//
//   npm run semear -w @farol/web             (com `npx convex dev` rodando)
//   npm run semear -w @farol/web -- --limpar  (apaga a demo antes)

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ConvexHttpClient } from 'convex/browser';

import { api } from '../convex/_generated/api.js';

const WEB = join(import.meta.dirname, '..');
const CORE = join(WEB, '..', '..', 'packages', 'core');
const FIX = join(CORE, 'fixtures');
const LOTE = 4 * 1024 * 1024;

function lerEnv(): Record<string, string> {
  const arq = join(WEB, '.env.local');
  if (!existsSync(arq)) return {};
  return Object.fromEntries(readFileSync(arq, 'utf8').split(/\r?\n/)
    .map((l) => /^([A-Z_]+)=(.*)$/.exec(l.trim())).filter((m) => m !== null).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
}

const convex = (...args: string[]) => execFileSync('npx', ['convex', 'run', ...args], { cwd: WEB, stdio: 'inherit', shell: true });

const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? lerEnv().NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error('NEXT_PUBLIC_CONVEX_URL não encontrada: rode `npx convex dev` antes.');

if (process.argv.includes('--limpar')) convex('seed:limparDemo');
convex('seed:base');

if (!existsSync(FIX)) execFileSync('node', ['scripts/gerar-xmls.ts'], { cwd: CORE, stdio: 'inherit' });
const clientes = JSON.parse(readFileSync(join(FIX, 'clientes.json'), 'utf8')) as { cnpj: string; nome: string; email: string }[];
const cliente = new ConvexHttpClient(url);

for (const c of clientes) {
  const pasta = join(FIX, c.cnpj);
  const arquivos = readdirSync(pasta).filter((f) => f.endsWith('.xml'));
  let lote: { nome: string; conteudo: string }[] = [];
  let tamanho = 0;
  let novas = 0;
  const enviar = async () => {
    if (!lote.length) return;
    const r = await cliente.action(api.notas.importar, { xmls: lote, cnpj: c.cnpj, email: c.email });
    novas += r.novas;
    if (r.erros.length) console.warn(`${c.cnpj}: ${r.erros.length} erro(s)`, r.erros.slice(0, 3));
    lote = [];
    tamanho = 0;
  };
  for (const f of arquivos) {
    const conteudo = readFileSync(join(pasta, f), 'utf8');
    if (tamanho + conteudo.length > LOTE) await enviar();
    lote.push({ nome: f, conteudo });
    tamanho += conteudo.length;
  }
  await enviar();
  console.log(`${c.nome}: ${novas} nota(s) nova(s)`);
}
console.log('Demonstração pronta. Os cálculos rodam em segundo plano e a tela se atualiza sozinha.');
