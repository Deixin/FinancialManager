import assert from 'node:assert/strict';
import test from 'node:test';
import { requiredOidcChecks, validateOidcEvidence } from './oidc-evidence.mjs';

const evidence = () => ({
  format_version: 1,
  synthetic_only: true,
  scope: 'local-oidc-protocol',
  passed: true,
  completed_at_utc: '2026-10-15T23:00:00.000Z',
  checks: Object.fromEntries(requiredOidcChecks.map((name) => [name, true])),
  pending: [
    'google',
    'apple',
    'native-system-browser-deep-link-and-secret-store',
    'nextjs-integration',
  ],
  containers_and_synthetic_secrets_removed: true,
  versions: {
    keycloak: '26.8.0',
    mailpit: '1.27.4',
    caddy: '2.10.2',
    openid_client: '6.8.8',
    playwright: '1.64.1',
    node: '24.19.0',
    chromium: '156.0.8078.4',
  },
});

test('OIDC evidence requires every real protocol check and completed cleanup', () => {
  assert.equal(validateOidcEvidence(evidence()).passed, true);
  for (const name of requiredOidcChecks) {
    const report = evidence();
    delete report.checks[name];
    assert.throws(() => validateOidcEvidence(report), /OIDC_CHECK_MISSING/);
  }
  for (const patch of [
    { passed: false },
    { synthetic_only: false },
    { containers_and_synthetic_secrets_removed: false },
    { completed_at_utc: 'invalid' },
  ])
    assert.throws(() => validateOidcEvidence({ ...evidence(), ...patch }));
});

test('OIDC evidence cannot claim Google, Apple, native app integration or include secret fields', () => {
  for (const pending of evidence().pending)
    assert.throws(
      () =>
        validateOidcEvidence({
          ...evidence(),
          pending: evidence().pending.filter((value) => value !== pending),
        }),
      /OIDC_SCOPE_OVERCLAIMED/,
    );
  assert.throws(
    () =>
      validateOidcEvidence({
        ...evidence(),
        access_token: 'synthetic-placeholder',
      }),
    /UNEXPECTED_FIELD/,
  );
  assert.throws(
    () =>
      validateOidcEvidence({
        ...evidence(),
        versions: { ...evidence().versions, password: 'synthetic-placeholder' },
      }),
    /UNEXPECTED_FIELD/,
  );
});
