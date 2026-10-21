/* global structuredClone */
// SYNTHETIC only. Real shared port supplies the browser protocol's policy and responses.
import { createImportCentralService } from '../../packages/finance-ports/dist/imports.js';
import {
  importStatuses,
  itemDispositions,
  effectActions,
} from '../../packages/domain/dist/imports.js';
import {
  editorSnapshot,
  syntheticCounterpartyHost,
  workspace,
  other,
  now,
} from '../counterparties-desktop/fixture.mjs';
export { workspace, other, now };
export const id = (n) =>
  `0199d050-0000-7000-8000-${String(n).padStart(12, '0')}`;
export function syntheticImportHost() {
  const financial = syntheticCounterpartyHost(),
    snapshot = editorSnapshot().movements;
  const account = snapshot.balance.accounts.find(
    (a) => a.account.status === 'ACTIVE',
  ).account.id;
  const batches = importStatuses.map((status, n) => ({
    id: id(100 + n),
    workspace_id: workspace,
    target_account_id: account,
    batch_kind: 'IMPORT',
    status,
    reverses_batch_id: null,
    created_by_member_id: null,
    created_at: now,
    committed_at: ['COMMITTED', 'REVERSED', 'PARTIALLY_REVERSED'].includes(
      status,
    )
      ? now
      : null,
    version: '1',
    failure_code: status === 'FAILED' ? 'SYNTHETIC_FAILURE' : null,
  }));
  const sources = [
    {
      id: id(200),
      workspace_id: workspace,
      batch_id: id(103),
      file_name: 'SYNTHETIC-extrato.ofx',
      file_hash: 'a'.repeat(64),
      format: 'OFX',
      parser_name: 'SYNTHETIC',
      parser_version: '1',
      detected_currency: 'BRL',
      period_start: '2026-01-01',
      period_end: '2026-01-31',
      imported_at: now,
    },
  ];
  const transaction = snapshot.transactions[0].id,
    revision = id(40),
    readFinancial = financial.read;
  financial.read = (w) => {
    const s = readFinancial(w);
    if (w === workspace)
      s.history.push({
        id: revision,
        transaction_id: transaction,
        version: '1',
        created_at: now,
        change_source: 'IMPORT',
        compatible: true,
        snapshot: {
          format_version: 1,
          base_revision: '0',
          before: null,
          after: structuredClone(s.transactions[0]),
        },
      });
    return s;
  };
  const effects = [
    {
      id: id(400),
      workspace_id: workspace,
      batch_id: id(103),
      import_item_id: id(300),
      transaction_id: transaction,
      action: 'CREATE',
      before_revision_id: null,
      after_revision_id: revision,
      created_at: now,
    },
  ];
  const counts = (b) => ({
    items: Object.fromEntries(
      itemDispositions.map((s) => [
        s,
        s === 'COMMITTED' && b === id(103) ? '1' : '0',
      ]),
    ),
    effects: Object.fromEntries(
      effectActions.map((s) => [
        s,
        s === 'CREATE' && b === id(103) ? '1' : '0',
      ]),
    ),
    total_items: b === id(103) ? '1' : '0',
    total_effects: b === id(103) ? '1' : '0',
  });
  const service = createImportCentralService({
    authorize: async (r) => ({
      workspace_id: r.workspace_id,
      authority: 'LOCAL',
      can_read: true,
      can_prepare: true,
      account_ids: null,
      member_id: null,
    }),
    now: () => now,
    store: {
      async transaction(scope, _mode, run) {
        const w = scope.workspace_id;
        return run({
          workspace: async () => ({ storage_mode: 'LOCAL' }),
          account: async (id) =>
            financial
              .read(w)
              .balance.accounts.map((a) => a.account)
              .find((a) => a.id === id) ?? null,
          candidates: async (q) =>
            batches
              .filter(
                (b) =>
                  b.workspace_id === w &&
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
          batch: async (id) =>
            batches.find((b) => b.workspace_id === w && b.id === id) ?? null,
          sources: async (id) =>
            sources.filter((s) => s.workspace_id === w && s.batch_id === id),
          counts: async (id) => counts(id),
          effects: async (id, after, limit) =>
            effects
              .filter(
                (e) =>
                  e.workspace_id === w &&
                  e.batch_id === id &&
                  (after === null || e.id > after),
              )
              .slice(0, limit),
          insert: async (b) => {
            batches.push(structuredClone(b));
          },
        });
      },
    },
  });
  return {
    service,
    batches,
    account,
    financial,
    async call(command, args) {
      const r = { workspace_id: args.workspaceId };
      return command === 'list_local_imports'
        ? service.list(r, args.input)
        : command === 'read_local_import'
          ? service.detail(r, args.input)
          : service.prepare(r, args.input);
    },
  };
}
