'use client';

import { ConvexError } from 'convex/values';

export default function Erro({ error, retry }: { error: unknown; retry: () => void }) {
  const mensagem = error instanceof ConvexError ? String(error.data)
    : error instanceof Error ? error.message : 'Erro inesperado.';
  return (
    <div className="cartao">
      <h2>Algo deu errado</h2>
      <p className="erro">{mensagem}</p>
      <div className="acoes"><button className="botao secundario" onClick={() => retry()}>Tentar de novo</button></div>
    </div>
  );
}
