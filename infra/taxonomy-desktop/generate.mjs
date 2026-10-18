/* global structuredClone */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { createTaxonomyService } from '../../packages/finance-ports/dist/taxonomy.js';
import { captureLocalTaxonomy } from '../../apps/desktop/dist/local-taxonomy.js';
export const id = (n) =>
  '0199d245-0000-7000-8000-' + String(n).padStart(12, '0');
const w = id(1),
  category = (n, status = 'ACTIVE') => ({
    id: id(n),
    workspace_id: w,
    name: 'SYNTHETIC CATEGORY ' + n,
    category_scope: 'BOTH',
    sort_order: n,
    status,
    is_seeded: false,
  }),
  tag = (n = 100, name = 'SYNTHETIC TAG') => ({
    kind: 'TAG',
    id: id(n),
    workspace_id: w,
    name,
    status: 'ACTIVE',
  }),
  sub = (n = 200, name = 'SYNTHETIC SUB', parent = id(10)) => ({
    kind: 'SUBCATEGORY',
    id: id(n),
    workspace_id: w,
    name,
    status: 'ACTIVE',
    category_id: parent,
    sort_order: 10,
  }),
  catalog = (items = []) => ({
    categories: [category(10), category(11)],
    items,
  }),
  create = (item) => ({ kind: 'CREATE', item }),
  update = (base, fields = {}) => ({
    kind: 'UPDATE',
    base,
    item: { ...base, ...fields },
  }),
  vectors = [];
async function vector(name, command, current = catalog()) {
  current = structuredClone(current);
  command = structuredClone(command);
  let expected;
  try {
    const plans = [],
      c = captureLocalTaxonomy(command, w),
      service = createTaxonomyService({
        authorize: async () => ({
          workspace_id: w,
          authority: 'LOCAL',
          can_read: true,
          can_manage: true,
        }),
        store: {
          transaction: async (_, run) =>
            run({
              workspace: async () => ({ storage_mode: 'LOCAL' }),
              catalog: async () => current,
              save: async (p) => plans.push(p),
            }),
        },
      });
    await service.apply({ workspace_id: w }, c);
    expected = { plans };
  } catch (e) {
    expected = { error: e.code };
  }
  vectors.push({ name, workspace_id: w, current, command, expected });
}
for (const item of [tag(), sub()]) {
  await vector(item.kind + '_create', create(item));
  await vector(item.kind + '_replay', create(item), catalog([item]));
  await vector(
    item.kind + '_replay_conflict',
    create({ ...item, name: 'SYNTHETIC DIFFERENT' }),
    catalog([item]),
  );
  await vector(
    item.kind + '_update',
    update(item, { name: 'SYNTHETIC RENAMED' }),
    catalog([item]),
  );
  await vector(
    item.kind + '_archive',
    update(item, { status: 'ARCHIVED' }),
    catalog([item]),
  );
  await vector(item.kind + '_noop', update(item), catalog([item]));
  await vector(
    item.kind + '_stale',
    update({ ...item, name: 'SYNTHETIC FORGED' }),
    catalog([item]),
  );
  await vector(item.kind + '_missing', update(item));
  await vector(
    item.kind + '_reactivate',
    update({ ...item, status: 'ARCHIVED' }, { status: 'ACTIVE' }),
    catalog([{ ...item, status: 'ARCHIVED' }]),
  );
  await vector(
    item.kind + '_legacy_archive',
    update({ ...item, name: 'x'.repeat(121) }, { status: 'ARCHIVED' }),
    catalog([{ ...item, name: 'x'.repeat(121) }]),
  );
  for (const [name, change] of Object.entries({
    empty: { name: '' },
    control: { name: 'SYNTHETIC\nPRIVATE' },
    long: { name: 'x'.repeat(121) },
    foreign: { workspace_id: id(2) },
    unknown: { extra: 1 },
    v4: { id: '0199d245-0000-4000-8000-000000000999' },
    archived: { status: 'ARCHIVED' },
    kind: { kind: 'UNKNOWN' },
  }))
    await vector(
      item.kind + '_invalid_' + name,
      create({ ...item, ...change }),
    );
  for (const name of [
    '  ＦÉＲＩＡＳ  ',
    'SYNTHETIC\u00a0\u00a0NAME',
    'SYNTHETIC\u0085NAME',
    'SYNTHETIC\ufeffNAME',
    'á'.repeat(120),
    '😀'.repeat(60),
    '😀'.repeat(61),
  ])
    await vector(
      item.kind + '_label_' + vectors.length,
      create({ ...item, name }),
    );
  const existing = { ...item, name: 'Ｆéｒｉａｓ' };
  await vector(
    item.kind + '_alias',
    create({ ...item, id: id(999), name: ' férias ' }),
    catalog([existing]),
  );
  await vector(
    item.kind + '_archived_name_available',
    create({ ...item, id: id(999), name: ' férias ' }),
    catalog([{ ...existing, status: 'ARCHIVED' }]),
  );
  await vector(
    item.kind + '_reactivation_conflict',
    update({ ...item, status: 'ARCHIVED' }, { status: 'ACTIVE' }),
    catalog([
      { ...item, status: 'ARCHIVED' },
      { ...item, id: id(999) },
    ]),
  );
}
await vector(
  'parent_immutable',
  update(sub(), { category_id: id(11) }),
  catalog([sub()]),
);
await vector('parent_missing', create(sub(200, 'SYNTHETIC', id(999))));
await vector('parent_archived_create', create(sub()), {
  categories: [category(10, 'ARCHIVED')],
  items: [],
});
await vector(
  'parent_archived_reactivate',
  update({ ...sub(), status: 'ARCHIVED' }, { status: 'ACTIVE' }),
  {
    categories: [category(10, 'ARCHIVED')],
    items: [{ ...sub(), status: 'ARCHIVED' }],
  },
);
await vector(
  'parent_archived_keep',
  update(sub(), { name: 'SYNTHETIC MAINTAINED' }),
  { categories: [category(10, 'ARCHIVED')], items: [sub()] },
);
await vector(
  'names_different_types',
  create(tag(100, 'SYNTHETIC SUB')),
  catalog([sub()]),
);
await vector(
  'names_different_parents',
  create(sub(201, 'SYNTHETIC SUB', id(11))),
  catalog([sub()]),
);
const legacy = [sub(), sub(201), sub(202)];
await vector(
  'legacy_duplicate_archive',
  update(legacy[0], { status: 'ARCHIVED' }),
  catalog(legacy),
);
const siblings = [sub(), sub(201, 'SYNTHETIC SECOND')],
  reorder = {
    kind: 'REORDER_SUBCATEGORIES',
    category_id: id(10),
    bases: siblings,
    ids: siblings.map((r) => r.id).reverse(),
  };
