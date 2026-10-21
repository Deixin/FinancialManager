-- US-050 opt-in import ledger. No original files; runtime access remains denied without explicit authorization.
CREATE UNIQUE INDEX revision_import_identity ON transaction_revision(workspace_id,transaction_id,id);
CREATE TABLE import_batch(
  id TEXT NOT NULL CHECK((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  target_account_id TEXT CHECK(target_account_id IS NULL OR (length(target_account_id)=36 AND target_account_id=lower(target_account_id) AND substr(target_account_id,9,1)='-' AND substr(target_account_id,14,1)='-' AND substr(target_account_id,19,1)='-' AND substr(target_account_id,24,1)='-' AND length(replace(target_account_id,'-',''))=32 AND replace(target_account_id,'-','') NOT GLOB '*[^0-9a-f]*' AND target_account_id<>'00000000-0000-0000-0000-000000000000')),
  batch_kind TEXT NOT NULL CHECK(batch_kind IN ('IMPORT','REVERSAL')),
  status TEXT NOT NULL CHECK(status IN ('PREPARING','REVIEW','CONFIRMING','COMMITTED','FAILED','REVERSED','PARTIALLY_REVERSED')),
  reverses_batch_id TEXT CHECK(reverses_batch_id IS NULL OR (length(reverses_batch_id)=36 AND reverses_batch_id=lower(reverses_batch_id) AND substr(reverses_batch_id,9,1)='-' AND substr(reverses_batch_id,14,1)='-' AND substr(reverses_batch_id,19,1)='-' AND substr(reverses_batch_id,24,1)='-' AND length(replace(reverses_batch_id,'-',''))=32 AND replace(reverses_batch_id,'-','') NOT GLOB '*[^0-9a-f]*' AND reverses_batch_id<>'00000000-0000-0000-0000-000000000000')),
  created_by_member_id TEXT CHECK(created_by_member_id IS NULL OR (length(created_by_member_id)=36 AND created_by_member_id=lower(created_by_member_id) AND substr(created_by_member_id,9,1)='-' AND substr(created_by_member_id,14,1)='-' AND substr(created_by_member_id,19,1)='-' AND substr(created_by_member_id,24,1)='-' AND length(replace(created_by_member_id,'-',''))=32 AND replace(created_by_member_id,'-','') NOT GLOB '*[^0-9a-f]*' AND created_by_member_id<>'00000000-0000-0000-0000-000000000000')),
  created_at TEXT NOT NULL CHECK(coalesce((length(created_at)=24 AND length(substr(created_at,1,10))=10 AND substr(created_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(created_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(created_at,1,10),'+0 days')=substr(created_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND substr(created_at,12,2) BETWEEN '00' AND '23' AND substr(created_at,15,2) BETWEEN '00' AND '59' AND substr(created_at,18,2) BETWEEN '00' AND '59'),0)),
  committed_at TEXT CHECK(committed_at IS NULL OR coalesce((length(committed_at)=24 AND length(substr(committed_at,1,10))=10 AND substr(committed_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(committed_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(committed_at,1,10),'+0 days')=substr(committed_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',committed_at)=committed_at AND substr(committed_at,12,2) BETWEEN '00' AND '23' AND substr(committed_at,15,2) BETWEEN '00' AND '59' AND substr(committed_at,18,2) BETWEEN '00' AND '59'),0)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  failure_code TEXT CHECK(failure_code IS NULL OR (length(failure_code) BETWEEN 1 AND 64 AND substr(failure_code,1,1) GLOB '[A-Z]' AND failure_code NOT GLOB '*[^A-Z0-9_]*')),
  CHECK((batch_kind='IMPORT' AND reverses_batch_id IS NULL) OR (batch_kind='REVERSAL' AND reverses_batch_id IS NOT NULL AND reverses_batch_id<>id)),
  CHECK((status IN ('COMMITTED','REVERSED','PARTIALLY_REVERSED')) = (committed_at IS NOT NULL)),
  CHECK(committed_at IS NULL OR committed_at>=created_at),
  CHECK((status='FAILED') = (failure_code IS NOT NULL)),
  FOREIGN KEY(workspace_id,target_account_id) REFERENCES financial_account(workspace_id,id),
  FOREIGN KEY(workspace_id,reverses_batch_id) REFERENCES import_batch(workspace_id,id),
  UNIQUE(workspace_id,id)
) STRICT;
CREATE TABLE import_source(
  id TEXT NOT NULL CHECK((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  batch_id TEXT NOT NULL CHECK((length(batch_id)=36 AND batch_id=lower(batch_id) AND substr(batch_id,9,1)='-' AND substr(batch_id,14,1)='-' AND substr(batch_id,19,1)='-' AND substr(batch_id,24,1)='-' AND length(replace(batch_id,'-',''))=32 AND replace(batch_id,'-','') NOT GLOB '*[^0-9a-f]*' AND batch_id<>'00000000-0000-0000-0000-000000000000')),
  file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
  file_hash TEXT NOT NULL CHECK(length(file_hash)=64 AND file_hash NOT GLOB '*[^a-f0-9]*'),
  format TEXT NOT NULL CHECK(length(format) BETWEEN 1 AND 32),
  parser_name TEXT CHECK(parser_name IS NULL OR length(parser_name) BETWEEN 1 AND 120),
  parser_version TEXT CHECK(parser_version IS NULL OR length(parser_version) BETWEEN 1 AND 40),
  detected_currency TEXT CHECK(detected_currency IS NULL OR length(detected_currency)=3),
  period_start TEXT CHECK(period_start IS NULL OR coalesce((length(period_start)=10 AND period_start GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND period_start BETWEEN '0001-01-01' AND '9999-12-31' AND date(period_start,'+0 days')=period_start),0)),
  period_end TEXT CHECK(period_end IS NULL OR coalesce((length(period_end)=10 AND period_end GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND period_end BETWEEN '0001-01-01' AND '9999-12-31' AND date(period_end,'+0 days')=period_end),0)),
  imported_at TEXT NOT NULL CHECK(coalesce((length(imported_at)=24 AND length(substr(imported_at,1,10))=10 AND substr(imported_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(imported_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(imported_at,1,10),'+0 days')=substr(imported_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',imported_at)=imported_at AND substr(imported_at,12,2) BETWEEN '00' AND '23' AND substr(imported_at,15,2) BETWEEN '00' AND '59' AND substr(imported_at,18,2) BETWEEN '00' AND '59'),0)),
  CHECK((parser_name IS NULL) = (parser_version IS NULL)),
  CHECK(period_start IS NULL OR period_end IS NULL OR period_start<=period_end),
  UNIQUE(workspace_id,batch_id,id),
  FOREIGN KEY(workspace_id,batch_id) REFERENCES import_batch(workspace_id,id),
  UNIQUE(workspace_id,id)
) STRICT;
CREATE TABLE import_item(
  id TEXT NOT NULL CHECK((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  batch_id TEXT NOT NULL CHECK((length(batch_id)=36 AND batch_id=lower(batch_id) AND substr(batch_id,9,1)='-' AND substr(batch_id,14,1)='-' AND substr(batch_id,19,1)='-' AND substr(batch_id,24,1)='-' AND length(replace(batch_id,'-',''))=32 AND replace(batch_id,'-','') NOT GLOB '*[^0-9a-f]*' AND batch_id<>'00000000-0000-0000-0000-000000000000')),
  source_id TEXT CHECK(source_id IS NULL OR (length(source_id)=36 AND source_id=lower(source_id) AND substr(source_id,9,1)='-' AND substr(source_id,14,1)='-' AND substr(source_id,19,1)='-' AND substr(source_id,24,1)='-' AND length(replace(source_id,'-',''))=32 AND replace(source_id,'-','') NOT GLOB '*[^0-9a-f]*' AND source_id<>'00000000-0000-0000-0000-000000000000')),
  row_no INTEGER CHECK(row_no IS NULL OR row_no BETWEEN 1 AND 200000),
  source_external_id TEXT CHECK(source_external_id IS NULL OR length(source_external_id)<=256),
  normalized_date TEXT CHECK(normalized_date IS NULL OR coalesce((length(normalized_date)=10 AND normalized_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND normalized_date BETWEEN '0001-01-01' AND '9999-12-31' AND date(normalized_date,'+0 days')=normalized_date),0)),
  normalized_amount_minor INTEGER,
  original_description TEXT CHECK(original_description IS NULL OR length(original_description)<=20000),
  proposed_name TEXT CHECK(proposed_name IS NULL OR length(proposed_name) BETWEEN 1 AND 120),
  disposition TEXT NOT NULL CHECK(disposition IN ('NEW','DUPLICATE','POSSIBLE_DUPLICATE','UPDATE','INVALID','SKIPPED','COMMITTED')),
  validation_errors TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(validation_errors) AND json_type(validation_errors)='array' AND length(CAST(validation_errors AS BLOB))<=16384),
  provenance TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(provenance) AND json_type(provenance)='object' AND length(CAST(provenance AS BLOB))<=16384),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(workspace_id,batch_id,id),
  CHECK(disposition IN ('INVALID','SKIPPED') OR (normalized_date IS NOT NULL AND normalized_amount_minor IS NOT NULL)),
  FOREIGN KEY(workspace_id,batch_id) REFERENCES import_batch(workspace_id,id),
  FOREIGN KEY(workspace_id,batch_id,source_id) REFERENCES import_source(workspace_id,batch_id,id),
  UNIQUE(workspace_id,id)
) STRICT;
CREATE TABLE import_effect(
  id TEXT NOT NULL CHECK((length(id)=36 AND id=lower(id) AND substr(id,9,1)='-' AND substr(id,14,1)='-' AND substr(id,19,1)='-' AND substr(id,24,1)='-' AND length(replace(id,'-',''))=32 AND replace(id,'-','') NOT GLOB '*[^0-9a-f]*' AND id<>'00000000-0000-0000-0000-000000000000')) PRIMARY KEY,
  workspace_id TEXT NOT NULL CHECK((length(workspace_id)=36 AND workspace_id=lower(workspace_id) AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-' AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-' AND length(replace(workspace_id,'-',''))=32 AND replace(workspace_id,'-','') NOT GLOB '*[^0-9a-f]*' AND workspace_id<>'00000000-0000-0000-0000-000000000000')) REFERENCES workspace(id),
  batch_id TEXT NOT NULL CHECK((length(batch_id)=36 AND batch_id=lower(batch_id) AND substr(batch_id,9,1)='-' AND substr(batch_id,14,1)='-' AND substr(batch_id,19,1)='-' AND substr(batch_id,24,1)='-' AND length(replace(batch_id,'-',''))=32 AND replace(batch_id,'-','') NOT GLOB '*[^0-9a-f]*' AND batch_id<>'00000000-0000-0000-0000-000000000000')),
  import_item_id TEXT NOT NULL CHECK((length(import_item_id)=36 AND import_item_id=lower(import_item_id) AND substr(import_item_id,9,1)='-' AND substr(import_item_id,14,1)='-' AND substr(import_item_id,19,1)='-' AND substr(import_item_id,24,1)='-' AND length(replace(import_item_id,'-',''))=32 AND replace(import_item_id,'-','') NOT GLOB '*[^0-9a-f]*' AND import_item_id<>'00000000-0000-0000-0000-000000000000')),
  transaction_id TEXT NOT NULL CHECK((length(transaction_id)=36 AND transaction_id=lower(transaction_id) AND substr(transaction_id,9,1)='-' AND substr(transaction_id,14,1)='-' AND substr(transaction_id,19,1)='-' AND substr(transaction_id,24,1)='-' AND length(replace(transaction_id,'-',''))=32 AND replace(transaction_id,'-','') NOT GLOB '*[^0-9a-f]*' AND transaction_id<>'00000000-0000-0000-0000-000000000000')),
  action TEXT NOT NULL CHECK(action IN ('CREATE','UPDATE','LINK','UNLINK','RESTORE','DELETE')),
  before_revision_id TEXT CHECK(before_revision_id IS NULL OR (length(before_revision_id)=36 AND before_revision_id=lower(before_revision_id) AND substr(before_revision_id,9,1)='-' AND substr(before_revision_id,14,1)='-' AND substr(before_revision_id,19,1)='-' AND substr(before_revision_id,24,1)='-' AND length(replace(before_revision_id,'-',''))=32 AND replace(before_revision_id,'-','') NOT GLOB '*[^0-9a-f]*' AND before_revision_id<>'00000000-0000-0000-0000-000000000000')),
  after_revision_id TEXT CHECK(after_revision_id IS NULL OR (length(after_revision_id)=36 AND after_revision_id=lower(after_revision_id) AND substr(after_revision_id,9,1)='-' AND substr(after_revision_id,14,1)='-' AND substr(after_revision_id,19,1)='-' AND substr(after_revision_id,24,1)='-' AND length(replace(after_revision_id,'-',''))=32 AND replace(after_revision_id,'-','') NOT GLOB '*[^0-9a-f]*' AND after_revision_id<>'00000000-0000-0000-0000-000000000000')),
  created_at TEXT NOT NULL CHECK(coalesce((length(created_at)=24 AND length(substr(created_at,1,10))=10 AND substr(created_at,1,10) GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND substr(created_at,1,10) BETWEEN '0001-01-01' AND '9999-12-31' AND date(substr(created_at,1,10),'+0 days')=substr(created_at,1,10) AND strftime('%Y-%m-%dT%H:%M:%fZ',created_at)=created_at AND substr(created_at,12,2) BETWEEN '00' AND '23' AND substr(created_at,15,2) BETWEEN '00' AND '59' AND substr(created_at,18,2) BETWEEN '00' AND '59'),0)),
  CHECK(action<>'CREATE' OR (before_revision_id IS NULL AND after_revision_id IS NOT NULL)),
  CHECK(action NOT IN ('UPDATE','RESTORE','DELETE') OR (before_revision_id IS NOT NULL AND after_revision_id IS NOT NULL AND before_revision_id<>after_revision_id)),
  FOREIGN KEY(workspace_id,batch_id) REFERENCES import_batch(workspace_id,id),
  FOREIGN KEY(workspace_id,batch_id,import_item_id) REFERENCES import_item(workspace_id,batch_id,id),
  FOREIGN KEY(workspace_id,transaction_id) REFERENCES financial_transaction(workspace_id,id),
  FOREIGN KEY(workspace_id,transaction_id,before_revision_id) REFERENCES transaction_revision(workspace_id,transaction_id,id),
  FOREIGN KEY(workspace_id,transaction_id,after_revision_id) REFERENCES transaction_revision(workspace_id,transaction_id,id),
  UNIQUE(workspace_id,id)
) STRICT;
CREATE INDEX import_batch_central_lookup ON import_batch(workspace_id,created_at DESC,id DESC);
CREATE INDEX import_source_central_lookup ON import_source(workspace_id,batch_id,id);
CREATE INDEX import_item_central_lookup ON import_item(workspace_id,batch_id,disposition);
CREATE INDEX import_effect_central_lookup ON import_effect(workspace_id,batch_id,id);
CREATE TRIGGER import_batch_identity_immutable BEFORE UPDATE ON import_batch WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'FM_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER import_source_identity_immutable BEFORE UPDATE ON import_source WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'FM_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER import_item_identity_immutable BEFORE UPDATE ON import_item WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'FM_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER import_effect_identity_immutable BEFORE UPDATE ON import_effect WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'FM_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER effect_update_immutable BEFORE UPDATE ON import_effect BEGIN SELECT RAISE(ABORT,'FM_IMPORT_EFFECT_IMMUTABLE'); END;
CREATE TRIGGER effect_delete_immutable BEFORE DELETE ON import_effect BEGIN SELECT RAISE(ABORT,'FM_IMPORT_EFFECT_IMMUTABLE'); END;
