import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { corpus } from './us021-corpus.mjs';
export const caseNames = Object.freeze(corpus.cases.map((item) => item.name));
const common = [
  'packages/storage-schema/sqlite/migrations/0001-financial-core.sql',
  'packages/storage-schema/fixtures/us021.json',
];
const files = {
  dual: [
    ...common,
    'packages/storage-schema/src/index.ts',
    'packages/storage-schema/src/generated.ts',
    'packages/storage-schema/src/generated-probe.ts',
    'packages/storage-schema/src/synthetic-probe.ts',
    'apps/api/persistence/postgres/migrations/0001-financial-core.sql',
    'infra/schema/sqlite-model.mjs',
    'infra/schema/generate-sqlite.mjs',
    'infra/schema/us021-corpus.mjs',
    'infra/schema/dual-postgres.mjs',
    'infra/schema/dual.mjs',
    'infra/schema/dual-compose.yaml',
    'infra/schema/sqlite-adapter.mjs',
  ],
  desktop: [
    ...common,
    'apps/desktop/spikes/us-001/tests/us021_schema.rs',
    'apps/desktop/spikes/us-001/Cargo.toml',
    'apps/desktop/spikes/us-001/Cargo.lock',
    'apps/desktop/spikes/us-001/src/vault.rs',
    'apps/desktop/spikes/us-001/src/lib.rs',
    'infra/schema/native.mjs',
  ],
  android: [
    ...common,
    'packages/storage-schema/src/index.ts',
    'packages/storage-schema/src/generated.ts',
    'packages/storage-schema/src/generated-probe.ts',
    'packages/storage-schema/src/synthetic-probe.ts',
    'apps/mobile/spikes/us-021/index.ts',
    'apps/mobile/spikes/us-021/probe.ts',
    'apps/mobile/spikes/us-021/with-schema-probe.cjs',
    'apps/mobile/spikes/us-002/with-android-build.cjs',
    'apps/mobile/app.config.ts',
    'apps/mobile/package.json',
    'pnpm-lock.yaml',
    'infra/schema/native.mjs',
  ],
};
export const sourceHashes = (kind) =>
  Object.fromEntries(
    files[kind].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  );
export function validateNativeEvidence(report, { matchSources = true } = {}) {
  const reject = () => {
    throw new Error('NATIVE_SCHEMA_EVIDENCE_INVALID');
  };
  const exact = (value, keys) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  const android = report?.platform === 'android';
  const fields = [
    'format_version',
    'scope',
    'synthetic_only',
    'platform',
    'passed',
    'cases',
    'checks',
    'cipher_version',
    'sqlite_version',
    'source_sha256',
    'completed_at_utc',
    'pending',
  ];
  if (android)
    fields.push(
      'phase',
      'android_api',
      'abi',
      'boot_count_before',
      'boot_count_after',
      'full_reboot_verified',
      'offline_confirmed',
      'runtime_libraries_packaged',
      'apk_sha256',
    );
  if (
    !exact(report, fields) ||
    report.format_version !== 1 ||
    report.scope !== 'us021-sqlcipher-schema' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    !['windows', 'android'].includes(report.platform)
  )
    reject();
  if (
    !exact(report.cases, caseNames) ||
    caseNames.some((key) => report.cases[key] !== true)
  )
    reject();
  const checks = [
    'migration_rollback',
    'ciphertext_header',
    'wrong_key_rejected',
    'unkeyed_open_rejected',
    'reopened_balance',
    'database_integrity',
    'synthetic_artifacts_removed',
  ];
  if (android)
    checks.push(
      'secure_store',
      'migration_idempotent',
      'native_secret_persisted',
    );
  if (
    !exact(report.checks, checks) ||
    checks.some((key) => report.checks[key] !== true)
  )
    reject();
  if (
    typeof report.cipher_version !== 'string' ||
    !/^4\.\d+\.\d+[A-Za-z0-9 ._-]{0,50}$/.test(report.cipher_version) ||
    !/^3\.\d+\.\d+$/.test(report.sqlite_version)
  )
    reject();
  if (
    !Array.isArray(report.pending) ||
    [...report.pending].sort().join(',') !==
      'ios-native-runtime,product-vault-policy-and-migrations'
  )
    reject();
  const hashes = sourceHashes(android ? 'android' : 'desktop');
  if (
    !exact(report.source_sha256, Object.keys(hashes)) ||
    Object.entries(hashes).some(
      ([key, value]) =>
        !/^[a-f0-9]{64}$/.test(report.source_sha256[key]) ||
        (matchSources && report.source_sha256[key] !== value),
    )
  )
    reject();
  if (
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    new Date(report.completed_at_utc).toISOString() !== report.completed_at_utc
  )
    reject();
  if (
    android &&
    (report.phase !== 'cleaned' ||
      report.android_api !== 36 ||
      report.abi !== 'x86_64' ||
      !Number.isInteger(report.boot_count_before) ||
      !Number.isInteger(report.boot_count_after) ||
      report.boot_count_after <= report.boot_count_before ||
      report.full_reboot_verified !== true ||
      report.offline_confirmed !== true ||
      report.runtime_libraries_packaged !== true ||
      !/^[a-f0-9]{64}$/.test(report.apk_sha256))
  )
    reject();
  return report;
}
export const dualChecks = Object.freeze([
  'migration_rollback',
  'migration_idempotency_and_checksum',
  'foreign_keys_and_strict_integer',
  'commit_guard_cannot_be_bypassed',
  'single_writer_serialization',
  'local_workspace_without_identity',
  'reopened_balance_and_integrity',
  'postgres_rls_context',
  'operational_logs_sanitized',
  'owned_resources_removed',
]);
export function validateDualEvidence(report) {
  const reject = () => {
    throw new Error('DUAL_SCHEMA_EVIDENCE_INVALID');
  };
  const exact = (value, keys) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
  if (
    !exact(report, [
      'format_version',
      'scope',
      'synthetic_only',
      'passed',
      'checks',
      'engines',
      'source_sha256',
      'pending',
      'resources_closed',
      'completed_at_utc',
    ]) ||
    report.format_version !== 1 ||
    report.scope !== 'us021-postgresql-sqlite-equivalence' ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true
  )
    reject();
  if (
    !exact(report.checks, dualChecks) ||
    dualChecks.some((key) => report.checks[key] !== true)
  )
    reject();
  if (
    !exact(report.engines, ['postgresql', 'sqlite']) ||
    !/^18\.\d+$/.test(report.engines.postgresql.version) ||
    !/^3\.\d+\.\d+$/.test(report.engines.sqlite.version)
  )
    reject();
  for (const engine of Object.values(report.engines))
    if (
      !exact(engine, ['version', 'cases']) ||
      !exact(engine.cases, caseNames) ||
      caseNames.some((key) => engine.cases[key] !== true)
    )
      reject();
  if (
    !Array.isArray(report.pending) ||
    [...report.pending].sort().join(',') !==
      [
        'ios-native-runtime',
        'product-vault-policy-and-migrations',
        'uuid-generator-and-full-cross-engine-suite',
      ]
        .sort()
        .join(',')
  )
    reject();
  const hashes = sourceHashes('dual');
  if (
    !exact(report.source_sha256, Object.keys(hashes)) ||
    Object.entries(hashes).some(
      ([key, value]) => report.source_sha256[key] !== value,
    )
  )
    reject();
  if (
    typeof report.completed_at_utc !== 'string' ||
    !Number.isFinite(Date.parse(report.completed_at_utc)) ||
    new Date(report.completed_at_utc).toISOString() !== report.completed_at_utc
  )
    reject();
  return report;
}
