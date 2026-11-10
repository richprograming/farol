import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Entrada } from './_componentes/Entrada';
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
          <Entrada>{children}</Entrada>
        </Providers>
      </body>
    </html>
  );
}
