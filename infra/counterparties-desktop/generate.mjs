/* global structuredClone */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { editorSnapshot, workspace as w, id, now } from './fixture.mjs';
import { planCounterparty } from '../../packages/domain/dist/counterparties.js';
import {
  captureLocalCounterparty,
  captureLocalAssociations,
} from '../../apps/desktop/dist/local-counterparties.js';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createCounterpartyAssociationService } from '../../packages/finance-ports/dist/counterparties.js';
const s = editorSnapshot().movements,
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
  catalog = editorSnapshot().items.map(({ id, workspace_id, status }) => ({
    id,
    workspace_id,
    status,
  })),
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
  counterparty: { kind: 'KEEP' },
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
    const captured = captureLocalAssociations(v.commands, v.workspace_id),
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
            counterpartyReferences: async (ids) =>
              v.catalog.filter((r) => ids.includes(r.id)),
            history: async () => null,
            save: async () => {},
          }),
      },
    });
    const service = createCounterpartyAssociationService({
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

const set = (n, c = 900) => ({
  ...keep(n),
  counterparty: { kind: 'SET', counterparty_id: id(c) },
});
for (const n of [100, 101, 102, 103]) {
  await vector('keep_' + n, [keep(n)]);
  await vector('set_' + n, [set(n)]);
  await vector('clear_' + n, [{ ...keep(n), counterparty: { kind: 'CLEAR' } }]);
}
await vector('transfer', [set(104), keep(105)]);
await vector('card', [set(107), keep(108)]);
await vector('partial_group', [set(104)]);
await vector('missing', [set(100, 999)]);
await vector('archived', [set(100, 901)]);
for (const value of ['0', '-9223372036854775808', '-9007199254740993']) {
  const c = set(100);
  c.base.content.account_amount_minor = value;
  c.base.content.economic_kind = 'ADJUSTMENT';
  c.base.content.allocations = [];
  const current = structuredClone(s.transactions);
  current[current.findIndex((r) => r.id === c.base.id)] = c.base;
  await vector('wide_' + value, [c], { current });
}
{
  const c = set(100);
  c.base.content.display_name = 'SYNTHETIC FORGED';
  await vector('full_base_conflict', [c]);
}
{
  const c = set(100);
  const current = structuredClone(s.transactions);
  current.find((r) => r.id === c.base.id).version = '2';
  await vector('stale_version', [c], { current });
}
{
  const c = set(100);
  c.base.content.counterparty_id = id(901);
  const current = structuredClone(s.transactions);
  current[current.findIndex((r) => r.id === c.base.id)] = c.base;
  await vector('retain_archived', [{ ...c, counterparty: { kind: 'KEEP' } }], {
    current,
  });
}
for (const mutate of [
  (c) => (c.extra = true),
  (c) => (c.counterparty.extra = true),
  (c) => (c.counterparty.counterparty_id = 'bad'),
  (c) => delete c.base.content.counterparty_id,
]) {
  const c = set(100);
  mutate(c);
  await vector('malformed_' + vectors.length, [c]);
}
await vector('empty', []);
await vector('duplicate', [set(100), keep(100)]);
const catalogVectors = [];
function cat(name, command, rows = []) {
  let expected;
  try {
    const c = captureLocalCounterparty(command, w);
    expected = { plan: planCounterparty(w, rows, c) };
  } catch (e) {
    expected = { error: e.code };
  }
  catalogVectors.push({ name, workspace_id: w, command, rows, expected });
}
const item = editorSnapshot().items[0];
cat('create', { kind: 'CREATE', item });
cat('replay', { kind: 'CREATE', item }, [item]);
cat('homonym', { kind: 'CREATE', item: { ...item, id: id(902) } }, [item]);
for (const [name, patch] of [
  ['rename', { display_name: 'SYNTHETIC RENAMED' }],
  ['archive', { status: 'ARCHIVED' }],
  ['cpf', { identifier_type: 'CPF', identifier_value: '00000000000' }],
  ['cnpj', { identifier_type: 'CNPJ', identifier_value: '00000000000000' }],
  ['other', { identifier_type: 'OTHER', identifier_value: 'SYNTHETIC-ID' }],
])
  cat(name, { kind: 'UPDATE', base: item, item: { ...item, ...patch } }, [
    item,
  ]);
cat('noop', { kind: 'UPDATE', base: item, item }, [item]);
cat('missing', { kind: 'UPDATE', base: item, item });
cat(
  'stale',
  { kind: 'UPDATE', base: { ...item, display_name: 'SYNTHETIC OLD' }, item },
  [item],
);
for (const patch of [
  { display_name: ' x ' },
  { display_name: '' },
  { display_name: 'x'.repeat(121) },
  { display_name: '😀'.repeat(61) },
  { display_name: 'x\u0000' },
  { identifier_type: 'CPF', identifier_value: '123' },
  { identifier_type: 'CNPJ', identifier_value: '1'.repeat(15) },
  { identifier_type: 'OTHER', identifier_value: null },
  { identifier_type: null, identifier_value: 'x' },
  { relationship_hint: 'UNKNOWN' },
  { workspace_id: id(999) },
  { extra: true },
])
  cat('invalid_' + catalogVectors.length, {
    kind: 'CREATE',
    item: { ...item, ...patch },
  });
for (const display_name of [
  '😀'.repeat(60),
  'SYNTHETIC Café',
  'SYNTHETIC　NAME',
])
  cat('unicode_' + catalogVectors.length, {
    kind: 'CREATE',
    item: { ...item, display_name },
  });
{
  const missing = { ...item };
  delete missing.identifier_value;
  cat('missing_nullable', { kind: 'CREATE', item: missing });
}
const output = {
  synthetic_only: true,
  catalog_vectors: catalogVectors,
  association_vectors: vectors,
};
const file = new URL(
    '../../apps/desktop/src-tauri/fixtures/us047-counterparties.json',
    import.meta.url,
  ),
  formatted = await prettier.format(JSON.stringify(output), { parser: 'json' });
if (process.argv.includes('--check'))
  assert.equal(readFileSync(file, 'utf8'), formatted);
else writeFileSync(file, formatted);
console.log(
  'US047 shared vectors: ' +
    catalogVectors.length +
    ' catalog, ' +
    vectors.length +
    ' associations',
);
