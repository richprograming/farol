'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useQuery } from 'convex/react';

import { api } from '../../convex/_generated/api';

export function Topo() {
  const caminho = usePathname();
  const resumo = useQuery(api.carteira.resumo);
  const mudancas = useQuery(api.radar.mudancas);
  const pendentes = mudancas?.filter((m) => !m.confirmada).length ?? 0;

  // A faixa só some quando nada for exemplo: dados reais, tabela oficial e alíquotas oficiais.
  const avisos = ['Protótipo do Hack Brasil'];
  if (resumo?.algumSintetico) avisos.push('dados sintéticos');
  if (resumo?.tabela.exemplo) avisos.push('tabela de cClassTrib de exemplo');
  if (resumo?.parametros.estimativa) avisos.push('alíquotas de 2027 em diante são estimativas');

  return (
    <>
      <header className="topo">
        <div className="marca">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 2l3 5h-6l3-5zm-3 7h6l1.5 13h-9L9 9z" fill="currentColor" />
            <path d="M15.5 6.5l6-2.5M15.5 8.5l6 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span>Farol</span>
        </div>
        <nav className="abas">
          <Link className="aba" href="/" aria-current={caminho === '/' ? 'page' : undefined}>Carteira</Link>
          <Link className="aba" href="/radar" aria-current={caminho === '/radar' ? 'page' : undefined}>
            Radar {pendentes > 0 && <span className="pilula">{pendentes}</span>}
          </Link>
        </nav>
        <div className="escritorio">{resumo?.escritorio}</div>
      </header>
      <div className="faixa-aviso">{avisos.join(' · ')}</div>
    </>
  );
}
