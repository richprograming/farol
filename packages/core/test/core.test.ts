import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { analisarCliente, CONTEXTO_PADRAO, rankingCarteira, type Cliente } from '../src/analise.ts';
import { rascunharAviso } from '../src/aviso.ts';
import { chaveProduto, classificarItem } from '../src/classificar.ts';
import { impactoDaMudanca, type Mudanca } from '../src/mudancas.ts';
import { lerNota, mascararCpf, NotaInvalidaError, type ItemNota } from '../src/nfe.ts';
import { TABELA_EXEMPLO } from '../src/tabela-exemplo.ts';
import { parseXml, XmlError } from '../src/xml.ts';
import { enviarAviso } from '../src/integracoes/resend.ts';

const FIX = join(import.meta.dirname, '..', 'fixtures');

function carregarCliente(cnpj: string): Cliente {
  const pasta = join(FIX, cnpj);
  const notas = readdirSync(pasta).filter((f) => f.endsWith('.xml')).map((f) => lerNota(readFileSync(join(pasta, f), 'utf8')));
  const venda = notas.find((n) => n.emitente.cnpj === cnpj)!;
  return { cnpj, nome: venda.emitente.nome, regime: venda.emitente.regime, notas };
}

const item = (ncm: string, descricao = 'PRODUTO', extra: Partial<ItemNota> = {}): ItemNota => ({
  nItem: 1, codigo: 'X', descricao, ncm, cfop: '5102', quantidade: 1, valor: 100, vICMS: 18, vPIS: 0.65, vCOFINS: 3, ...extra,
});

test('parser XML: namespaces, atributos, entidades e CDATA', () => {
  const r = parseXml('<?xml version="1.0"?><a:raiz xmlns:a="x" id="1"><b>R&amp;D &lt;ok&gt;</b><c><![CDATA[<cru>]]></c><d/></a:raiz>');
  assert.equal(r.name, 'raiz');
  assert.equal(r.attrs.id, '1');
  assert.equal(r.children[0].text, 'R&D <ok>');
  assert.equal(r.children[1].text, '<cru>');
  assert.equal(r.children[2].name, 'd');
});

test('parser XML: rejeita documento malformado', () => {
  assert.throws(() => parseXml('<a><b></a>'), XmlError);
  assert.throws(() => parseXml('<a>'), XmlError);
});

test('lerNota: extrai itens e mascara CPF do consumidor', () => {
  const xml = readFileSync(join(FIX, '11111111000101', 'venda-1.xml'), 'utf8');
  const n = lerNota(xml);
  assert.equal(n.emitente.cnpj, '11111111000101');
  assert.equal(n.emitente.regime, 'normal');
  assert.equal(n.modelo, '65');
  assert.ok(n.itens.length >= 1);
  assert.match(n.itens[0].ncm, /^\d{8}$/);
  if (n.destinatario?.pessoaFisica) {
    assert.match(n.destinatario.documento, /^\*\*\*\.\d{3}\.\d{3}-\*\*$/);
    assert.ok(!xml.includes(n.destinatario.documento));
  }
});

test('lerNota: erro claro quando não é NF-e', () => {
  assert.throws(() => lerNota('<html><body/></html>'), NotaInvalidaError);
  assert.throws(() => lerNota('<nfe'), NotaInvalidaError);
});

test('mascararCpf', () => {
  assert.equal(mascararCpf('123.456.789-01'), '***.456.789-**');
  assert.equal(mascararCpf('1'), '***');
});

test('classificação: tabela com tratamento único, padrão e revisão', () => {
  assert.equal(classificarItem(item('10063021'), TABELA_EXEMPLO).status, 'tabela');
  assert.equal(classificarItem(item('22021000'), TABELA_EXEMPLO).status, 'padrao');
  const med = classificarItem(item('30049069'), TABELA_EXEMPLO);
  assert.equal(med.status, 'revisar');
  assert.ok(med.precisaRevisao);
  assert.equal(med.tratamento.reducao, 0.6, 'em revisão usa o tratamento mais conservador');
});

test('classificação: decisão do contador vence e código da nota é conferido', () => {
  const it = item('30049069', 'Dipirona 500mg');
  const revisoes = new Map([[chaveProduto(it), 'EX2002']]);
  const c = classificarItem(it, TABELA_EXEMPLO, revisoes);
  assert.equal(c.status, 'revisado');
  assert.equal(c.tratamento.reducao, 1);
  const incoerente = classificarItem(item('22021000', 'Refri', { cClassTrib: 'EX2001' }), TABELA_EXEMPLO);
  assert.equal(incoerente.status, 'da_nota');
  assert.ok(incoerente.precisaRevisao);
});

