import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const gates = Object.freeze([
  'local_without_login_and_semantic_landmarks',
  'keyboard_skip_link_and_visible_focus',
  'keyboard_navigation_and_heading_focus',
  'distinct_states_hide_stale_content_and_announce_status',
  'axe_wcag_22_aa_all_six_states',
  'retry_returns_to_ready',
  'workspace_change_resets_route_and_search',
  'web_offers_cloud_workspaces_only',
  'reflow_320_375_768_and_long_workspace_name',
  'text_at_200_percent_without_horizontal_overflow',
  'forced_colors_preserves_focus',
  'no_browser_storage_external_requests_or_runtime_errors',
]);
export const pending = Object.freeze([
  'native-android-ios-runtime',
  'screen-reader-manual-review',
  'nextjs-vite-tauri-integration',
]);
export const flagGates = Object.freeze([
  'enabled_section_and_server_operation',
  'disable_resets_route_search_navigation_and_cards',
  'server_rejects_disabled_operation_and_client_override',
  'public_configuration_no_store_and_same_bundle',
  'reload_and_higher_revision_restore',
  'cross_origin_change_rejected',
  'configuration_failure_closes_optional_sections',
  'limited_accessibility_and_no_storage_external_requests_or_errors',
]);
const historicalSources = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.github/workflows/ci.yml',
  'packages/design-tokens/src/index.ts',
  'packages/design-tokens/src/tokens.ts',
  'packages/design-tokens/src/css.ts',
  'packages/design-tokens/src/shell.ts',
  'packages/ui-dom/src/shell.tsx',
  'packages/ui-dom/src/index.ts',
  'packages/ui-dom/styles.css',
  'apps/web/src/shell.ts',
  'apps/desktop/src/shell.ts',
  'apps/mobile/src/native-shell.tsx',
  'apps/mobile/src/native-shell-example.tsx',
  'infra/ui/example.tsx',
  'infra/ui/host.mjs',
  'infra/ui/check.mjs',
  'infra/ui/evidence.mjs',
];
export const sourceHashes = () =>
  Object.fromEntries(
    [
      'package.json',
      'pnpm-lock.yaml',
      'pnpm-workspace.yaml',
      '.github/workflows/ci.yml',
      'packages/design-tokens/src/index.ts',
      'packages/design-tokens/src/tokens.ts',
      'packages/design-tokens/src/css.ts',
      'packages/design-tokens/src/shell.ts',
      'packages/ui-dom/src/shell.tsx',
      'packages/ui-dom/src/index.ts',
      'packages/ui-dom/styles.css',
      'apps/web/src/shell.ts',
      'apps/desktop/src/shell.ts',
      'apps/mobile/src/native-shell.tsx',
      'apps/mobile/src/native-shell-example.tsx',
      'infra/ui/example.tsx',
      'infra/ui/host.mjs',
      'infra/ui/check.mjs',
      'infra/ui/evidence.mjs',
      'packages/runtime-config/src/index.ts',
      'apps/web/src/configuration.ts',
      'apps/desktop/src/configuration.ts',
      'apps/mobile/src/configuration.ts',
      'apps/api/src/features.ts',
      'apps/worker/src/features.ts',
      'infra/ui/availability.mjs',
      'infra/ui/check-flags.mjs',
      'infra/config/check.mjs',
      ...['local', 'ci', 'integration', 'staging', 'production'].map(
        (environment) => `infra/config/profiles/${environment}.json`,
      ),
    ].map((name) => [
      name,
      createHash('sha256')
        .update(readFileSync(new URL('../../' + name, import.meta.url)))
        .digest('hex'),
    ]),
  );
const exactKeys = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const invalid = () => {
  throw new Error('UI_EVIDENCE_INVALID');
};
function validateEvidence(report, scope, requiredGates, matchSources) {
  if (
    !exactKeys(report, [
      'format_version',
      'scope',
      'synthetic_only',
      'started_at_utc',
      'completed_at_utc',
      'checks',
      'pending',
      'versions',
      'source_sha256',
      'passed',
      'resources_closed',
    ]) ||
    report.format_version !== 1 ||
    report.scope !== scope ||
    report.synthetic_only !== true ||
    report.passed !== true ||
    report.resources_closed !== true
  )
    invalid();
  if (
    !exactKeys(report.checks, requiredGates) ||
    requiredGates.some((gate) => report.checks[gate] !== true)
  )
    invalid();
  if (
    !Array.isArray(report.pending) ||
    [...report.pending].sort().join(',') !== [...pending].sort().join(',')
  )
    invalid();
  if (
    !exactKeys(report.versions, ['node', 'chromium', 'axe']) ||
    !/^\d+\.\d+\.\d+$/.test(report.versions.node) ||
    !/^\d+\.\d+\.\d+\.\d+$/.test(report.versions.chromium) ||
    !/^\d+\.\d+\.\d+$/.test(report.versions.axe)
  )
    invalid();
  for (const key of ['started_at_utc', 'completed_at_utc'])
    if (
      typeof report[key] !== 'string' ||
      !Number.isFinite(Date.parse(report[key])) ||
      new Date(report[key]).toISOString() !== report[key]
    )
      invalid();
  if (report.completed_at_utc < report.started_at_utc) invalid();
  const hashes = matchSources ? sourceHashes() : null;
  if (
    !exactKeys(
      report.source_sha256,
      hashes ? Object.keys(hashes) : historicalSources,
    ) ||
    Object.values(report.source_sha256).some(
      (hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash),
    ) ||
    (hashes &&
      Object.entries(hashes).some(
        ([name, hash]) => report.source_sha256[name] !== hash,
      ))
  )
    invalid();
  return report;
}
export function validateUiEvidence(report, { matchSources = true } = {}) {
  return validateEvidence(
    report,
    'us016-dom-synthetic-example',
    gates,
    matchSources,
  );
}
export function validateFlagEvidence(report) {
  return validateEvidence(
    report,
    'us017-runtime-flags-synthetic-example',
    flagGates,
    true,
  );
}
