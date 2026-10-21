import {
  readEvidenceFile as readFileSync,
  currentEvidenceValidator,
} from '../validation/evidence.mjs';
/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureCounterpartyAssociation,
  counterpartyAssociationChange,
  validateCounterpartyAssociationPlan,
  CounterpartyAssociationError,
  captureCounterpartyReference,
} from '../../packages/domain/dist/counterparties.js';
import {
  captureRevisionState,
  planTransactionRevision,
} from '../../packages/domain/dist/revisions.js';
import { createCounterpartyAssociationService } from '../../packages/finance-ports/dist/counterparties.js';
import { RevisionError } from '../../packages/finance-ports/dist/revisions.js';
import { initialState, ids } from '../revisions/scenarios.mjs';
import { openProbeDatabase } from '../schema/sqlite-adapter.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
import { sha256 } from '../schema/postgres-migrations.mjs';
import { fixture, loadFixture } from '../fixtures/loader.mjs';
import { prepareCategoryTenants } from '../categories/harness.mjs';
import {
  createCounterpartyAssociationHarness,
  id,
} from '../counterparty-associations/harness.mjs';
import {
  associationCases,
  runAssociationCases,
  set,
  keep,
  clear,
} from '../counterparty-associations/protocol.mjs';
import {
  associationChecks,
  validateAssociationEvidence as rawValidateAssociationEvidence,
} from '../counterparty-associations/evidence.mjs';

const validateAssociationEvidence = currentEvidenceValidator(
  rawValidateAssociationEvidence,
);

const w = ids.a;
const base = (patch = {}) => {
  const b = initialState(ids.expense);
  return captureRevisionState({
    ...b,
    deleted_at: patch.deleted ? b.updated_at : null,
    content: { ...b.content, counterparty_id: null, ...patch },
  });
};
const ref = (n = 40, status = 'ACTIVE', workspace_id = w) => ({
  id: id(n),
  workspace_id,
  status,
});
const plan = (c) =>
  planTransactionRevision(
    w,
    c.base,
    counterpartyAssociationChange(c),
    '2026-10-18T12:00:00.000Z',
  );
