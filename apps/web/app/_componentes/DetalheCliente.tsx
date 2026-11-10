'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';

import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { brl, REGIME, sinal, STATUS, mensagemDeErro } from './formato';

type Produto = Doc<'analises'>['produtos'][number];

export function DetalheCliente({ clienteId }: { clienteId: Id<'clientes'> }) {
  const dados = useQuery(api.carteira.cliente, { clienteId });
  if (dados === undefined) return <div className="cartao"><p className="sub">Carregando…</p></div>;
  const a = dados.analise;
  if (!a) return <div className="cartao"><h2>{dados.cliente.nome}</h2><p className="calculando">Calculando…</p></div>;

  // Regime normal: diferença contra hoje. Simples/MEI: carga simulada no regime regular (o DAS não está nas notas).
  const valor = (p: (typeof a.projecao)[number]) => (a.comparavel ? p.diferencaMensal : p.cargaMensal);
  const maxAbs = Math.max(1, ...a.projecao.map((p) => Math.abs(valor(p))));

  return (
    <div className="cartao">
      <h2>{a.nome}</h2>
      <p className="sub">
        {REGIME[a.regime]} · {a.meses} {a.meses === 1 ? 'mês' : 'meses'} de notas · parâmetros {a.versoes.parametros} · tabela {a.versoes.tabela}
      </p>
      {a.avisos.length > 0 && <ul className="avisos">{a.avisos.map((t) => <li key={t}>{t}</li>)}</ul>}
      <div className="grade-detalhe">
        <div>
          <h3>{a.comparavel ? 'Variação mensal estimada contra hoje' : 'Carga mensal simulada no regime regular'}</h3>
          <div className="barras">
            {a.projecao.map((p) => {
              const v = valor(p);
              const w = (Math.abs(v) / maxAbs) * 50;
              return [
                <div key={`a${p.ano}`}>{p.ano}</div>,
                <div key={`t${p.ano}`} className="trilho" title={`${p.ano}: carga estimada ${brl(p.cargaMensal)}/mês`}>
                  <div className="eixo" />
                  <div className={`barra ${v >= 0 ? 'mais' : 'menos'}`} style={{ left: `${v >= 0 ? 50 : 50 - w}%`, width: `${w}%` }} />
                </div>,
                <div key={`v${p.ano}`} className={`num ${p.estimativa ? 'estimativa' : ''}`}>{a.comparavel ? sinal(v) : brl(v)}</div>,
              ];
            })}
          </div>
          <p className="citacao">Vermelho = paga mais; verde = paga menos. Valores em cinza usam alíquotas ainda estimadas.</p>
        </div>
        <div>
          <h3>Split payment (cenário 2027)</h3>
          <p className="sub">
            Com o imposto separado no recebimento, cerca de {brl(a.efeitoCaixaSplit)} deixam de ficar no caixa do cliente.
            Premissa: hoje o tributo sai ~25 dias depois do recebimento.
          </p>
          <h3>Premissas da conta</h3>
          <p className="citacao">
            Base de CBS/IBS = valor do item. Crédito só sobre compras com nota enviada. ICMS = vendas − compras.
            PIS/Cofins cumulativos. ISS fora. Média mensal do período.
          </p>
        </div>
      </div>
      <h3>Produtos ({a.produtos.length})</h3>
      <table className="tabela">
        <thead><tr><th>Produto</th><th>NCM</th><th className="num">Vendas no período</th><th>Tratamento</th></tr></thead>
        <tbody>{a.produtos.map((p) => <LinhaProduto key={p.chave} p={p} />)}</tbody>
      </table>
    </div>
  );
}

function LinhaProduto({ p }: { p: Produto }) {
  const c = p.classificacao;
  const [rotulo, tom] = STATUS[c.status];
  const revisar = useMutation(api.carteira.revisar);
  const [escolha, setEscolha] = useState(c.tratamento.cClassTrib);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  return (
    <tr>
      <td>{p.descricao}</td>
      <td>{p.ncm}</td>
      <td className="num">{brl(p.valorVendas)}</td>
      <td>
        {c.precisaRevisao ? (
          <div className="revisao">
            <span className={`pilula ${tom}`}>{rotulo}</span>{' '}
            <select aria-label={`Tratamento de ${p.descricao}`} value={escolha} onChange={(e) => setEscolha(e.target.value)}>
              {c.candidatos.map((t) => <option key={t.cClassTrib} value={t.cClassTrib}>{t.cClassTrib} · {t.descricao}</option>)}
            </select>{' '}
            <button className="botao secundario" disabled={salvando} onClick={async () => {
              setSalvando(true);
              setErro('');
              try {
                await revisar({ chave: p.chave, cClassTrib: escolha });
              } catch (e) {
                setErro(mensagemDeErro(e));
                setSalvando(false);
              }
            }}>{salvando ? 'Recalculando…' : 'Confirmar'}</button>
            <div className="citacao">{c.motivo}</div>
            {erro && <div className="erro">{erro}</div>}
          </div>
        ) : (
          <div>
            <span className={`pilula ${tom}`}>{rotulo}</span> {c.tratamento.cClassTrib} · {c.tratamento.descricao}
            <div className="citacao">{c.tratamento.baseLegal}</div>
          </div>
        )}
      </td>
    </tr>
  );
}
