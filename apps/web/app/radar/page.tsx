'use client';

import { useMutation, useQuery } from 'convex/react';
import { useState } from 'react';

import { api } from '../../convex/_generated/api';
import type { Doc, Id } from '../../convex/_generated/dataModel';
import { data, sinal, mensagemDeErro } from '../_componentes/formato';

export default function Radar() {
  const mudancas = useQuery(api.radar.mudancas);
  return (
    <section>
      <div className="cabecalho-secao">
        <div>
          <h1>Radar</h1>
          <p className="sub">
            Mudanças normativas detectadas nas fontes oficiais. Confirme a leitura antes de calcular o impacto; nenhum aviso sai sem a sua aprovação.
          </p>
        </div>
      </div>
      {mudancas === undefined ? <p className="sub">Carregando…</p>
        : mudancas.length === 0 ? <div className="cartao vazio">Nenhuma mudança pendente.</div>
          : mudancas.map((m) => <CartaoMudanca key={m._id} m={m} />)}
    </section>
  );
}

type Mudanca = Doc<'mudancas'> & { afetados: number | null; calculando: boolean };

function CartaoMudanca({ m }: { m: Mudanca }) {
  const confirmar = useMutation(api.radar.confirmar);
  const aplicar = useMutation(api.radar.aplicar);
  const [ocupado, setOcupado] = useState(false);

  return (
    <div className="cartao mudanca">
      <h2>{m.titulo}</h2>
      <div className="meta">
        Publicada em {data(m.publicadaEm)}{m.vigenciaDesde ? ` · vigência ${data(m.vigenciaDesde)}` : ''} ·{' '}
        <a href={m.fonte} target="_blank" rel="noopener noreferrer">fonte</a>
      </div>
      <p className="sub">{m.resumo}</p>
      {m.confirmada ? (
        <>
          <p className="sub">
            <span className="pilula bom">Confirmada</span>{' '}
            {m.calculando ? <span className="calculando">calculando impacto…</span> : `${m.afetados} cliente(s) afetado(s)`}
          </p>
          <Afetados mudancaId={m._id} />
          {!m.calculando && (
            <div className="acoes">
              <button className="botao secundario" disabled={ocupado} title="Cria uma nova versão da tabela do escritório com esta mudança"
                onClick={async () => { setOcupado(true); await aplicar({ mudancaId: m._id }).finally(() => setOcupado(false)); }}>
                Incorporar à tabela do escritório
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="acoes">
          <button className="botao" disabled={ocupado}
            onClick={async () => { setOcupado(true); await confirmar({ mudancaId: m._id }).finally(() => setOcupado(false)); }}>
            Leitura correta: calcular impacto
          </button>
        </div>
      )}
    </div>
  );
}

function Afetados({ mudancaId }: { mudancaId: Id<'mudancas'> }) {
  const lista = useQuery(api.radar.impactos, { mudancaId });
  if (!lista) return null;
  if (lista.length === 0) return null;
  return <>{lista.map((a) => <Afetado key={a._id} a={a} />)}</>;
}

type Impacto = Doc<'impactos'> & { envio: Doc<'envios'> | null };

function Afetado({ a }: { a: Impacto }) {
  const aprovar = useMutation(api.radar.aprovarEnvio);
  const [para, setPara] = useState(a.envio?.para ?? a.aviso.para);
  const [assunto, setAssunto] = useState(a.aviso.assunto);
  const [texto, setTexto] = useState(a.aviso.texto);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const e = a.envio;
  const bloqueado = enviando || (e !== null && e.status !== 'erro');

  let status = erro;
  if (e?.status === 'enviando') status = 'Aprovado. Enviando…';
  if (e?.status === 'simulado') status = `Aprovado. Envio simulado (sem RESEND_API_KEY) para ${e.para}.`;
  if (e?.status === 'enviado') status = `Enviado para ${e.para} · id ${e.resendId}`;
  if (e?.status === 'erro' && !erro) status = `Falha no envio: ${e.erro}. Revise e tente de novo.`;

  return (
    <div className="afetado">
      <div className="afetado-topo">
        <div>
          <div className="nome-cliente">{a.nome}</div>
          <div className="citacao">{a.produtosAfetados.map((p) => `${p.descricao}: ${p.de} → ${p.para}`).join(' · ')}</div>
        </div>
        <div className={a.variacaoMensal > 0 ? 'mais' : 'menos'}>{sinal(a.variacaoMensal)}/mês em 2027</div>
      </div>
      <div className="linha-form"><span>Para</span><input type="email" aria-label="E-mail do cliente" value={para} onChange={(x) => setPara(x.target.value)} disabled={bloqueado} /></div>
      <div className="linha-form"><span>Assunto</span><input type="text" aria-label="Assunto" value={assunto} onChange={(x) => setAssunto(x.target.value)} disabled={bloqueado} /></div>
      <textarea aria-label="Texto do aviso" value={texto} onChange={(x) => setTexto(x.target.value)} disabled={bloqueado} />
      <div className="acoes">
        <button className="botao" disabled={bloqueado} onClick={async () => {
          setEnviando(true);
          setErro('');
          try {
            await aprovar({ mudancaId: a.mudancaId, clienteId: a.clienteId, para, assunto, texto });
          } catch (x) {
            setErro(mensagemDeErro(x));
          } finally {
            setEnviando(false);
          }
        }}>{e && e.status !== 'erro' ? 'Aprovado' : 'Aprovar e enviar'}</button>
        <span className="sub" role="status">{status}</span>
      </div>
    </div>
  );
}
