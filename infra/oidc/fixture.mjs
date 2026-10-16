// Synthetic identities only. Secrets are supplied at runtime and never versioned.
export const webOrigin = 'https://127.0.0.1:43181';
export const nativeOrigin = 'http://127.0.0.1:43182';
export const issuer = 'http://127.0.0.1:43180/realms/us003';
export const mailOrigin = 'http://127.0.0.1:43185';

export function realmFixture({ password, clientSecret }) {
  return {
    realm: 'us003',
    enabled: true,
    sslRequired: 'none',
    loginWithEmailAllowed: true,
    registrationAllowed: false,
    resetPasswordAllowed: true,
    verifyEmail: true,
    rememberMe: false,
    bruteForceProtected: true,
    revokeRefreshToken: true,
    refreshTokenMaxReuse: 0,
    accessTokenLifespan: 60,
    ssoSessionIdleTimeout: 900,
    smtpServer: {
      host: 'mailpit',
      port: '1025',
      from: 'idp@us003.invalid',
      ssl: 'false',
      starttls: 'false',
      auth: 'false',
    },
    clients: [
      {
        clientId: 'us003-web',
        secret: clientSecret,
        publicClient: false,
        clientAuthenticatorType: 'client-secret',
        redirectUris: [webOrigin + '/callback'],
        webOrigins: [],
        attributes: {
          'pkce.code.challenge.method': 'S256',
          'post.logout.redirect.uris': webOrigin + '/signed-out',
        },
      },
      {
        clientId: 'us003-native',
        publicClient: true,
        redirectUris: [nativeOrigin + '/callback'],
        webOrigins: [],
        attributes: { 'pkce.code.challenge.method': 'S256' },
      },
    ].map((item) => ({
      ...item,
      protocol: 'openid-connect',
      enabled: true,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      serviceAccountsEnabled: false,
      defaultClientScopes: ['profile', 'email'],
    })),
    users: [
      {
        username: 'synthetic',
        email: 'synthetic@us003.invalid',
        firstName: 'Synthetic',
        lastName: 'Fixture',
        enabled: true,
        emailVerified: false,
        credentials: [{ type: 'password', value: password, temporary: false }],
      },
    ],
  };
}
