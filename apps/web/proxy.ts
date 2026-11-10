// Toda página do Farol exige login (WorkOS AuthKit). Só o retorno do login fica aberto.
import { authkitProxy } from '@workos-inc/authkit-nextjs';

export default authkitProxy({
  middlewareAuth: { enabled: true, unauthenticatedPaths: ['/callback'] },
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
