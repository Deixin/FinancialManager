/* global structuredClone */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { editorSnapshot, workspace as w, id, now } from './fixture.mjs';
import { captureLocalAllocations } from '../../apps/desktop/dist/local-allocations.js';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createAllocationService } from '../../packages/finance-ports/dist/classification.js';
const s = editorSnapshot(),
  accounts = s.balance.accounts.map((r) => {
    const {
      id,
      workspace_id,
      currency_code,
      account_kind,
      balance_nature,
      status,
    } = r.account;
    return {
      id,
      workspace_id,
      currency_code,
      account_kind,
      balance_nature,
      status,
    };
  }),
  catalog = {
    categories: s.classification.categories,
    items: s.classification.items,
  },
  current = s.transactions,
  groups = [80, 81].map((n) => ({
    id: id(n),
    workspace_id: w,
    group_type: n === 80 ? 'TRANSFER' : 'CARD_PAYMENT',
    state: 'ACTIVE',
    member_ids: current
      .filter((r) => r.content.group_id === id(n))
      .map((r) => r.id),
  })),
  vectors = [];
const keep = (n) => ({
  base: structuredClone(current.find((r) => r.id === id(n))),
  allocation: { kind: 'KEEP' },
});
const row = (n, cat, amount, sub = null, note = null) => ({
  id: id(n),
  category_id: id(cat),
  subcategory_id: sub === null ? null : id(sub),
  amount_minor: amount,
  note,
});
const replace = (n, rows) => ({
  ...keep(n),
  allocation: { kind: 'REPLACE', allocations: rows },
});
async function vector(name, commands, extra = {}) {
  const v = structuredClone({
    workspace_id: w,
    now,
    commands,
    current,
    accounts,
    catalog,
    groups,
    ...extra,
  });
  let expected;
  try {
    const captured = captureLocalAllocations(v.commands, v.workspace_id),
      plans = [];
    let sequence = 9000;
    const core = createRevisionService({
      authorize: async () => ({
        workspace_id: v.workspace_id,
        authority: 'LOCAL',
        can_write: true,
        account_ids: null,
        actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
      }),
      identity: {
        newId: () => id(sequence++),
        nowInstant: () => v.now,
      },
      change_source: 'MANUAL',
      store: {
        transaction: async (_, run) =>
          run({
            workspaceMode: async () => 'LOCAL',
            account: async (id) => {
              const a = v.accounts.find((a) => a.id === id);
              return a
                ? { ...a, name: 'SYNTHETIC ACCOUNT', created_at: now }
                : null;
            },
            load: async (id) => v.current.find((r) => r.id === id) ?? null,
            group: async (gid) => {
              const g = v.groups.find((g) => g.id === gid);
              return g
                ? {
                    id: g.id,
                    group_type: g.group_type,
                    state: g.state,
                    members: g.member_ids.map((id) => ({
                      id,
                      account_id:
                        v.current.find((r) => r.id === id)?.content
                          .account_id ?? v.accounts[0].id,
                    })),
                  }
                : null;
            },
            taxonomyCatalog: async () => v.catalog,
            history: async () => null,
            save: async () => {},
          }),
      },
    });
    const service = createAllocationService({
      applyGuarded: (request, changes, guard) =>
        core.applyGuarded(request, changes, async (ctx) => {
          plans.push(ctx.plan);
          await guard(ctx);
        }),
    });
    await service.apply({ workspace_id: v.workspace_id }, captured);
    expected = { plans };
  } catch (e) {
    expected = { error: e.code ?? 'INVALID_CLASSIFICATION' };
  }
  vectors.push({ name, ...v, expected });
}
const total = (n) => {
  const a = BigInt(keep(n).base.content.account_amount_minor);
  return a < 0n ? -a : a;
};
const split = (n) =>
  replace(n, [
    row(n + 500, 10, (total(n) - 1n).toString()),
    row(n + 600, 11, '1'),
  ]);
for (const n of [100, 101, 102, 103]) {
  await vector('keep_' + n, [keep(n)]);
  await vector('clear_' + n, [{ ...keep(n), allocation: { kind: 'CLEAR' } }]);
}
await vector('import_split', [split(100)]);
await vector('two_parcels_same_category', [
  replace(100, [row(500, 10, '1'), row(501, 10, (total(100) - 1n).toString())]),
]);
for (const value of ['0', '-1', '01', '1.0', '9223372036854775808', 1])
  await vector('invalid_money_' + String(value), [
    replace(100, [row(500, 10, value)]),
  ]);
for (const value of ['1', (total(100) + 1n).toString()])
  await vector('mismatch_' + value, [replace(100, [row(500, 10, value)])]);
