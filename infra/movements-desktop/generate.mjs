/* global structuredClone */
// Explicitly synthetic vectors produced through the production guarded service.
import assert from 'node:assert/strict';
import * as prettier from 'prettier';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createManualMovementService } from '../../packages/finance-ports/dist/manual-movements.js';
import {
  captureRevisionState,
  planTransactionRevision,
} from '../../packages/domain/dist/revisions.js';
import {
  captureManualMovement,
  manualMovementChange,
} from '../../packages/domain/dist/manual-movements.js';
import { captureLocalManualMovement } from '../../apps/desktop/dist/local-movements.js';
const id = (n) => '0199d141-0000-7000-8000-' + String(n).padStart(12, '0'),
  workspace = id(1),
  now = '2026-10-18T12:00:00.000Z';
const account = {
    id: id(2),
    workspace_id: workspace,
    currency_code: 'BRL',
    account_kind: 'CASH',
    balance_nature: 'ASSET',
    status: 'ACTIVE',
  },
  card = {
    ...account,
    id: id(4),
    account_kind: 'CREDIT_CARD',
    balance_nature: 'LIABILITY',
  };
const create = () => ({
  kind: 'CREATE',
  id: id(3),
  account: { ...account },
  financial_date: '2026-10-17',
  amount_minor: '1000',
  movement_kind: 'EXPENSE',
  display_name: 'SYNTHETIC MANUAL',
  original_description: 'SYNTHETIC ORIGINAL',
});
const initial = planTransactionRevision(
  workspace,
  null,
  manualMovementChange(captureManualMovement(create(), workspace)),
  now,
).after;
const edit = (base = initial) => ({
  kind: 'EDIT',
  base,
  account: { ...account },
  financial_date: '2026-10-17',
  amount_minor: '1000',
  movement_kind: 'EXPENSE',
  display_name: base.content.display_name,
});
const deleted = planTransactionRevision(
  workspace,
  initial,
  {
    id: initial.id,
    base_revision: '1',
    content: { ...initial.content, deleted: true },
  },
  now,
).after;
const vectors = [];
async function vector(
  name,
  current,
  input,
  target = account,
  previous = current ? account : null,
  at = now,
) {
  current = structuredClone(current);
  input = structuredClone(input);
  target = structuredClone(target);
  previous = structuredClone(previous);
  let expected;
  try {
    const command = captureLocalManualMovement(input, workspace);
    let saved;
    const service = createRevisionService({
      authorize: async () => ({
        workspace_id: workspace,
        authority: 'LOCAL',
        can_write: true,
        account_ids: null,
        actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
      }),
      identity: { newId: () => id(900), nowInstant: () => at },
      change_source: 'MANUAL',
      store: {
        transaction: async (_, run) =>
          run({
            workspaceMode: async () => 'LOCAL',
            account: async (requested) =>
              target?.id === requested
                ? target
                : previous?.id === requested
                  ? previous
                  : null,
            load: async () => current,
            group: async () => null,
            history: async () => null,
            save: async (plan) => {
              saved = plan;
            },
          }),
      },
    });
    await createManualMovementService(service).apply(
      { workspace_id: workspace },
      command,
    );
    expected = {
      plan: saved
        ? {
            changed: saved.changed,
            state: saved.after,
            snapshot: saved.snapshot,
          }
        : {
            changed: false,
            state: captureRevisionState(current),
            snapshot: null,
          },
    };
  } catch (error) {
    expected = { error: error.code ?? 'INVALID_MANUAL_MOVEMENT' };
  }
  vectors.push({
    name,
    workspace_id: workspace,
    now: at,
    current,
    command: input,
    account: target,
    previous_account: previous,
    expected,
  });
}
await vector('create', null, create());
await vector('replay_create_conflict', initial, create());
await vector('edit_noop', initial, edit());
await vector('edit_name', initial, {
  ...edit(),
  display_name: '  SYNTHETIC EDIT  ',
});
await vector(
  'move_to_liability',
  initial,
  { ...edit(), account: card },
  card,
  account,
);
for (const balance_nature of ['ASSET', 'LIABILITY'])
  for (const movement_kind of ['INCOME', 'EXPENSE'])
    for (const amount_minor of [
      '1',
      '9007199254740993',
      '9223372036854775807',
    ]) {
      const a = { ...account, balance_nature };
      await vector(
        'sign_' + balance_nature + '_' + movement_kind + '_' + amount_minor,
        null,
        { ...create(), account: a, movement_kind, amount_minor },
        a,
        null,
      );
    }
for (const amount_minor of [
  '0',
  '-1',
  '01',
  '+1',
  '1.0',
  '1e2',
  '9223372036854775808',
  1,
  null,
])
  await vector('reject_amount_' + String(amount_minor), null, {
    ...create(),
    amount_minor,
  });
for (const delta_minor of [
  '-9223372036854775808',
  '9223372036854775807',
  '9007199254740993',
  '-1',
  '0',
  '01',
  '1.5',
  2,
])
  await vector('adjust_' + delta_minor, null, {
    kind: 'ADJUST',
    id: id(3),
    account,
    financial_date: '2026-10-17',
    delta_minor,
    reason: 'SYNTHETIC REASON',
  });