test('análise: 2026 mantém a carga de hoje e 2027 muda', () => {
  const a = analisarCliente(carregarCliente('33333333000103'), TABELA_EXEMPLO);
  assert.equal(a.meses, 3);
  const p2026 = a.projecao.find((p) => p.ano === 2026)!;
  assert.ok(Math.abs(p2026.diferencaMensal) < 0.02, 'ano de teste é neutro');
  assert.notEqual(a.exposicao2027, 0);
  assert.ok(a.efeitoCaixaSplit > 0);
  assert.equal(a.projecao.length, 8);
});

test('análise: cliente do Simples recebe aviso', () => {
  const a = analisarCliente(carregarCliente('44444444000104'), TABELA_EXEMPLO);
  assert.equal(a.regime, 'simples');
  assert.ok(a.avisos.some((x) => x.includes('Simples')));
});

test('ranking da carteira ordena por exposição em 2027', () => {
  const carteira = readdirSync(FIX).filter((f) => /^\d{14}$/.test(f)).map(carregarCliente);
  const r = rankingCarteira(carteira.map((c) => analisarCliente(c, TABELA_EXEMPLO)));
  const comparaveis = r.filter((a) => a.comparavel);
  assert.deepEqual(r.slice(0, comparaveis.length), comparaveis, 'regime normal vem antes');
  for (let i = 1; i < comparaveis.length; i++) assert.ok(comparaveis[i - 1].exposicao2027 >= comparaveis[i].exposicao2027);
  assert.equal(r.at(-1)!.regime, 'simples');
});

const MUDANCA: Mudanca = {
  id: 'teste-1',
  titulo: 'Exemplo: refrigerantes passam a ter redução de 60%',
  resumo: 'Mudança fictícia para teste.',
  fonte: 'https://exemplo.gov.br/norma',
  publicadaEm: '2026-11-06',
  efeito: { tipo: 'novo_tratamento_ncm', ncmPrefixos: ['2202'],
    tratamento: { cClassTrib: 'EX2099', descricao: 'Exemplo', reducao: 0.6, baseLegal: 'Norma fictícia' } },
  confirmada: true,
};

test('impacto da mudança: só o cliente que vende o NCM é afetado, e paga menos', () => {
  const carteira = readdirSync(FIX).filter((f) => /^\d{14}$/.test(f)).map(carregarCliente);
  const afetados = impactoDaMudanca(carteira, TABELA_EXEMPLO, MUDANCA);
  assert.deepEqual(afetados.map((a) => a.cnpj), ['11111111000101']);
  assert.ok(afetados[0].variacaoMensal < 0);
  assert.ok(afetados[0].produtosAfetados.some((p) => p.ncm === '22021000'));
});

test('impacto exige mudança confirmada', () => {
  assert.throws(() => impactoDaMudanca([], TABELA_EXEMPLO, { ...MUDANCA, confirmada: false }));
});

test('aviso: rascunho não pode ser enviado sem aprovação; aprovado vai em modo simulação', async () => {
  const carteira = [carregarCliente('11111111000101')];
  const [afetado] = impactoDaMudanca(carteira, TABELA_EXEMPLO, MUDANCA);
  const aviso = rascunharAviso('Contabilidade Exemplo', afetado, MUDANCA, 'cliente@exemplo.com');
  assert.match(aviso.texto, /reduz/);
  assert.ok(aviso.texto.includes(MUDANCA.fonte));
  await assert.rejects(() => enviarAviso(aviso, 'x', ''));
  const r = await enviarAviso({ ...aviso, aprovado: true }, 'x', '');
  assert.equal(r.simulado, true);
});

test('contexto do cálculo: versões e transição vêm de quem chama', () => {
  const cliente = carregarCliente('33333333000103');
  const padrao = analisarCliente(cliente, TABELA_EXEMPLO);
  assert.deepEqual(padrao.versoes, { parametros: CONTEXTO_PADRAO.versoes.parametros, tabela: CONTEXTO_PADRAO.versoes.tabela });
  const so2027 = CONTEXTO_PADRAO.transicao.filter((t) => t.ano === 2027);
  const a = analisarCliente(cliente, TABELA_EXEMPLO, new Map(), { transicao: so2027, versoes: { parametros: 'p-teste', tabela: 't-teste' } });
  assert.deepEqual(a.versoes, { parametros: 'p-teste', tabela: 't-teste' });
  assert.deepEqual(a.projecao.map((p) => p.ano), [2027]);
  assert.equal(a.exposicao2027, padrao.exposicao2027, 'mesma conta com os mesmos parâmetros');
  const [afetado] = impactoDaMudanca([carregarCliente('11111111000101')], TABELA_EXEMPLO, MUDANCA, new Map(),
    { transicao: CONTEXTO_PADRAO.transicao, versoes: { parametros: 'p-teste', tabela: 't-teste' } });
  assert.equal(afetado.analiseDepois.versoes.tabela, `t-teste+${MUDANCA.id}`);
});