await vector('empty_replace', [replace(100, [])]);
await vector('duplicate_rows', [
  replace(100, [row(500, 10, '1'), row(500, 10, (total(100) - 1n).toString())]),
]);
for (const [name, fields] of [
  ['wrong_scope', { category_id: id(11) }],
  ['missing_category', { category_id: id(999) }],
  ['wrong_sub_parent', { subcategory_id: id(21) }],
  ['archived_new', { category_id: id(12) }],
])
  await vector(
    name,
    [replace(100, [{ ...row(500, 10, total(100).toString()), ...fields }])],
    name === 'wrong_scope'
      ? {
          catalog: {
            ...catalog,
            categories: catalog.categories.map((c) =>
              c.id === id(11) ? { ...c, category_scope: 'INCOME' } : c,
            ),
          },
        }
      : {},
  );
for (const kind of ['KEEP', 'CLEAR'])
  await vector('unknown_field_' + kind, [
    { ...keep(100), allocation: { kind, extra: true } },
  ]);
await vector('unknown_command_field', [{ ...keep(100), tag_ids: [] }]);
await vector('new_uuid4', [
  replace(100, [
    {
      ...row(500, 10, total(100).toString()),
      id: id(500).replace('-7000-', '-4000-'),
    },
  ]),
]);
await vector('forged_base', [
  {
    ...keep(100),
    base: {
      ...keep(100).base,
      content: { ...keep(100).base.content, display_name: 'SYNTHETIC FORGED' },
    },
  },
]);
await vector('stale_base', [
  { ...keep(100), base: { ...keep(100).base, version: '2' } },
]);
for (const [name, value] of [
  ['minimum', '-9223372036854775808'],
  ['wide', '-9007199254740993'],
  ['zero', '0'],
]) {
  const c = keep(100);
  c.base.content.account_amount_minor = value;
  c.base.content.allocations = [];
  if (value === '0') c.base.content.economic_kind = 'ADJUSTMENT';
  const states = current.map((s) =>
      s.id === c.base.id ? structuredClone(c.base) : s,
    ),
    a = BigInt(value) < 0n ? -BigInt(value) : BigInt(value);
  await vector(name + '_keep', [c], { current: states });
  await vector(
    name + '_replace',
    [
      {
        ...c,
        allocation: {
          kind: 'REPLACE',
          allocations: [
            row(500, 10, a > 1n ? (a - 1n).toString() : '1'),
            row(501, 11, '1'),
          ],
        },
      },
    ],
    { current: states },
  );
}
for (const n of [104, 107]) {
  const partner = n === 104 ? 105 : 108;
  await vector('group_missing_' + n, [split(n)]);
  await vector('group_complete_' + n, [split(n), keep(partner)]);
}
await vector('archived_keep', [keep(101)], {
  catalog: {
    ...catalog,
    categories: catalog.categories.map((c) =>
      c.id === id(10) ? { ...c, status: 'ARCHIVED' } : c,
    ),
    items: catalog.items.map((s) =>
      s.id === id(20) ? { ...s, status: 'ARCHIVED' } : s,
    ),
  },
});
await vector(
  'archived_retained_note',
  [
    replace(101, [
      { ...keep(101).base.content.allocations[0], note: 'SYNTHETIC REVISED' },
    ]),
  ],
  {
    catalog: {
      ...catalog,
      categories: catalog.categories.map((c) =>
        c.id === id(10) ? { ...c, status: 'ARCHIVED' } : c,
      ),
      items: catalog.items.map((s) =>
        s.id === id(20) ? { ...s, status: 'ARCHIVED' } : s,
      ),
    },
  },
);
await vector('collapse_existing', [
  replace(100, [
    {
      ...keep(100).base.content.allocations[0],
      amount_minor: total(100).toString(),
    },
  ]),
]);
await vector('empty_batch', []);
await vector('duplicate_batch', [keep(100), keep(100)]);
await vector('oversize_batch', Array(257).fill(keep(100)));
const b = keep(100);
await vector('too_many_parcels', [
  {
    ...b,
    allocation: {
      kind: 'REPLACE',
      allocations: Array.from({ length: 1001 }, (_, n) =>
        row(n + 2000, 10, '1'),
      ),
    },
  },
]);
const document = { format_version: 1, synthetic_only: true, vectors };
const file = 'apps/desktop/src-tauri/fixtures/us046-allocations.json';
const output = await prettier.format(JSON.stringify(document), {
  parser: 'json',
});
if (process.argv.includes('--check'))
  assert.equal(readFileSync(file, 'utf8').replaceAll('\r\n', '\n'), output);
else writeFileSync(file, output);
console.log('US046_ALLOCATION_VECTORS: ' + vectors.length);
