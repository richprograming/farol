/// <reference types="vite/client" />
// Testes das funções do Convex: login, bloqueios do contador, LGPD, isolamento por escritório e deduplicação.

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { lerNota } from '@farol/core';

import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { identificarCliente } from './notas';
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

const ANA = { subject: 'user_ana', email: 'ana@contabil.exemplo', name: 'Ana' };
const BETO = { subject: 'user_beto', email: 'beto@outro.exemplo' };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Usuário logado com escritório criado, duas notas importadas e as mudanças de exemplo. */
async function preparar() {
  const t = convexTest(schema, modules);
  const ana = t.withIdentity(ANA);
  const escritorioId = await ana.mutation(api.conta.criarEscritorio, { nome: 'Contabilidade da Ana' });
  const r = await ana.action(api.notas.importar, { xmls: NOTAS, email: 'cliente@exemplo.com' });
  await t.mutation(internal.demo.criarMudancasExemplo, { escritorioId });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const fraldas = (await ana.query(api.radar.mudancas, {})).find((m) => m.ref === 'exemplo-fraldas')!;
  return { t, ana, r, fraldas, escritorioId };
}

test('login: sem identidade nada é lido; o 1º acesso cria o escritório com o usuário como dono', async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.conta.eu, {})).toEqual({ logado: false });
  await expect(t.query(api.carteira.resumo, {})).rejects.toThrow(/Faça login/);
  await expect(t.action(api.notas.importar, { xmls: NOTAS })).rejects.toThrow(/Faça login/);
  await expect(t.mutation(api.conta.criarEscritorio, { nome: 'X' })).rejects.toThrow(/Faça login/);

  const ana = t.withIdentity(ANA);
  expect(await ana.query(api.conta.eu, {})).toMatchObject({ logado: true, escritorio: null });
  await expect(ana.query(api.carteira.resumo, {})).rejects.toThrow(/Crie o seu escritório/);
  await expect(ana.mutation(api.conta.criarEscritorio, { nome: ' ' })).rejects.toThrow(/nome do escritório/);
  const id = await ana.mutation(api.conta.criarEscritorio, { nome: '  Contabilidade   da Ana ' });
  expect(await ana.query(api.conta.eu, {})).toMatchObject({ logado: true, email: ANA.email, escritorio: { _id: id, nome: 'Contabilidade da Ana' } });
  await expect(ana.mutation(api.conta.criarEscritorio, { nome: 'Outro' })).rejects.toThrow(/já tem um escritório/);
  const membros = await t.run((ctx) => ctx.db.query('membros').collect());
  expect(membros).toMatchObject([{ escritorioId: id, papel: 'dono' }]);
  const resumo = await ana.query(api.carteira.resumo, {});
  expect(resumo).toMatchObject({ escritorio: 'Contabilidade da Ana', clientes: [], tabela: { versao: 'exemplo-0.1', exemplo: true } });
  expect(await ana.query(api.radar.mudancas, {})).toEqual([]); // escritório novo não ganha mudança fictícia
});

test('importar: grava itens normalizados, mascara CPF e calcula a análise', async () => {
  const { t, ana, r } = await preparar();
  expect(r).toMatchObject({ cnpj: CNPJ, lidas: 2, novas: 2, duplicadas: 0, erros: [] });
  const notas = await t.run((ctx) => ctx.db.query('notas').collect());
  expect(notas).toHaveLength(2);
  const comCpf = notas.find((n) => n.destinatario?.pessoaFisica)!;
  expect(comCpf.destinatario!.documento).toBe('***.456.789-**');
  expect(JSON.stringify(notas)).not.toContain('12345678901');
  expect(JSON.stringify(notas)).not.toContain('<infNFe');
  const resumo = await ana.query(api.carteira.resumo, {});
  expect(resumo.pendentes).toHaveLength(0);
  expect(resumo.clientes[0]).toMatchObject({ cnpj: CNPJ, meses: 2, sintetico: true });
  expect(resumo.clientes[0].versoes).toEqual({ tabela: 'exemplo-0.1', parametros: '2026-11-07-exemplo' });
});

test('importar: notas repetidas são ignoradas pela chave e notas de outro CNPJ viram erro por arquivo', async () => {
  const { t, ana } = await preparar();
  const estranha = { nome: 'c.xml', conteudo: xml({ chave: '3'.repeat(44), emit: OUTRO, ncm: '22021000', desc: 'REFRI', valor: 10 }) };
  const r = await ana.action(api.notas.importar, { xmls: [...NOTAS, estranha, { nome: 'd.xml', conteudo: '<html/>' }], cnpj: CNPJ });
  expect(r.novas).toBe(0);
  expect(r.duplicadas).toBe(2);
  expect(r.erros.map((e) => e.arquivo).sort()).toEqual(['c.xml', 'd.xml']);
  expect(await t.run((ctx) => ctx.db.query('notas').collect())).toHaveLength(2);
});

