import type {
  Account,
  AccountKind,
  BalanceNature,
  BalanceReference,
  EconomicKind,
  MoneyMinor,
  UtcInstant,
} from '@financial-manager/domain';
import type { ResourceId } from '@financial-manager/contracts';
export {
  createAccountWriteService,
  readCalculatedAccountBalance,
} from './account-changes.js';
export { AccountChangeError } from '@financial-manager/domain';
export type {
  AccountWriteRequest,
  AccountWriteGrant,
  AccountWriteScope,
  AccountWriteTransaction,
  AccountWriteOptions,
} from './account-changes.js';
export type { AccountKind, BalanceNature };
const codes = [
  'INVALID_INPUT',
  'ACCESS_DENIED',
  'INVALID_AUTHORIZATION',
  'SCOPE_CLOSED',
  'DATA_INVALID',
  'DATA_ACCESS_FAILED',
  'PENDING_WORK',
  'NESTED_READ_SCOPE',
  'UNIT_OF_WORK_FAILED',
  'CONFIGURATION_INVALID',
  'CLOSED',
  'NOT_FOUND',
] as const;
export type DataAccessErrorCode = (typeof codes)[number];
export class DataAccessError extends Error {
  readonly code: DataAccessErrorCode;
  constructor(code: DataAccessErrorCode) {
    const safe = codes.includes(code) ? code : 'UNIT_OF_WORK_FAILED';
    super(safe);
    this.name = 'DataAccessError';
    this.code = safe;
  }
}
export interface AccountRecord extends Account {
  readonly id: ResourceId;
  readonly workspace_id: ResourceId;
  readonly name: string;
  readonly institution_name: string | null;
  readonly created_at: UtcInstant;
}
export interface ReferenceRecord extends BalanceReference {
  readonly id: ResourceId;
  readonly source: 'MANUAL' | 'STATEMENT' | 'IMPORT';
  readonly created_at: UtcInstant;
}
export interface TransactionRecord {
  readonly id: ResourceId;
  readonly workspace_id: ResourceId;
  readonly account_id: ResourceId;
  readonly group_id: ResourceId | null;
  readonly counterparty_id: ResourceId | null;
  readonly financial_date: string;
  readonly account_amount_minor: MoneyMinor;
  readonly economic_kind: EconomicKind;
  readonly original_description: string | null;
  readonly display_name: string;
  readonly origin_kind: 'MANUAL' | 'IMPORT' | 'DOCUMENT' | 'SYSTEM';
  readonly version: string;
  readonly created_at: UtcInstant;
  readonly updated_at: UtcInstant;
}
export interface AllocationRecord {
  readonly id: ResourceId;
  readonly transaction_id: ResourceId;
  readonly category_id: ResourceId;
  readonly subcategory_id: ResourceId | null;
  readonly amount_minor: MoneyMinor;
}
export interface RevisionHeader {
  readonly id: ResourceId;
  readonly transaction_id: ResourceId;
  readonly version: string;
  readonly change_source:
    | 'MANUAL'
    | 'IMPORT'
    | 'SYNC_RESOLUTION'
    | 'REVERSAL'
    | 'MIGRATION'
    | 'SYSTEM';
  readonly created_at: UtcInstant;
}
export interface AccountCursor {
  readonly workspace_id: ResourceId;
  readonly id: ResourceId;
}
export interface ReferenceCursor extends AccountCursor {
  readonly account_id: ResourceId;
  readonly reference_date: string;
}
export interface TransactionCursor extends AccountCursor {
  readonly account_id: ResourceId | null;
  readonly from: string;
  readonly through: string;
  readonly financial_date: string;
}
export interface Page<T, C> {
  readonly items: readonly T[];
  readonly next_cursor: C | null;
}
export interface AccountsReadPort {
  get(id: string): Promise<AccountRecord | null>;
  page(
    input: Readonly<{ limit: number; cursor?: AccountCursor | null }>,
  ): Promise<Page<AccountRecord, AccountCursor>>;
  references(
    input: Readonly<{
      account_id: string;
      limit: number;
      cursor?: ReferenceCursor | null;
    }>,
  ): Promise<Page<ReferenceRecord, ReferenceCursor>>;
}
export interface TransactionsReadPort {
  get(id: string): Promise<TransactionRecord | null>;
  page(
    input: Readonly<{
      account_id?: string | null;
      from: string;
      through: string;
      limit: number;
      cursor?: TransactionCursor | null;
    }>,
  ): Promise<Page<TransactionRecord, TransactionCursor>>;
  allocations(transaction_id: string): Promise<readonly AllocationRecord[]>;
  tagIds(transaction_id: string): Promise<readonly ResourceId[]>;
  revisions(transaction_id: string): Promise<readonly RevisionHeader[]>;
}
export interface ScopedReadPorts {
  readonly accounts: AccountsReadPort;
  readonly transactions: TransactionsReadPort;
}
export interface ReadRequest {
  readonly workspace_id: string;
  readonly principal_id: string;
}
export type ReadPermission = 'accounts:read' | 'transactions:read';
export interface ReadGrant {
  readonly workspace_id: string;
  readonly permissions: readonly ReadPermission[];
  readonly account_ids: readonly string[] | null;
}
export type AuthorizeRead = (
  request: Readonly<ReadRequest>,
) => Promise<ReadGrant | null>;
export interface WorkspaceReadUnit {
  readonly snapshot_consistency?: boolean;
  read<T>(
    request: ReadRequest,
    operation: (ports: ScopedReadPorts) => Promise<T>,
  ): Promise<T>;
}
// Explicit application orchestration. No module queries the other module's table.
export function readAccountActivity(
  unit: WorkspaceReadUnit,
  request: ReadRequest,
  input: Readonly<{
    account_id: string;
    from: string;
    through: string;
    limit: number;
    cursor?: TransactionCursor | null;
  }>,
) {
  const captured = Object.freeze({
    ...input,
    cursor: input.cursor ? Object.freeze({ ...input.cursor }) : null,
  });
  return unit.read(request, async (ports) => {
    const account = await ports.accounts.get(captured.account_id);
    if (!account) throw new DataAccessError('NOT_FOUND');
    const transactions = await ports.transactions.page(captured);
    return Object.freeze({ account, transactions });
  });
}
