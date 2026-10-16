import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateUiEvidence } from '../ui/evidence.mjs';

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-016-dom-2026-10-16.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
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
