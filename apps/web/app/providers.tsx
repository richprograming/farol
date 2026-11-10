'use client';

import { AuthKitProvider, useAccessToken, useAuth } from '@workos-inc/authkit-nextjs/components';
import { ConvexProviderWithAuth, ConvexReactClient } from 'convex/react';
import { useCallback, useMemo, type ReactNode } from 'react';

const url = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = url ? new ConvexReactClient(url) : null;

/** Entrega ao Convex o access token do WorkOS; o Convex valida (convex/auth.config.ts). */
function useAuthDoWorkOS() {
  const { user, loading } = useAuth();
  const { getAccessToken, refresh } = useAccessToken();
  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    if (!user) return null;
    try {
      return (forceRefreshToken ? await refresh() : await getAccessToken()) ?? null;
    } catch {
      return null;
    }
  }, [user, refresh, getAccessToken]);
  return useMemo(() => ({ isLoading: loading, isAuthenticated: Boolean(user), fetchAccessToken }), [loading, user, fetchAccessToken]);
}

export function Providers({ children }: { children: ReactNode }) {
  if (!convex) {
    return <main><p className="erro">NEXT_PUBLIC_CONVEX_URL não definida. Rode <code>npm run convex</code> na raiz.</p></main>;
  }
  return (
    <AuthKitProvider>
      <ConvexProviderWithAuth client={convex} useAuth={useAuthDoWorkOS}>{children}</ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}