await vector(
  'reorder',
  reorder,
  catalog([...siblings, sub(202, 'SYNTHETIC OTHER', id(11)), tag()]),
);
await vector('reorder_empty', {
  kind: 'REORDER_SUBCATEGORIES',
  category_id: id(10),
  bases: [],
  ids: [],
});
await vector('reorder_missing_parent', {
  kind: 'REORDER_SUBCATEGORIES',
  category_id: id(999),
  bases: [],
  ids: [],
});
for (const [name, change] of Object.entries({
  stale: {
    bases: siblings.map((r, i) => (i ? r : { ...r, name: 'SYNTHETIC FORGED' })),
  },
  partial: { bases: [siblings[0]], ids: [siblings[0].id] },
  repeated: { ids: [siblings[0].id, siblings[0].id] },
  wrong_parent: { category_id: id(11) },
  tag_base: { bases: [tag()], ids: [tag().id] },
}))
  await vector('reorder_' + name, { ...reorder, ...change }, catalog(siblings));
for (const sort_order of [
  -2147483648, 2147483647, -2147483649, 2147483648, 0.5,
])
  await vector('order_' + sort_order, create({ ...sub(), sort_order }));
const file = new URL(
    '../../apps/desktop/src-tauri/fixtures/us045-taxonomy.json',
    import.meta.url,
  ),
  text = await prettier.format(
    JSON.stringify({
      synthetic_only: true,
      dataset_id: 'SYNTHETIC_US045_DESKTOP_ONLY',
      vectors,
    }),
    { parser: 'json' },
  );
if (process.argv.includes('--check'))
  assert.equal(readFileSync(file, 'utf8'), text);
else writeFileSync(file, text);
console.log('US045_TAXONOMY_VECTORS: ' + vectors.length);
