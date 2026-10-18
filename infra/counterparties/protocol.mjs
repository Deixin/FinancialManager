import assert from 'node:assert/strict';
import { fixture } from '../fixtures/loader.mjs';
import {
  createCounterpartyHarness,
  id,
  tenants,
  request,
  grant,
} from './harness.mjs';
import { createPostgresCounterpartyService } from '../../packages/persistence-postgres/dist/counterparty-changes.js';
import { activeDataUnit } from '../../packages/persistence-postgres/dist/internal/unit-scope.js';
export const counterpartyCases = Object.freeze([
  'create_exact_replay_and_id_collision',
  'homonyms_are_explicit_independent_identities',
  'optional_identifiers_and_relationships',
  'rename_archive_reactivate_with_full_base',
  'normalized_search_and_filters',
  'stale_base_missing_identity_and_workspace',
  'read_and_manage_authorization',
  'capture_before_authorization_await',
  'competing_updates_one_winner',
  'failed_write_rolls_back',
  'used_counterparty_preserves_original_and_financial_history',
  'close_waits_for_accepted_work',
]);
export const item = (n, w = tenants.personal, fields = {}) => ({
  id: id(n),
  workspace_id: w,
  display_name: 'SYNTHETIC Comércio',
  identifier_type: null,
  identifier_value: null,
  relationship_hint: null,
  status: 'ACTIVE',
  ...fields,
});
export const create = (n, w = tenants.personal, fields = {}) => ({
  kind: 'CREATE',
  item: item(n, w, fields),
});
export const update = (base, fields = {}) => ({
  kind: 'UPDATE',
  base,
  item: { ...base, ...fields },
});
export const query = (fields = {}) => ({
  status: 'ALL',
  relationship_hint: 'ALL',
  search: '',
  ...fields,
});
export async function runCounterpartyCases(h, step) {
  const w = tenants.personal,
    req = request(w),
    unit = h.make(w),
    list = async (q = query(), u = unit) => (await u.list(req, q)).items,
    row = async (n) => (await list()).find((r) => r.id === id(n)),
    unchanged = async (operation, code) => {
      const before = await list();
      await assert.rejects(operation, { code });
      assert.deepEqual(await list(), before);
    };
  await step('create_exact_replay_and_id_collision', async () => {
    assert.equal((await unit.apply(req, create(47001))).changed, true);
    assert.equal((await unit.apply(req, create(47001))).changed, false);
    await unchanged(
      () =>
        unit.apply(
          req,
          create(47001, w, { display_name: 'SYNTHETIC DIFFERENT' }),
        ),
      'COUNTERPARTY_BASE_CONFLICT',
    );
  });
  await step('homonyms_are_explicit_independent_identities', async () => {
    await unit.apply(req, create(47002));
    const other = h.make(tenants.other);
    await other.apply(request(tenants.other), create(47003, tenants.other));
    assert.deepEqual(
      (await list()).map((r) => r.id),
      [id(47001), id(47002)],
    );
    assert.equal((await other.list(request(tenants.other))).items.length, 1);
  });
  await step('optional_identifiers_and_relationships', async () => {
    for (const [n, identifier_type, identifier_value, relationship_hint] of [
      [47004, 'CPF', '00000000000', 'CUSTOMER'],
      [47005, 'CNPJ', '00000000000000', 'SUPPLIER'],
      [47006, 'OTHER', 'SYNTHETIC-REFERENCE', 'OTHER'],
    ])
      await unit.apply(
        req,
        create(n, w, { identifier_type, identifier_value, relationship_hint }),
      );
    assert.equal((await row(47004)).identifier_value, '00000000000');
  });
  await step('rename_archive_reactivate_with_full_base', async () => {
    const before = await row(47001);
    assert.equal((await unit.apply(req, update(before))).changed, false);
    await unit.apply(
      req,
      update(before, { display_name: 'SYNTHETIC Mercado', status: 'ARCHIVED' }),
    );
    const archived = await row(47001);
    await unchanged(
      () => unit.apply(req, update(before)),
      'COUNTERPARTY_BASE_CONFLICT',
    );
    await unit.apply(req, update(archived, { status: 'ACTIVE' }));
    assert.equal((await row(47001)).display_name, 'SYNTHETIC Mercado');
  });
  await step('normalized_search_and_filters', async () => {
    assert.ok(
      (await list(query({ search: 'COMERCIO' }))).some(
        (r) => r.id === id(47002),
      ),
    );
    assert.deepEqual(
      (await list(query({ search: 'synthetic-reference' }))).map((r) => r.id),
      [id(47006)],
    );
    assert.deepEqual(
      (await list(query({ relationship_hint: 'CUSTOMER' }))).map((r) => r.id),
      [id(47004)],
    );
    assert.deepEqual(await list(query({ status: 'ARCHIVED' })), []);
    assert.equal((await list(query({ relationship_hint: null }))).length, 2);
  });
  await step('stale_base_missing_identity_and_workspace', async () => {
    await unchanged(
      () => unit.apply(req, update(item(47998))),
      'COUNTERPARTY_NOT_FOUND',
    );
    await unchanged(
      () =>
        unit.apply(req, update(item(47002), { workspace_id: tenants.other })),
      'INVALID_COUNTERPARTY_CHANGE',
    );
    await unchanged(
      () =>
        unit.apply(
          req,
          create(47099, w, { original_description: 'SYNTHETIC PRIVATE' }),
        ),
      'INVALID_COUNTERPARTY_CHANGE',
    );
    await unchanged(
      () =>
        unit.apply(
          req,
          create(47099, w, { identifier_type: 'CPF', identifier_value: null }),
        ),
      'INVALID_COUNTERPARTY_CHANGE',
    );
  });
  await step('read_and_manage_authorization', async () => {
    const read = h.make(w, {
      authorize: async (r) => ({ ...grant(r), can_manage: false }),
    });
    assert.deepEqual((await read.list(req)).items, await list());
    await unchanged(() => read.apply(req, create(47098)), 'ACCESS_DENIED');
    const denied = h.make(w, {
      authorize: async (r) => ({ ...grant(r), can_read: false }),
    });
    await assert.rejects(() => denied.list(req), { code: 'ACCESS_DENIED' });
    const wrong = h.make(w, {
      authorize: async (r) => ({ ...grant(r), authority: 'LOCAL' }),
    });
    await assert.rejects(() => wrong.list({ workspace_id: w }), {
      code: 'ACCESS_DENIED',
    });
  });
  await step('capture_before_authorization_await', async () => {
    let release;
    const wait = new Promise((r) => {
        release = r;
      }),
      delayed = h.make(w, { authorize: () => wait }),
      raw = create(47007),
      requestCopy = request(w),
      pending = delayed.apply(requestCopy, raw);
    raw.item.display_name = 'SYNTHETIC MUTATED';
    requestCopy.workspace_id = tenants.other;
    release(grant(req));
    await pending;
    assert.equal((await row(47007)).display_name, 'SYNTHETIC Comércio');
    let releaseQuery;
    const waitingQuery = new Promise((r) => {
        releaseQuery = r;
      }),
      q = query({ search: 'MERCADO' }),
      reader = h.make(w, { authorize: () => waitingQuery }),
      result = reader.list(req, q);
    q.search = 'SYNTHETIC NEVER';
    releaseQuery(grant(req));
    assert.deepEqual(
      (await result).items.map((r) => r.id),
      [id(47001)],
    );
  });
  await step('competing_updates_one_winner', async () => {
    const base = await row(47002),
      other = h.engine === 'sqlite' ? unit : h.make(w);
    const results = await Promise.allSettled([
      unit.apply(req, update(base, { display_name: 'SYNTHETIC FIRST' })),
      other.apply(req, update(base, { display_name: 'SYNTHETIC SECOND' })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'COUNTERPARTY_BASE_CONFLICT',
    );
    await unit.apply(
      req,
      update(await row(47002), { display_name: base.display_name }),
    );
  });
  await step('failed_write_rolls_back', async () => {
    const bad = h.make(w, { fail_write: 1 });
    await unchanged(() => bad.apply(req, create(47090)), 'DATA_ACCESS_FAILED');
    assert.equal((await bad.list(req)).items.length, (await list()).length);
  });
  await step(
    'used_counterparty_preserves_original_and_financial_history',
    async () => {
      // Fixture A contains imported descriptions and existing counterparty references.
      const before = await h.snapshot(fixture.workspace_a),
        beforeB = await h.snapshot(fixture.workspace_b),
        used = h.make(fixture.workspace_a),
        requestA = request(fixture.workspace_a);
      const original = (await used.list(requestA)).items[0];
      assert.ok(original);
      assert.ok(
        before.financial_transaction.some(
          (r) => r.counterparty_id === original.id,
        ),
      );
      await used.apply(
        requestA,
        update(original, {
          display_name: 'SYNTHETIC RENAMED COUNTERPARTY',
          status: 'ARCHIVED',
        }),
      );
      const after = await h.snapshot(fixture.workspace_a);
      const withoutCatalog = (snapshot) => ({ ...snapshot, counterparty: [] });
      assert.deepEqual(withoutCatalog(after), withoutCatalog(before));
      assert.deepEqual(await h.snapshot(fixture.workspace_b), beforeB);
      await used.apply(
        requestA,
        update(
          (await used.list(requestA)).items.find((r) => r.id === original.id),
          original,
        ),
      );
      assert.deepEqual(await h.snapshot(fixture.workspace_a), before);
    },
  );
  await step('close_waits_for_accepted_work', async () => {
    let release;
    const wait = new Promise((r) => {
        release = r;
      }),
      closing = h.make(w, { authorize: () => wait }),
      accepted = closing.apply(req, create(47008)),
      close = closing.close();
    await assert.rejects(() => closing.list(req), { code: 'CLOSED' });
    release(grant(req));
    await accepted;
    await close;
    await closing.close();
    assert.ok(await row(47008));
  });
  return list();
}
export async function runCounterpartyProtocol(sqlite, pools, admin, step) {
  const local = createCounterpartyHarness('sqlite', { sqlite: () => sqlite }),
    cloud = createCounterpartyHarness('postgresql', { pools, admin });
  try {
    const a = await runCounterpartyCases(local, (n, f) =>
        step('sqlite_counterparties_' + n, f),
      ),
      b = await runCounterpartyCases(cloud, (n, f) =>
        step('postgresql_counterparties_' + n, f),
      );
    await step('counterparties_same_catalog_cross_engine', () =>
      assert.deepEqual(a, b),
    );
    await step(
      'sqlite_counterparties_local_without_cloud_identity',
      async () => {
        const u = local.make(tenants.local);
        assert.equal(
          (
            await u.apply(
              { workspace_id: tenants.local },
              create(47999, tenants.local),
            )
          ).changed,
          true,
        );
        await assert.rejects(() => u.list(request(tenants.local)), {
          code: 'ACCESS_DENIED',
        });
      },
    );
    await step('postgres_counterparties_rls_owner_nested_unit', async () => {
      const owner = createPostgresCounterpartyService({
        pool: admin,
        expected_role: 'us021_bootstrap',
        authorize: async (r) => grant(r),
      });
      try {
        await assert.rejects(() => owner.list(request(tenants.personal)), {
          code: 'CONFIGURATION_INVALID',
        });
      } finally {
        await owner.close();
      }
      const denied = cloud.make(fixture.workspace_b, { as_a: true });
      await assert.rejects(() => denied.list(request(fixture.workspace_b)), {
        code: 'ACCESS_DENIED',
      });
      const normal = cloud.make(tenants.personal);
      await assert.rejects(
        () =>
          activeDataUnit.run(true, () =>
            normal.list(request(tenants.personal)),
          ),
        { code: 'NESTED_UNIT' },
      );
    });
  } finally {
    await Promise.all([local.close(), cloud.close()]);
  }
}
