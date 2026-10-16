-- Generated from infra/schema/sqlite-model.mjs. US-021. No network or native UDFs.
CREATE TABLE _schema_migration(version INTEGER PRIMARY KEY CHECK(version=1),checksum TEXT NOT NULL CHECK(length(checksum)=64 AND checksum NOT GLOB '*[^a-f0-9]*')) STRICT;
CREATE TABLE workspace(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  display_name TEXT NOT NULL CHECK(trim(display_name)<>''),
  purpose TEXT NOT NULL CHECK(purpose IN ('PERSONAL','BUSINESS','OTHER')),
  storage_mode TEXT NOT NULL CHECK(storage_mode IN ('LOCAL','CLOUD')),
  default_currency TEXT NOT NULL CHECK(default_currency='BRL'),
  legal_name TEXT,
  tax_identifier TEXT,
  legal_nature TEXT,
  sync_generation TEXT NOT NULL CHECK ((length(sync_generation)=36 AND sync_generation=lower(sync_generation) AND substr(sync_generation,9,1)='-' AND substr(sync_generation,14,1)='-' AND substr(sync_generation,19,1)='-' AND substr(sync_generation,24,1)='-' AND length(replace(sync_generation,'-',''))=32 AND replace(sync_generation,'-','') NOT GLOB '*[^0-9a-f]*' AND sync_generation<>'00000000-0000-0000-0000-000000000000')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (coalesce((length(created_at)=24 AND length(substr(created_at,1,10))=10 AND substr(created_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(created_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(created_at,1,10),'+0 days')=substr(created_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND substr(created_at,12,2) BETWEEN '00' AND '23' AND substr(created_at,15,2) BETWEEN '00' AND '59' AND substr(created_at,18,2) BETWEEN '00' AND '59'),0))
) STRICT;
CREATE TABLE financial_account(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  name TEXT NOT NULL CHECK(trim(name)<>''),
  account_kind TEXT NOT NULL CHECK(account_kind IN ('CHECKING','SAVINGS','DIGITAL','CASH','CREDIT_CARD','INVESTMENT_SIMPLE','LOAN_SIMPLE','OTHER')),
  balance_nature TEXT NOT NULL CHECK(balance_nature IN ('ASSET','LIABILITY')),
  currency_code TEXT NOT NULL CHECK(currency_code='BRL'),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')),
  institution_name TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (coalesce((length(created_at)=24 AND length(substr(created_at,1,10))=10 AND substr(created_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(created_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(created_at,1,10),'+0 days')=substr(created_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND substr(created_at,12,2) BETWEEN '00' AND '23' AND substr(created_at,15,2) BETWEEN '00' AND '59' AND substr(created_at,18,2) BETWEEN '00' AND '59'),0)),
  UNIQUE(workspace_id,id),
  CHECK(account_kind<>'CREDIT_CARD' OR balance_nature='LIABILITY')
) STRICT;
CREATE TABLE balance_reference(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  account_id TEXT NOT NULL CHECK ((length(account_id)=36 AND account_id=lower(account_id) AND substr(account_id,9,1)='-' AND substr(account_id,14,1)='-' AND substr(account_id,19,1)='-' AND substr(account_id,24,1)='-' AND length(replace(account_id,'-',''))=32 AND replace(account_id,'-','') NOT GLOB '*[^0-9a-f]*' AND account_id<>'00000000-0000-0000-0000-000000000000')),
  amount_minor INTEGER NOT NULL,
  reference_date TEXT NOT NULL CHECK(coalesce((length(reference_date)=10 AND reference_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND reference_date BETWEEN '0001-01-01' AND '9999-12-31' AND date(reference_date,'+0 days')=reference_date),0)),
  day_position TEXT NOT NULL CHECK(day_position IN ('START_OF_DAY','END_OF_DAY')),
  source TEXT NOT NULL CHECK(source IN ('MANUAL','STATEMENT','IMPORT')),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','SUPERSEDED')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (coalesce((length(created_at)=24 AND length(substr(created_at,1,10))=10 AND substr(created_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(created_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(created_at,1,10),'+0 days')=substr(created_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND substr(created_at,12,2) BETWEEN '00' AND '23' AND substr(created_at,15,2) BETWEEN '00' AND '59' AND substr(created_at,18,2) BETWEEN '00' AND '59'),0)),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES financial_account(workspace_id,id)
) STRICT;
CREATE TABLE transaction_group(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  group_type TEXT NOT NULL CHECK(group_type IN ('TRANSFER','CARD_PAYMENT','OTHER_COMPOSITE')),
  state TEXT NOT NULL CHECK(state IN ('ACTIVE','BROKEN','VOIDED')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (coalesce((length(created_at)=24 AND length(substr(created_at,1,10))=10 AND substr(created_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(created_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(created_at,1,10),'+0 days')=substr(created_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND substr(created_at,12,2) BETWEEN '00' AND '23' AND substr(created_at,15,2) BETWEEN '00' AND '59' AND substr(created_at,18,2) BETWEEN '00' AND '59'),0)),
  UNIQUE(workspace_id,id)
) STRICT;
CREATE TABLE counterparty(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  display_name TEXT NOT NULL CHECK(trim(display_name)<>''),
  identifier_type TEXT,
  identifier_value TEXT,
  relationship_hint TEXT,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')),
  UNIQUE(workspace_id,id)
) STRICT;
CREATE TABLE category(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  name TEXT NOT NULL CHECK(trim(name)<>''),
  normalized_name TEXT NOT NULL CHECK(trim(normalized_name)<>''),
  category_scope TEXT NOT NULL CHECK(category_scope IN ('EXPENSE','INCOME','BOTH')),
  sort_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')),
  is_seeded INTEGER NOT NULL CHECK(is_seeded IN(0,1)),
  UNIQUE(workspace_id,id)
) STRICT;
CREATE TABLE subcategory(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  category_id TEXT NOT NULL CHECK ((length(category_id)=36 AND category_id=lower(category_id) AND substr(category_id,9,1)='-' AND substr(category_id,14,1)='-' AND substr(category_id,19,1)='-' AND substr(category_id,24,1)='-' AND length(replace(category_id,'-',''))=32 AND replace(category_id,'-','') NOT GLOB '*[^0-9a-f]*' AND category_id<>'00000000-0000-0000-0000-000000000000')),
  name TEXT NOT NULL CHECK(trim(name)<>''),
  sort_order INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,category_id,id),
  FOREIGN KEY(workspace_id,category_id) REFERENCES category(workspace_id,id)
) STRICT;
CREATE TABLE tag(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  name TEXT NOT NULL CHECK(trim(name)<>''),
  normalized_name TEXT NOT NULL CHECK(trim(normalized_name)<>''),
  status TEXT NOT NULL CHECK(status IN ('ACTIVE','ARCHIVED')),
  UNIQUE(workspace_id,id)
) STRICT;
CREATE TABLE financial_transaction(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  account_id TEXT NOT NULL CHECK ((length(account_id)=36 AND account_id=lower(account_id) AND substr(account_id,9,1)='-' AND substr(account_id,14,1)='-' AND substr(account_id,19,1)='-' AND substr(account_id,24,1)='-' AND length(replace(account_id,'-',''))=32 AND replace(account_id,'-','') NOT GLOB '*[^0-9a-f]*' AND account_id<>'00000000-0000-0000-0000-000000000000')),
  group_id TEXT  CHECK (group_id IS NULL OR (length(group_id)=36 AND group_id=lower(group_id) AND substr(group_id,9,1)='-' AND substr(group_id,14,1)='-' AND substr(group_id,19,1)='-' AND substr(group_id,24,1)='-' AND length(replace(group_id,'-',''))=32 AND replace(group_id,'-','') NOT GLOB '*[^0-9a-f]*' AND group_id<>'00000000-0000-0000-0000-000000000000')),
  counterparty_id TEXT  CHECK (counterparty_id IS NULL OR (length(counterparty_id)=36 AND counterparty_id=lower(counterparty_id) AND substr(counterparty_id,9,1)='-' AND substr(counterparty_id,14,1)='-' AND substr(counterparty_id,19,1)='-' AND substr(counterparty_id,24,1)='-' AND length(replace(counterparty_id,'-',''))=32 AND replace(counterparty_id,'-','') NOT GLOB '*[^0-9a-f]*' AND counterparty_id<>'00000000-0000-0000-0000-000000000000')),
  financial_date TEXT NOT NULL CHECK(coalesce((length(financial_date)=10 AND financial_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND financial_date BETWEEN '0001-01-01' AND '9999-12-31' AND date(financial_date,'+0 days')=financial_date),0)),
  account_amount_minor INTEGER NOT NULL,
  economic_kind TEXT NOT NULL CHECK(economic_kind IN ('INCOME','EXPENSE','EXPENSE_REVERSAL','TRANSFER','DEBT_SETTLEMENT','ADJUSTMENT','OTHER')),
  original_description TEXT,
  display_name TEXT NOT NULL CHECK(trim(display_name)<>''),
  origin_kind TEXT NOT NULL CHECK(origin_kind IN ('MANUAL','IMPORT','DOCUMENT','SYSTEM')),
  version INTEGER NOT NULL CHECK(version>0),
  deleted_at TEXT  CHECK (deleted_at IS NULL OR coalesce((length(deleted_at)=24 AND length(substr(deleted_at,1,10))=10 AND substr(deleted_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(deleted_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(deleted_at,1,10),'+0 days')=substr(deleted_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',deleted_at)=deleted_at AND substr(deleted_at,12,2) BETWEEN '00' AND '23' AND substr(deleted_at,15,2) BETWEEN '00' AND '59' AND substr(deleted_at,18,2) BETWEEN '00' AND '59'),0)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (coalesce((length(created_at)=24 AND length(substr(created_at,1,10))=10 AND substr(created_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(created_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(created_at,1,10),'+0 days')=substr(created_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND substr(created_at,12,2) BETWEEN '00' AND '23' AND substr(created_at,15,2) BETWEEN '00' AND '59' AND substr(created_at,18,2) BETWEEN '00' AND '59'),0)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (coalesce((length(updated_at)=24 AND length(substr(updated_at,1,10))=10 AND substr(updated_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(updated_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(updated_at,1,10),'+0 days')=substr(updated_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',updated_at)=updated_at AND substr(updated_at,12,2) BETWEEN '00' AND '23' AND substr(updated_at,15,2) BETWEEN '00' AND '59' AND substr(updated_at,18,2) BETWEEN '00' AND '59'),0)),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,account_id) REFERENCES financial_account(workspace_id,id),
  FOREIGN KEY(workspace_id,group_id) REFERENCES transaction_group(workspace_id,id),
  FOREIGN KEY(workspace_id,counterparty_id) REFERENCES counterparty(workspace_id,id),
  CHECK(updated_at>=created_at),
  CHECK(deleted_at IS NULL OR deleted_at>=created_at),
  FOREIGN KEY(workspace_id,id) REFERENCES _allocation_commit_guard(workspace_id,transaction_id) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE transaction_allocation(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  transaction_id TEXT NOT NULL CHECK ((length(transaction_id)=36 AND transaction_id=lower(transaction_id) AND substr(transaction_id,9,1)='-' AND substr(transaction_id,14,1)='-' AND substr(transaction_id,19,1)='-' AND substr(transaction_id,24,1)='-' AND length(replace(transaction_id,'-',''))=32 AND replace(transaction_id,'-','') NOT GLOB '*[^0-9a-f]*' AND transaction_id<>'00000000-0000-0000-0000-000000000000')),
  category_id TEXT NOT NULL CHECK ((length(category_id)=36 AND category_id=lower(category_id) AND substr(category_id,9,1)='-' AND substr(category_id,14,1)='-' AND substr(category_id,19,1)='-' AND substr(category_id,24,1)='-' AND length(replace(category_id,'-',''))=32 AND replace(category_id,'-','') NOT GLOB '*[^0-9a-f]*' AND category_id<>'00000000-0000-0000-0000-000000000000')),
  subcategory_id TEXT  CHECK (subcategory_id IS NULL OR (length(subcategory_id)=36 AND subcategory_id=lower(subcategory_id) AND substr(subcategory_id,9,1)='-' AND substr(subcategory_id,14,1)='-' AND substr(subcategory_id,19,1)='-' AND substr(subcategory_id,24,1)='-' AND length(replace(subcategory_id,'-',''))=32 AND replace(subcategory_id,'-','') NOT GLOB '*[^0-9a-f]*' AND subcategory_id<>'00000000-0000-0000-0000-000000000000')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
  note TEXT,
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,transaction_id) REFERENCES financial_transaction(workspace_id,id),
  FOREIGN KEY(workspace_id,category_id) REFERENCES category(workspace_id,id),
  FOREIGN KEY(workspace_id,category_id,subcategory_id) REFERENCES subcategory(workspace_id,category_id,id)
) STRICT;
CREATE TABLE transaction_tag(
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  transaction_id TEXT NOT NULL CHECK ((length(transaction_id)=36 AND transaction_id=lower(transaction_id) AND substr(transaction_id,9,1)='-' AND substr(transaction_id,14,1)='-' AND substr(transaction_id,19,1)='-' AND substr(transaction_id,24,1)='-' AND length(replace(transaction_id,'-',''))=32 AND replace(transaction_id,'-','') NOT GLOB '*[^0-9a-f]*' AND transaction_id<>'00000000-0000-0000-0000-000000000000')),
  tag_id TEXT NOT NULL CHECK ((length(tag_id)=36 AND tag_id=lower(tag_id) AND substr(tag_id,9,1)='-' AND substr(tag_id,14,1)='-' AND substr(tag_id,19,1)='-' AND substr(tag_id,24,1)='-' AND length(replace(tag_id,'-',''))=32 AND replace(tag_id,'-','') NOT GLOB '*[^0-9a-f]*' AND tag_id<>'00000000-0000-0000-0000-000000000000')),
  PRIMARY KEY(workspace_id,transaction_id,tag_id),
  FOREIGN KEY(workspace_id,transaction_id) REFERENCES financial_transaction(workspace_id,id),
  FOREIGN KEY(workspace_id,tag_id) REFERENCES tag(workspace_id,id)
) STRICT;
CREATE TABLE transaction_revision(
  id TEXT NOT NULL CHECK ((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK ((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  transaction_id TEXT NOT NULL CHECK ((length(transaction_id)=36 AND transaction_id=lower(transaction_id) AND substr(transaction_id,9,1)='-' AND substr(transaction_id,14,1)='-' AND substr(transaction_id,19,1)='-' AND substr(transaction_id,24,1)='-' AND length(replace(transaction_id,'-',''))=32 AND replace(transaction_id,'-','') NOT GLOB '*[^0-9a-f]*' AND transaction_id<>'00000000-0000-0000-0000-000000000000')),
  version INTEGER NOT NULL CHECK(version>0),
  snapshot TEXT NOT NULL CHECK(CASE WHEN json_valid(snapshot) THEN json_type(snapshot)='object' ELSE 0 END),
  actor_type TEXT NOT NULL CHECK(actor_type IN ('LOCAL_USER','MEMBER','SYSTEM','SUPPORT')),
  actor_id TEXT,
  device_id TEXT  CHECK (device_id IS NULL OR (length(device_id)=36 AND device_id=lower(device_id) AND substr(device_id,9,1)='-' AND substr(device_id,14,1)='-' AND substr(device_id,19,1)='-' AND substr(device_id,24,1)='-' AND length(replace(device_id,'-',''))=32 AND replace(device_id,'-','') NOT GLOB '*[^0-9a-f]*' AND device_id<>'00000000-0000-0000-0000-000000000000')),
  change_source TEXT NOT NULL CHECK(change_source IN ('MANUAL','IMPORT','SYNC_RESOLUTION','REVERSAL','MIGRATION','SYSTEM')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) CHECK (coalesce((length(created_at)=24 AND length(substr(created_at,1,10))=10 AND substr(created_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(created_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(created_at,1,10),'+0 days')=substr(created_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND substr(created_at,12,2) BETWEEN '00' AND '23' AND substr(created_at,15,2) BETWEEN '00' AND '59' AND substr(created_at,18,2) BETWEEN '00' AND '59'),0)),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,transaction_id,version),
  FOREIGN KEY(workspace_id,transaction_id) REFERENCES financial_transaction(workspace_id,id)
) STRICT;
CREATE TABLE _allocation_valid_anchor(valid INTEGER PRIMARY KEY CHECK(valid=1)) STRICT;
INSERT INTO _allocation_valid_anchor VALUES(1);
CREATE TABLE _allocation_commit_guard(
  workspace_id TEXT NOT NULL,transaction_id TEXT NOT NULL,valid INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,transaction_id),
  FOREIGN KEY(workspace_id,transaction_id) REFERENCES financial_transaction(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(valid) REFERENCES _allocation_valid_anchor(valid) DEFERRABLE INITIALLY DEFERRED
) STRICT;
-- Exact positive accumulation in base 2^32, saturating above 2^63.
-- Each addition stays within INTEGER, even for invalid totals and INT64_MIN.
CREATE VIEW _allocation_status AS SELECT t.workspace_id,t.id AS transaction_id,
  coalesce((WITH RECURSIVE
    parts AS (SELECT row_number() OVER(ORDER BY id) AS n,
      amount_minor/4294967296 AS hi,amount_minor%4294967296 AS lo
      FROM transaction_allocation WHERE workspace_id=t.workspace_id AND transaction_id=t.id),
    sums(n,hi,lo) AS (SELECT 0,0,0 UNION ALL
      SELECT p.n,min(2147483649,s.hi+p.hi+(s.lo+p.lo)/4294967296),(s.lo+p.lo)%4294967296
      FROM sums s JOIN parts p ON p.n=s.n+1)
    SELECT hi=CASE WHEN t.account_amount_minor<0 THEN -(t.account_amount_minor/4294967296) ELSE t.account_amount_minor/4294967296 END
      AND lo=CASE WHEN t.account_amount_minor<0 THEN -(t.account_amount_minor%4294967296) ELSE t.account_amount_minor%4294967296 END
    FROM sums WHERE n>0 ORDER BY n DESC LIMIT 1),1) AS valid
  FROM financial_transaction t;
CREATE TRIGGER guard_insert_checked BEFORE INSERT ON _allocation_commit_guard BEGIN
  SELECT CASE WHEN NEW.valid<>coalesce((SELECT valid FROM _allocation_status WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.transaction_id),-1)
    THEN RAISE(ABORT,'ALLOCATION_GUARD_INVALID') END;
END;
CREATE TRIGGER guard_update_checked BEFORE UPDATE ON _allocation_commit_guard BEGIN
  SELECT CASE WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.transaction_id<>OLD.transaction_id
    OR NEW.valid<>coalesce((SELECT valid FROM _allocation_status WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.transaction_id),-1)
    THEN RAISE(ABORT,'ALLOCATION_GUARD_INVALID') END;
END;
CREATE TRIGGER transaction_guard_insert AFTER INSERT ON financial_transaction BEGIN
  INSERT INTO _allocation_commit_guard VALUES(NEW.workspace_id,NEW.id,1);
END;
CREATE TRIGGER transaction_guard_update AFTER UPDATE OF account_amount_minor ON financial_transaction BEGIN
  UPDATE _allocation_commit_guard SET valid=(SELECT valid FROM _allocation_status WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.id)
    WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.id;
END;
CREATE TRIGGER allocation_guard_insert AFTER INSERT ON transaction_allocation BEGIN UPDATE _allocation_commit_guard SET valid=(SELECT valid FROM _allocation_status WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.transaction_id) WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.transaction_id; END;
CREATE TRIGGER allocation_guard_delete AFTER DELETE ON transaction_allocation BEGIN UPDATE _allocation_commit_guard SET valid=(SELECT valid FROM _allocation_status WHERE workspace_id=OLD.workspace_id AND transaction_id=OLD.transaction_id) WHERE workspace_id=OLD.workspace_id AND transaction_id=OLD.transaction_id; END;
CREATE TRIGGER allocation_guard_update AFTER UPDATE ON transaction_allocation BEGIN UPDATE _allocation_commit_guard SET valid=(SELECT valid FROM _allocation_status WHERE workspace_id=OLD.workspace_id AND transaction_id=OLD.transaction_id) WHERE workspace_id=OLD.workspace_id AND transaction_id=OLD.transaction_id; UPDATE _allocation_commit_guard SET valid=(SELECT valid FROM _allocation_status WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.transaction_id) WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.transaction_id; END;
CREATE TRIGGER revision_immutable_update BEFORE UPDATE ON transaction_revision BEGIN SELECT RAISE(ABORT,'REVISION_IMMUTABLE'); END;
CREATE TRIGGER revision_immutable_delete BEFORE DELETE ON transaction_revision BEGIN SELECT RAISE(ABORT,'REVISION_IMMUTABLE'); END;
CREATE UNIQUE INDEX category_active_name ON category(workspace_id,normalized_name) WHERE status='ACTIVE';
CREATE UNIQUE INDEX tag_active_name ON tag(workspace_id,normalized_name) WHERE status='ACTIVE';
CREATE UNIQUE INDEX balance_reference_active_point ON balance_reference(workspace_id,account_id,reference_date,day_position) WHERE status='ACTIVE';
CREATE INDEX transaction_workspace_date ON financial_transaction(workspace_id,financial_date DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX transaction_account_date ON financial_transaction(workspace_id,account_id,financial_date DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX transaction_group_lookup ON financial_transaction(workspace_id,group_id) WHERE group_id IS NOT NULL;
CREATE INDEX allocation_transaction ON transaction_allocation(workspace_id,transaction_id);
CREATE INDEX allocation_category ON transaction_allocation(workspace_id,category_id,transaction_id);
CREATE TRIGGER workspace_identity_immutable BEFORE UPDATE ON workspace WHEN NEW.id<>OLD.id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER financial_account_identity_immutable BEFORE UPDATE ON financial_account WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER balance_reference_identity_immutable BEFORE UPDATE ON balance_reference WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER transaction_group_identity_immutable BEFORE UPDATE ON transaction_group WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER counterparty_identity_immutable BEFORE UPDATE ON counterparty WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER category_identity_immutable BEFORE UPDATE ON category WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER subcategory_identity_immutable BEFORE UPDATE ON subcategory WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER tag_identity_immutable BEFORE UPDATE ON tag WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER financial_transaction_identity_immutable BEFORE UPDATE ON financial_transaction WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER transaction_allocation_identity_immutable BEFORE UPDATE ON transaction_allocation WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;
