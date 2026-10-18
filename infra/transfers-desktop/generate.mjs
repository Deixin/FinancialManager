/* global structuredClone */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as prettier from 'prettier';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createTransferService } from '../../packages/finance-ports/dist/transfers.js';
import { planTransactionRevision } from '../../packages/domain/dist/revisions.js';
import { transferChanges } from '../../packages/domain/dist/transfers.js';
import { captureLocalTransfer } from '../../apps/desktop/dist/local-transfers.js';
export const id = (n) =>
  '0199d242-0000-7000-8000-' + String(n).padStart(12, '0');
const w = id(1),
  now = '2026-10-18T12:00:00.000Z';
const a = {
    id: id(2),
    workspace_id: w,
    currency_code: 'BRL',
    account_kind: 'CASH',
    balance_nature: 'ASSET',
    status: 'ACTIVE',
  },
  b = { ...a, id: id(3) },
  other = { ...a, id: id(4) },
  live = [a, b, other];
const create = () => ({
  kind: 'CREATE',
  id: id(10),
  source_entry_id: id(11),
  target_entry_id: id(12),
  source_account: a,
  target_account: b,
  financial_date: '2026-10-18',
  amount_minor: '1000',
  display_name: 'SYNTHETIC TRANSFER',
  original_description: 'SYNTHETIC ORIGINAL',
});
const changes = transferChanges(captureLocalTransfer(create(), w)),
  initial = changes.map((c) => planTransactionRevision(w, null, c, now).after),
  group = {
    id: id(10),
    workspace_id: w,
    group_type: 'TRANSFER',
    state: 'ACTIVE',
    member_ids: initial.map((s) => s.id),
  };
const base = (rows = initial) => ({
    group_id: id(10),
    source: rows[0],
    target: rows[1],
  }),
  edit = (rows = initial, extra = {}) => ({
    kind: 'EDIT',
    base: base(rows),
    source_account: a,
    target_account: b,
    financial_date: '2026-10-18',
    amount_minor: '1000',
    display_name: rows[0].content.display_name,
    ...extra,
  });