test('counterparty association captures immutable intent preserving descriptions money and classification', () => {
  const raw = set(structuredClone(base()), id(40)),
    c = captureCounterpartyAssociation(raw, w);
  raw.counterparty.counterparty_id = id(41);
  raw.base.content.display_name = 'SYNTHETIC MUTATED';
  assert.equal(c.counterparty.counterparty_id, id(40));
  assert.ok(Object.isFrozen(c.base.content.allocations));
  assert.ok(Object.isFrozen(c.counterparty));
  const p = plan(c);
  validateCounterpartyAssociationPlan(c, p, [ref()], w);
  for (const key of Object.keys(c.base.content).filter(
    (k) => k !== 'counterparty_id',
  ))
    assert.deepEqual(p.after.content[key], c.base.content[key]);
  assert.equal(p.after.version, '2');
  assert.deepEqual(p.snapshot.before, c.base);
  assert.equal(
    new CounterpartyAssociationError('PRIVATE').message,
    'INVALID_COUNTERPARTY_ASSOCIATION',
  );
});
test('association selections are exact and cannot create edit rename or delete financial content', () => {
  for (const selection of [
    { kind: 'SET' },
    { kind: 'SET', counterparty_id: null },
    { kind: 'SET', counterparty_id: 1 },
    { kind: 'SET', counterparty_id: '' },
    { kind: 'KEEP', counterparty_id: id(40) },
    { kind: 'CLEAR', name: 'SYNTHETIC' },
    { kind: 'CREATE', name: 'SYNTHETIC' },
  ])
    assert.throws(
      () =>
        captureCounterpartyAssociation(
          { base: base(), counterparty: selection },
          w,
        ),
      { code: 'INVALID_COUNTERPARTY_ASSOCIATION' },
    );
  assert.throws(() =>
    captureCounterpartyAssociation(
      { ...keep(base()), display_name: 'SYNTHETIC' },
      w,
    ),
  );
  assert.throws(() => captureCounterpartyAssociation(keep(base()), ids.b));
  assert.throws(
    () => captureCounterpartyAssociation(keep(base({ deleted: true })), w),
    { code: 'COUNTERPARTY_ASSOCIATION_DELETED' },
  );
});
test('association validates full base and rejects any unrelated change in the revision plan', () => {
  const c = set(base(), id(40)),
    p = plan(c),
    forged = structuredClone(c);
  forged.base.content.display_name = 'SYNTHETIC FORGED';
  assert.throws(
    () => validateCounterpartyAssociationPlan(forged, p, [ref()], w),
    { code: 'COUNTERPARTY_ASSOCIATION_BASE_CONFLICT' },
  );
  for (const patch of [
    { account_amount_minor: '-1' },
    { display_name: 'SYNTHETIC OVERRIDE' },
    { original_description: 'SYNTHETIC ALTERED' },
    { tag_ids: [id(999)] },
    { counterparty_id: id(41) },
  ]) {
    const changed = structuredClone(p);
    changed.after.content = { ...changed.after.content, ...patch };
    assert.throws(
      () => validateCounterpartyAssociationPlan(c, changed, [ref()], w),
      { code: 'INVALID_COUNTERPARTY_ASSOCIATION' },
    );
  }
});
test('association references require same workspace exact minimal projection and active new choices', () => {
  const c = set(base(), id(40));
  for (const references of [
    [],
    [ref(40, 'ARCHIVED')],
    [ref(40, 'ACTIVE', ids.b)],
    [ref(), ref()],
    Array(1),
    [{ ...ref(), identifier_value: 'SYNTHETIC PRIVATE' }],
  ])
    assert.throws(
      () => validateCounterpartyAssociationPlan(c, plan(c), references, w),
      { code: 'COUNTERPARTY_REFERENCE_UNAVAILABLE' },
    );
  assert.throws(() =>
    captureCounterpartyReference({ ...ref(), display_name: 'SYNTHETIC' }, w),
  );
  const existing = base({ counterparty_id: id(40) });
  for (const command of [keep(existing), set(existing, id(40))])
    validateCounterpartyAssociationPlan(
      command,
      plan(command),
      [ref(40, 'ARCHIVED')],
      w,
    );
  validateCounterpartyAssociationPlan(
    clear(existing),
    plan(clear(existing)),
    [],
    w,
  );
});
test('counterparty service bounds and captures batches before entering the revision writer', async () => {
  assert.throws(() => createCounterpartyAssociationService({}), {
    code: 'CONFIGURATION_INVALID',
  });
  let calls = 0;
  const svc = createCounterpartyAssociationService({
      async applyGuarded() {
        calls++;
      },
    }),
    c = set(base(), id(40));
  for (const rows of [
    null,
    [],
    Array(1),
    [c, c],
    Array(257).fill(c),
    [{ ...c, extra: true }],
    [set(base(), 'SYNTHETIC INVALID UUID')],
  ])
    await assert.rejects(() => svc.apply({ workspace_id: w }, rows), {
      code: 'INVALID_COUNTERPARTY_ASSOCIATION',
    });
  const huge = structuredClone(c);
  huge.base.content.display_name = 'x'.repeat(4 * 1024 * 1024);
  await assert.rejects(() => svc.apply({ workspace_id: w }, [huge]), {
    code: 'INVALID_COUNTERPARTY_ASSOCIATION',
  });
  assert.equal(calls, 0);
});
test('association batches read a single frozen bounded reference projection within the trusted guard', async () => {
  const a = base(),
    b = captureRevisionState({ ...base(), id: id(100) }),
    commands = [set(a, id(40)), set(b, id(40))];
  let reads = 0;
  const svc = createCounterpartyAssociationService({
    async applyGuarded(_, changes, guard) {
      for (let i = 0; i < changes.length; i++)
        await guard({
          plan: planTransactionRevision(
            w,
            commands[i].base,
            changes[i],
            '2026-10-18T12:00:00.000Z',
          ),
          readCounterparties: async (ids) => {
            reads++;
            assert.ok(Object.isFrozen(ids));
            assert.deepEqual(ids, [id(40)]);
            return [ref()];
          },
        });
      return Object.freeze([]);
    },
  });
  await svc.apply({ workspace_id: w }, commands);
  assert.equal(reads, 1);
});
test('association fails closed when trusted lookup is unavailable or returns unrelated identities', async () => {
  const c = set(base(), id(40));
  for (const [readCounterparties, code] of [
    [undefined, 'CONFIGURATION_INVALID'],
    [async () => [ref(41)], 'DATA_ACCESS_FAILED'],
    [
      async () => [{ ...ref(), identifier_value: 'SYNTHETIC PRIVATE' }],
      'DATA_ACCESS_FAILED',
    ],
  ]) {
    const svc = createCounterpartyAssociationService({
      async applyGuarded(_, __, guard) {
        try {
          await guard({
            plan: plan(c),
            ...(readCounterparties ? { readCounterparties } : {}),
          });
        } catch (e) {
          throw e instanceof RevisionError
            ? e
            : new RevisionError('DATA_ACCESS_FAILED');
        }
      },
    });
    await assert.rejects(() => svc.apply({ workspace_id: w }, [c]), { code });
  }
});
test('association protocol runs every preservation isolation conflict group and rollback case on real SQLite', async () => {
  const sqlite = openProbeDatabase(':memory:');
  let h;
  try {
    await migrateSqliteTo(sqlite.db, { sha256 });
    for (const workspace of [fixture.workspace_a, fixture.workspace_b])
      await loadFixture(sqlite.db, 'sqlite', workspace);
    await prepareCategoryTenants(sqlite);
    h = createCounterpartyAssociationHarness('sqlite', {
      sqlite: () => sqlite,
    });
    const checks = [];
    await runAssociationCases(h, async (n, f) => {
      await f();
      checks.push(n);
    });
    assert.deepEqual(checks, [...associationCases]);
  } finally {
    await h?.close();
    sqlite.close();
  }
});
test('association evidence binds every real engine gate cleanup sources and pending integration', () => {
  const evidence = () =>
    JSON.parse(
      readFileSync(
        'docs/quality/evidence/us-047-associations-core-2026-10-20-us050-core.json',
      ),
    );
  assert.equal(validateAssociationEvidence(evidence()).passed, true);
  for (const n of associationChecks) {
    const r = evidence();
    delete r.checks[n];
    assert.throws(() => validateAssociationEvidence(r));
  }
  for (const mutate of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.financial_payload = 'SYNTHETIC';
    },
    (r) => {
      r.source_sha256['packages/domain/src/counterparty-associations.ts'] =
        '0'.repeat(64);
    },
  ]) {
    const r = evidence();
    mutate(r);
    assert.throws(() => validateAssociationEvidence(r));
  }
});
