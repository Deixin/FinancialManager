import * as oidc from 'openid-client';

export async function localClient({ issuer, clientId, clientSecret }) {
  // An explicit loopback-only instrument, never a general HTTP issuer escape.
  if (issuer !== 'http://127.0.0.1:43180/realms/us003') {
    throw new Error('LOCAL_SYNTHETIC_ISSUER_REQUIRED');
  }
  const config = await oidc.discovery(
    new URL(issuer),
    clientId,
    {
      id_token_signed_response_alg: 'RS256',
      token_endpoint_auth_method: clientSecret ? 'client_secret_post' : 'none',
    },
    clientSecret ? oidc.ClientSecretPost(clientSecret) : oidc.None(),
    {
      execute: [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks],
      timeout: 10,
    },
  );
  for (const name of [
    'authorization_endpoint',
    'token_endpoint',
    'jwks_uri',
    'userinfo_endpoint',
    'revocation_endpoint',
    'end_session_endpoint',
  ]) {
    const endpoint = new URL(config.serverMetadata()[name]);
    if (
      endpoint.origin !== 'http://127.0.0.1:43180' ||
      endpoint.username ||
      endpoint.password ||
      !endpoint.pathname.startsWith('/realms/us003/')
    )
      throw new Error('LOCAL_PROVIDER_ENDPOINT_REQUIRED');
  }
  return config;
}

export async function beginAuthorization(config, redirectUri) {
  const verifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: redirectUri,
    scope: 'openid email',
    code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  });
  return { verifier, state, nonce, url, redirectUri };
}

export async function completeAuthorization(config, callback, transaction) {
  const url = new URL(callback);
  const target = new URL(transaction.redirectUri);
  if (
    url.origin !== target.origin ||
    url.pathname !== target.pathname ||
    url.hash
  ) {
    throw new Error('CALLBACK_TARGET_REJECTED');
  }
  for (const name of ['state', 'code', 'iss', 'error']) {
    if (url.searchParams.getAll(name).length > 1)
      throw new Error('DUPLICATE_CALLBACK_PARAMETER');
  }
  return await oidc.authorizationCodeGrant(config, url, {
    pkceCodeVerifier: transaction.verifier,
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    idTokenExpected: true,
  });
}

export function identityFromClaims(config, tokens) {
  const claims = tokens.claims();
  if (
    typeof claims?.sub !== 'string' ||
    !claims.sub ||
    claims.iss !== config.serverMetadata().issuer ||
    claims.email_verified !== true
  ) {
    throw new Error('VERIFIED_IDENTITY_REQUIRED');
  }
  // Equality of e-mail is never used to link identities.
  return { issuer: claims.iss, subject: claims.sub };
}

export { oidc };
