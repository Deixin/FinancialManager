/* global structuredClone */
// Disposable synthetic host for browser tests, using the production policy/service.
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createManualMovementService } from '../../packages/finance-ports/dist/manual-movements.js';
export const id = (n) =>
  '0199d141-0000-7000-8000-' + String(n).padStart(12, '0');
export const workspace = id(1),
  now = '2026-10-18T12:00:00.000Z';
export function syntheticHost() {
  const states = new Map(),
    history = [],
    accounts = [2, 3].map((n) => ({
      account: {
        id: id(n),
        workspace_id: workspace,
        name: 'SYNTHETIC US041 ACCOUNT ' + n,
        institution_name: null,
        account_kind: 'CASH',
        balance_nature: 'ASSET',
        currency_code: 'BRL',
        status: 'ACTIVE',
        created_at: now,
      },
      references: [
        {
          id: id(n + 1000),
          workspace_id: workspace,
          account_id: id(n),
          amount_minor: n === 2 ? '100000' : '200000',
          reference_date: '2026-10-01',
          day_position: 'START_OF_DAY',
          status: 'ACTIVE',
          source: 'MANUAL',
          created_at: now,
        },
      ],
    }));
  let seq = 900;
  const service = createManualMovementService(
    createRevisionService({
      authorize: async () => ({
        workspace_id: workspace,
        authority: 'LOCAL',
        can_write: true,
        account_ids: null,
        actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
      }),
      identity: { newId: () => id(seq++), nowInstant: () => now },
      change_source: 'MANUAL',
      store: {
        transaction: async (_, run) =>
          run({
            workspaceMode: async () => 'LOCAL',
            account: async (a) =>
              accounts.find((v) => v.account.id === a)?.account ?? null,
            load: async (a) => states.get(a) ?? null,
            group: async () => null,
            history: async () => null,
            save: async (p, r) => {
              states.set(p.after.id, structuredClone(p.after));
              history.push({
                id: r.id,
                transaction_id: p.after.id,
                version: p.after.version,
                created_at: r.created_at,
                change_source: 'MANUAL',
                compatible: true,
                snapshot: structuredClone(p.snapshot),
              });
            },
          }),
      },
    }),
  );
  return {
    states,
    accounts,
    history,
    async apply(input) {
      const r = await service.apply({ workspace_id: workspace }, input);
      return {
        changed: r.changed,
        id: r.id,
        base_revision: r.base_revision,
        version: r.version,
        revision_id: r.revision_id,
      };
    },
    snapshot() {
      return {
        balance: {
          workspace_id: workspace,
          read_at: now,
          accounts: structuredClone(accounts),
          movements: [...states.values()]
            .filter((s) => !s.content.deleted)
            .map((s) => ({
              id: s.id,
              workspace_id: workspace,
              account_id: s.content.account_id,
              group_id: s.content.group_id,
              financial_date: s.content.financial_date,
              account_amount_minor: s.content.account_amount_minor,
              economic_kind: s.content.economic_kind,
              posting_state: 'CONFIRMED',
            })),
        },
        transactions: structuredClone([...states.values()]),
        history: structuredClone(history),
      };
    },
  };
}
