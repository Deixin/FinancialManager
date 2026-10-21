import type { ColumnType, SelectType } from 'kysely';
import type { ImportStatus } from '@financial-manager/domain/imports';
import type {
  AccountKind,
  BalanceNature,
  EconomicKind,
} from '@financial-manager/domain';
type Read<T> = ColumnType<T, never, never>;

export interface WriteImportsTables {
  import_batch: {
    id: string;
    workspace_id: string;
    target_account_id: string | null;
    batch_kind: 'IMPORT' | 'REVERSAL';
    status: ImportStatus;
    reverses_batch_id: string | null;
    created_by_member_id: string | null;
    created_at: ColumnType<Date, string, string>;
    committed_at: ColumnType<Date | null, string | null, string | null>;
    version: ColumnType<string, string, string>;
    failure_code: string | null;
  };
  import_source: {
    id: string;
    workspace_id: string;
    batch_id: string;
    file_name: string;
    file_hash: string;
    format: string;
    parser_name: string | null;
    parser_version: string | null;
    detected_currency: string | null;
    period_start: ColumnType<Date | null, string | null, string | null>;
    period_end: ColumnType<Date | null, string | null, string | null>;
    imported_at: ColumnType<Date, string, string>;
  };
  import_item: {
    id: string;
    workspace_id: string;
    batch_id: string;
    source_id: string | null;
    row_no: ColumnType<string | null, string | null, string | null>;
    source_external_id: string | null;
    normalized_date: ColumnType<Date | null, string | null, string | null>;
    normalized_amount_minor: ColumnType<
      string | null,
      string | null,
      string | null
    >;
    original_description: string | null;
    proposed_name: string | null;
    disposition:
      | 'NEW'
      | 'DUPLICATE'
      | 'POSSIBLE_DUPLICATE'
      | 'UPDATE'
      | 'INVALID'
      | 'SKIPPED'
      | 'COMMITTED';
    validation_errors: unknown;
    provenance: unknown;
    version: ColumnType<string, string, string>;
  };
  import_effect: {
    id: string;
    workspace_id: string;
    batch_id: string;
    import_item_id: string;
    transaction_id: string;
    action: 'CREATE' | 'UPDATE' | 'LINK' | 'UNLINK' | 'RESTORE' | 'DELETE';
    before_revision_id: string | null;
    after_revision_id: string | null;
    created_at: ColumnType<Date, string, string>;
  };
}
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
  note: Read<string | null>;
}
interface Revision extends Identity {
  transaction_id: Id;
  version: Read<string>;
  snapshot: Read<unknown>;
  actor_type: Read<'LOCAL_USER' | 'MEMBER' | 'SYSTEM' | 'SUPPORT'>;
  actor_id: Read<string | null>;
  device_id: Read<string | null>;
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
  transaction_group: Identity & {
    group_type: Read<'TRANSFER' | 'CARD_PAYMENT' | 'OTHER_COMPOSITE'>;
    state: Read<'ACTIVE' | 'BROKEN' | 'VOIDED'>;
  };
  transaction_allocation: Allocation;
  transaction_tag: { workspace_id: Id; transaction_id: Id; tag_id: Id };
  transaction_revision: Revision;
}
export type Database = AccountsTables & TransactionsTables;
export interface WorkspaceTables {
  workspace: {
    id: Id;
    storage_mode: Read<'LOCAL' | 'CLOUD'>;
    purpose: Read<'PERSONAL' | 'BUSINESS' | 'OTHER'>;
  };
}
type DriverInput<T> = T extends Date ? string : T;
type Writable<T> = {
  [K in keyof T]: ColumnType<
    SelectType<T[K]>,
    DriverInput<SelectType<T[K]>>,
    DriverInput<SelectType<T[K]>>
  >;
};
export type WriteTransactionsTables = {
  [K in keyof TransactionsTables]: Writable<TransactionsTables[K]>;
};
export type WriteAccountsTables = {
  [K in keyof AccountsTables]: Writable<AccountsTables[K]>;
};
export interface WriteCategoriesTables {
  category: {
    id: string;
    workspace_id: string;
    name: string;
    normalized_name: ColumnType<string, never, never>;
    category_scope: 'EXPENSE' | 'INCOME' | 'BOTH';
    sort_order: number;
    status: 'ACTIVE' | 'ARCHIVED';
    is_seeded: boolean;
  };
}
export interface WriteTaxonomyTables extends WriteCategoriesTables {
  subcategory: {
    id: string;
    workspace_id: string;
    category_id: string;
    name: string;
    sort_order: number;
    status: 'ACTIVE' | 'ARCHIVED';
  };
  tag: {
    id: string;
    workspace_id: string;
    name: string;
    normalized_name: ColumnType<string, never, never>;
    status: 'ACTIVE' | 'ARCHIVED';
  };
}

export interface WriteCounterpartiesTables {
  counterparty: {
    id: string;
    workspace_id: string;
    display_name: string;
    identifier_type: 'CPF' | 'CNPJ' | 'OTHER' | null;
    identifier_value: string | null;
    relationship_hint: 'CUSTOMER' | 'SUPPLIER' | 'OTHER' | null;
    status: 'ACTIVE' | 'ARCHIVED';
  };
}
