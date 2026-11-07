/// <reference types="vite/client" />
// Testes das funções do Convex: bloqueios do contador, LGPD, isolamento por escritório e deduplicação.

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { api, internal } from './_generated/api';
import { identificarCliente } from './notas';
import { lerNota } from '@farol/core';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.*s');

const CNPJ = '22222222000102';
const OUTRO = '99999999000199';

/** NF-e mínima e SINTÉTICA, no formato que o core lê. */
function xml(p: { chave: string; emit: string; dest?: { cpf?: string; cnpj?: string }; ncm: string; desc: string; valor: number; mes?: string }) {
  const dest = !p.dest ? '' : p.dest.cpf ? `<dest><CPF>${p.dest.cpf}</CPF><xNome>CONSUMIDOR</xNome></dest>`
    : `<dest><CNPJ>${p.dest.cnpj}</CNPJ><xNome>DEST</xNome></dest>`;
  return `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${p.chave}"><ide><mod>65</mod><nNF>1</nNF>` +
    `<dhEmi>${p.mes ?? '2026-09'}-10T10:00:00-03:00</dhEmi><tpNF>1</tpNF></ide>` +
    `<emit><CNPJ>${p.emit}</CNPJ><xNome>FARMACIA TESTE (SINTETICO)</xNome><CRT>3</CRT></emit>${dest}` +
    `<det nItem="1"><prod><cProd>1</cProd><xProd>${p.desc}</xProd><NCM>${p.ncm}</NCM><CFOP>5102</CFOP><qCom>1</qCom>` +
    `<vProd>${p.valor.toFixed(2)}</vProd></prod><imposto><ICMS><ICMS00><vICMS>${(p.valor * 0.18).toFixed(2)}</vICMS></ICMS00></ICMS>` +
    `<PIS><PISAliq><vPIS>${(p.valor * 0.0065).toFixed(2)}</vPIS></PISAliq></PIS><COFINS><COFINSAliq><vCOFINS>${(p.valor * 0.03).toFixed(2)}</vCOFINS></COFINSAliq></COFINS></imposto></det>` +
    `<total><ICMSTot><vNF>${p.valor.toFixed(2)}</vNF></ICMSTot></total></infNFe></NFe></nfeProc>`;
}

