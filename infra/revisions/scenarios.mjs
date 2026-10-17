import assert from 'node:assert/strict';
import { fixture, expectedSnapshot } from '../fixtures/loader.mjs';
import {
  decodeRevisionState,
  decodeRevisionSnapshot,
} from '../../packages/domain/dist/revisions.js';
export const revisionCases = Object.freeze([
  'update_snapshot_noop',
  'stale_base_and_reversal',
  'create_delete_restore',
  'classification_and_composite_atomicity',
  'i64_versions_and_money',
  'authorization_and_scopes',
  'failed_revision_rolls_back',
  'competing_base_versions',
  'immutable_history_and_regressing_clock',
]);
export const ids = Object.freeze({
  a: fixture.workspace_a,
  b: fixture.workspace_b,
  expense: fixture.seed.find(
    (row) =>
      row.table === 'financial_transaction' &&
      row.values.display_name === 'SYNTHETIC FIN-002 MOVEMENT' &&
      row.values.economic_kind === 'EXPENSE' &&
      row.values.account_amount_minor === '-20000',
  ).values.id,
  created: '0199d026-0000-7000-8000-000000000701',
  actor: '0199d026-0000-7000-8000-000000000801',
  local: '0199d026-0000-7000-8000-000000000901',
  localAccount: '0199d026-0000-7000-8000-000000000902',
  localTransaction: '0199d026-0000-7000-8000-000000000903',
});
export const request = (workspace_id = ids.a) => ({
  workspace_id,
  principal_id: 'synthetic-member',
});
export const grant = (input) =>
  input.principal_id === 'synthetic-member' &&
  [ids.a, ids.b].includes(input.workspace_id)
    ? {
        workspace_id: input.workspace_id,
        authority: 'CLOUD',
        can_write: true,
        account_ids: null,
        actor: { actor_type: 'MEMBER', actor_id: ids.actor, device_id: null },
      }
    : input.workspace_id === ids.local
      ? {
          workspace_id: ids.local,
          authority: 'LOCAL',
          can_write: true,
          account_ids: null,
          actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
        }
      : null;
export function stateFromSnapshot(snapshot, id) {
  const row = snapshot.financial_transaction.find((row) => row.id === id);
  if (!row) return null;
  return decodeRevisionState({
    workspace_id: row.workspace_id,
    id: row.id,
    version: row.version,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    content: {
      account_id: row.account_id,
      group_id: row.group_id,
      counterparty_id: row.counterparty_id,
      financial_date: row.financial_date,
      account_amount_minor: row.account_amount_minor,
      economic_kind: row.economic_kind,
      original_description: row.original_description,
      display_name: row.display_name,
      origin_kind: row.origin_kind,
      deleted: row.deleted_at !== null,
      allocations: snapshot.transaction_allocation
        .filter((row) => row.transaction_id === id)
        .map((row) => ({
          id: row.id,
          category_id: row.category_id,
          subcategory_id: row.subcategory_id,
          amount_minor: row.amount_minor,
          note: row.note,
        })),
      tag_ids: snapshot.transaction_tag
        .filter((row) => row.transaction_id === id)
        .map((row) => row.tag_id),
    },
  });
}
export const initialState = (id) =>
  stateFromSnapshot(
    expectedSnapshot(
      fixture.seed.find(
        (row) => row.table === 'financial_transaction' && row.values.id === id,
      )?.values.workspace_id ?? ids.a,
    ),
    id,
  );
