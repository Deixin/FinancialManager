import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const runtimeChecks = [
  'rfc_vector',
  'legacy_and_invalid_ids',
  'same_millisecond_csprng',
  'increasing_clock_order',
  'clock_regression_and_independent_generators',
  'canonical_temporal_vectors',
];
export const nodeChecks = [
  ...runtimeChecks,
  'api_and_worker_csprng',
  'four_timezone_processes',
  'chromium_real_crypto_and_no_storage_egress',
  'postgres_native_v7_and_sorting',
  'postgres_temporal_domains_and_precision',
  'sqlite_product_roundtrip',
  'operational_logs_sanitized',
  'owned_resources_removed',
];
const common = [
  'packages/domain/src/time.ts',
  'packages/domain/src/model.ts',
  'packages/domain/src/errors.ts',
  'packages/domain/src/index.ts',
  'packages/contracts/src/identity.ts',
  'packages/contracts/src/identity-probe.ts',
  'packages/contracts/src/generated/identity-vectors.ts',
  'packages/contracts/src/formats.ts',
  'packages/contracts/src/index.ts',
  'packages/contracts/fixtures/us023.json',
  'infra/identity/evidence.mjs',
];
const storage = [
  'packages/storage-schema/src/index.ts',
  'packages/storage-schema/src/migrations.ts',
  'packages/storage-schema/src/generated.ts',
  'packages/storage-schema/src/generated-migrations.ts',
  'packages/storage-schema/src/migration-plan.ts',
  'packages/storage-schema/src/synthetic-probe.ts',
  'packages/storage-schema/src/generated-probe.ts',
];
const sources = {
  node: [
    ...common,
    ...storage,
    'apps/web/src/identity.ts',
    'apps/api/src/identity.ts',
    'apps/worker/src/identity.ts',
    'infra/identity/generate.mjs',
    'infra/identity/browser.ts',
    'infra/identity/timezone-worker.mjs',
    'infra/identity/run.mjs',
    'infra/identity/compose.yaml',
    'infra/schema/postgres-migrations.mjs',
    'apps/api/persistence/postgres/migrations/0001-financial-core.sql',
    'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.up.sql',
    'apps/api/persistence/postgres/migrations/0002-balance-reference-lookup.down.sql',
    'pnpm-lock.yaml',
  ],
  windows: [
    ...common,
    'apps/desktop/spikes/us-001/src/identity.rs',
    'apps/desktop/spikes/us-001/src/lib.rs',
    'apps/desktop/spikes/us-001/src/vault.rs',
    'apps/desktop/spikes/us-001/Cargo.toml',
    'apps/desktop/spikes/us-001/Cargo.lock',
    'apps/desktop/spikes/us-001/tests/us023_identity.rs',
    'packages/storage-schema/sqlite/migrations/0001-financial-core.sql',
    'infra/identity/native.mjs',
  ],
  android: [
    ...common,
    ...storage,
    'apps/mobile/src/identity.ts',
    'apps/mobile/app.config.ts',
    'apps/mobile/package.json',
    'apps/mobile/spikes/us-023/index.ts',
    'apps/mobile/spikes/us-023/probe.ts',
    'apps/mobile/spikes/us-023/with-identity-probe.cjs',
    'apps/mobile/spikes/us-002/with-android-build.cjs',
    'infra/identity/native.mjs',
    'pnpm-lock.yaml',
  ],
};
export const sourceHashes = (kind) =>
  Object.fromEntries(
    sources[kind].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  );
const exact = (value, names) =>
  value &&
  JSON.stringify(Object.keys(value).sort()) ===
    JSON.stringify([...names].sort());
export function validateIdentityEvidence(report, kind = 'node') {
  const fail = () => {
    throw new Error('IDENTITY_EVIDENCE_INVALID');
  };
  const native = kind !== 'node',
    android = kind === 'android';
  const keys = [
    'format_version',
    'synthetic_only',
    'scope',
    'passed',
    'checks',
    'same_millisecond_sample_count',
    'source_sha256',
    'completed_at_utc',
    'pending',
  ];
  if (native) keys.push('platform', 'cipher_version', 'sqlite_version');
  else keys.push('engines', 'resources_closed');
  if (android)
    keys.push(
      'phase',
      'android_api',
      'abi',
      'process_restart_verified',
      'offline_confirmed',
      'runtime_libraries_packaged',
      'apk_sha256',
    );
  if (
    !sources[kind] ||
    !exact(report, keys) ||
    report.format_version !== 1 ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.scope !==
      (native
        ? 'us023-native-identity-time'
        : 'us023-js-postgresql-identity-time') ||
    report.same_millisecond_sample_count !== 4096
  )
    fail();
  const gates = native
    ? [...runtimeChecks, 'sqlcipher_roundtrip_reopen_and_cleanup']
    : nodeChecks;
  if (
    !exact(report.checks, gates) ||
    gates.some((name) => report.checks[name] !== true)
  )
    fail();
  const hashes = sourceHashes(kind);
  if (
    !exact(report.source_sha256, Object.keys(hashes)) ||
    Object.entries(hashes).some(
      ([name, hash]) => report.source_sha256[name] !== hash,
    )
  )
    fail();
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    JSON.stringify(report.pending) !==
      JSON.stringify([
        'ios-runtime',
        'product-command-and-repository-integration',
      ])
  )
    fail();
  if (native) {
    if (
      report.platform !== kind ||
      !/^4\.\d+\.\d+[A-Za-z0-9 ._-]{0,50}$/.test(report.cipher_version) ||
      !/^3\.\d+\.\d+$/.test(report.sqlite_version)
    )
      fail();
  } else if (
    !exact(report.engines, ['node', 'chromium', 'postgresql', 'sqlite']) ||
    !/^24\./.test(report.engines.node) ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(report.engines.chromium) ||
    !/^18\.\d+$/.test(report.engines.postgresql) ||
    !/^3\.\d+\.\d+$/.test(report.engines.sqlite) ||
    report.resources_closed !== true
  )
    fail();
  if (
    android &&
    (report.phase !== 'cleaned' ||
      report.android_api !== 36 ||
      report.abi !== 'x86_64' ||
      report.process_restart_verified !== true ||
      report.offline_confirmed !== true ||
      report.runtime_libraries_packaged !== true ||
      !/^[a-f0-9]{64}$/.test(report.apk_sha256))
  )
    fail();
  return report;
}
