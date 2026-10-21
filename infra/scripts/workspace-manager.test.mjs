import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  browserChecks,
  nativeChecks,
  validateManagerEvidence,
} from '../workspace-manager/evidence.mjs';
const load = (kind) =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-036-workspace-manager-' +
          kind +
          '-2026-10-20-us050-desktop.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
test('workspace manager evidence requires native plurality, context reset, fresh creation, lost acknowledgement and cleanup gates', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateManagerEvidence(load(kind)).passed, true);
    for (const gate of checks) {
      const r = load(kind);
      delete r.checks[gate];
      assert.throws(
        () => validateManagerEvidence(r),
        /WORKSPACE_MANAGER_EVIDENCE_INVALID/,
      );
    }
  }
});
test('workspace manager evidence refuses stale sources, private data, missing human deferral and invented cloud integration', () => {
  for (const mutate of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
    (r) => {
      r.private_workspace_name = 'SYNTHETIC_PRIVATE';
    },
    (r) => {
      r.checks.cloud_authorization_product_complete = true;
    },
    (r) => {
      r.completed_at_utc = 'invalid';
    },
  ]) {
    const r = load('windows');
    mutate(r);
    assert.throws(
      () => validateManagerEvidence(r),
      /WORKSPACE_MANAGER_EVIDENCE_INVALID/,
    );
  }
  const r = load('windows');
  r.source_sha256['package.json'] = '0'.repeat(64);
  assert.equal(
    validateManagerEvidence(r, { matchSources: false }).passed,
    true,
  );
});
