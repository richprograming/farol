// O Convex aceita os access tokens (JWT) emitidos pelo WorkOS AuthKit para este client.
// WORKOS_CLIENT_ID precisa estar nas variáveis do deployment: `npx convex env set WORKOS_CLIENT_ID client_...`.

const clientId = process.env.WORKOS_CLIENT_ID;

export default {
  providers: [
    {
      type: 'customJwt',
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
    {
      type: 'customJwt',
      issuer: 'https://api.workos.com/',
      algorithm: 'RS256',
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
  ],
};
