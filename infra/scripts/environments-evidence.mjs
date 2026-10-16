import { manifest, sourceHashes } from '../environments/runtime.mjs';
import { profileNames } from '../environments/model.mjs';

export const requiredProfileChecks = Object.freeze([
  'pinned_images',
  'loopback_ports',
  'isolated_network',
  'ephemeral_storage',
  'private_runtime_credentials',
  'database_marker',
  'runtime_role_restricted',
  'identity_database_isolated',
  'tls_pinned_to_profile',
  'oidc_discovery_and_jwks',
  'mail_sink_ready',
  'logs_without_credentials',
]);
export const requiredEnvironmentChecks = Object.freeze([
  'failed_start_preserves_recoverable_cleanup',
  'exclusive_test_refuses_existing_instance',
  'cross_profile_credentials_rejected',
  'cross_profile_tls_trust_rejected',
  'repeated_up_preserves_instance',
  'recreation_rotates_credentials_and_instance',
  'all_owned_containers_networks_and_secrets_removed',
]);
const pending = [
  'product-api-bff-worker',
  'object-storage-adapter',
  'remote-staging-and-production',
  'native-client-runtime-integration',
];
function exactKeys(value, keys) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',')
  );
}
const fail = () => {
  throw new Error('ENVIRONMENT_EVIDENCE_INVALID');
};
export function validateEnvironmentEvidence(
  report,
  { matchSources = true } = {},
) {
  if (
    !exactKeys(report, [
      'format_version',
      'scope',
      'synthetic_only',
      'started_at_utc',
      'completed_at_utc',
      'passed',
      'profiles',
      'checks',
      'versions',
      'images',
      'source_sha256',
      'pending',
    ]) ||
    report.format_version !== 1 ||
    report.synthetic_only !== true ||
    report.scope !== 'docker-local-foundation-environments' ||
    report.passed !== true
  )
    fail();
  for (const name of ['started_at_utc', 'completed_at_utc'])
    if (
      typeof report[name] !== 'string' ||
      !Number.isFinite(Date.parse(report[name])) ||
      new Date(report[name]).toISOString() !== report[name]
    )
      fail();
  if (
    report.completed_at_utc < report.started_at_utc ||
    !exactKeys(report.profiles, profileNames)
  )
    fail();
  for (const profile of profileNames) {
    const result = report.profiles[profile];
    if (
      !exactKeys(result, ['profile', 'passed', 'database_version', 'checks']) ||
      result.profile !== profile ||
      result.passed !== true ||
      result.database_version !== '18.6' ||
      !exactKeys(result.checks, requiredProfileChecks) ||
      requiredProfileChecks.some((name) => result.checks[name] !== true)
    )
      fail();
  }
  if (
    !exactKeys(report.checks, requiredEnvironmentChecks) ||
    requiredEnvironmentChecks.some((name) => report.checks[name] !== true)
  )
    fail();
  if (
    !exactKeys(report.versions, ['node', 'docker', 'compose']) ||
    Object.values(report.versions).some(
      (value) => typeof value !== 'string' || !/^\d+\.\d+\.\d+$/.test(value),
    )
  )
    fail();
  if (
    !exactKeys(report.images, Object.keys(manifest.images)) ||
    Object.entries(manifest.images).some(
      ([key, value]) => report.images[key] !== value,
    )
  )
    fail();
  if (
    !Array.isArray(report.pending) ||
    [...report.pending].sort().join(',') !== [...pending].sort().join(',')
  )
    fail();
  const hashes = sourceHashes();
  if (
    !exactKeys(report.source_sha256, Object.keys(hashes)) ||
    Object.entries(report.source_sha256).some(
      ([key, value]) =>
        typeof value !== 'string' ||
        !/^[a-f0-9]{64}$/.test(value) ||
        (matchSources && value !== hashes[key]),
    )
  )
    fail();
  return report;
}
