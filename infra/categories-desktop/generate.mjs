/* global structuredClone */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { createCategoryService } from '../../packages/finance-ports/dist/categories.js';
import {
  categoryDefaults,
  planCategories,
} from '../../packages/domain/dist/categories.js';
import { captureLocalCategory } from '../../apps/desktop/dist/local-categories.js';
export const id = (n) =>
  '0199d244-0000-7000-8000-' + String(n).padStart(12, '0');
const w = id(1),
  vectors = [];
const seed = (purpose = 'PERSONAL', start = 100) => ({
    kind: 'SEED',
    profile_version: 1,
    purpose,
    ids: categoryDefaults(purpose).map((_, i) => id(start + i)),
  }),
  create = () => ({
    kind: 'CREATE',
    id: id(500),
    name: 'SYNTHETIC CATEGORY',
    category_scope: 'BOTH',
    sort_order: 10,
  });
const rows = planCategories(w, 'PERSONAL', [], seed()).map((p) => p.after),
  update = (base = rows[0], fields = {}) => ({
    kind: 'UPDATE',
    base,
    name: base.name,
    sort_order: base.sort_order,
    status: base.status,
    ...fields,
  });
async function vector(name, command, current = [], purpose = 'PERSONAL') {
  command = structuredClone(command);
  current = structuredClone(current);
  let expected;
  try {
    const plans = [],
      c = captureLocalCategory(command, w),
      s = createCategoryService({
        authorize: async () => ({
          workspace_id: w,
          authority: 'LOCAL',
          can_read: true,
          can_manage: true,
        }),
        store: {
          transaction: async (_, run) =>
            run({
              workspace: async () => ({ storage_mode: 'LOCAL', purpose }),
              list: async () => current,
              save: async (p) => plans.push(p),
            }),
        },
      });
    await s.apply({ workspace_id: w }, c);
    expected = { plans };
  } catch (e) {
    expected = { error: e.code };
  }
  vectors.push({ name, workspace_id: w, purpose, current, command, expected });
}
for (const p of ['PERSONAL', 'BUSINESS', 'OTHER']) {
  const c = seed(p),
    r = planCategories(w, p, [], c).map((p) => p.after);
  await vector('seed_' + p, c, [], p);
  await vector('seed_replay_' + p, c, r, p);
}
await vector('seed_wrong_purpose', seed('BUSINESS'));
await vector(
  'seed_changed',
  seed(),
  rows.map((r, i) => (i ? r : { ...r, name: 'SYNTHETIC EDITED' })),
);
await vector(
  'seed_archived',
  seed(),
  rows.map((r, i) => (i ? r : { ...r, status: 'ARCHIVED' })),
);
for (const [name, mutate] of Object.entries({
  wrong_profile: (c) => (c.profile_version = 2),
  missing_seed_id: (c) => c.ids.pop(),
  duplicate_seed_id: (c) => (c.ids[1] = c.ids[0]),
  unknown_field: (c) => (c.reset = true),
})) {
  const c = seed();
  mutate(c);
  await vector(name, c);
}
await vector('create', create(), rows);
await vector(
  'create_replay',
  create(),
  planCategories(w, 'PERSONAL', [], create()).map((p) => p.after),
);
await vector('create_id_conflict', { ...create(), id: rows[0].id }, rows);
for (const [name, value] of [
  ['empty', ''],
  ['spaces', '   '],
  ['control', 'SYNTHETIC\nPRIVATE'],
  ['name_limit', 'x'.repeat(121)],
  ['trim', '\ufeff SYNTHETIC TRIM \ufeff'],
  ['utf16', '😀'.repeat(60)],
  ['utf16_limit', '😀'.repeat(61)],
  ['nfkc_conflict', ' ＳＡＬÁＲＩＯ '],
  ['combining_conflict', 'Sala\u0301rio'],
])
  await vector(name, { ...create(), name: value }, rows);
for (const [name, fields] of Object.entries({
  float: { sort_order: 0.5 },
  high: { sort_order: 2147483648 },
  low: { sort_order: -2147483649 },
  minimum: { sort_order: -2147483648 },
  maximum: { sort_order: 2147483647 },
  bad_scope: { category_scope: 'UNKNOWN' },
  v4: { id: id(500).replace('-7000-', '-4000-') },
  extra: { is_seeded: true },
}))
  await vector(name, { ...create(), ...fields }, rows);
await vector('rename', update(rows[0], { name: 'SYNTHETIC RENAMED' }), rows);
await vector('noop', update(), rows);
await vector('archive', update(rows[0], { status: 'ARCHIVED' }), rows);
await vector('missing', update({ ...rows[0], id: id(999) }), rows);
await vector('stale', update({ ...rows[0], name: 'SYNTHETIC STALE' }), rows);
await vector('forged_seeded', update({ ...rows[0], is_seeded: false }), rows);
await vector(
  'wrong_workspace',
  update({ ...rows[0], workspace_id: id(99) }),
  rows,
);
await vector('scope_change', { ...update(), category_scope: 'BOTH' }, rows);
const archived = rows.map((r, i) =>
  i === 7 ? { ...r, status: 'ARCHIVED' } : r,
);
await vector('archived_name_reuse', { ...create(), name: 'salário' }, archived);
const manual = planCategories(w, 'PERSONAL', archived, {
  ...create(),
  name: 'salário',
})[0].after;
await vector(
  'reactivate_name_conflict',
  update(archived[7], { status: 'ACTIVE' }),
  [...archived, manual],
);
await vector('reactivate', update(archived[7], { status: 'ACTIVE' }), archived);
for (const [name, current] of [
  ['reorder', rows],
  ['reorder_archived', archived],
]) {
  const bases = current.filter((r) => r.status === 'ACTIVE');
  await vector(
    name,
    { kind: 'REORDER', bases, ids: bases.map((r) => r.id).reverse() },
    current,
  );
  await vector(
    name + '_stale',
    {
      kind: 'REORDER',
      bases: bases.map((r, i) => (i ? r : { ...r, name: 'SYNTHETIC FORGED' })),
      ids: bases.map((r) => r.id),
    },
    current,
  );
  await vector(
    name + '_missing',
    {
      kind: 'REORDER',
      bases: bases.slice(1),
      ids: bases.slice(1).map((r) => r.id),
    },
    current,
  );
}
await vector('reorder_empty', { kind: 'REORDER', bases: [], ids: [] });
await vector(
  'legacy_label',
  update({ ...rows[0], name: 'x'.repeat(121) }, { status: 'ARCHIVED' }),
  [{ ...rows[0], name: 'x'.repeat(121) }],
);
const filename = fileURLToPath(
    new URL(
      '../../apps/desktop/src-tauri/fixtures/us044-categories.json',
      import.meta.url,
    ),
  ),
  text = await prettier.format(
    JSON.stringify({
      synthetic_only: true,
      dataset_id: 'SYNTHETIC_US044_DESKTOP_ONLY',
      vectors,
    }),
    { parser: 'json' },
  );
if (process.argv.includes('--check'))
  assert.equal(readFileSync(filename, 'utf8'), text);
else writeFileSync(filename, text);
console.log('US044_CATEGORY_VECTORS: ' + vectors.length);
