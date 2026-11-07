'use client';

import { ConvexProvider, ConvexReactClient } from 'convex/react';
import type { ReactNode } from 'react';

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = url ? new ConvexReactClient(url) : null;

export function Providers({ children }: { children: ReactNode }) {
  if (!convex) {
    return <main><p className="erro">NEXT_PUBLIC_CONVEX_URL não definida. Rode <code>npx convex dev</code> em apps/web.</p></main>;
  }
  return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
