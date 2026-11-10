'use client';

import { mensagemDeErro } from './_componentes/formato';

export default function Erro({ error, retry }: { error: unknown; retry: () => void }) {
  const mensagem = mensagemDeErro(error);
  return (
    <div className="cartao">
      <h2>Algo deu errado</h2>
      <p className="erro">{mensagem}</p>
      <div className="acoes"><button className="botao secundario" onClick={() => retry()}>Tentar de novo</button></div>
    </div>
  );
}
