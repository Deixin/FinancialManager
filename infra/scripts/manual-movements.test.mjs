/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  captureManualMovement,
  manualMovementChange,
  validateManualMovementPlan,
} from '../../packages/domain/dist/manual-movements.js';
import { planTransactionRevision } from '../../packages/domain/dist/revisions.js';
import { createManualMovementService } from '../../packages/finance-ports/dist/manual-movements.js';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createRevisionHarness } from '../revisions/harness.mjs';
import { runManualCases, manualCases } from '../manual-movements/protocol.mjs';
import {
  manualChecks,
  validateManualEvidence,
} from '../manual-movements/evidence.mjs';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { fixture, loadFixture } from '../fixtures/loader.mjs';
import { sha256 } from '../schema/postgres-migrations.mjs';
const id = (n) => '0199d041-0000-7000-8000-' + String(n).padStart(12, '0'),
  w = id(1),
  at = '2026-10-18T00:00:00.000Z';
const account = {
  id: id(2),
  workspace_id: w,
  currency_code: 'BRL',
  account_kind: 'CASH',
  balance_nature: 'ASSET',
  status: 'ACTIVE',
};
const input = () => ({
  kind: 'CREATE',
  id: id(3),
  account: { ...account },
  financial_date: '2026-10-17',
  amount_minor: '1000',
  movement_kind: 'EXPENSE',
  display_name: 'SYNTHETIC MANUAL',
  original_description: 'SYNTHETIC ORIGINAL',
});
const base = () =>
  planTransactionRevision(
    w,
    null,
    manualMovementChange(captureManualMovement(input(), w)),
    at,
  ).after;
