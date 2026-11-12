'use client';

import { useAction, useQuery } from 'convex/react';
import { useState } from 'react';

import { api } from '../../convex/_generated/api';
import { brl, mensagemDeErro } from '../_componentes/formato';

export default function Plano() {
  const plano = useQuery(api.plano.atual);
  const assinar = useAction(api.plano.assinar);
  const conferir = useAction(api.plano.conferir);
  const [estado, setEstado] = useState('');
  const ocupado = estado === 'abrindo' || estado === 'conferindo';

  if (plano === undefined) return <p className="sub">Carregando…</p>;
  const dia = (ms: number) => new Date(ms).toLocaleDateString('pt-BR');

  return (
    <section>
      <div className="cabecalho-secao">
        <div>
          <h1>Plano</h1>
          <p className="sub">O pagamento é feito na página da AbacatePay (Pix ou cartão). O Farol não recebe nem guarda dados de pagamento.</p>
        </div>
      </div>
      <div className="cartao">
        {plano.paga ? (
          <>
            <h2><span className="pilula bom">Plano pago</span></h2>
            <p className="sub">
              Pagamento de {brl(plano.paga.valorCentavos / 100)} confirmado pela AbacatePay em {dia(plano.paga.pagaEm)}.
              {plano.paga.teste && ' Feito em modo de teste da AbacatePay: nenhum dinheiro foi cobrado.'}
            </p>
          </>
        ) : !plano.configurado ? (
          <>
            <h2>Cobrança não configurada</h2>
            <p className="sub">Este ambiente não tem a AbacatePay configurada. Todas as funções do Farol seguem liberadas.</p>
          </>
        ) : (
          <>
            <h2>{plano.pendente ? 'Pagamento em aberto' : 'Assinar o Farol'}</h2>
            <p className="sub">
              {plano.pendente
                ? `Há uma cobrança de ${brl(plano.pendente.valorCentavos / 100)} aberta em ${dia(plano.pendente.criadaEm)}.`
                : 'O valor aparece na página de pagamento, antes de você confirmar.'}
              {plano.pendente?.teste && ' Modo de teste da AbacatePay: nenhum dinheiro é cobrado.'}
            </p>
            <div className="acoes">
              {plano.pendente && <a className="botao" href={plano.pendente.url} target="_blank" rel="noopener noreferrer">Abrir página de pagamento</a>}
              <button className={`botao${plano.pendente ? ' secundario' : ''}`} disabled={ocupado} onClick={async () => {
                setEstado('abrindo');
                try {
                  const { url } = await assinar({ origem: window.location.origin });
                  window.location.assign(url);
                } catch (e) {
                  setEstado(mensagemDeErro(e));
                }
              }}>{estado === 'abrindo' ? 'Abrindo…' : plano.pendente ? 'Gerar nova cobrança' : 'Ir para o pagamento'}</button>
              {plano.pendente && (
                <button className="botao secundario" disabled={ocupado} onClick={async () => {
                  setEstado('conferindo');
                  try {
                    setEstado((await conferir({})) ? '' : 'A AbacatePay ainda não confirmou o pagamento.');
                  } catch (e) {
                    setEstado(mensagemDeErro(e));
                  }
                }}>{estado === 'conferindo' ? 'Conferindo…' : 'Já paguei'}</button>
              )}
            </div>
            {estado && !ocupado && <p className="erro" role="status">{estado}</p>}
          </>
        )}
      </div>
    </section>
  );
}