const vectors = [];
async function vector(
  name,
  command,
  current = [null, null],
  g = null,
  accounts = live,
  at = now,
) {
  command = structuredClone(command);
  current = structuredClone(current);
  g = structuredClone(g);
  accounts = structuredClone(accounts);
  let expected;
  try {
    const c = captureLocalTransfer(command, w),
      saved = [],
      captured = transferChanges(c);
    let creation = false;
    const service = createRevisionService({
      authorize: async () => ({
        workspace_id: w,
        authority: 'LOCAL',
        can_write: true,
        account_ids: null,
        actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
      }),
      identity: { newId: () => id(900 + saved.length), nowInstant: () => at },
      change_source: 'MANUAL',
      store: {
        transaction: async (_, run) =>
          run({
            workspaceMode: async () => 'LOCAL',
            account: async (id) => {
              const found = accounts.find((a) => a.id === id);
              return found
                ? { ...found, name: 'SYNTHETIC TRUSTED META', created_at: now }
                : null;
            },
            load: async (id) => current.find((s) => s?.id === id) ?? null,
            group: async (id) =>
              g && g.id === id
                ? {
                    id: g.id,
                    group_type: g.group_type,
                    state: g.state,
                    members: g.member_ids.map((id) => ({
                      id,
                      account_id:
                        current.find((s) => s?.id === id)?.content.account_id ??
                        a.id,
                    })),
                  }
                : null,
            createGroup: async (input) => {
              creation = true;
              g = { ...group, id: input.id, member_ids: [] };
            },
            history: async () => null,
            save: async (p) => {
              saved.push(p);
            },
          }),
      },
    });
    await createTransferService(service).apply({ workspace_id: w }, c);
    expected = {
      plan: {
        creation,
        plans: captured
          .toSorted((a, b) => a.id.localeCompare(b.id))
          .map((change) => {
            const p =
              saved.find((p) => p.after.id === change.id) ??
              planTransactionRevision(
                w,
                current.find((s) => s?.id === change.id) ?? null,
                change,
                at,
              );
            return { changed: p.changed, state: p.after, snapshot: p.snapshot };
          }),
      },
    };
  } catch (e) {
    expected = { error: e.code ?? 'INVALID_TRANSFER' };
  }
  vectors.push({
    name,
    workspace_id: w,
    now: at,
    command,
    current,
    group:
      g && g.id === id(10)
        ? current.every((s) => s === null) && expected.plan
          ? null
          : g
        : g,
    accounts,
    expected,
  });
}
await vector('create', create());
await vector('edit_noop', edit(), initial, group);
await vector(
  'edit_amount',
  edit(initial, { amount_minor: '123' }),
  initial,
  group,
);
await vector(
  'edit_swap_accounts',
  edit(initial, { source_account: b, target_account: a }),
  initial,
  group,
);
await vector(
  'edit_third_account',
  edit(initial, { source_account: other }),
  initial,
  group,
);
await vector(
  'edit_date_name',
  edit(initial, {
    financial_date: '2026-10-17',
    display_name: 'SYNTHETIC EDIT',
  }),
  initial,
  group,
);
await vector('delete', { kind: 'DELETE', base: base() }, initial, group);
const deleted = initial.map(
  (s) =>
    planTransactionRevision(
      w,
      s,
      {
        id: s.id,
        base_revision: s.version,
        content: { ...s.content, deleted: true },
      },
      now,
    ).after,
);
await vector(
  'delete_noop',
  { kind: 'DELETE', base: base(deleted) },
  deleted,
  group,
);
await vector(
  'restore',
  { kind: 'RESTORE', base: base(deleted) },
  deleted,
  group,
);
await vector('restore_noop', { kind: 'RESTORE', base: base() }, initial, group);
await vector('edit_deleted', edit(deleted), deleted, group);
await vector('replay_create', create(), initial, group);
for (const value of [
  '0',
  '-1',
  '01',
  '1e2',
  '9223372036854775808',
  1,
  1.5,
  null,
  '9223372036854775807',
  '9007199254740993',
])
  await vector('create_amount_' + String(value), {
    ...create(),
    amount_minor: value,
  });
for (const modify of [
  (c) => (c.display_name = ' '),
  (c) => (c.display_name = 'SYNTHETIC\nLINE'),
  (c) => (c.display_name = '😀'.repeat(1001)),
  (c) => (c.display_name = '😀'.repeat(1000)),
  (c) => (c.original_description = 42),
  (c) => (c.original_description = 'x'.repeat(2001)),
  (c) => (c.original_description = '\u0000'),
  (c) => delete c.original_description,
  (c) => (c.actor = 'SYNTHETIC'),
  (c) => (c.source_entry_id = c.target_entry_id),
  (c) => (c.source_entry_id = c.id),
  (c) => (c.id = '00000000-0000-4000-8000-000000000001'),
  (c) => (c.source_entry_id = 'invalid'),
  (c) => (c.financial_date = '2026-02-30'),
  (c) => (c.target_account = { ...a }),
  (c) => (c.target_account = { ...b, workspace_id: id(90) }),
  (c) =>
    (c.target_account = {
      ...b,
      balance_nature: 'LIABILITY',
      account_kind: 'CREDIT_CARD',
    }),
  (c) => (c.source_account = { ...a, status: 'ARCHIVED' }),
  (c) => (c.target_account = { ...b, currency_code: 'USD' }),
  (c) => (c.source_account = { ...a, name: 'SYNTHETIC EXTRA' }),
]) {
  const c = structuredClone(create());
  modify(c);
  await vector('invalid_create_' + vectors.length, c);
}
for (const state of ['BROKEN', 'VOIDED'])
  await vector('group_' + state, edit(), initial, { ...group, state });
