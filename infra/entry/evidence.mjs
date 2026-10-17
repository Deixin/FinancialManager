import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
export const browserChecks = Object.freeze([
  'three_choices_and_local_prominence',
  'keyboard_skip_and_local_transition_focus',
  'local_handoff_without_credentials_or_fake_workspace',
  'back_and_repeat_do_not_duplicate_state',
  'offline_keeps_local_available',
  'network_changes_do_not_leave_local_mode',
  'privacy_information_available_offline',
  'axe_accessibility_both_screens',
  'responsive_reflow_and_large_text',
  'forced_colors_focus_and_targets',
  'fresh_boot_offline_without_anonymous_identity',
  'no_storage_egress_identity_or_runtime_errors',
]);
export const nativeChecks = Object.freeze([
  'locked_build_and_clippy',
  'production_capability_has_no_permissions',
  'embedded_entry',
  'cloud_disabled_offline',
  'local_without_identity',
  'local_heading_focus',
  'return_to_entry',
  'no_network_or_storage',
  'owned_profile_removed',
]);
export const entryPending = Object.freeze([
  'workspace-persistence-us031',
  'vault-product-integration-us032',
  'cloud-auth-product-integration',
  'signed-desktop-release',
]);
const files = [
  'package.json',
  'pnpm-lock.yaml',
  'turbo.json',
  'eslint.config.mjs',
  '.github/workflows/ci.yml',
  'packages/config/workspace-boundaries.json',
  'packages/design-tokens/src/tokens.ts',
  'packages/design-tokens/src/css.ts',
  'apps/desktop/package.json',
  'apps/desktop/tsconfig.json',
  'apps/desktop/index.html',
  'apps/desktop/vite.config.mjs',
  ...['entry-model.ts', 'entry.tsx', 'entry.css', 'main.tsx'].map(
    (name) => 'apps/desktop/src/' + name,
  ),
  ...[
    'Cargo.toml',
    'Cargo.lock',
    'rust-toolchain.toml',
    'build.rs',
    'tauri.conf.json',
    'capabilities/entry-main.json',
    'src/main.rs',
    'src/bin/entry-smoke.rs',
    'smoke.js',
    'icons/icon.ico',
  ].map((name) => 'apps/desktop/src-tauri/' + name),
  ...['host.mjs', 'check.mjs', 'native.mjs', 'evidence.mjs'].map(
    (name) => 'infra/entry/' + name,
  ),
  'infra/scripts/desktop-entry.test.mjs',
];
export const entryHashes = () =>
  Object.fromEntries(
    files.map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  );
export function validateEntryEvidence(report, { matchSources = true } = {}) {
  const exact = (value, keys) =>
    value &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort());
  const native = report?.scope === 'us030-desktop-entry-windows',
    checks = native ? nativeChecks : browserChecks;
  const fail = () => {
    throw Error('ENTRY_EVIDENCE_INVALID');
  };
  if (
    !exact(report, [
      'format_version',
      'scope',
      'passed',
      'checks',
      'versions',
      'pending',
      'resources_closed',
      'source_sha256',
      'completed_at_utc',
    ]) ||
    report.format_version !== 1 ||
    !['us030-desktop-entry-windows', 'us030-desktop-entry-browser'].includes(
      report.scope,
    ) ||
    report.passed !== true ||
    report.resources_closed !== true ||
    !exact(report.checks, checks) ||
    checks.some((key) => report.checks[key] !== true) ||
    JSON.stringify(report.pending) !== JSON.stringify(entryPending) ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(report.completed_at_utc) ||
    !Number.isFinite(Date.parse(report.completed_at_utc))
  )
    fail();
  if (
    native
      ? !exact(report.versions, ['rust', 'tauri', 'platform']) ||
        !/^rustc 1\.99\.0/.test(report.versions.rust) ||
        report.versions.tauri !== '2.12.3' ||
        report.versions.platform !== 'win32-x64'
      : !exact(report.versions, ['node', 'chromium']) ||
        !/^24\./.test(report.versions.node) ||
        !/^\d+\.\d+\.\d+\.\d+$/.test(report.versions.chromium)
  )
    fail();
  const hashes = entryHashes();
  if (
    !exact(report.source_sha256, files) ||
    files.some((name) =>
      matchSources
        ? report.source_sha256[name] !== hashes[name]
        : !/^[a-f0-9]{64}$/.test(report.source_sha256[name]),
    )
  )
    fail();
  return report;
}