test('radar: sem confirmação não há impacto nem envio', async () => {
  const { ana, fraldas } = await preparar();
  expect(await ana.query(api.radar.impactos, { mudancaId: fraldas._id })).toEqual([]);
  const clienteId = (await ana.query(api.carteira.resumo, {})).clientes[0].clienteId;
  await expect(ana.mutation(api.radar.aprovarEnvio, { mudancaId: fraldas._id, clienteId, para: 'a@b.com', assunto: 'x', texto: 'y' }))
    .rejects.toThrow(/Confirme/);
  await expect(ana.mutation(api.radar.aplicar, { mudancaId: fraldas._id })).rejects.toThrow(/Confirme/);
});

test('radar: confirmar calcula o impacto; aprovar grava e envia (simulado sem chave); não envia duas vezes', async () => {
  const { t, ana, fraldas } = await preparar();
  await ana.mutation(api.radar.confirmar, { mudancaId: fraldas._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [impacto, ...resto] = await ana.query(api.radar.impactos, { mudancaId: fraldas._id });
  expect(resto).toHaveLength(0);
  expect(impacto.variacaoMensal).toBeLessThan(0);
  expect(impacto.versoes.tabela).toBe('exemplo-0.1+exemplo-fraldas');
  expect(impacto.aviso.texto).toContain(fraldas.fonte);
  expect(impacto.aviso.texto).toContain('Contabilidade da Ana'); // assinado pelo escritório
  expect(impacto.envio).toBeNull();

  const pedido = { mudancaId: fraldas._id, clienteId: impacto.clienteId, para: 'cliente@exemplo.com', assunto: impacto.aviso.assunto, texto: impacto.aviso.texto };
  await ana.mutation(api.radar.aprovarEnvio, pedido);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const [depois] = await ana.query(api.radar.impactos, { mudancaId: fraldas._id });
  expect(depois.envio).toMatchObject({ status: 'simulado', para: 'cliente@exemplo.com' });
  await expect(ana.mutation(api.radar.aprovarEnvio, pedido)).rejects.toThrow(/já foi aprovado/);
  await expect(ana.mutation(api.radar.aprovarEnvio, { ...pedido, para: 'invalido' })).rejects.toThrow();
});

test('aplicar: cria versão derivada da tabela só para o escritório e recalcula', async () => {
  const { t, ana, fraldas } = await preparar();
  const antes = (await ana.query(api.carteira.resumo, {})).clientes[0].exposicao2027;
  await ana.mutation(api.radar.confirmar, { mudancaId: fraldas._id });
  await ana.mutation(api.radar.aplicar, { mudancaId: fraldas._id });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const resumo = await ana.query(api.carteira.resumo, {});
  expect(resumo.tabela.versao).toBe('exemplo-0.1+exemplo-fraldas');
  expect(resumo.clientes[0].versoes.tabela).toBe('exemplo-0.1+exemplo-fraldas');
  expect(resumo.clientes[0].exposicao2027).toBeLessThan(antes);
  expect((await ana.query(api.radar.mudancas, {})).map((m) => m.ref)).not.toContain('exemplo-fraldas');
  const base = await t.run((ctx) => ctx.db.query('versoesTabela').withIndex('by_versao', (q) => q.eq('versao', 'exemplo-0.1')).unique());
  expect(base!.escritorioId).toBeUndefined();
});

test('revisão: só aceita código da tabela vigente e muda a conta', async () => {
  const { t, ana } = await preparar();
  const c = (await ana.query(api.carteira.resumo, {})).clientes[0];
  const det = await ana.query(api.carteira.cliente, { clienteId: c.clienteId });
  const dipirona = det.analise!.produtos.find((p) => p.descricao === 'DIPIRONA')!;
  expect(dipirona.classificacao.status).toBe('revisar');
  await expect(ana.mutation(api.carteira.revisar, { chave: dipirona.chave, cClassTrib: '000001' })).rejects.toThrow(/não está na tabela/);
  await ana.mutation(api.carteira.revisar, { chave: dipirona.chave, cClassTrib: 'EX2002' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const depois = await ana.query(api.carteira.cliente, { clienteId: c.clienteId });
  expect(depois.analise!.produtos.find((p) => p.descricao === 'DIPIRONA')!.classificacao.status).toBe('revisado');
  expect(depois.analise!.exposicao2027).toBeLessThan(c.exposicao2027);
});

test('isolamento: cada usuário só vê e só mexe no próprio escritório', async () => {
  const { t, ana, r, fraldas } = await preparar();
  const beto = t.withIdentity(BETO);
  await beto.mutation(api.conta.criarEscritorio, { nome: 'Escritório do Beto' });
  const deBeto = await beto.action(api.notas.importar, {
    xmls: [{ nome: 'x.xml', conteudo: xml({ chave: '9'.repeat(44), emit: OUTRO, ncm: '22021000', desc: 'REFRI', valor: 10 }) }],
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);

  expect((await ana.query(api.carteira.resumo, {})).clientes.map((c) => c.cnpj)).toEqual([r.cnpj]);
  expect((await beto.query(api.carteira.resumo, {})).clientes.map((c) => c.cnpj)).toEqual([OUTRO]);
  expect(await beto.query(api.radar.mudancas, {})).toEqual([]);

  const clienteDaAna = (await ana.query(api.carteira.resumo, {})).clientes[0].clienteId;
  await expect(beto.query(api.carteira.cliente, { clienteId: clienteDaAna })).rejects.toThrow(/não encontrado/);
  await expect(ana.query(api.carteira.cliente, { clienteId: deBeto.clienteId as Id<'clientes'> })).rejects.toThrow(/não encontrado/);
  await expect(beto.query(api.radar.impactos, { mudancaId: fraldas._id })).rejects.toThrow(/não encontrad/);
  await expect(beto.mutation(api.radar.confirmar, { mudancaId: fraldas._id })).rejects.toThrow(/não encontrad/);
  await expect(beto.mutation(api.radar.aprovarEnvio, { mudancaId: fraldas._id, clienteId: clienteDaAna, para: 'a@b.com', assunto: 'x', texto: 'y' }))
    .rejects.toThrow(/não encontrad/);
  // Revisão de um escritório não muda a conta do outro
  const det = await ana.query(api.carteira.cliente, { clienteId: clienteDaAna });
  const chave = det.analise!.produtos.find((p) => p.descricao === 'DIPIRONA')!.chave;
  await beto.mutation(api.carteira.revisar, { chave, cClassTrib: 'EX2002' });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const dip = (await ana.query(api.carteira.cliente, { clienteId: clienteDaAna })).analise!.produtos.find((p) => p.descricao === 'DIPIRONA')!;
  expect(dip.classificacao.status).toBe('revisar');
});

test('demonstração: carrega a carteira sintética no próprio escritório e recomeça só se for 100% sintética', async () => {
  const t = convexTest(schema, modules);
  const ana = t.withIdentity(ANA);
  await ana.mutation(api.conta.criarEscritorio, { nome: 'Contabilidade da Ana' });
  const r = await ana.action(api.demo.carregar, {});
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(r.clientes).toBe(4);
  const resumo = await ana.query(api.carteira.resumo, {});
  expect(resumo.clientes).toHaveLength(4);
  expect(resumo.algumSintetico).toBe(true);
  expect((await ana.query(api.radar.mudancas, {})).map((m) => m.ref).sort()).toEqual(['exemplo-detergentes', 'exemplo-fraldas']);
  expect((await ana.action(api.demo.carregar, {})).notas).toBe(0); // de novo: nada duplica

  await ana.mutation(api.demo.recomecar, {});
  expect((await ana.query(api.carteira.resumo, {})).clientes).toHaveLength(0);
  expect(await ana.query(api.radar.mudancas, {})).toEqual([]);

  // Com um cliente real na carteira, recomeçar é recusado
  const real = xml({ chave: '7'.repeat(44), emit: CNPJ, ncm: '30049069', desc: 'X', valor: 10 }).replace('(SINTETICO)', 'LTDA');
  await ana.action(api.notas.importar, { xmls: [{ nome: 'r.xml', conteudo: real }] });
  await expect(ana.mutation(api.demo.recomecar, {})).rejects.toThrow(/clientes reais/);
});

test('identificar cliente: lote com mais compras que vendas não elege o fornecedor', () => {
  const compra = (i: number) => lerNota(xml({ chave: String(i).repeat(44).slice(0, 44), emit: OUTRO, dest: { cnpj: CNPJ }, ncm: '30049069', desc: 'X', valor: 10 }));
  const venda = (i: number) => lerNota(xml({ chave: String(i).repeat(44).slice(0, 44), emit: CNPJ, ncm: '30049069', desc: 'X', valor: 10 }));
  expect(identificarCliente([compra(1), compra(2), compra(3), venda(4), venda(5)])).toBe(CNPJ);
  expect(identificarCliente([compra(1)])).toBeNull(); // empate entre fornecedor e cliente: não chuta
  expect(identificarCliente([venda(4)])).toBe(CNPJ);
});
