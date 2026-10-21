-- US-050 opt-in import ledger. No original files; runtime access remains denied without explicit authorization.
CREATE UNIQUE INDEX revision_import_identity ON fm.transaction_revision(workspace_id,transaction_id,id);
CREATE TABLE fm.import_batch(
  id fm.resource_id NOT NULL PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  target_account_id fm.resource_id,
  batch_kind TEXT NOT NULL CHECK(batch_kind IN ('IMPORT','REVERSAL')),
  status TEXT NOT NULL CHECK(status IN ('PREPARING','REVIEW','CONFIRMING','COMMITTED','FAILED','REVERSED','PARTIALLY_REVERSED')),
  reverses_batch_id fm.resource_id,
  created_by_member_id fm.resource_id,
  created_at fm.technical_instant NOT NULL,
  committed_at fm.technical_instant,
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  failure_code TEXT CHECK(failure_code IS NULL OR (length(failure_code) BETWEEN 1 AND 64 AND failure_code ~ '^[A-Z][A-Z0-9_]*$')),
  CHECK((batch_kind='IMPORT' AND reverses_batch_id IS NULL) OR (batch_kind='REVERSAL' AND reverses_batch_id IS NOT NULL AND reverses_batch_id<>id)),
  CHECK((status IN ('COMMITTED','REVERSED','PARTIALLY_REVERSED')) = (committed_at IS NOT NULL)),
  CHECK(committed_at IS NULL OR committed_at>=created_at),
  CHECK((status='FAILED') = (failure_code IS NOT NULL)),
  FOREIGN KEY(workspace_id,target_account_id) REFERENCES fm.financial_account(workspace_id,id),
  FOREIGN KEY(workspace_id,reverses_batch_id) REFERENCES fm.import_batch(workspace_id,id),
  UNIQUE(workspace_id,id)
);
CREATE TABLE fm.import_source(
  id fm.resource_id NOT NULL PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  batch_id fm.resource_id NOT NULL,
  file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
  file_hash TEXT NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$'),
  format TEXT NOT NULL CHECK(length(format) BETWEEN 1 AND 32),
  parser_name TEXT CHECK(parser_name IS NULL OR length(parser_name) BETWEEN 1 AND 120),
  parser_version TEXT CHECK(parser_version IS NULL OR length(parser_version) BETWEEN 1 AND 40),
  detected_currency TEXT CHECK(detected_currency IS NULL OR length(detected_currency)=3),
  period_start fm.financial_day,
  period_end fm.financial_day,
  imported_at fm.technical_instant NOT NULL,
  CHECK((parser_name IS NULL) = (parser_version IS NULL)),
  CHECK(period_start IS NULL OR period_end IS NULL OR period_start<=period_end),
  UNIQUE(workspace_id,batch_id,id),
  FOREIGN KEY(workspace_id,batch_id) REFERENCES fm.import_batch(workspace_id,id),
  UNIQUE(workspace_id,id)
);
CREATE TABLE fm.import_item(
  id fm.resource_id NOT NULL PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  batch_id fm.resource_id NOT NULL,
  source_id fm.resource_id,
  row_no bigint CHECK(row_no IS NULL OR row_no BETWEEN 1 AND 200000),
  source_external_id TEXT CHECK(source_external_id IS NULL OR length(source_external_id)<=256),
  normalized_date fm.financial_day,
  normalized_amount_minor bigint,
  original_description TEXT CHECK(original_description IS NULL OR length(original_description)<=20000),
  proposed_name TEXT CHECK(proposed_name IS NULL OR length(proposed_name) BETWEEN 1 AND 120),
  disposition TEXT NOT NULL CHECK(disposition IN ('NEW','DUPLICATE','POSSIBLE_DUPLICATE','UPDATE','INVALID','SKIPPED','COMMITTED')),
  validation_errors jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(validation_errors)='array' AND octet_length(validation_errors::text)<=16384),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=16384),
  version bigint NOT NULL DEFAULT 1 CHECK(version>0),
  UNIQUE(workspace_id,batch_id,id),
  CHECK(disposition IN ('INVALID','SKIPPED') OR (normalized_date IS NOT NULL AND normalized_amount_minor IS NOT NULL)),
  FOREIGN KEY(workspace_id,batch_id) REFERENCES fm.import_batch(workspace_id,id),
  FOREIGN KEY(workspace_id,batch_id,source_id) REFERENCES fm.import_source(workspace_id,batch_id,id),
  UNIQUE(workspace_id,id)
);
CREATE TABLE fm.import_effect(
  id fm.resource_id NOT NULL PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  batch_id fm.resource_id NOT NULL,
  import_item_id fm.resource_id NOT NULL,
  transaction_id fm.resource_id NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('CREATE','UPDATE','LINK','UNLINK','RESTORE','DELETE')),
  before_revision_id fm.resource_id,
  after_revision_id fm.resource_id,
  created_at fm.technical_instant NOT NULL,
  CHECK(action<>'CREATE' OR (before_revision_id IS NULL AND after_revision_id IS NOT NULL)),
  CHECK(action NOT IN ('UPDATE','RESTORE','DELETE') OR (before_revision_id IS NOT NULL AND after_revision_id IS NOT NULL AND before_revision_id<>after_revision_id)),
  FOREIGN KEY(workspace_id,batch_id) REFERENCES fm.import_batch(workspace_id,id),
  FOREIGN KEY(workspace_id,batch_id,import_item_id) REFERENCES fm.import_item(workspace_id,batch_id,id),
  FOREIGN KEY(workspace_id,transaction_id) REFERENCES fm.financial_transaction(workspace_id,id),
  FOREIGN KEY(workspace_id,transaction_id,before_revision_id) REFERENCES fm.transaction_revision(workspace_id,transaction_id,id),
  FOREIGN KEY(workspace_id,transaction_id,after_revision_id) REFERENCES fm.transaction_revision(workspace_id,transaction_id,id),
  UNIQUE(workspace_id,id)
);
CREATE INDEX import_batch_central_lookup ON fm.import_batch(workspace_id,created_at DESC,id DESC);
CREATE INDEX import_source_central_lookup ON fm.import_source(workspace_id,batch_id,id);
CREATE INDEX import_item_central_lookup ON fm.import_item(workspace_id,batch_id,disposition);
CREATE INDEX import_effect_central_lookup ON fm.import_effect(workspace_id,batch_id,id);
CREATE FUNCTION fm.reject_import_effect_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FM_IMPORT_EFFECT_IMMUTABLE'; END $$;
CREATE TRIGGER effect_immutable BEFORE UPDATE OR DELETE ON fm.import_effect FOR EACH ROW EXECUTE FUNCTION fm.reject_import_effect_mutation();
ALTER TABLE fm.import_batch ENABLE ROW LEVEL SECURITY;
ALTER TABLE fm.import_batch FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_boundary ON fm.import_batch AS RESTRICTIVE USING(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid);
CREATE TRIGGER identity_immutable BEFORE UPDATE ON fm.import_batch FOR EACH ROW EXECUTE FUNCTION fm.reject_identity_mutation();
REVOKE ALL ON fm.import_batch FROM PUBLIC;
ALTER TABLE fm.import_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE fm.import_source FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_boundary ON fm.import_source AS RESTRICTIVE USING(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid);
CREATE TRIGGER identity_immutable BEFORE UPDATE ON fm.import_source FOR EACH ROW EXECUTE FUNCTION fm.reject_identity_mutation();
REVOKE ALL ON fm.import_source FROM PUBLIC;
ALTER TABLE fm.import_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE fm.import_item FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_boundary ON fm.import_item AS RESTRICTIVE USING(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid);
CREATE TRIGGER identity_immutable BEFORE UPDATE ON fm.import_item FOR EACH ROW EXECUTE FUNCTION fm.reject_identity_mutation();
REVOKE ALL ON fm.import_item FROM PUBLIC;
ALTER TABLE fm.import_effect ENABLE ROW LEVEL SECURITY;
ALTER TABLE fm.import_effect FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_boundary ON fm.import_effect AS RESTRICTIVE USING(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid);
CREATE TRIGGER identity_immutable BEFORE UPDATE ON fm.import_effect FOR EACH ROW EXECUTE FUNCTION fm.reject_identity_mutation();
REVOKE ALL ON fm.import_effect FROM PUBLIC;
REVOKE ALL ON FUNCTION fm.reject_import_effect_mutation() FROM PUBLIC;
