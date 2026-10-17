import type { ColumnType } from 'kysely';
import type {
  AccountKind,
  BalanceNature,
  EconomicKind,
} from '@financial-manager/domain';
type Read<T> = ColumnType<T, never, never>;
type Id = Read<string>;
type Instant = Read<Date>;
interface Identity {
  id: Id;
  workspace_id: Id;
}
interface FinancialAccount extends Identity {
  name: Read<string>;
  account_kind: Read<AccountKind>;
  balance_nature: Read<BalanceNature>;
  currency_code: Read<'BRL'>;
  status: Read<'ACTIVE' | 'ARCHIVED'>;
  institution_name: Read<string | null>;
  created_at: Instant;
}
interface BalanceReference extends Identity {
  account_id: Id;
  amount_minor: Read<string>;
  reference_date: Read<Date>;
  day_position: Read<'START_OF_DAY' | 'END_OF_DAY'>;
  source: Read<'MANUAL' | 'STATEMENT' | 'IMPORT'>;
  status: Read<'ACTIVE' | 'SUPERSEDED'>;
  created_at: Instant;
}
interface FinancialTransaction extends Identity {
  account_id: Id;
  group_id: Read<string | null>;
  counterparty_id: Read<string | null>;
  financial_date: Read<Date>;
  account_amount_minor: Read<string>;
  economic_kind: Read<EconomicKind>;
  original_description: Read<string | null>;
  display_name: Read<string>;
  origin_kind: Read<'MANUAL' | 'IMPORT' | 'DOCUMENT' | 'SYSTEM'>;
  version: Read<string>;
  deleted_at: Read<Date | null>;
  created_at: Instant;
  updated_at: Instant;
}
interface Allocation extends Identity {
  transaction_id: Id;
  category_id: Read<string>;
  subcategory_id: Read<string | null>;
  amount_minor: Read<string>;
}
interface Revision extends Identity {
  transaction_id: Id;
  version: Read<string>;
  change_source: Read<
    | 'MANUAL'
    | 'IMPORT'
    | 'SYNC_RESOLUTION'
    | 'REVERSAL'
    | 'MIGRATION'
    | 'SYSTEM'
  >;
  created_at: Instant;
}
export interface AccountsTables {
  financial_account: FinancialAccount;
  balance_reference: BalanceReference;
}
export interface TransactionsTables {
  financial_transaction: FinancialTransaction;
  transaction_group: Identity;
  transaction_allocation: Allocation;
  transaction_tag: { workspace_id: Id; transaction_id: Id; tag_id: Id };
  transaction_revision: Revision;
}
export type Database = AccountsTables & TransactionsTables;
