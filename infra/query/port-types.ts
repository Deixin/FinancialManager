import type {
  ScopedReadPorts,
  WorkspaceReadUnit,
} from '../../packages/finance-ports/dist/index.js';
declare const ports: ScopedReadPorts;
// @ts-expect-error ports cannot expose a database handle
ports.db.selectFrom('financial_account');
// @ts-expect-error a transaction repository cannot become an accounts repository
ports.transactions.accounts.get('id');
// @ts-expect-error read ports do not expose writes before revisions/idempotency/outbox integration
ports.transactions.insert({ account_amount_minor: 1 });
// @ts-expect-error table names and SQL are not repository methods
ports.accounts.selectFrom('financial_transaction');
declare const unit: WorkspaceReadUnit;
unit.read(
  {
    workspace_id: 'id',
    principal_id: 'subject',
    // @ts-expect-error public callers cannot supply an authorization grant
    permissions: ['accounts:read'],
  },
  async () => {},
);