for (const kind of ['DELETE', 'RESTORE']) {
  await vector(kind.toLowerCase(), kind === 'DELETE' ? initial : deleted, {
    kind,
    base: kind === 'DELETE' ? initial : deleted,
  });
  await vector(kind + '_noop', kind === 'DELETE' ? deleted : initial, {
    kind,
    base: kind === 'DELETE' ? deleted : initial,
  });
}
await vector('edit_deleted', deleted, edit(deleted));
await vector('stale', deleted, edit(initial));
const forged = {
  ...initial,
  content: { ...initial.content, counterparty_id: id(99) },
};
await vector('forged_same_version', initial, edit(forged));
await vector(
  'immutable_original',
  initial,
  edit({
    ...initial,
    content: { ...initial.content, original_description: 'SYNTHETIC FORGED' },
  }),
);
for (const origin_kind of ['IMPORT', 'DOCUMENT', 'SYSTEM']) {
  const b = { ...initial, content: { ...initial.content, origin_kind } };
  await vector('readonly_' + origin_kind, b, { kind: 'DELETE', base: b });
}
const grouped = {
  ...initial,
  content: { ...initial.content, group_id: id(20) },
};
await vector('readonly_group', grouped, { kind: 'DELETE', base: grouped });
await vector(
  'archived_create',
  null,
  create(),
  { ...account, status: 'ARCHIVED' },
  null,
);
await vector(
  'archived_restore',
  deleted,
  { kind: 'RESTORE', base: deleted },
  { ...account, status: 'ARCHIVED' },
  { ...account, status: 'ARCHIVED' },
);
await vector(
  'changed_account',
  null,
  { ...create(), account: { ...account, balance_nature: 'LIABILITY' } },
  account,
  null,
);
await vector(
  'archived_origin_move',
  initial,
  { ...edit(), account: card },
  card,
  { ...account, status: 'ARCHIVED' },
);
await vector('missing_target', null, create(), null, null);
await vector('missing_current', null, edit());
const allocation = {
  id: id(30),
  category_id: id(31),
  subcategory_id: null,
  amount_minor: '1000',
  note: 'SYNTHETIC NOTE',
};
const classified = {
  ...initial,
  content: { ...initial.content, allocations: [allocation], tag_ids: [id(32)] },
};
await vector('resize_single', classified, {
  ...edit(classified),
  amount_minor: '2500',
});
await vector('classified_kind_change', classified, {
  ...edit(classified),
  movement_kind: 'INCOME',
});
await vector('classified_delete', classified, {
  kind: 'DELETE',
  base: classified,
});
const split = {
  ...initial,
  content: {
    ...initial.content,
    allocations: [
      { ...allocation, amount_minor: '400' },
      { ...allocation, id: id(33), amount_minor: '600' },
    ],
  },
};
await vector('split_reject_resize', split, {
  ...edit(split),
  amount_minor: '2500',
});
await vector('split_rename', split, {
  ...edit(split),
  display_name: 'SYNTHETIC SPLIT EDIT',
});
const legacy = {
  ...initial,
  content: {
    ...initial.content,
    display_name: '  ' + 'SYNTHETIC'.repeat(300) + '  ',
    original_description: 'SYNTHETIC\nLEGACY',
  },
};
await vector('legacy_unchanged', legacy, {
  ...edit(legacy),
  financial_date: '2026-10-18',
});
await vector('legacy_delete', legacy, { kind: 'DELETE', base: legacy });
for (const display_name of [
  '',
  '  ',
  'SYNTHETIC\nNEW',
  'SYNTHETIC'.repeat(300),
  '😀'.repeat(1000),
  '😀'.repeat(1001),
  '\ufeffSYNTHETIC\ufeff',
])
  await vector('name_' + vectors.length, null, { ...create(), display_name });
for (const mutate of [
  (c) => delete c.original_description,
  (c) => (c.extra = true),
  (c) => (c.account.extra = true),
  (c) => (c.account.currency_code = 'USD'),
  (c) => (c.account.workspace_id = id(9)),
  (c) => (c.id = '123'),
  (c) => (c.id = '00000000-0000-4000-8000-000000000003'),
  (c) => (c.financial_date = '2026-02-30'),
  (c) => (c.movement_kind = 'TRANSFER'),
  (c) => (c.original_description = 1),
]) {
  const c = create();
  mutate(c);
  await vector('closed_' + vectors.length, null, c);
}
const max = { ...initial, version: '9223372036854775807' };
await vector('exhausted', max, { kind: 'DELETE', base: max });
const future = { ...initial, updated_at: '2026-10-19T00:00:00.000Z' };
await vector('regressed_clock', future, {
  ...edit(future),
  display_name: 'SYNTHETIC CLOCK',
});
const legacyNel = {
  ...initial,
  content: { ...initial.content, display_name: '\u0085' },
};
await vector('legacy_nel_name_noop', legacyNel, edit(legacyNel));
await vector('legacy_nel_delete_preserves_text', legacyNel, {
  kind: 'DELETE',
  base: legacyNel,
});
const path = new URL(
    '../../apps/desktop/src-tauri/fixtures/us041-movements.json',
    import.meta.url,
  ),
  text = await prettier.format(
    JSON.stringify(
      { synthetic_only: true, scope: 'US041_SHARED_DOMAIN_PARITY', vectors },
      null,
      2,
    ),
    {
      ...(await prettier.resolveConfig(path.pathname)),
      filepath: path.pathname,
    },
  );
if (process.argv.includes('--check'))
  assert.ok(readFileSync(path, 'utf8') === text, 'US041_PARITY_STALE');
else writeFileSync(path, text);
console.log('US041_MOVEMENT_VECTORS: ' + vectors.length);
