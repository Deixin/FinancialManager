export const requiredOidcChecks = [
  'docker_isolation',
  'email_verification',
  'bff_cookie_and_browser_storage',
  'csrf_rejection',
  'bff_refresh',
  'logout_local_and_provider',
  'password_recovery_at_provider',
  'public_client_pkce',
  'code_replay_rejected',
  'wrong_verifier_rejected',
  'nonce_and_state_rejected',
  'signature_tampering_rejected',
  'refresh_rotation_and_revocation',
  'callback_binding_expiry_and_replay',
  'session_expiry',
];

export function validateOidcEvidence(report) {
  if (
    report?.format_version !== 1 ||
    report.synthetic_only !== true ||
    report.scope !== 'local-oidc-protocol' ||
    report.passed !== true ||
    report.containers_and_synthetic_secrets_removed !== true ||
    !Number.isFinite(Date.parse(report.completed_at_utc))
  )
    throw new Error('OIDC_EVIDENCE_INCOMPLETE');
  for (const name of requiredOidcChecks)
    if (report.checks?.[name] !== true)
      throw new Error('OIDC_CHECK_MISSING: ' + name);
  for (const pending of [
    'google',
    'apple',
    'native-system-browser-deep-link-and-secret-store',
    'nextjs-integration',
  ])
    if (!report.pending?.includes(pending))
      throw new Error('OIDC_SCOPE_OVERCLAIMED');
  const permitted = [
    'format_version',
    'synthetic_only',
    'scope',
    'passed',
    'completed_at_utc',
    'checks',
    'pending',
    'versions',
    'containers_and_synthetic_secrets_removed',
  ];
  const versionKeys = [
    'keycloak',
    'mailpit',
    'caddy',
    'openid_client',
    'playwright',
    'node',
    'chromium',
  ];
  if (
    !report.versions ||
    Object.keys(report.versions).length !== versionKeys.length ||
    versionKeys.some(
      (key) =>
        typeof report.versions[key] !== 'string' ||
        !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(report.versions[key]),
    ) ||
    report.pending.length !== 4
  )
    throw new Error('OIDC_EVIDENCE_UNEXPECTED_FIELD');
  if (
    Object.keys(report).some((key) => !permitted.includes(key)) ||
    Object.keys(report.checks).some((key) => !requiredOidcChecks.includes(key))
  )
    throw new Error('OIDC_EVIDENCE_UNEXPECTED_FIELD');
  return report;
}
