/* global structuredClone */
// SYNTHETIC_US045_CLASSIFICATION_ONLY. Mutable transport double; native tests use SQLCipher.
import {
  syntheticClassificationSnapshot,
  workspace,
  other,
  id,
  now,
} from '../classification-filters-desktop/fixture.mjs';
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createClassificationService } from '../../packages/finance-ports/dist/classification.js';
export { workspace, other, id, now };
export function editorSnapshot(w = workspace) {
  const s = syntheticClassificationSnapshot(w);
  if (w === other) return s;
  const card = structuredClone(s.balance.accounts[0]);
  card.account = {
    ...card.account,
    id: id(4),
    name: 'SYNTHETIC CREDIT CARD',
    account_kind: 'CREDIT_CARD',
    balance_nature: 'LIABILITY',
  };
  card.references = card.references.map((r) => ({
    ...r,
    id: id(1004),
    account_id: id(4),
    amount_minor: '1000',
  }));
  s.balance.accounts.push(card);
  for (const [n, a] of [
    [107, 2],
    [108, 4],
  ]) {
    const state = structuredClone(s.transactions.find((r) => r.id === id(104)));
    state.id = id(n);
    state.content = {
      ...state.content,
      account_id: id(a),
      group_id: id(81),
      economic_kind: 'DEBT_SETTLEMENT',
      display_name: 'SYNTHETIC CARD SIDE ' + n,
      tag_ids: [],
    };
    s.transactions.push(state);
    s.balance.movements.push({
      id: state.id,
      workspace_id: w,
      account_id: id(a),
      group_id: id(81),
      financial_date: state.content.financial_date,
      account_amount_minor: state.content.account_amount_minor,
      economic_kind: 'DEBT_SETTLEMENT',
      posting_state: 'CONFIRMED',
    });
  }
  return s;
}
export function syntheticEditorHost() {
  const data = new Map([workspace, other].map((w) => [w, editorSnapshot(w)]));
  let seq = 9000;
  const service = createClassificationService(
    createRevisionService({
      authorize: async (request) => ({
        workspace_id: request.workspace_id,
        authority: 'LOCAL',
        can_write: true,
        account_ids: null,
        actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
      }),
      identity: { newId: () => id(seq++), nowInstant: () => now },
      change_source: 'MANUAL',
      store: {
        transaction: async (scope, run) => {
          const w = scope.workspace_id,
            s = structuredClone(data.get(w));
          if (!s) throw Error('SYNTHETIC_WORKSPACE_MISSING');
          const result = await run({
            workspaceMode: async () => 'LOCAL',
            account: async (id) =>
              s.balance.accounts.find((r) => r.account.id === id)?.account ??
              null,
            load: async (id) => s.transactions.find((r) => r.id === id) ?? null,
            group: async (gid) => {
              const members = s.transactions.filter(
                (r) => r.content.group_id === gid,
              );
              return members.length
                ? {
                    id: gid,
                    group_type:
                      members[0].content.economic_kind === 'TRANSFER'
                        ? 'TRANSFER'
                        : 'CARD_PAYMENT',
                    state: 'ACTIVE',
                    members: members.map((r) => ({
                      id: r.id,
                      account_id: r.content.account_id,
                    })),
                  }
                : null;
            },
            taxonomyCatalog: async () => ({
              categories: s.classification.categories,
              items: s.classification.items,
            }),
            history: async () => null,
            save: async (p, r) => {
              s.transactions = s.transactions
                .filter((t) => t.id !== p.after.id)
                .concat(structuredClone(p.after));
              s.history.push({
                id: r.id,
                transaction_id: r.transaction_id,
                version: r.version,
                created_at: r.created_at,
                change_source: r.change_source,
                compatible: true,
                snapshot: structuredClone(r.snapshot),
              });
            },
          });
          data.set(w, s);
          return result;
        },
      },
    }),
  );
  return {
    data,
    read: (w) => structuredClone(data.get(w)),
    apply: async (w, input) => ({
      entries: await service.apply({ workspace_id: w }, input),
    }),
  };
}
