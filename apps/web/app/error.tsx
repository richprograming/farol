'use client';

export default function Erro({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="cartao">
      <h2>Algo deu errado</h2>
      <p className="erro">{error.message}</p>
      <div className="acoes"><button className="botao secundario" onClick={reset}>Tentar de novo</button></div>
    </div>
  );
}
