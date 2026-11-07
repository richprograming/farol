'use client';

import { useQuery } from 'convex/react';
import { useState } from 'react';

import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { AdicionarCliente } from './_componentes/AdicionarCliente';
import { DetalheCliente } from './_componentes/DetalheCliente';
import { brl, formatarCnpj, REGIME, sinal } from './_componentes/formato';

export default function Carteira() {
  const resumo = useQuery(api.carteira.resumo);
  const [selecionado, setSelecionado] = useState<Id<'clientes'> | null>(null);
  const [envioAberto, setEnvioAberto] = useState(false);

  if (resumo === undefined) return <p className="sub">Carregando…</p>;
  const c = resumo.clientes;
  const atual = selecionado ?? c[0]?.clienteId ?? null;
  const exposicao = c.filter((x) => x.comparavel).reduce((s, x) => s + x.exposicao2027, 0);
  const caixa = c.reduce((s, x) => s + x.efeitoCaixaSplit, 0);
  const revisar = c.reduce((s, x) => s + x.itensParaRevisar, 0);

  return (
    <section>
      <div className="cabecalho-secao">
        <div>
          <h1>Carteira</h1>
          <p className="sub">Clientes ordenados por quanto a estimativa de tributos muda em 2027, quando a CBS passa a ser cobrada.</p>
        </div>
        <button className="botao" onClick={() => setEnvioAberto(true)}>Adicionar cliente</button>
      </div>

      {envioAberto && (
        <AdicionarCliente
          aoFechar={() => setEnvioAberto(false)}
          aoImportar={(clienteId) => setSelecionado(clienteId)}
        />
      )}

      <div className="numeros">
        <Numero rotulo="Clientes na carteira" valor={c.length + resumo.pendentes.length} />
        <Numero rotulo="Variação mensal em 2027 (regime normal)" valor={sinal(exposicao)} />
        <Numero rotulo="Caixa que o split payment retém" valor={brl(caixa)} />
        <Numero rotulo="Produtos para revisar" valor={revisar} />
      </div>

      <div className="cartao sem-padding">
        <table className="tabela">
          {c.length + resumo.pendentes.length === 0 ? (
            <tbody><tr><td className="vazio">Nenhum cliente ainda. Use &quot;Adicionar cliente&quot; para subir os XMLs.</td></tr></tbody>
          ) : (
            <>
              <thead>
                <tr>
                  <th>Cliente</th><th>Regime</th><th className="num">Vendas/mês</th><th className="num">Tributos hoje/mês</th>
                  <th className="num">Variação 2027/mês</th><th className="num">Caixa (split)</th><th>Revisar</th>
                </tr>
              </thead>
              <tbody>
                {c.map((x) => (
                  <tr key={x.clienteId} tabIndex={0} className={`clicavel${atual === x.clienteId ? ' ativo' : ''}`}
                    onClick={() => setSelecionado(x.clienteId)} onKeyDown={(e) => e.key === 'Enter' && setSelecionado(x.clienteId)}>
                    <td><div className="nome-cliente">{x.nome}</div><div className="citacao">{formatarCnpj(x.cnpj)}</div></td>
                    <td>{REGIME[x.regime]}</td>
                    <td className="num">{brl(x.vendasMensais)}</td>
                    <td className="num">{x.comparavel ? brl(x.cargaAtualMensal) : <span className="citacao" title="O DAS não aparece nas notas">DAS</span>}</td>
                    {x.comparavel
                      ? <td className={`num ${x.exposicao2027 > 0 ? 'mais' : 'menos'}`}>{sinal(x.exposicao2027)}</td>
                      : <td className="num"><span className="pilula" title="Simular a opção pelo regime regular">avaliar opção</span></td>}
                    <td className="num">{brl(x.efeitoCaixaSplit)}</td>
                    <td>{x.itensParaRevisar ? <span className="pilula alerta">{x.itensParaRevisar}</span> : '—'}</td>
                  </tr>
                ))}
                {resumo.pendentes.map((x) => (
                  <tr key={x.clienteId}>
                    <td><div className="nome-cliente">{x.nome}</div><div className="citacao">{formatarCnpj(x.cnpj)}</div></td>
                    <td colSpan={6} className="calculando">Calculando…</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
      </div>

      {atual && <DetalheCliente clienteId={atual} />}
    </section>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string | number }) {
  return <div className="numero"><div className="rotulo">{rotulo}</div><div className="valor">{valor}</div></div>;
}
