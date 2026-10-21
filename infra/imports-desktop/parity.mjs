/* global structuredClone */
// SYNTHETIC ONLY. The real shared port is the oracle for native pagination/replay.
import assert from 'node:assert/strict';
import { createImportCentralService } from '../../packages/finance-ports/dist/imports.js';
import {
  itemDispositions,
  effectActions,
} from '../../packages/domain/dist/imports.js';
export async function verifyNativeParity(initial, scenarios, prepared) {
  const w = initial.detail.batch.workspace_id,
    account = initial.page.items[0].batch.target_account_id;
  const summaries = new Map(
      initial.page.items.map((s) => [s.batch.id, structuredClone(s)]),
    ),
    effects = initial.detail.effects;
  const empty = () => ({
    items: Object.fromEntries(itemDispositions.map((k) => [k, '0'])),
    effects: Object.fromEntries(effectActions.map((k) => [k, '0'])),
    total_items: '0',
    total_effects: '0',
  });
  const core = createImportCentralService({
    authorize: async () => ({
      workspace_id: w,
      authority: 'LOCAL',
      can_read: true,
      can_prepare: true,
      account_ids: null,
      member_id: null,
    }),
    now: () => prepared.first.batch.created_at,
    store: {
      async transaction(_scope, _mode, run) {
        return run({
          workspace: async () => ({ storage_mode: 'LOCAL' }),
          account: async (id) =>
            id === account ? { id, workspace_id: w, status: 'ACTIVE' } : null,
          batch: async (id) => summaries.get(id)?.batch ?? null,
          candidates: async (q) =>
            [...summaries.values()]
              .map((s) => s.batch)
              .filter(
                (b) =>
                  (!q.statuses.length || q.statuses.includes(b.status)) &&
                  (q.account_id === null ||
                    q.account_id === b.target_account_id) &&
                  (!q.cursor ||
                    b.created_at < q.cursor.created_at ||
                    (b.created_at === q.cursor.created_at &&
                      b.id < q.cursor.id)),
              )
              .sort((a, b) =>
                a.created_at > b.created_at
                  ? -1
                  : a.created_at < b.created_at
                    ? 1
                    : a.id > b.id
                      ? -1
                      : 1,
              )
              .slice(0, q.limit + 1),
          sources: async (id) => summaries.get(id)?.sources ?? [],
          counts: async (id) => summaries.get(id)?.counts ?? empty(),
          effects: async (id, after, limit) =>
            effects
              .filter(
                (e) => e.batch_id === id && (after === null || e.id > after),
              )
              .slice(0, limit),
          insert: async (batch) => {
            summaries.set(batch.id, { batch, sources: [], counts: empty() });
          },
        });
      },
    },
  });
  for (const s of scenarios.lists)
    assert.deepEqual(s.result, await core.list({ workspace_id: w }, s.input));
  for (const s of scenarios.details)
    assert.deepEqual(s.result, await core.detail({ workspace_id: w }, s.input));
  const input = { id: prepared.first.batch.id, target_account_id: account };
  assert.deepEqual(
    prepared.first,
    await core.prepare({ workspace_id: w }, input),
  );
  assert.deepEqual(
    prepared.replay,
    await core.prepare({ workspace_id: w }, input),
  );
  await assert.rejects(
    core.prepare(
      { workspace_id: w },
      { ...input, target_account_id: prepared.conflicting_account },
    ),
    (e) => e.code === prepared.conflict,
  );
}
