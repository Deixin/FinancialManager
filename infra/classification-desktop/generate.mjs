/* global structuredClone */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { editorSnapshot, workspace as w, id, now } from './fixture.mjs';
import { captureLocalClassification } from '../../apps/desktop/dist/local-classification.js';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createClassificationService } from '../../packages/finance-ports/dist/classification.js';
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
const keep = (n, tags) => {
    const base = structuredClone(current.find((r) => r.id === id(n)));
    return {
      base,
      classification: { kind: 'KEEP' },
      tag_ids: tags ?? base.content.tag_ids,
    };
  },
  set = (n, cat = 10, sub = null) => {
    const c = keep(n);
    c.classification = {
      kind: 'SET',
      allocation_id: c.base.content.allocations[0]?.id ?? id(n + 500),
      category_id: id(cat),
      subcategory_id: sub === null ? null : id(sub),
    };
    return c;
  };
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
    const captured = captureLocalClassification(v.commands, v.workspace_id),
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
    const service = createClassificationService({
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
await vector('keep_noop', [keep(101)]);
await vector('set_existing_id_note', [set(101, 11, 21)]);
await vector('new_single_import', [set(102, 10, 20)]);
await vector('clear_preserve_tags', [
  { ...keep(101), classification: { kind: 'CLEAR' } },
]);
await vector('tags_on_split', [keep(100, [id(30)])]);
await vector('split_set_rejected', [set(100)]);
await vector('split_clear_rejected', [
  { ...keep(100), classification: { kind: 'CLEAR' } },
]);
await vector('archive_kept', [keep(106)]);
await vector('archive_removed', [
  { ...keep(106, []), classification: { kind: 'CLEAR' } },
]);
await vector('unchanged_archive_set', [set(106, 12, 22)]);
await vector('archived_category_new', [set(102, 12, 22)]);
await vector('archived_tag_new', [keep(102, [id(32)])]);
await vector('missing_tag', [keep(102, [id(999)])]);
await vector('missing_category', [set(102, 999)]);
await vector('wrong_parent', [set(102, 10, 21)]);
await vector('missing_sub', [set(102, 10, 999)]);
await vector('category_scope_mismatch', [set(102)], {
  catalog: {
    ...catalog,
    categories: catalog.categories.map((r) => ({
      ...r,
      category_scope: 'INCOME',
    })),
  },
});
await vector('active_category_inactive_sub', [set(102, 10, 20)], {
  catalog: {
    ...catalog,
    items: catalog.items.map((r) =>
      r.id === id(20) ? { ...r, status: 'ARCHIVED' } : r,
    ),
  },
});
for (const [label, change] of Object.entries({
  version: { version: '2' },
  display: { content: { display_name: 'SYNTHETIC FORGED' } },
  origin: { content: { origin_kind: 'SYSTEM' } },
  original: { content: { original_description: 'SYNTHETIC FORGED' } },
  account: { content: { account_id: id(3) } },
  missing_account: { content: { account_id: id(999) } },
  timestamp: { updated_at: '2026-10-18T12:00:01.000Z' },
})) {
  const c = keep(101);
  c.base = {
    ...c.base,
    ...change,
    content: { ...c.base.content, ...change.content },
  };
  await vector('forged_' + label, [c]);
}
await vector('foreign_base', [
  { ...keep(101), base: { ...keep(101).base, workspace_id: id(999) } },
]);
await vector('deleted', [keep(103)]);
await vector('not_found', [
  { ...keep(101), base: { ...keep(101).base, id: id(999) } },
]);
await vector('duplicate_tags', [keep(102, [id(30), id(30)])]);
await vector('duplicate_batch', [keep(101), keep(101)]);
await vector('empty_batch', []);
await vector('keep_extra_selection', [
  { ...keep(101), classification: { kind: 'KEEP', amount_minor: '1' } },
]);
await vector('extra_command', [{ ...keep(101), amount_minor: '1' }]);
await vector('new_uuid_v4', [
  {
    ...set(102),
    classification: {
      ...set(102).classification,
      allocation_id: '4b871fc7-f700-430b-a236-5c7212d74c90',
    },
  },
]);
await vector('existing_allocation_id_immutable', [
  {
    ...set(101),
    classification: { ...set(101).classification, allocation_id: id(999) },
  },
]);
await vector('bad_uuid', [keep(102, ['invalid'])]);
for (const amount of ['0', '-9223372036854775808', '9223372036854775807']) {
  const row = {
    ...keep(102).base,
    content: {
      ...keep(102).base.content,
      account_amount_minor: amount,
      economic_kind: 'ADJUSTMENT',
    },
  };
  const c = { ...set(102), base: row };
  await vector('amount_set_' + amount, [c], {
    current: current.filter((r) => r.id !== row.id).concat(row),
  });
  await vector(
    'amount_keep_' + amount,
    [{ ...c, classification: { kind: 'KEEP' } }],
    { current: current.filter((r) => r.id !== row.id).concat(row) },
  );
}
await vector(
  'version_exhausted',
  [
    {
      ...keep(101, [id(31)]),
      base: { ...keep(101).base, version: '9223372036854775807' },
    },
  ],
  {
    current: current.map((r) =>
      r.id === id(101) ? { ...r, version: '9223372036854775807' } : r,
    ),
  },
);
await vector('archived_single_account', [keep(101, [id(31)])], {
  accounts: accounts.map((a) => ({ ...a, status: 'ARCHIVED' })),
});
await vector('paired_transfer', [set(104), keep(105)]);
await vector('paired_card', [set(107), keep(108)]);
await vector('paired_both_groups', [set(104), keep(105), set(107), keep(108)]);
await vector('incomplete_pair', [set(104)]);
await vector('incomplete_card', [set(107)]);
for (const state of ['BROKEN', 'VOIDED'])
  await vector('group_' + state, [set(104), keep(105)], {
    groups: groups.map((g) => ({ ...g, state })),
  });
await vector('group_other_composite', [set(104), keep(105)], {
  groups: groups.map((g) => ({ ...g, group_type: 'OTHER_COMPOSITE' })),
});
await vector('group_missing', [set(104), keep(105)], { groups: [] });
await vector('group_members_changed', [set(104), keep(105)], {
  groups: groups.map((g) => ({ ...g, member_ids: [id(104), id(999)] })),
});
await vector('group_third_member', [set(104), keep(105)], {
  groups: groups.map((g) => ({ ...g, member_ids: [...g.member_ids, id(999)] })),
});
await vector('group_archived_account', [set(104), keep(105)], {
  accounts: accounts.map((a) =>
    a.id === id(3) ? { ...a, status: 'ARCHIVED' } : a,
  ),
});
await vector('group_stale_partner', [
  set(104),
  { ...keep(105), base: { ...keep(105).base, version: '2' } },
]);
await vector('group_second_bad_reference', [set(104), keep(105, [id(999)])]);
const file = new URL(
    '../../apps/desktop/src-tauri/fixtures/us045-classification.json',
    import.meta.url,
  ),
  text = await prettier.format(
    JSON.stringify({
      synthetic_only: true,
      dataset_id: 'SYNTHETIC_US045_CLASSIFICATION_ONLY',
      vectors,
    }),
    { parser: 'json' },
  );
if (process.argv.includes('--check'))
  assert.equal(readFileSync(file, 'utf8'), text);
else writeFileSync(file, text);
console.log('US045_CLASSIFICATION_VECTORS: ' + vectors.length);