await vector('group_card_payment', edit(), initial, {
  ...group,
  group_type: 'CARD_PAYMENT',
});
await vector('group_missing', edit(), initial, null);
await vector('group_extra_member', edit(), initial, {
  ...group,
  member_ids: [...group.member_ids, id(30)],
});
await vector('group_missing_member', edit(), initial, {
  ...group,
  member_ids: [group.member_ids[0]],
});
for (const index of [0, 1]) {
  const changed = structuredClone(initial);
  changed[index].version = '2';
  await vector('stale_side_' + index, edit(), changed, group);
  const forged = structuredClone(initial);
  forged[index].content.display_name = 'SYNTHETIC FORGED';
  await vector('forged_side_' + index, edit(forged), initial, group);
  const imported = structuredClone(initial);
  imported[index].content.origin_kind = 'IMPORT';
  await vector('imported_side_' + index, edit(imported), imported, group);
  const ac = structuredClone(live);
  ac[index].status = 'ARCHIVED';
  await vector('live_archived_' + index, edit(), initial, group, ac);
  ac[index].status = 'ACTIVE';
  ac[index].account_kind = 'DIGITAL';
  await vector('live_descriptor_changed_' + index, edit(), initial, group, ac);
}
await vector('target_missing', create(), [null, null], null, [a]);
await vector('current_missing', edit(), [null, initial[1]], group);
await vector(
  'max_version_changed',
  edit(
    initial.map((s) => ({ ...s, version: '9223372036854775807' })),
    { amount_minor: '1' },
  ),
  initial.map((s) => ({ ...s, version: '9223372036854775807' })),
  group,
);
await vector(
  'max_version_noop',
  edit(initial.map((s) => ({ ...s, version: '9223372036854775807' }))),
  initial.map((s) => ({ ...s, version: '9223372036854775807' })),
  group,
);
for (const name of ['  ' + 'SYNTHETIC'.repeat(300) + '  ', '\u0085']) {
  const old = initial.map((s) => ({
    ...s,
    content: { ...s.content, display_name: name },
  }));
  await vector('legacy_name_' + vectors.length, edit(old), old, group);
}
const classified = structuredClone(initial);
classified[0].content.allocations = [
  {
    id: id(51),
    category_id: id(52),
    subcategory_id: null,
    amount_minor: '1000',
    note: 'SYNTHETIC NOTE',
  },
];
classified[0].content.tag_ids = [id(53)];
await vector(
  'single_allocation_resize',
  edit(classified, { amount_minor: '123' }),
  classified,
  group,
);
await vector(
  'classified_delete',
  { kind: 'DELETE', base: base(classified) },
  classified,
  group,
);
classified[0].content.allocations = [
  { ...classified[0].content.allocations[0], amount_minor: '500' },
  { ...classified[0].content.allocations[0], id: id(54), amount_minor: '500' },
];
await vector(
  'split_requires_review',
  edit(classified, { amount_minor: '123' }),
  classified,
  group,
);
await vector(
  'split_same_magnitude',
  edit(classified, { display_name: 'SYNTHETIC SPLIT' }),
  classified,
  group,
);
const future = initial.map((s) => ({
  ...s,
  updated_at: '2026-10-19T00:00:00.000Z',
}));
await vector(
  'regressing_clock',
  edit(future, { display_name: 'SYNTHETIC CLOCK' }),
  future,
  group,
);
const file = new URL(
    '../../apps/desktop/src-tauri/fixtures/us042-transfers.json',
    import.meta.url,
  ),
  text = await prettier.format(
    JSON.stringify(
      { synthetic_only: true, scope: 'US042_DESKTOP_SHARED_PARITY', vectors },
      null,
      2,
    ),
    {
      ...(await prettier.resolveConfig(fileURLToPath(file))),
      filepath: fileURLToPath(file),
    },
  );
if (process.argv.includes('--check'))
  assert.ok(
    readFileSync(file, 'utf8') === text,
    'US042_TRANSFER_VECTORS_STALE',
  );
else writeFileSync(file, text);
console.log('US042_TRANSFER_VECTORS: ' + vectors.length);
