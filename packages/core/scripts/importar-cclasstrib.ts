// Importa a tabela OFICIAL de cClassTrib e gera src/tabela-oficial.ts.
//
//   npm run tabela:oficial                      baixa a página oficial agora
//   npm run tabela:oficial -- pagina.html       usa uma cópia salva da página
//
// O arquivo gerado guarda a fonte, a data do download, a publicação mais recente da tabela
// e o sha256 dos dados extraídos, para qualquer número poder ser rastreado até a origem.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { converterTabelaOficial, extrairDadosDaPagina, URL_TABELA_OFICIAL, type CstOficial } from '../src/oficial.ts';

const arquivo = process.argv[2];
const hoje = new Date().toISOString().slice(0, 10);

let html: string;
let origem: string;
if (arquivo) {
  html = readFileSync(arquivo, 'utf8');
  origem = `${URL_TABELA_OFICIAL} (cópia salva em arquivo)`;
} else {
  const r = await fetch(URL_TABELA_OFICIAL, { headers: { 'User-Agent': 'farol-importador-cclasstrib' } });
  if (!r.ok) throw new Error(`O portal respondeu ${r.status}.`);
  html = await r.text();
  origem = URL_TABELA_OFICIAL;
}

const json = extrairDadosDaPagina(html);
const sha256 = createHash('sha256').update(json).digest('hex');
const { tabela, resumo } = converterTabelaOficial(JSON.parse(json) as CstOficial[], hoje);
const versao = `oficial-${resumo.publicacaoMaisRecente}-${sha256.slice(0, 8)}`;

const info = {
  versao,
  fonte: `Tabela oficial de cClassTrib — Portal da Conformidade Fácil (SVRS), ${origem}`,
  baixadaEm: hoje,
  publicacaoMaisRecente: resumo.publicacaoMaisRecente,
  sha256,
  codigos: resumo.codigos,
  ncms: resumo.ncms,
};

// Uma linha por regra/tratamento: a diferença entre duas versões fica legível no git.
const linhas = (xs: unknown[]) => xs.map((x) => `    ${JSON.stringify(x)},`).join('\n');
const saida = `// GERADO por scripts/importar-cclasstrib.ts — não editar à mão. Para atualizar: npm run tabela:oficial
//
// Tabela OFICIAL de cClassTrib (códigos válidos para NF-e/NFC-e) com os NCMs dos anexos da LC 214/2025.
// Regras de uso desta tabela pelo Farol: ver src/oficial.ts.

import type { TabelaCompacta } from './tabela.ts';

export const TABELA_OFICIAL_INFO = ${JSON.stringify(info, null, 2)} as const;

export const TABELA_OFICIAL: TabelaCompacta = {
  padrao: ${JSON.stringify(tabela.padrao)},
  tratamentos: [
${linhas(tabela.tratamentos)}
  ],
  textos: [
${linhas(tabela.textos)}
  ],
  regras: [
${linhas(tabela.regras)}
  ],
};
`;
writeFileSync(join(import.meta.dirname, '..', 'src', 'tabela-oficial.ts'), saida);
console.log(`Tabela ${versao}: ${resumo.codigos} códigos, ${resumo.ncms} NCMs em anexos ` +
  `(${resumo.ncmsComVariasOpcoes} com mais de um código), ${resumo.comRessalva.length} códigos com ressalva.`);
