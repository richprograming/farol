'use client';

import { useConvexAuth, useMutation, useQuery } from 'convex/react';
import { useState, type FormEvent, type ReactNode } from 'react';

import { mensagemDeErro } from './formato';
import { api } from '../../convex/_generated/api';
import { sair } from '../acoes';
import { Topo } from './Topo';

/** Só mostra o app depois do login validado pelo Convex e com um escritório criado. */
export function Entrada({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const eu = useQuery(api.conta.eu, isAuthenticated ? {} : 'skip');

  if (isLoading || (isAuthenticated && eu === undefined)) return <main><p className="sub">Carregando…</p></main>;
  if (!isAuthenticated || !eu?.logado) {
    return (
      <main>
        <div className="cartao">
          <h2>Sessão não reconhecida</h2>
          <p className="sub">O login não foi aceito pelo servidor. Saia e entre de novo.</p>
          <form action={sair} className="acoes"><button className="botao" type="submit">Sair</button></form>
        </div>
      </main>
    );
  }
  if (!eu.escritorio) return <main><CriarEscritorio email={eu.email} /></main>;
  return (
    <>
      <Topo email={eu.email} />
      <main>{children}</main>
    </>
  );
}

function CriarEscritorio({ email }: { email: string }) {
  const criar = useMutation(api.conta.criarEscritorio);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nome = (e.currentTarget.elements.namedItem('nome') as HTMLInputElement).value;
    setEnviando(true);
    setErro('');
    try {
      await criar({ nome });
    } catch (x) {
      setErro(mensagemDeErro(x));
      setEnviando(false);
    }
  }

  return (
    <form className="cartao envio" onSubmit={enviar}>
      <h2>Bem-vindo ao Farol</h2>
      <p className="sub">
        Você entrou como {email}. Para começar, crie o seu escritório: você será o dono, e os clientes, notas e avisos
        ficam visíveis só para quem é do escritório.
      </p>
      <label>Nome do escritório (assina os avisos aos clientes)
        <input name="nome" required minLength={2} maxLength={120} placeholder="Contabilidade Exemplo" autoFocus />
      </label>
      <div className="acoes">
        <button className="botao" type="submit" disabled={enviando}>{enviando ? 'Criando…' : 'Criar escritório'}</button>
      </div>
      {erro && <p className="erro">{erro}</p>}
    </form>
  );
}
