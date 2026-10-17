/* global structuredClone */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { expectedSnapshot, fixture } from '../fixtures/loader.mjs';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { sha256 } from '../schema/postgres-migrations.mjs';
import {
  logicalSnapshot,
  referenceTotals,
  assertAudit,
} from '../invariants/oracle.mjs';
import {
  fixtureId,
  invariantCases,
  transferAmounts,
  splitAmounts,
  families,
} from '../invariants/scenarios.mjs';
import {
  seedInvariants,
  invariantHarness,
  runInvariants,
  verifyObserved,
} from '../invariants/protocol.mjs';
import {
  invariantChecks,
  validateInvariantEvidence,
} from '../invariants/evidence.mjs';
test('independent invariant oracle matches literal goldens and exact signed i64 cancellation', () => {
  const a = expectedSnapshot(fixture.workspace_a),
    b = expectedSnapshot(fixture.workspace_b),
    totals = referenceTotals(a);
  assert.equal(totals.balances[fixtureId(11)], '108500');
  assert.equal(totals.balances[fixtureId(12)], '30000');
  assert.equal(totals.balances[fixtureId(13)], '-2000');
  assert.equal(totals.net_worth_minor, '140500');
  assert.equal(referenceTotals(b).balances[fixtureId(14)], '-1');
  assert.deepEqual(
    totals.periods,
    fixture.expected.reports.map((row) => row.totals),
  );
  verifyObserved(a, fixture.workspace_a);
  verifyObserved(b, fixture.workspace_b);
});
test('reference-day boundaries and soft deletion independently change the balance oracle', () => {
  const a = expectedSnapshot(fixture.workspace_a);
  a.balance_reference.find(
    (row) => row.account_id === fixtureId(12),
  ).day_position = 'START_OF_DAY';
  assert.equal(referenceTotals(a).balances[fixtureId(12)], '25000');
  a.financial_transaction.find((row) => row.id === fixtureId(113)).deleted_at =
    null;
  assert.equal(referenceTotals(a).balances[fixtureId(11)], '19612');
  assert.equal(referenceTotals(a).periods[0].expense_minor, '120888');
});
test('differential normalization ignores only JSON object key order and preserves financial representation', () => {
  const a = expectedSnapshot(fixture.workspace_a),
    b = structuredClone(a);
  a.transaction_revision[0].snapshot = '{"a":"1","b":["2","3"]}';
  b.transaction_revision[0].snapshot = '{"b":["2","3"],"a":"1"}';
  assert.deepEqual(logicalSnapshot(a), logicalSnapshot(b));
  b.transaction_revision[0].snapshot = '{"b":["3","2"],"a":"1"}';
  assert.notDeepEqual(logicalSnapshot(a), logicalSnapshot(b));
  b.transaction_revision[0].snapshot = a.transaction_revision[0].snapshot;
  b.financial_transaction[0].account_amount_minor = Number(
    a.financial_transaction[0].account_amount_minor,
  );
  assert.notDeepEqual(logicalSnapshot(a), logicalSnapshot(b));
});
test('audit oracle rejects unrecorded edits, rewritten history, and any rejected-command side effect', () => {
  const before = expectedSnapshot(fixture.workspace_a),
    after = structuredClone(before);
  assertAudit(before, after);
  assertAudit(before, after, true);
  after.financial_transaction[0].display_name = 'SYNTHETIC UNRECORDED EDIT';
  assert.throws(() => assertAudit(before, after));
  assert.throws(() => assertAudit(before, after, true));
  const rewritten = structuredClone(before);
  rewritten.transaction_revision[0].snapshot = '{"changed":true}';
  assert.throws(() => assertAudit(before, rewritten));
});
test('versioned invariant catalog is bounded, deterministic and includes all six acceptance families', () => {
  assert.equal(new Set(invariantCases).size, 43);
  assert.equal(invariantCases.length, 43);
  assert.deepEqual(families, [
    'transfers',
    'allocations',
    'cards',
    'balances',
    'reversal',
    'deletion',
  ]);
  assert.equal(transferAmounts.length, 16);
  assert.equal(splitAmounts.length, 8);
  assert.equal(transferAmounts[3], '9007199254740993');
  assert.equal(transferAmounts[4], '130340437195814');
  for (const amount of [...transferAmounts, ...splitAmounts])
    assert.match(amount, /^[1-9][0-9]*$/);
});
test('all shared command, rollback and roundtrip cases run against migrated SQLite with persisted audit', async () => {
  const sqlite = openProbeDatabase(':memory:');
  try {
    await migrateSqliteTo(sqlite.db, { sha256 });
    await seedInvariants('sqlite', sqlite);
    const passed = [];
    await runInvariants(
      [invariantHarness('sqlite', sqlite)],
      async (name, run) => {
        await run();
        passed.push(name);
      },
    );
    assert.deepEqual(passed, invariantCases);
  } finally {
    sqlite.close();
  }
});
test('US-027 evidence requires every gate, current sources and truthful platform scope', () => {
  const load = () =>
    JSON.parse(
      readFileSync(
        new URL(
          '../../docs/quality/evidence/us-027-invariants-2026-10-16.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
  assert.equal(validateInvariantEvidence(load()).passed, true);
  for (const name of invariantChecks) {
    const report = load();
    delete report.checks[name];
    assert.throws(
      () => validateInvariantEvidence(report),
      /INVARIANT_EVIDENCE_INVALID/,
    );
  }
  for (const mutate of [
    (r) => {
      r.source_sha256['package.json'] = '0'.repeat(64);
    },
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.ios_verified = true;
    },
    (r) => {
      r.corpus_version = 2;
    },
  ]) {
    const report = load();
    mutate(report);
    assert.throws(
      () => validateInvariantEvidence(report),
      /INVARIANT_EVIDENCE_INVALID/,
    );
  }
  const historical = load();
  historical.source_sha256['package.json'] = '0'.repeat(64);
  assert.equal(
    validateInvariantEvidence(historical, { matchSources: false }).passed,
    true,
  );
  historical.source_sha256['package.json'] = 'invalid';
  assert.throws(
    () => validateInvariantEvidence(historical, { matchSources: false }),
    /INVARIANT_EVIDENCE_INVALID/,
  );
});
