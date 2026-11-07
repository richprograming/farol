import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Topo } from './_componentes/Topo';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Farol — a reforma, cliente por cliente',
  description: 'Radar da reforma tributária para escritórios contábeis',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Providers>
          <Topo />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
