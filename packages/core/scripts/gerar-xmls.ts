// Gera XMLs de NF-e/NFC-e SINTÉTICOS para desenvolvimento e demo.
// Empresas, CNPJs, CPFs e valores são inventados. Nada aqui é dado real.
// Uso: node scripts/gerar-xmls.ts  → escreve em fixtures/

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface Produto { cod: string; desc: string; ncm: string; preco: number; icms: number }
interface Empresa { cnpj: string; nome: string; crt: '1' | '3'; email: string; produtos: Produto[]; vendasMes: number; consumidorFinal: boolean }

let semente = 42;
const rand = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const entre = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
const r2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

const EMPRESAS: Empresa[] = [
  { cnpj: '11111111000101', nome: 'MERCADINHO BOM PRECO LTDA (SINTETICO)', crt: '3', email: 'financeiro@bompreco.exemplo', vendasMes: 40, consumidorFinal: true,
    produtos: [
      { cod: 'ARZ5', desc: 'ARROZ TIPO 1 5KG', ncm: '10063021', preco: 27.9, icms: 0.07 },
      { cod: 'LTI1', desc: 'LEITE UHT INTEGRAL 1L', ncm: '04011010', preco: 5.49, icms: 0.07 },
      { cod: 'REF2', desc: 'REFRIGERANTE COLA 2L', ncm: '22021000', preco: 9.99, icms: 0.18 },
      { cod: 'DET5', desc: 'DETERGENTE LIQUIDO 500ML', ncm: '34022000', preco: 2.79, icms: 0.18 },
    ] },
  { cnpj: '22222222000102', nome: 'FARMACIA VIDA E SAUDE LTDA (SINTETICO)', crt: '3', email: 'contato@farmaciavida.exemplo', vendasMes: 35, consumidorFinal: true,
    produtos: [
      { cod: 'DIP', desc: 'DIPIRONA MONOIDRATADA 500MG 10 COMP', ncm: '30049069', preco: 8.5, icms: 0.18 },
      { cod: 'AMX', desc: 'AMOXICILINA 500MG 21 CAPS', ncm: '30042019', preco: 24.9, icms: 0.18 },
      { cod: 'SER', desc: 'SERINGA DESCARTAVEL 5ML', ncm: '90183111', preco: 1.2, icms: 0.18 },
      { cod: 'FRD', desc: 'FRALDA INFANTIL G 30UN', ncm: '96190000', preco: 49.9, icms: 0.18 },
    ] },
  { cnpj: '33333333000103', nome: 'FERRO FORTE MATERIAIS DE CONSTRUCAO LTDA (SINTETICO)', crt: '3', email: 'adm@ferroforte.exemplo', vendasMes: 30, consumidorFinal: false,
    produtos: [
      { cod: 'CIM', desc: 'CIMENTO CP II 50KG', ncm: '25232910', preco: 38.0, icms: 0.18 },
      { cod: 'TNT', desc: 'TINTA ACRILICA 18L', ncm: '32091010', preco: 289.0, icms: 0.18 },
      { cod: 'PAR', desc: 'PARAFUSO SEXTAVADO 1/4 CX100', ncm: '73181500', preco: 42.0, icms: 0.18 },
    ] },
  { cnpj: '44444444000104', nome: 'PADARIA PAO QUENTE LTDA ME (SINTETICO)', crt: '1', email: 'paoquente@exemplo.com', vendasMes: 25, consumidorFinal: true,
    produtos: [
      { cod: 'PFR', desc: 'PAO FRANCES KG', ncm: '19059090', preco: 16.9, icms: 0 },
      { cod: 'LTI1', desc: 'LEITE UHT INTEGRAL 1L', ncm: '04011010', preco: 5.99, icms: 0 },
      { cod: 'BOL', desc: 'BOLO DE CENOURA FATIA', ncm: '19059090', preco: 7.5, icms: 0 },
    ] },
];

const FORNECEDOR = { cnpj: '99999999000199', nome: 'DISTRIBUIDORA ATACADO EXEMPLO SA (SINTETICO)' };
const MESES = ['2026-08', '2026-09', '2026-10'];
const PIS = 0.0065, COFINS = 0.03;

function chave(cnpj: string, mod: string, n: number, mes: string): string {
  const base = `35${mes.slice(2, 4)}${mes.slice(5, 7)}${cnpj}${mod}001${String(n).padStart(9, '0')}1${String(n).padStart(8, '0')}`;
  return (base + '0').slice(0, 44);
}

