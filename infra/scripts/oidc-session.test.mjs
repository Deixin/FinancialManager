import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ExpiringStore,
  readCookie,
} from '../../apps/web/spikes/us-003/bff.mjs';
import {
  localClient,
  completeAuthorization,
  identityFromClaims,
} from '../../apps/web/spikes/us-003/oidc.mjs';

test('OIDC pending state is consumed once, expires, and releases bounded capacity', () => {
  let now = 0;
  const store = new ExpiringStore(100, 1, () => now);
  store.put('pending', { browser: 'first' });
  assert.throws(() => store.put('second', {}), /CAPACITY_REACHED/);
  assert.deepEqual(store.take('pending'), { browser: 'first' });
  assert.equal(store.take('pending'), undefined);
  store.put('expired', {});
  now = 100;
  assert.equal(store.get('expired'), undefined);
  store.put('next', {});
  store.clear();
  assert.equal(store.get('next'), undefined);
});

test('OIDC session cookies reject ambiguous or malformed values', () => {
  const id = 'A'.repeat(43);
  assert.equal(
    readCookie(
      'other=value; __Host-us003-session=' + id,
      '__Host-us003-session',
    ),
    id,
  );
  for (const header of [
    undefined,
    '__Host-us003-session=bad',
    `__Host-us003-session=${id}; __Host-us003-session=${id}`,
    `__Host-us003-session=${id}%20`,
  ]) {
    assert.equal(readCookie(header, '__Host-us003-session'), undefined);
  }
});

test('OIDC instrument rejects other issuers and callback targets before contacting a provider', async () => {
  await assert.rejects(
    localClient({ issuer: 'http://example.com', clientId: 'test' }),
    /LOCAL_SYNTHETIC_ISSUER_REQUIRED/,
  );
  const transaction = { redirectUri: 'https://127.0.0.1:43181/callback' };
  for (const callback of [
    'https://attacker.invalid/callback?code=x',
    'https://127.0.0.1:43181/other?code=x',
    'https://127.0.0.1:43181/callback#code=x',
    'https://127.0.0.1:43181/callback?code=x&code=y',
  ]) {
    await assert.rejects(
      completeAuthorization(undefined, callback, transaction),
    );
  }
});

test('OIDC identity requires verified e-mail and keys identity by issuer and subject', () => {
  const config = {
    serverMetadata: () => ({ issuer: 'https://issuer.invalid' }),
  };
  const tokens = (claims) => ({ claims: () => claims });
  const verified = {
    iss: 'https://issuer.invalid',
    sub: 'subject-a',
    email: 'same@synthetic.invalid',
    email_verified: true,
  };
  assert.deepEqual(identityFromClaims(config, tokens(verified)), {
    issuer: verified.iss,
    subject: 'subject-a',
  });
  assert.notDeepEqual(
    identityFromClaims(config, tokens(verified)),
    identityFromClaims(config, tokens({ ...verified, sub: 'subject-b' })),
  );
  for (const claims of [
    { ...verified, email_verified: false },
    { ...verified, email_verified: 'true' },
    { ...verified, iss: 'https://other.invalid' },
    { ...verified, sub: '' },
  ]) {
    assert.throws(
      () => identityFromClaims(config, tokens(claims)),
      /VERIFIED_IDENTITY_REQUIRED/,
    );
  }
});
