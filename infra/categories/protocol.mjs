/* global structuredClone */
import assert from 'node:assert/strict';
import { categoryDefaults } from '../../packages/domain/dist/categories.js';
import {
  createCategoryHarness,
  tenants,
  id,
  request,
  grant,
} from './harness.mjs';
import { fixture } from '../fixtures/loader.mjs';
import { activeDataUnit } from '../../packages/persistence-postgres/dist/internal/unit-scope.js';
import { createPostgresCategoryService } from '../../packages/persistence-postgres/dist/category-changes.js';
export { id, tenants };
export const categoryCases = Object.freeze([
  'purpose_profiles_and_seed_replay',
  'used_category_edit_archive_preserves_finance',
  'create_replay_and_seed_cannot_overwrite_changes',
  'complete_active_reorder_and_forged_base',
  'normalization_archive_and_name_conflict',
  'stale_base_and_immutable_scope_provenance',
  'failed_seed_or_reorder_rolls_back_every_row',
  'authorization_before_write_and_mode',
  'competing_full_base_updates',
  'capture_before_authorization',
  'close_waits_for_accepted_work',
  'preserve_original_fixture_history_and_balances',
]);
export const seed = (purpose, start) => ({
  kind: 'SEED',
  profile_version: 1,
  purpose,
  ids: categoryDefaults(purpose).map((_, i) => id(start + i)),
});
export async function runCategoryCases(h, step) {
  const originalA = await h.snapshot(fixture.workspace_a),
    originalB = await h.snapshot(fixture.workspace_b),
    w = tenants.personal,
    unit = h.make(w),
    req = request(w);
  const list = async (workspace = w, svc = unit) =>
    (await svc.list(request(workspace))).categories;
  const update = (base, fields = {}) => ({
    kind: 'UPDATE',
    base,
    name: base.name,
    status: base.status,
    sort_order: base.sort_order,
    ...fields,
  });
  const create = (n, name = 'SYNTHETIC CATEGORY') => ({
    kind: 'CREATE',
    id: id(n),
    name,
    category_scope: 'EXPENSE',
    sort_order: 100,
  });
  const unchanged = async (operation, code, workspace = w) => {
    const before = await list(workspace);
    await assert.rejects(operation, (e) => e.code === code);
    assert.deepEqual(await list(workspace), before);
  };
  await step('purpose_profiles_and_seed_replay', async () => {
    for (const [kind, workspace, start] of [
      ['PERSONAL', w, 100],
      ['BUSINESS', tenants.business, 200],
      ['OTHER', tenants.other, 300],
    ]) {
      const c = seed(kind, start),
        first = await unit.apply(request(workspace), c),
        again = await unit.apply(request(workspace), c);
      assert.equal(first.categories.length, categoryDefaults(kind).length);
      assert.equal(first.changed, true);
      assert.equal(again.changed, false);
      assert.deepEqual(again.categories, first.categories);
      assert.ok(
        first.categories.every(
          (r) => r.is_seeded && r.workspace_id === workspace,
        ),
      );
    }
    await unchanged(
      () => unit.apply(req, seed('BUSINESS', 400)),
      'CATEGORY_SEED_CONFLICT',
    );
  });
  await step('used_category_edit_archive_preserves_finance', async () => {
    const workspace = fixture.workspace_a,
      before = await h.snapshot(workspace),
      row = (await list(workspace))[0];
    const changed = await unit.apply(
      request(workspace),
      update(row, {
        name: 'SYNTHETIC CATEGORY RENAMED',
        status: 'ARCHIVED',
        sort_order: 42,
      }),
    );
    const current = changed.categories.find((r) => r.id === row.id);
    assert.equal(current.is_seeded, row.is_seeded);
    assert.equal(current.status, 'ARCHIVED');
    const after = await h.snapshot(workspace);
    for (const table of Object.keys(before).filter((t) => t !== 'category'))
      assert.deepEqual(after[table], before[table]);
    assert.equal(after.category.length, before.category.length);
    await unit.apply(
      request(workspace),
      update(current, {
        name: row.name,
        status: row.status,
        sort_order: row.sort_order,
      }),
    );
    assert.deepEqual(await h.snapshot(workspace), before);
  });
  await step('create_replay_and_seed_cannot_overwrite_changes', async () => {
    const c = create(500, "SYNTHETIC '); DROP TABLE category; --"),
      first = await unit.apply(req, c),
      again = await unit.apply(req, c);
    assert.equal(first.changed, true);
    assert.equal(again.changed, false);
    assert.equal(first.categories.find((r) => r.id === c.id).is_seeded, false);
    const base = first.categories.find((r) => r.id === c.id);
    await unit.apply(req, update(base, { name: 'SYNTHETIC MANUAL RENAMED' }));
    await unchanged(() => unit.apply(req, c), 'CATEGORY_BASE_CONFLICT');
    await unchanged(
      () => unit.apply(req, seed('PERSONAL', 100)),
      'CATEGORY_SEED_CONFLICT',
    );
  });
  await step('complete_active_reorder_and_forged_base', async () => {
    const bases = (await list()).filter((r) => r.status === 'ACTIVE'),
      ids = bases.map((r) => r.id).reverse();
    const next = await unit.apply(req, { kind: 'REORDER', bases, ids });
    for (const [index, id] of ids.entries())
      assert.equal(next.categories.find((r) => r.id === id).sort_order, index);
    await unchanged(
      () => unit.apply(req, { kind: 'REORDER', bases, ids: ids.slice(1) }),
      'INVALID_CATEGORY_CHANGE',
    );
    const forged = structuredClone(
      next.categories.filter((r) => r.status === 'ACTIVE'),
    );
    forged[0].name = 'SYNTHETIC FORGED';
    await unchanged(
      () =>
        unit.apply(req, {
          kind: 'REORDER',
          bases: forged,
          ids: forged.map((r) => r.id),
        }),
      'CATEGORY_BASE_CONFLICT',
    );
  });
  await step('normalization_archive_and_name_conflict', async () => {
    await unchanged(
      () => unit.apply(req, create(510, ' ＳＡＬÁＲＩＯ ')),
      'CATEGORY_NAME_CONFLICT',
    );
    let row = (await list()).find((r) => r.name === 'Salário');
    await unit.apply(req, update(row, { status: 'ARCHIVED' }));
    await unit.apply(req, create(510, 'salário'));
    row = (await list()).find((r) => r.id === row.id);
    await unchanged(
      () => unit.apply(req, update(row, { status: 'ACTIVE' })),
      'CATEGORY_NAME_CONFLICT',
    );
    await unit.apply(
      req,
      update(
        (await list()).find((r) => r.id === id(510)),
        { status: 'ARCHIVED' },
      ),
    );
    await unit.apply(req, update(row, { status: 'ACTIVE' }));
  });
  await step('stale_base_and_immutable_scope_provenance', async () => {
    const row = (await list()).find((r) => r.id === id(500));
    await unit.apply(req, update(row, { name: 'SYNTHETIC CURRENT' }));
    await unchanged(
      () => unit.apply(req, update(row, { name: 'SYNTHETIC STALE' })),
      'CATEGORY_BASE_CONFLICT',
    );
    const current = (await list()).find((r) => r.id === row.id),
      forged = { ...current, is_seeded: !current.is_seeded };
    await unchanged(
      () => unit.apply(req, update(forged)),
      'CATEGORY_BASE_CONFLICT',
    );
    await unchanged(
      () => unit.apply(req, { ...update(current), category_scope: 'INCOME' }),
      'INVALID_CATEGORY_CHANGE',
    );
    await unchanged(
      () =>
        unit.apply(
          req,
          update({ ...current, workspace_id: fixture.workspace_b }),
        ),
      'INVALID_CATEGORY_CHANGE',
    );
  });
  await step('failed_seed_or_reorder_rolls_back_every_row', async () => {
    const fail = h.make(tenants.rollback, { fail_write: 2 });
    try {
      await unchanged(
        () => fail.apply(request(tenants.rollback), seed('PERSONAL', 600)),
        'DATA_ACCESS_FAILED',
        tenants.rollback,
      );
    } finally {
      await fail.close();
    }
    const bases = (await list()).filter((r) => r.status === 'ACTIVE'),
      fault = h.make(w, { fail_write: 2 });
    const ids = [...bases]
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
      .reverse()
      .map((r) => r.id);
    try {
      await unchanged(
        () => fault.apply(req, { kind: 'REORDER', bases, ids }),
        'DATA_ACCESS_FAILED',
      );
    } finally {
      await fault.close();
    }
  });
  await step('authorization_before_write_and_mode', async () => {
    for (const authorization of [
      async () => null,
      async (r) => ({ ...grant(r), can_manage: false }),
      async (r) => ({ ...grant(r), can_read: false }),
      async (r) => ({ ...grant(r), authority: 'LOCAL' }),
    ]) {
      const denied = h.make(w, { authorize: authorization });
      try {
        await unchanged(() => denied.apply(req, create(700)), 'ACCESS_DENIED');
      } finally {
        await denied.close();
      }
    }
    const wrongMode = h.make(w, {
      authorize: async (r) => ({ ...grant(r), authority: 'LOCAL' }),
    });
    try {
      await unchanged(
        () => wrongMode.apply({ workspace_id: w }, create(700)),
        'ACCESS_DENIED',
      );
    } finally {
      await wrongMode.close();
    }
    const reader = h.make(w, {
      authorize: async (r) => ({ ...grant(r), can_manage: false }),
    });
    try {
      assert.deepEqual((await reader.list(req)).categories, await list());
    } finally {
      await reader.close();
    }
  });
  await step('competing_full_base_updates', async () => {
    const row = (await list()).find((r) => r.id === id(500)),
      command = update(row, { name: 'SYNTHETIC CONCURRENT' });
    const results = await Promise.allSettled([
      unit.apply(req, command),
      unit.apply(req, command),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'rejected').reason.code,
      'CATEGORY_BASE_CONFLICT',
    );
  });
  await step('capture_before_authorization', async () => {
    let release;
    const waiting = new Promise((r) => {
        release = r;
      }),
      delayed = h.make(w, { authorize: () => waiting });
    try {
      const raw = create(800, 'SYNTHETIC CAPTURED'),
        pending = delayed.apply(req, raw);
      raw.name = 'SYNTHETIC MUTATED';
      release(grant(req));
      await pending;
      assert.equal(
        (await list()).find((r) => r.id === id(800)).name,
        'SYNTHETIC CAPTURED',
      );
    } finally {
      release(grant(req));
      await delayed.close();
    }
  });
  await step('close_waits_for_accepted_work', async () => {
    let release;
    const waiting = new Promise((r) => {
        release = r;
      }),
      closing = h.make(w, { authorize: () => waiting });
    const pending = closing.apply(
        req,
        create(801, 'SYNTHETIC ACCEPTED BEFORE CLOSE'),
      ),
      close = closing.close();
    await assert.rejects(() => closing.list(req), { code: 'CLOSED' });
    release(grant(req));
    await pending;
    await close;
    await closing.close();
    assert.ok((await list()).some((r) => r.id === id(801)));
  });
  await step('preserve_original_fixture_history_and_balances', async () => {
    assert.deepEqual(await h.snapshot(fixture.workspace_a), originalA);
    assert.deepEqual(await h.snapshot(fixture.workspace_b), originalB);
  });
  return {
    personal: await list(),
    business: await list(tenants.business),
    other: await list(tenants.other),
  };
}
export async function runCategoryProtocol(sqlite, pools, admin, step) {
  const local = createCategoryHarness('sqlite', { sqlite: () => sqlite }),
    cloud = createCategoryHarness('postgresql', { pools, admin });
  try {
    const a = await runCategoryCases(local, (n, f) =>
        step('sqlite_category_' + n, f),
      ),
      b = await runCategoryCases(cloud, (n, f) =>
        step('postgresql_category_' + n, f),
      );
    await step('category_same_profiles_metadata_and_order_cross_engine', () =>
      assert.deepEqual(a, b),
    );
    await step('sqlite_category_local_without_cloud_identity', async () => {
      const unit = local.make(tenants.local);
      try {
        const first = await unit.apply(
          { workspace_id: tenants.local },
          seed('PERSONAL', 900),
        );
        assert.equal(first.categories.length, 9);
        await assert.rejects(() => unit.list(request(tenants.local)), {
          code: 'ACCESS_DENIED',
        });
      } finally {
        await unit.close();
      }
    });
    await step('postgres_category_rls_owner_and_nested_unit', async () => {
      const owner = createPostgresCategoryService({
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
      try {
        await assert.rejects(() => denied.list(request(fixture.workspace_b)), {
          code: 'ACCESS_DENIED',
        });
      } finally {
        await denied.close();
      }
      const normal = cloud.make(tenants.personal);
      try {
        await assert.rejects(
          () =>
            activeDataUnit.run(true, () =>
              normal.list(request(tenants.personal)),
            ),
          { code: 'NESTED_UNIT' },
        );
      } finally {
        await normal.close();
      }
    });
  } finally {
    await Promise.all([local.close(), cloud.close()]);
  }
}