function nota(p: {
  emit: { cnpj: string; nome: string; crt: string };
  dest: { cnpj?: string; cpf?: string; nome: string } | null;
  mod: '55' | '65'; n: number; data: string; itens: { prod: Produto; q: number; preco: number; icms: number }[];
}): string {
  let total = 0;
  const dets = p.itens.map((it, i) => {
    const v = it.q * it.preco;
    total += v;
    const icms = p.emit.crt === '1'
      ? `<ICMS><ICMSSN102><orig>0</orig><CSOSN>102</CSOSN></ICMSSN102></ICMS>`
      : `<ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>${r2(v)}</vBC><pICMS>${r2(it.icms * 100)}</pICMS><vICMS>${r2(v * it.icms)}</vICMS></ICMS00></ICMS>`;
    const pc = p.emit.crt === '1'
      ? `<PIS><PISOutr><CST>99</CST><vPIS>0.00</vPIS></PISOutr></PIS><COFINS><COFINSOutr><CST>99</CST><vCOFINS>0.00</vCOFINS></COFINSOutr></COFINS>`
      : `<PIS><PISAliq><CST>01</CST><vBC>${r2(v)}</vBC><pPIS>0.65</pPIS><vPIS>${r2(v * PIS)}</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>${r2(v)}</vBC><pCOFINS>3.00</pCOFINS><vCOFINS>${r2(v * COFINS)}</vCOFINS></COFINSAliq></COFINS>`;
    return `<det nItem="${i + 1}"><prod><cProd>${it.prod.cod}</cProd><cEAN>SEM GTIN</cEAN><xProd>${it.prod.desc}</xProd><NCM>${it.prod.ncm}</NCM><CFOP>5102</CFOP><uCom>UN</uCom><qCom>${it.q.toFixed(4)}</qCom><vUnCom>${r2(it.preco)}</vUnCom><vProd>${r2(v)}</vProd></prod><imposto>${icms}${pc}</imposto></det>`;
  }).join('');
  const dest = !p.dest ? '' : p.dest.cpf
    ? `<dest><CPF>${p.dest.cpf}</CPF><xNome>${p.dest.nome}</xNome></dest>`
    : `<dest><CNPJ>${p.dest.cnpj}</CNPJ><xNome>${p.dest.nome}</xNome></dest>`;
  const ch = chave(p.emit.cnpj, p.mod, p.n, p.data.slice(0, 7));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${ch}" versao="4.00"><ide><cUF>35</cUF><mod>${p.mod}</mod><serie>1</serie><nNF>${p.n}</nNF><dhEmi>${p.data}T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide><emit><CNPJ>${p.emit.cnpj}</CNPJ><xNome>${p.emit.nome}</xNome><CRT>${p.emit.crt}</CRT></emit>${dest}${dets}<total><ICMSTot><vNF>${r2(total)}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>\n`;
}

const raiz = join(import.meta.dirname, '..', 'fixtures');
rmSync(raiz, { recursive: true, force: true });
const clientes = [];
for (const e of EMPRESAS) {
  const pasta = join(raiz, e.cnpj);
  mkdirSync(pasta, { recursive: true });
  let n = 1;
  for (const mes of MESES) {
    for (let k = 0; k < e.vendasMes; k++) {
      const dia = String(entre(1, 28)).padStart(2, '0');
      const escolhidos = e.produtos.filter(() => rand() < 0.6);
      const itens = (escolhidos.length ? escolhidos : [e.produtos[0]]).map((prod) => ({
        prod, q: entre(1, e.consumidorFinal ? 6 : 40), preco: prod.preco, icms: prod.icms,
      }));
      const cpf = `${entre(100, 999)}${entre(100, 999)}${entre(100, 999)}${entre(10, 99)}`;
      const dest = e.consumidorFinal
        ? (rand() < 0.5 ? { cpf, nome: 'CONSUMIDOR SINTETICO' } : null)
        : { cnpj: `55${String(entre(100000, 999999))}000155`, nome: 'CONSTRUTORA CLIENTE SINTETICA LTDA' };
      writeFileSync(join(pasta, `venda-${n}.xml`), nota({ emit: e, dest, mod: e.consumidorFinal ? '65' : '55', n, data: `${mes}-${dia}`, itens }));
      n++;
    }
    // compras do mês junto ao fornecedor (o cliente é o destinatário)
    const qMedia = e.consumidorFinal ? 3.5 : 20.5; // média de entre(1, 6) e entre(1, 40)
    const itens = e.produtos.map((prod) => ({ prod, q: Math.round(e.vendasMes * 0.6 * qMedia * 0.9), preco: Math.round(prod.preco * 0.62 * 100) / 100, icms: prod.icms ? 0.12 : 0 }));
    writeFileSync(join(pasta, `compra-${mes}.xml`), nota({ emit: { ...FORNECEDOR, crt: '3' }, dest: { cnpj: e.cnpj, nome: e.nome }, mod: '55', n: n++, data: `${mes}-05`, itens }));
  }
  clientes.push({ cnpj: e.cnpj, nome: e.nome, email: e.email });
}
writeFileSync(join(raiz, 'clientes.json'), JSON.stringify(clientes, null, 2));
console.log(`XMLs sintéticos gerados em ${raiz} para ${clientes.length} clientes.`);
