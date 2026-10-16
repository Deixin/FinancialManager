import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateUiEvidence, validateFlagEvidence } from '../ui/evidence.mjs';

const fixture = (filename = 'us-016-dom-2026-10-16-us023.json') =>
  JSON.parse(
    readFileSync(
      new URL('../../docs/quality/evidence/' + filename, import.meta.url),
      'utf8',
    ),
  );
test('historical UI evidence preserves its original scope and source manifest', () => {
  assert.equal(
    validateUiEvidence(fixture('us-016-dom-2026-10-16-us022.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  assert.equal(
    validateFlagEvidence(fixture('us-017-flags-2026-10-16-us022.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  assert.equal(
    validateUiEvidence(fixture('us-016-dom-2026-10-16-us021.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  assert.equal(
    validateFlagEvidence(fixture('us-017-flags-2026-10-16-us021.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  assert.equal(
    validateUiEvidence(fixture('us-016-dom-2026-10-16-us020.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  assert.equal(
    validateFlagEvidence(fixture('us-017-flags-2026-10-16-us020.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  assert.equal(
    validateUiEvidence(fixture('us-016-dom-2026-10-16-us017.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  assert.equal(
    validateFlagEvidence(fixture('us-017-flags-2026-10-16.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  assert.equal(
    validateUiEvidence(fixture('us-016-dom-2026-10-16.json'), {
      matchSources: false,
    }).passed,
    true,
  );
  const report = fixture('us-016-dom-2026-10-16.json');
  report.source_sha256['unknown-secret-file'] = '0'.repeat(64);
  assert.throws(
    () => validateUiEvidence(report, { matchSources: false }),
    /UI_EVIDENCE_INVALID/,
  );
});
test('runtime flag evidence requires every real browser gate and current sources', () => {
  const filename = 'us-017-flags-2026-10-16-us023.json';
  assert.equal(validateFlagEvidence(fixture(filename)).passed, true);
  for (const mutate of [
    (report) => {
      delete report.checks
        .server_rejects_disabled_operation_and_client_override;
    },
    (report) => {
      report.source_sha256['packages/runtime-config/src/index.ts'] = '0'.repeat(
        64,
      );
    },
    (report) => {
      report.scope = 'us016-dom-synthetic-example';
    },
    (report) => {
      report.pending = [];
    },
    (report) => {
      report.payload = 'SYNTHETIC_PRIVATE_CANARY';
    },
    (report) => {
      report.resources_closed = false;
    },
  ]) {
    const report = fixture(filename);
    mutate(report);
    assert.throws(() => validateFlagEvidence(report), /UI_EVIDENCE_INVALID/);
  }
});
test('archived UI evidence matches the real browser gates, cleanup and current sources', () => {
  assert.equal(validateUiEvidence(fixture()).passed, true);
});
test('UI evidence rejects missing accessibility gates, payloads and native/remote completion claims', () => {
  for (const mutate of [
    (report) => {
      delete report.checks.axe_wcag_22_aa_all_six_states;
    },
    (report) => {
      report.checks.keyboard_navigation_and_heading_focus = false;
    },
    (report) => {
      report.payload = 'SYNTHETIC_PRIVATE_CANARY';
    },
    (report) => {
      report.pending = [];
    },
    (report) => {
      report.scope = 'native-product-complete';
    },
    (report) => {
      report.resources_closed = false;
    },
    (report) => {
      report.passed = false;
    },
  ]) {
    const report = fixture();
    mutate(report);
    assert.throws(() => validateUiEvidence(report), /UI_EVIDENCE_INVALID/);
  }
});
test('UI evidence rejects stale hashes, unsupported versions and invalid timestamps', () => {
  for (const mutate of [
    (report) => {
      report.source_sha256['infra/ui/check.mjs'] = '0'.repeat(64);
    },
    (report) => {
      report.versions.axe = 'unknown';
    },
    (report) => {
      report.completed_at_utc = '2020-01-01T00:00:00.000Z';
    },
    (report) => {
      report.started_at_utc = 'invalid';
    },
  ]) {
    const report = fixture();
    mutate(report);
    assert.throws(() => validateUiEvidence(report), /UI_EVIDENCE_INVALID/);
  }
});
