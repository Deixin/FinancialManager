/* global structuredClone */
// Synthetic browser bridge only. The native protocol owns separate SQLCipher files.
import { createRevisionService } from '../../packages/finance-ports/dist/revisions.js';
import { createCardPaymentService } from '../../packages/finance-ports/dist/card-payments.js';
export const id = (n) =>
    '0199d243-0000-7000-8000-' + String(n).padStart(12, '0'),
  workspace = id(1),
  now = '2026-10-18T12:00:00.000Z';
export function syntheticCardPaymentHost() {
  const states = new Map(),
    groups = new Map(),
    history = [],
    accounts = [2, 3].map((n) => ({
      account: {
        id: id(n),
        workspace_id: workspace,
        name: 'SYNTHETIC US043 ACCOUNT ' + n,
        institution_name: null,
        account_kind: n === 3 ? 'CREDIT_CARD' : 'CASH',
        balance_nature: n === 3 ? 'LIABILITY' : 'ASSET',
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
  let revision = 2000;
  const service = createCardPaymentService(
    createRevisionService({
      authorize: async () => ({
        workspace_id: workspace,
        authority: 'LOCAL',
        can_write: true,
        account_ids: null,
        actor: { actor_type: 'LOCAL_USER', actor_id: null, device_id: null },
      }),
      identity: { newId: () => id(revision++), nowInstant: () => now },
      change_source: 'MANUAL',
      store: {
        transaction: async (_, run) => {
          const before = structuredClone([...states]),
            oldGroups = structuredClone([...groups]),
            size = history.length;
          try {
            return await run({
              workspaceMode: async () => 'LOCAL',
              account: async (id) =>
                accounts.find((a) => a.account.id === id)?.account ?? null,
              load: async (id) => states.get(id) ?? null,
              group: async (id) => {
                const g = groups.get(id);
                return g
                  ? {
                      id: g.id,
                      group_type: g.group_type,
                      state: g.state,
                      members: [...states.values()]
                        .filter((s) => s.content.group_id === id)
                        .map((s) => ({
                          id: s.id,
                          account_id: s.content.account_id,
                        })),
                    }
                  : null;
              },
              createGroup: async (input) => {
                groups.set(input.id, {
                  id: input.id,
                  workspace_id: workspace,
                  group_type: 'CARD_PAYMENT',
                  state: 'ACTIVE',
                });
              },
              history: async () => null,
              save: async (p, r) => {
                states.set(p.after.id, structuredClone(p.after));
                history.push({
                  id: r.id,
                  transaction_id: p.after.id,
                  version: p.after.version,
                  created_at: r.created_at,
                  change_source: r.change_source,
                  compatible: true,
                  snapshot: structuredClone(p.snapshot),
                });
              },
            });
          } catch (e) {
            states.clear();
            for (const [k, v] of before) states.set(k, v);
            groups.clear();
            for (const [k, v] of oldGroups) groups.set(k, v);
            history.length = size;
            throw e;
          }
        },
      },
    }),
  );
  return {
    accounts,
    states,
    groups,
    history,
    async apply(command) {
      const entries = await service.apply({ workspace_id: workspace }, command);
      return {
        group_id:
          command.kind === 'CREATE' ? command.id : command.base.group_id,
        entries,
      };
    },
    snapshot() {
      return {
        movements: {
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
        },
        groups: structuredClone(
          [...groups.values()].map((g) => ({
            ...g,
            member_ids: [...states.values()]
              .filter((s) => s.content.group_id === g.id)
              .map((s) => s.id)
              .sort(),
          })),
        ),
      };
    },
  };
}