const NOTAS = [
  { nome: 'a.xml', conteudo: xml({ chave: '1'.repeat(44), emit: CNPJ, dest: { cpf: '12345678901' }, ncm: '96190000', desc: 'FRALDA G', valor: 500 }) },
  { nome: 'b.xml', conteudo: xml({ chave: '2'.repeat(44), emit: CNPJ, ncm: '30049069', desc: 'DIPIRONA', valor: 300, mes: '2026-10' }) },
];

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function preparar() {
  const t = convexTest(schema, modules);
  await t.mutation(internal.seed.base, {});
  const r = await t.action(api.notas.importar, { xmls: NOTAS, email: 'cliente@exemplo.com' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const fraldas = (await t.query(api.radar.mudancas, {})).find((m) => m.ref === 'exemplo-fraldas')!;
  return { t, r, fraldas };
}

test('importar: grava itens normalizados, mascara CPF e calcula a análise', async () => {
  const { t, r } = await preparar();
  expect(r).toMatchObject({ cnpj: CNPJ, lidas: 2, novas: 2, duplicadas: 0, erros: [] });
  const notas = await t.run((ctx) => ctx.db.query('notas').collect());
  expect(notas).toHaveLength(2);
  const comCpf = notas.find((n) => n.destinatario?.pessoaFisica)!;
  expect(comCpf.destinatario!.documento).toBe('***.456.789-**');
  expect(JSON.stringify(notas)).not.toContain('12345678901');
  expect(JSON.stringify(notas)).not.toContain('<infNFe');
  const resumo = await t.query(api.carteira.resumo, {});
  expect(resumo.pendentes).toHaveLength(0);
  expect(resumo.clientes[0]).toMatchObject({ cnpj: CNPJ, meses: 2, sintetico: true });
  expect(resumo.clientes[0].versoes).toEqual({ tabela: 'exemplo-0.1', parametros: '2026-11-07-exemplo' });
});

test('importar: notas repetidas são ignoradas pela chave e notas de outro CNPJ viram erro por arquivo', async () => {
  const { t } = await preparar();
  const estranha = { nome: 'c.xml', conteudo: xml({ chave: '3'.repeat(44), emit: OUTRO, ncm: '22021000', desc: 'REFRI', valor: 10 }) };
  const r = await t.action(api.notas.importar, { xmls: [...NOTAS, estranha, { nome: 'd.xml', conteudo: '<html/>' }], cnpj: CNPJ });
  expect(r.novas).toBe(0);
  expect(r.duplicadas).toBe(2);
  expect(r.erros.map((e) => e.arquivo).sort()).toEqual(['c.xml', 'd.xml']);
  expect(await t.run((ctx) => ctx.db.query('notas').collect())).toHaveLength(2);
});

test('radar: sem confirmação não há impacto nem envio', async () => {
  const { t, fraldas } = await preparar();
  expect(await t.query(api.radar.impactos, { mudancaId: fraldas._id })).toEqual([]);
  const clienteId = (await t.query(api.carteira.resumo, {})).clientes[0].clienteId;
  await expect(t.mutation(api.radar.aprovarEnvio, { mudancaId: fraldas._id, clienteId, para: 'a@b.com', assunto: 'x', texto: 'y' }))
    .rejects.toThrow(/Confirme/);
  await expect(t.mutation(api.radar.aplicar, { mudancaId: fraldas._id })).rejects.toThrow(/Confirme/);
});

test('radar: confirmar calcula o impacto; aprovar grava e envia (simulado sem chave); não envia duas vezes', async () => {
  const { t, fraldas } = await preparar();
  await t.mutation(api.radar.confirmar, { mudancaId: fraldas._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [impacto, ...resto] = await t.query(api.radar.impactos, { mudancaId: fraldas._id });
  expect(resto).toHaveLength(0);
  expect(impacto.variacaoMensal).toBeLessThan(0);
  expect(impacto.versoes.tabela).toBe('exemplo-0.1+exemplo-fraldas');
  expect(impacto.aviso.texto).toContain(fraldas.fonte);
  expect(impacto.envio).toBeNull();

  const pedido = { mudancaId: fraldas._id, clienteId: impacto.clienteId, para: 'cliente@exemplo.com', assunto: impacto.aviso.assunto, texto: impacto.aviso.texto };
  await t.mutation(api.radar.aprovarEnvio, pedido);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [depois] = await t.query(api.radar.impactos, { mudancaId: fraldas._id });
  expect(depois.envio).toMatchObject({ status: 'simulado', para: 'cliente@exemplo.com' });
  await expect(t.mutation(api.radar.aprovarEnvio, pedido)).rejects.toThrow(/já foi aprovado/);
  await expect(t.mutation(api.radar.aprovarEnvio, { ...pedido, para: 'invalido' })).rejects.toThrow();
});

test('aplicar: cria versão derivada da tabela só para o escritório e recalcula', async () => {
  const { t, fraldas } = await preparar();
  const antes = (await t.query(api.carteira.resumo, {})).clientes[0].exposicao2027;
  await t.mutation(api.radar.confirmar, { mudancaId: fraldas._id });
  await t.mutation(api.radar.aplicar, { mudancaId: fraldas._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const resumo = await t.query(api.carteira.resumo, {});
  expect(resumo.tabela.versao).toBe('exemplo-0.1+exemplo-fraldas');
  expect(resumo.clientes[0].versoes.tabela).toBe('exemplo-0.1+exemplo-fraldas');
  expect(resumo.clientes[0].exposicao2027).toBeLessThan(antes);
  expect((await t.query(api.radar.mudancas, {})).map((m) => m.ref)).not.toContain('exemplo-fraldas');
  const base = await t.run((ctx) => ctx.db.query('versoesTabela').withIndex('by_versao', (q) => q.eq('versao', 'exemplo-0.1')).unique());
  expect(base!.escritorioId).toBeUndefined();
});

test('revisão: só aceita código da tabela vigente e muda a conta', async () => {
  const { t } = await preparar();
  const c = (await t.query(api.carteira.resumo, {})).clientes[0];
  const det = await t.query(api.carteira.cliente, { clienteId: c.clienteId });
  const dipirona = det.analise!.produtos.find((p) => p.descricao === 'DIPIRONA')!;
  expect(dipirona.classificacao.status).toBe('revisar');
  await expect(t.mutation(api.carteira.revisar, { chave: dipirona.chave, cClassTrib: '000001' })).rejects.toThrow(/não está na tabela/);
  await t.mutation(api.carteira.revisar, { chave: dipirona.chave, cClassTrib: 'EX2002' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const depois = await t.query(api.carteira.cliente, { clienteId: c.clienteId });
  expect(depois.analise!.produtos.find((p) => p.descricao === 'DIPIRONA')!.classificacao.status).toBe('revisado');
  expect(depois.analise!.exposicao2027).toBeLessThan(c.exposicao2027);
});

test('isolamento: dados de outro escritório não aparecem nem podem ser lidos', async () => {
  const { t, r } = await preparar();
  const alheio = await t.run(async (ctx) => {
    const e = (await ctx.db.query('escritorios').first())!;
    const outro = await ctx.db.insert('escritorios', { nome: 'Outro', slug: 'outro', tabelaVersaoId: e.tabelaVersaoId, parametrosVersaoId: e.parametrosVersaoId });
    const clienteId = await ctx.db.insert('clientes', { escritorioId: outro, cnpj: OUTRO, nome: 'ALHEIO', regime: 'normal', email: '', sintetico: true });
    const mudancaId = await ctx.db.insert('mudancas', {
      escritorioId: outro, ref: 'x', titulo: 'ALHEIA', resumo: '', fonte: 'https://exemplo.gov.br', publicadaEm: '2026-11-01',
      efeito: { tipo: 'altera_reducao', cClassTrib: 'EX2060', novaReducao: 1 }, origem: 'manual', confirmada: true, aplicada: false, criadaEm: 0,
    });
    return { clienteId, mudancaId };
  });
  const resumo = await t.query(api.carteira.resumo, {});
  expect(resumo.clientes.map((c) => c.cnpj)).toEqual([r.cnpj]);
  expect((await t.query(api.radar.mudancas, {})).map((m) => m.titulo)).not.toContain('ALHEIA');
  await expect(t.query(api.carteira.cliente, { clienteId: alheio.clienteId as Id<'clientes'> })).rejects.toThrow(/não encontrado/);
  await expect(t.query(api.radar.impactos, { mudancaId: alheio.mudancaId })).rejects.toThrow(/não encontrad/);
  await expect(t.mutation(api.radar.confirmar, { mudancaId: alheio.mudancaId })).rejects.toThrow(/não encontrad/);
});

test('identificar cliente: lote com mais compras que vendas não elege o fornecedor', () => {
  const compra = (i: number) => lerNota(xml({ chave: String(i).repeat(44).slice(0, 44), emit: OUTRO, dest: { cnpj: CNPJ }, ncm: '30049069', desc: 'X', valor: 10 }));
  const venda = (i: number) => lerNota(xml({ chave: String(i).repeat(44).slice(0, 44), emit: CNPJ, ncm: '30049069', desc: 'X', valor: 10 }));
  expect(identificarCliente([compra(1), compra(2), compra(3), venda(4), venda(5)])).toBe(CNPJ);
  expect(identificarCliente([compra(1)])).toBeNull(); // empate entre fornecedor e cliente: não chuta
  expect(identificarCliente([venda(4)])).toBe(CNPJ);
});