test('manual input maps asset/liability signs exactly and captures immutable canonical fields', () => {
  for (const nature of ['ASSET', 'LIABILITY'])
    for (const kind of ['INCOME', 'EXPENSE']) {
      const source = {
          ...input(),
          account: { ...account, balance_nature: nature },
          movement_kind: kind,
          amount_minor: '9007199254740993',
        },
        captured = captureManualMovement(source, w);
      source.account.status = 'ARCHIVED';
      const c = manualMovementChange(captured);
      assert.equal(
        c.content.account_amount_minor,
        (
          9007199254740993n *
          (nature === 'ASSET' ? 1n : -1n) *
          (kind === 'INCOME' ? 1n : -1n)
        ).toString(),
      );
      assert.ok(Object.isFrozen(captured.account));
    }
});
test('manual commands reject floats, noncanonical money, zero, unknown fields and fabricated source metadata', () => {
  for (const mutate of [
    (c) => (c.amount_minor = 1),
    (c) => (c.amount_minor = '01'),
    (c) => (c.amount_minor = '0'),
    (c) => (c.amount_minor = '1e2'),
    (c) => (c.amount_minor = '-1'),
    (c) => (c.amount_minor = '9223372036854775808'),
    (c) => (c.origin_kind = 'IMPORT'),
    (c) => (c.financial_date = '2026-02-30'),
    (c) => (c.display_name = '  '),
    (c) => (c.account.workspace_id = id(4)),
    (c) => (c.original_description = 4),
  ]) {
    const source = input();
    mutate(source);
    assert.throws(() => captureManualMovement(source, w), {
      code: 'INVALID_MANUAL_MOVEMENT',
    });
  }
});
test('edits retain original description, legacy names, links and one-allocation notes; split changes demand review', () => {
  const before = base();
  const legacy = {
    ...before,
    content: {
      ...before.content,
      display_name: ' ' + 'SYNTHETIC'.repeat(300) + ' ',
      tag_ids: [id(80)],
      allocations: [
        {
          id: id(81),
          category_id: id(82),
          subcategory_id: null,
          amount_minor: '1000',
          note: 'SYNTHETIC NOTE',
        },
      ],
    },
  };
  const command = captureManualMovement(
      {
        kind: 'EDIT',
        base: legacy,
        account,
        financial_date: '2026-10-18',
        display_name: legacy.content.display_name,
        amount_minor: '2000',
        movement_kind: 'EXPENSE',
      },
      w,
    ),
    change = manualMovementChange(command);
  assert.equal(change.content.display_name, legacy.content.display_name);
  assert.equal(
    change.content.original_description,
    legacy.content.original_description,
  );
  assert.deepEqual(change.content.tag_ids, legacy.content.tag_ids);
  assert.equal(change.content.allocations[0].amount_minor, '2000');
  assert.equal(change.content.allocations[0].note, 'SYNTHETIC NOTE');
});
test('imported, grouped, deleted and adjustment rows cannot be rewritten through the ordinary manual editor', () => {
  for (const mutate of [
    (s) => (s.content.origin_kind = 'IMPORT'),
    (s) => (s.content.group_id = id(99)),
    (s) => {
      s.content.deleted = true;
      s.deleted_at = at;
    },
    (s) => (s.content.economic_kind = 'ADJUSTMENT'),
  ]) {
    const previous = structuredClone(base());
    mutate(previous);
    assert.throws(() =>
      captureManualMovement(
        {
          kind: 'EDIT',
          base: previous,
          account,
          financial_date: '2026-10-17',
          display_name: 'SYNTHETIC EDIT',
          amount_minor: '1000',
          movement_kind: 'EXPENSE',
        },
        w,
      ),
    );
  }
});
test('identified adjustments carry signed i64 deltas and a required reason without becoming income or expense', () => {
  for (const delta of ['-9223372036854775808', '9223372036854775807']) {
    const c = manualMovementChange(
      captureManualMovement(
        {
          kind: 'ADJUST',
          id: id(9),
          account,
          financial_date: '2026-10-17',
          delta_minor: delta,
          reason: 'SYNTHETIC RECONCILIATION',
        },
        w,
      ),
    );
    assert.equal(c.content.economic_kind, 'ADJUSTMENT');
    assert.equal(c.content.account_amount_minor, delta);
    assert.equal(c.content.original_description, 'SYNTHETIC RECONCILIATION');
    assert.ok(c.content.display_name.startsWith('Ajuste de saldo: '));
  }
});
test('same-version forged bases and live archived/changed account descriptors are refused', () => {
  const command = captureManualMovement(input(), w),
    plan = planTransactionRevision(w, null, manualMovementChange(command), at);
  validateManualMovementPlan(
    command,
    {
      plan,
      account: {
        status: 'ACTIVE',
        balance_nature: 'ASSET',
        account_kind: 'CASH',
        currency_code: 'BRL',
        workspace_id: w,
        id: id(2),
      },
      previous_account: null,
    },
    w,
  );
  validateManualMovementPlan(
    command,
    {
      plan,
      account: {
        ...account,
        name: 'SYNTHETIC PG METADATA',
        institution_name: null,
        created_at: at,
      },
      previous_account: null,
    },
    w,
  );
  assert.throws(
    () =>
      validateManualMovementPlan(
        command,
        {
          plan,
          account: { ...account, status: 'ARCHIVED' },
          previous_account: null,
        },
        w,
      ),
    { code: 'MANUAL_ACCOUNT_ARCHIVED' },
  );
  assert.throws(
    () =>
      validateManualMovementPlan(
        command,
        {
          plan,
          account: { ...account, balance_nature: 'LIABILITY' },
          previous_account: null,
        },
        w,
      ),
    { code: 'MANUAL_ACCOUNT_CHANGED' },
  );
});
test('guarded revision authorization precedes storage and does not run a manual guard on access denial', async () => {
  let storage = 0,
    guards = 0;
  const service = createRevisionService({
    store: {
      transaction: async () => {
        storage++;
        throw Error('SYNTHETIC_UNREACHABLE');
      },
    },
    authorize: async () => null,
    identity: { newId: () => id(100), nowInstant: () => at },
    change_source: 'MANUAL',
  });
  await assert.rejects(
    () =>
      service.applyGuarded(
        { workspace_id: w },
        [manualMovementChange(captureManualMovement(input(), w))],
        () => {
          guards++;
        },
      ),
    { code: 'ACCESS_DENIED' },
  );
  assert.equal(storage, 0);
  assert.equal(guards, 0);
  await assert.rejects(
    () =>
      createManualMovementService(service).apply({ workspace_id: w }, input()),
    { code: 'ACCESS_DENIED' },
  );
});
test('SQLite executes all manual movement cases atomically with real constraints, revisions and preserved fixtures', async () => {
  const handle = openProbeDatabase(':memory:');
  await migrateSqliteTo(handle.db, { sha256 });
  for (const workspace of [fixture.workspace_a, fixture.workspace_b])
    await loadFixture(handle.db, 'sqlite', workspace);
  const harness = createRevisionHarness('sqlite', { sqlite: () => handle }),
    seen = [];
  try {
    await runManualCases(
      { ...harness, engine: 'sqlite' },
      async (name, run) => {
        await run();
        seen.push(name);
      },
    );
    assert.deepEqual(seen, manualCases);
  } finally {
    await harness.close();
    handle.close();
  }
});
const evidence = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-041-manual-core-2026-10-18-us042-desktop.json',
        import.meta.url,
      ),
    ),
  );
test('manual movement evidence requires all persisted cross-engine, rollback, scope, history and cleanup gates', () => {
  assert.equal(validateManualEvidence(evidence()).passed, true);
  for (const key of manualChecks) {
    const r = evidence();
    delete r.checks[key];
    assert.throws(() => validateManualEvidence(r), /MANUAL_EVIDENCE_INVALID/);
  }
});
test('manual movement evidence rejects stale sources, private payloads and premature Desktop/cloud/human claims', () => {
  for (const mutate of [
    (r) => (r.pending = []),
    (r) => (r.resources_closed = false),
    (r) => (r.source_sha256['packages/domain/package.json'] = '0'.repeat(64)),
    (r) => (r.checks.desktop_complete = true),
    (r) => (r.description = 'SYNTHETIC PRIVATE'),
    (r) => (r.completed_at_utc = 'invalid'),
  ]) {
    const r = evidence();
    mutate(r);
    assert.throws(() => validateManualEvidence(r), /MANUAL_EVIDENCE_INVALID/);
  }
});