export const change = (state, patch = {}) => ({
  id: state.id,
  base_revision: state.version,
  content: { ...state.content, ...patch },
});
export async function runRevisionCases(h, step) {
  const service = h.make(ids.a),
    base = initialState(ids.expense);
  try {
    await step('update_snapshot_noop', async () => {
      const content = {
        ...base.content,
        display_name: 'SYNTHETIC REVISION EDIT',
        allocations: base.content.allocations.map((row) => ({
          ...row,
          note: 'SYNTHETIC REVISION NOTE',
        })),
        tag_ids: [fixture.seed.find((row) => row.table === 'tag').values.id],
      };
      const result = await service.apply(request(), [
        { id: base.id, base_revision: '1', content },
      ]);
      assert.equal(result[0].version, '2');
      assert.ok(result[0].revision_id);
      assert.equal(result[0].base_revision, '1');
      const rows = await h.history(ids.a, base.id);
      assert.equal(rows.length, 1);
      const snapshot = decodeRevisionSnapshot(rows[0].snapshot);
      assert.deepEqual(snapshot.before, base);
      assert.equal(snapshot.after.content.display_name, content.display_name);
      assert.equal(
        snapshot.after.content.allocations[0].note,
        'SYNTHETIC REVISION NOTE',
      );
      assert.deepEqual(snapshot.after.content.tag_ids, content.tag_ids);
      assert.equal(rows[0].actor_id, ids.actor);
      assert.equal(rows[0].change_source, 'MANUAL');
      assert.equal(
        (
          await service.apply(request(), [
            { id: base.id, base_revision: '2', content },
          ])
        )[0].changed,
        false,
      );
      assert.equal((await h.history(ids.a, base.id)).length, 1);
    });
    await step('stale_base_and_reversal', async () => {
      await assert.rejects(
        service.apply(request(), [
          change(base, { display_name: 'SYNTHETIC STALE' }),
        ]),
        { code: 'VERSION_CONFLICT' },
      );
      await service.revert(request(), [
        { id: base.id, base_revision: '2', revision_version: '2' },
      ]);
      let current = await h.state(ids.a, base.id);
      assert.equal(current.version, '3');
      assert.deepEqual(current.content, base.content);
      await service.apply(request(), [
        change(current, { display_name: 'SYNTHETIC LATER EDIT' }),
      ]);
      await assert.rejects(
        service.revert(request(), [
          { id: base.id, base_revision: '4', revision_version: '2' },
        ]),
        { code: 'REVERSAL_CONFLICT' },
      );
      current = await h.state(ids.a, base.id);
      assert.equal(current.content.display_name, 'SYNTHETIC LATER EDIT');
      assert.equal(current.version, '4');
      await service.revert(request(), [
        { id: base.id, base_revision: '4', revision_version: '4' },
      ]);
      assert.deepEqual((await h.state(ids.a, base.id)).content, base.content);
    });
    await step('create_delete_restore', async () => {
      let current = await h.state(ids.a, base.id);
      await service.apply(request(), [change(current, { deleted: true })]);
      current = await h.state(ids.a, base.id);
      assert.ok(current.deleted_at);
      assert.equal(current.version, '6');
      await service.apply(request(), [change(current, { deleted: false })]);
      assert.equal((await h.state(ids.a, base.id)).deleted_at, null);
      const content = {
        ...base.content,
        account_amount_minor: '1000',
        economic_kind: 'INCOME',
        allocations: [],
        tag_ids: [],
        display_name: 'SYNTHETIC CREATED',
      };
      await service.apply(request(), [
        { id: ids.created, base_revision: '0', content },
      ]);
      const rows = await h.history(ids.a, ids.created);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].snapshot.before, null);
      assert.equal(rows[0].snapshot.base_revision, '0');
      await service.revert(request(), [
        { id: ids.created, base_revision: '1', revision_version: '1' },
      ]);
      assert.equal((await h.state(ids.a, ids.created)).content.deleted, true);
      assert.equal((await h.state(ids.a, ids.created)).version, '2');
      assert.equal((await h.history(ids.a, ids.created)).length, 2);
    });
    await step('classification_and_composite_atomicity', async () => {
      const groups = fixture.seed
        .filter((row) => row.table === 'transaction_group')
        .slice(0, 2);
      for (const group of groups) {
        const members = fixture.seed
          .filter(
            (row) =>
              row.table === 'financial_transaction' &&
              row.values.group_id === group.values.id,
          )
          .map((row) => initialState(row.values.id));
        await assert.rejects(
          service.apply(request(), [
            change(members[0], { display_name: 'SYNTHETIC HALF GROUP' }),
          ]),
          { code: 'COMPOSITE_REQUIRED' },
        );
        const proposed = members.map((row) =>
          change(row, {
            account_amount_minor:
              BigInt(row.content.account_amount_minor) > 0n
                ? '11000'
                : group.values.group_type === 'TRANSFER'
                  ? '-11000'
                  : '-7100',
          }),
        );
        await service.apply(request(), proposed);
        for (const member of members)
          assert.equal((await h.state(ids.a, member.id)).version, '2');
        await service.revert(
          request(),
          members.map((row) => ({
            id: row.id,
            base_revision: '2',
            revision_version: '2',
          })),
        );
        for (const member of members)
          assert.deepEqual(
            (await h.state(ids.a, member.id)).content,
            member.content,
          );
      }
      const current = await h.state(ids.a, base.id);
      await assert.rejects(
        service.apply(request(), [
          change(current, { account_amount_minor: '-1' }),
        ]),
        { code: 'INVALID_REVISION' },
      );
      assert.equal((await h.state(ids.a, base.id)).version, current.version);
    });
    await step('i64_versions_and_money', async () => {
      const other = h.make(ids.b);
      try {
        const precision = fixture.seed.find(
          (row) =>
            row.table === 'financial_transaction' &&
            row.values.workspace_id === ids.b &&
            row.values.account_amount_minor === '9007199254740993',
        ).values.id;
        await h.setVersion(ids.b, precision, '9007199254740993');
        let current = await h.state(ids.b, precision);
        await other.apply(request(ids.b), [
          change(current, { display_name: 'SYNTHETIC BIG VERSION' }),
        ]);
        current = await h.state(ids.b, precision);
        assert.equal(current.version, '9007199254740994');
        assert.equal(current.content.account_amount_minor, '9007199254740993');
        assert.equal(
          (await h.history(ids.b, precision))[0].snapshot.base_revision,
          '9007199254740993',
        );
        await h.setVersion(ids.b, precision, '9223372036854775807');
        current = await h.state(ids.b, precision);
        await assert.rejects(
          other.apply(request(ids.b), [
            change(current, { display_name: 'SYNTHETIC EXHAUSTED' }),
          ]),
          { code: 'VERSION_EXHAUSTED' },
        );
        assert.equal(
          (await h.state(ids.b, precision)).version,
          '9223372036854775807',
        );
      } finally {
        await other.close();
      }
    });
    await step('authorization_and_scopes', async () => {
      const denied = h.make(ids.a, { authorize: async () => null });
      try {
        await assert.rejects(denied.apply(request(), [change(base)]), {
          code: 'ACCESS_DENIED',
        });
      } finally {
        await denied.close();
      }
      const bankOnly = h.make(ids.a, {
        authorize: async (input) => ({
          ...grant(input),
          account_ids: [base.content.account_id],
        }),
      });
      try {
        const card = fixture.seed.find(
          (row) =>
            row.table === 'financial_transaction' &&
            row.values.economic_kind === 'EXPENSE' &&
            row.values.account_amount_minor === '12000',
        ).values.id;
        await assert.rejects(
          bankOnly.apply(request(), [
            change(initialState(card), { display_name: 'SYNTHETIC HIDDEN' }),
          ]),
          { code: 'NOT_FOUND' },
        );
      } finally {
        await bankOnly.close();
      }
      const local = h.make(ids.a, {
        authorize: async () => ({
          workspace_id: ids.a,
          authority: 'LOCAL',
          can_write: true,
          account_ids: null,
          actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
        }),
      });
      try {
        await assert.rejects(
          local.apply({ workspace_id: ids.a }, [change(base)]),
          { code: 'ACCESS_DENIED' },
        );
      } finally {
        await local.close();
      }
      const current = await h.state(ids.a, base.id);
      await assert.rejects(
        service.apply(request(), [
          change(current, { original_description: 'SYNTHETIC FORGED ORIGIN' }),
        ]),
        { code: 'ORIGIN_IMMUTABLE' },
      );
    });
    await step('failed_revision_rolls_back', async () => {
      const current = await h.state(ids.a, base.id),
        count = (await h.history(ids.a, base.id)).length;
      const failing = h.make(ids.a, { fail_revision: true });
      try {
        await assert.rejects(
          failing.apply(request(), [
            change(current, {
              display_name: 'SYNTHETIC PRIVATE FAILURE CANARY',
            }),
          ]),
          { code: 'DATA_ACCESS_FAILED' },
        );
      } finally {
        await failing.close();
      }
      assert.deepEqual(await h.state(ids.a, base.id), current);
      assert.equal((await h.history(ids.a, base.id)).length, count);
      const transfer = fixture.seed.find(
        (row) =>
          row.table === 'transaction_group' &&
          row.values.group_type === 'TRANSFER',
      ).values.id;
      const members = [];
      for (const row of fixture.seed.filter(
        (row) =>
          row.table === 'financial_transaction' &&
          row.values.group_id === transfer,
      ))
        members.push(await h.state(ids.a, row.values.id));
      const histories = await Promise.all(
        members.map((row) => h.history(ids.a, row.id)),
      );
      const failingBatch = h.make(ids.a, { fail_revision: 2 });
      try {
        await assert.rejects(
          failingBatch.apply(
            request(),
            members.map((row) =>
              change(row, {
                account_amount_minor:
                  BigInt(row.content.account_amount_minor) > 0n
                    ? '12000'
                    : '-12000',
              }),
            ),
          ),
          { code: 'DATA_ACCESS_FAILED' },
        );
      } finally {
        await failingBatch.close();
      }
      for (let i = 0; i < members.length; i++) {
        assert.deepEqual(await h.state(ids.a, members[i].id), members[i]);
        assert.deepEqual(await h.history(ids.a, members[i].id), histories[i]);
      }
    });
    await step('competing_base_versions', async () => {
      const current = await h.state(ids.a, base.id),
        count = (await h.history(ids.a, base.id)).length;
      const results = await Promise.allSettled(
        ['SYNTHETIC CONCURRENT A', 'SYNTHETIC CONCURRENT B'].map((name) =>
          service.apply(request(), [change(current, { display_name: name })]),
        ),
      );
      assert.equal(
        results.filter((row) => row.status === 'fulfilled').length,
        1,
      );
      assert.equal(
        results.find((row) => row.status === 'rejected').reason.code,
        'VERSION_CONFLICT',
      );
      assert.equal(
        (await h.state(ids.a, base.id)).version,
        (BigInt(current.version) + 1n).toString(),
      );
      assert.equal((await h.history(ids.a, base.id)).length, count + 1);
    });
    await step('immutable_history_and_regressing_clock', async () => {
      const current = await h.state(ids.a, base.id),
        history = await h.history(ids.a, base.id);
      await assert.rejects(h.mutateHistory(ids.a, history[0].id));
      assert.deepEqual(await h.history(ids.a, base.id), history);
      const regressing = h.make(ids.a, { clock: '1900-01-01T00:00:00.000Z' });
      try {
        await regressing.apply(request(), [change(current, base.content)]);
      } finally {
        await regressing.close();
      }
      const after = await h.state(ids.a, base.id);
      assert.ok(after.updated_at >= current.updated_at);
      assert.equal(after.version, (BigInt(current.version) + 1n).toString());
      assert.deepEqual(after.content, base.content);
      const restored = await h.history(ids.a, base.id);
      assert.equal(restored.at(-1).created_at, '1900-01-01T00:00:00.000Z');
    });
  } finally {
    await service.close();
  }
}
