import assert from 'node:assert/strict';
import { fixture } from '../fixtures/loader.mjs';
import {
  createTaxonomyHarness,
  id,
  tenants,
  request,
  grant,
} from './harness.mjs';
import { createPostgresTaxonomyService } from '../../packages/persistence-postgres/dist/taxonomy-changes.js';
import { activeDataUnit } from '../../packages/persistence-postgres/dist/internal/unit-scope.js';
export const taxonomyCases = Object.freeze([
  'create_and_exact_replay',
  'names_scoped_by_parent_and_kind',
  'rename_archive_reactivate_preserve_identity',
  'complete_sibling_order_with_full_bases',
  'normalized_search_and_status_filters',
  'stale_base_and_parent_immutable',
  'authorization_capture_and_storage_mode',
  'competing_updates_and_name_creation',
  'reorder_second_write_rollback',
  'used_metadata_preserves_links_history_and_balances',
  'archived_parent_blocks_new_assignment_but_retains_history',
  'close_waits_for_accepted_work',
]);
const query = (fields = {}) => ({
  kind: 'ALL',
  status: 'ALL',
  category_id: null,
  search: '',
  ...fields,
});
const update = (base, fields = {}) => ({
  kind: 'UPDATE',
  base,
  item: { ...base, ...fields },
});
export async function runTaxonomyCases(h, step) {
  const w = tenants.personal,
    req = request(w),
    unit = h.make(w),
    initialA = await h.snapshot(fixture.workspace_a),
    initialB = await h.snapshot(fixture.workspace_b);
  const parent = (await unit.list(req)).categories.filter(
    (r) => r.status === 'ACTIVE',
  );
  assert.ok(parent.length >= 2);
  const tag = (n, name = 'SYNTHETIC TAG') => ({
      kind: 'CREATE',
      item: { kind: 'TAG', id: id(n), workspace_id: w, name, status: 'ACTIVE' },
    }),
    sub = (n, name = 'SYNTHETIC SUBCATEGORY', category_id = parent[0].id) => ({
      kind: 'CREATE',
      item: {
        kind: 'SUBCATEGORY',
        id: id(n),
        workspace_id: w,
        name,
        status: 'ACTIVE',
        category_id,
        sort_order: 10,
      },
    }),
    list = async (q = query(), u = unit) => (await u.list(req, q)).items,
    row = async (n) => (await list()).find((r) => r.id === id(n)),
    unchanged = async (op, code) => {
      const before = await list();
      await assert.rejects(op, { code });
      assert.deepEqual(await list(), before);
    };
  await step('create_and_exact_replay', async () => {
    for (const c of [tag(45001), sub(45002), sub(45003, 'SYNTHETIC SECOND')]) {
      assert.equal((await unit.apply(req, c)).changed, true);
      assert.equal((await unit.apply(req, c)).changed, false);
      await unchanged(
        () =>
          unit.apply(req, {
            ...c,
            item: { ...c.item, name: 'SYNTHETIC DIFFERENT' },
          }),
        'TAXONOMY_BASE_CONFLICT',
      );
    }
  });
  await step('names_scoped_by_parent_and_kind', async () => {
    await unit.apply(req, tag(45004, 'SYNTHETIC SUBCATEGORY'));
    await unit.apply(req, sub(45005, 'SYNTHETIC SUBCATEGORY', parent[1].id));
    await unchanged(
      () => unit.apply(req, sub(45006, ' synthetic  subcategory ')),
      'TAXONOMY_NAME_CONFLICT',
    );
    await unit.apply(req, tag(45007, 'Ｆéｒｉａｓ'));
    await unchanged(
      () => unit.apply(req, tag(45008, ' férias ')),
      'TAXONOMY_NAME_CONFLICT',
    );
    await unchanged(
      () =>
        unit.apply(
          req,
          sub(45009, 'SYNTHETIC WRONG WORKSPACE', fixture.workspace_b),
        ),
      'TAXONOMY_PARENT_UNAVAILABLE',
    );
  });
  await step('rename_archive_reactivate_preserve_identity', async () => {
    let a = await row(45001);
    await unit.apply(
      req,
      update(a, { name: 'SYNTHETIC RENAMED', status: 'ARCHIVED' }),
    );
    const archived = await row(45001);
    await unit.apply(req, tag(45010, 'SYNTHETIC RENAMED'));
    await unchanged(
      () => unit.apply(req, update(archived, { status: 'ACTIVE' })),
      'TAXONOMY_NAME_CONFLICT',
    );
    await unit.apply(
      req,
      update(archived, { name: 'SYNTHETIC REACTIVATED', status: 'ACTIVE' }),
    );
    a = await row(45002);
    await unit.apply(req, update(a, { status: 'ARCHIVED' }));
    await unit.apply(req, update(await row(45002), { status: 'ACTIVE' }));
  });
  await step('complete_sibling_order_with_full_bases', async () => {
    const bases = await list(
        query({
          kind: 'SUBCATEGORY',
          category_id: parent[0].id,
          status: 'ACTIVE',
        }),
      ),
      ids = bases.map((r) => r.id).reverse();
    const c = {
      kind: 'REORDER_SUBCATEGORIES',
      category_id: parent[0].id,
      bases,
      ids,
    };
    assert.equal((await unit.apply(req, c)).changed, true);
    assert.deepEqual(
      (
        await list(
          query({
            kind: 'SUBCATEGORY',
            category_id: parent[0].id,
            status: 'ACTIVE',
          }),
        )
      ).map((r) => r.id),
      ids,
    );
    await unchanged(() => unit.apply(req, c), 'TAXONOMY_BASE_CONFLICT');
    await unchanged(
      () =>
        unit.apply(req, {
          ...c,
          bases: bases.slice(0, 1),
          ids: ids.slice(0, 1),
        }),
      'INVALID_TAXONOMY_CHANGE',
    );
  });
  await step('normalized_search_and_status_filters', async () => {
    assert.deepEqual(
      (await list(query({ kind: 'TAG', search: ' FÉRIAS ' }))).map((r) => r.id),
      [id(45007)],
    );
    const a = await row(45005);
    await unit.apply(req, update(a, { status: 'ARCHIVED' }));
    assert.equal(
      (
        await list(
          query({
            kind: 'SUBCATEGORY',
            status: 'ARCHIVED',
            category_id: parent[1].id,
          }),
        )
      ).length,
      1,
    );
    assert.equal(
      (
        await list(
          query({
            kind: 'SUBCATEGORY',
            status: 'ACTIVE',
            category_id: parent[1].id,
          }),
        )
      ).some((r) => r.id === id(45005)),
      false,
    );
  });
  await step('stale_base_and_parent_immutable', async () => {
    const a = await row(45002);
    await unit.apply(req, update(a, { name: 'SYNTHETIC LATEST' }));
    await unchanged(
      () => unit.apply(req, update(a, { status: 'ARCHIVED' })),
      'TAXONOMY_BASE_CONFLICT',
    );
    const latest = await row(45002);
    await unchanged(
      () => unit.apply(req, update(latest, { category_id: parent[1].id })),
      'INVALID_TAXONOMY_CHANGE',
    );
  });
  await step('authorization_capture_and_storage_mode', async () => {
    for (const authorization of [
      async () => null,
      async (r) => ({ ...grant(r), can_manage: false }),
      async (r) => ({ ...grant(r), authority: 'LOCAL' }),
    ]) {
      const denied = h.make(w, { authorize: authorization });
      await unchanged(() => denied.apply(req, tag(45011)), 'ACCESS_DENIED');
    }
    const readonly = h.make(w, {
      authorize: async (r) => ({ ...grant(r), can_manage: false }),
    });
    assert.deepEqual(await list(query(), readonly), await list());
    let release;
    const waiting = new Promise((r) => {
        release = r;
      }),
      captured = h.make(w, { authorize: () => waiting }),
      c = tag(45012, 'SYNTHETIC CAPTURED'),
      promise = captured.apply(req, c);
    c.item.name = 'SYNTHETIC PRIVATE MUTATION';
    req.workspace_id = fixture.workspace_b;
    release(grant({ workspace_id: w }));
    await promise;
    req.workspace_id = w;
    assert.equal((await row(45012)).name, 'SYNTHETIC CAPTURED');
  });
  await step('competing_updates_and_name_creation', async () => {
    const base = await row(45002),
      other = h.engine === 'sqlite' ? unit : h.make(w);
    const results = await Promise.allSettled([
      unit.apply(req, update(base, { name: 'SYNTHETIC WINNER A' })),
      other.apply(req, update(base, { name: 'SYNTHETIC WINNER B' })),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'TAXONOMY_BASE_CONFLICT',
    );
    // Normalize the winner so the two-engine catalog comparison is deterministic.
    await unit.apply(
      req,
      update(await row(45002), { name: 'SYNTHETIC WINNER' }),
    );
    const names = await Promise.allSettled([
      unit.apply(req, tag(45013, 'SYNTHETIC RACE')),
      other.apply(req, tag(45014, 'SYNTHETIC RACE')),
    ]);
    assert.equal(names.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      names.find((r) => r.status === 'rejected').reason.code,
      'TAXONOMY_NAME_CONFLICT',
    );
    const winner = (await list()).find((r) => r.name === 'SYNTHETIC RACE');
    await unit.apply(req, update(winner, { status: 'ARCHIVED' }));
  });
  await step('reorder_second_write_rollback', async () => {
    const bases = await list(
        query({
          kind: 'SUBCATEGORY',
          status: 'ACTIVE',
          category_id: parent[0].id,
        }),
      ),
      failing = h.make(w, { fail_write: 2 });
    await unchanged(
      () =>
        failing.apply(req, {
          kind: 'REORDER_SUBCATEGORIES',
          category_id: parent[0].id,
          bases,
          ids: bases.map((r) => r.id).reverse(),
        }),
      'DATA_ACCESS_FAILED',
    );
  });
  await step('used_metadata_preserves_links_history_and_balances', async () => {
    const used = h.make(fixture.workspace_a),
      r = request(fixture.workspace_a),
      catalog = await used.list(r);
    const usedTag = initialA.transaction_tag[0].tag_id,
      usedSub = initialA.transaction_allocation.find(
        (r) => r.subcategory_id !== null,
      ).subcategory_id;
    for (const item of catalog.items.filter(
      (r) =>
        (r.kind === 'TAG' && r.id === usedTag) ||
        (r.kind === 'SUBCATEGORY' && r.id === usedSub),
    )) {
      await used.apply(
        r,
        update(item, {
          name: item.name + ' SYNTHETIC EDIT',
          status: 'ARCHIVED',
        }),
      );
      await used.apply(
        r,
        update(
          { ...item, name: item.name + ' SYNTHETIC EDIT', status: 'ARCHIVED' },
          {},
        ),
      );
    }
    const after = await h.snapshot(fixture.workspace_a);
    for (const key of Object.keys(initialA).filter(
      (k) => !['tag', 'subcategory'].includes(k),
    ))
      assert.deepEqual(after[key], initialA[key]);
    assert.deepEqual(await h.snapshot(fixture.workspace_b), initialB);
    // Restore fixture metadata, retaining every association and financial row.
    for (const item of catalog.items.filter(
      (r) =>
        (r.kind === 'TAG' && r.id === usedTag) ||
        (r.kind === 'SUBCATEGORY' && r.id === usedSub),
    ))
      await used.apply(
        r,
        update(
          { ...item, name: item.name + ' SYNTHETIC EDIT', status: 'ARCHIVED' },
          item,
        ),
      );
    assert.deepEqual(await h.snapshot(fixture.workspace_a), initialA);
  });
  await step(
    'archived_parent_blocks_new_assignment_but_retains_history',
    async () => {
      const manager = h.manage(w),
        base = parent[0],
        cat = (status) => ({
          kind: 'UPDATE',
          base,
          name: base.name,
          sort_order: base.sort_order,
          status,
        });
      await manager.apply(req, cat('ARCHIVED'));
      await unchanged(
        () => unit.apply(req, sub(45016, 'SYNTHETIC ARCHIVED PARENT')),
        'TAXONOMY_PARENT_UNAVAILABLE',
      );
      const a = await row(45002);
      await unit.apply(req, update(a, { status: 'ARCHIVED' }));
      const archived = await row(45002);
      await unchanged(
        () => unit.apply(req, update(archived, { status: 'ACTIVE' })),
        'TAXONOMY_PARENT_UNAVAILABLE',
      );
      const catalog = await manager.list(req),
        current = catalog.categories.find((r) => r.id === base.id);
      await manager.apply(req, { ...cat('ACTIVE'), base: current });
      await unit.apply(req, update(archived, { status: 'ACTIVE' }));
    },
  );
  await step('close_waits_for_accepted_work', async () => {
    let release;
    const waiting = new Promise((r) => {
        release = r;
      }),
      closing = h.make(w, { authorize: () => waiting }),
      pending = closing.apply(req, tag(45015, 'SYNTHETIC ACCEPTED')),
      close = closing.close();
    await assert.rejects(() => closing.list(req), { code: 'CLOSED' });
    release(grant(req));
    await pending;
    await close;
    await closing.close();
    assert.ok(await row(45015));
  });
  // Exclude the deliberately nondeterministic UUID of the concurrent create winner.
  return (await list()).filter((r) => ![id(45013), id(45014)].includes(r.id));
}
export async function runTaxonomyProtocol(sqlite, pools, admin, step) {
  const local = createTaxonomyHarness('sqlite', { sqlite: () => sqlite }),
    cloud = createTaxonomyHarness('postgresql', { pools, admin });
  try {
    const a = await runTaxonomyCases(local, (n, f) =>
        step('sqlite_taxonomy_' + n, f),
      ),
      b = await runTaxonomyCases(cloud, (n, f) =>
        step('postgresql_taxonomy_' + n, f),
      );
    await step('taxonomy_same_catalog_cross_engine', () =>
      assert.deepEqual(a, b),
    );
    await step('sqlite_taxonomy_local_without_cloud_identity', async () => {
      const u = local.make(tenants.local);
      const item = {
        kind: 'TAG',
        id: id(45999),
        workspace_id: tenants.local,
        name: 'SYNTHETIC LOCAL',
        status: 'ACTIVE',
      };
      assert.equal(
        (
          await u.apply(
            { workspace_id: tenants.local },
            { kind: 'CREATE', item },
          )
        ).changed,
        true,
      );
      await assert.rejects(() => u.list(request(tenants.local)), {
        code: 'ACCESS_DENIED',
      });
    });
    await step('postgres_taxonomy_rls_owner_nested_unit', async () => {
      const owner = createPostgresTaxonomyService({
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
