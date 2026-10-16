-- US-020 initial product schema. Apply transactionally as fm_schema_owner.
-- No identity, membership, import staging or runtime privileges are provisioned here.
CREATE SCHEMA fm AUTHORIZATION fm_schema_owner;
REVOKE ALL ON SCHEMA fm FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA fm REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE fm.schema_migration (
  version integer PRIMARY KEY CHECK (version = 1),
  checksum text NOT NULL CHECK (checksum ~ '^[a-f0-9]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP)
);

CREATE DOMAIN fm.resource_id AS uuid
  CHECK (VALUE <> '00000000-0000-0000-0000-000000000000'::uuid);
CREATE DOMAIN fm.technical_instant AS timestamptz
  CHECK (isfinite(VALUE) AND VALUE >= timestamptz '0001-01-01 00:00:00+00'
    AND VALUE < timestamptz '10000-01-01 00:00:00+00'
    AND date_trunc('milliseconds', VALUE) = VALUE);
CREATE DOMAIN fm.financial_day AS date
  CHECK (isfinite(VALUE) AND VALUE BETWEEN date '0001-01-01' AND date '9999-12-31');

CREATE TABLE fm.workspace (
  id fm.resource_id PRIMARY KEY,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  purpose text NOT NULL CHECK (purpose IN ('PERSONAL','BUSINESS','OTHER')),
  storage_mode text NOT NULL CHECK (storage_mode = 'CLOUD'),
  default_currency text NOT NULL CHECK (default_currency = 'BRL'),
  legal_name text,
  tax_identifier text,
  legal_nature text,
  sync_generation fm.resource_id NOT NULL,
  created_at fm.technical_instant NOT NULL DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP)
);
CREATE TABLE fm.financial_account (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  account_kind text NOT NULL CHECK (account_kind IN
    ('CHECKING','SAVINGS','DIGITAL','CASH','CREDIT_CARD','INVESTMENT_SIMPLE','LOAN_SIMPLE','OTHER')),
  balance_nature text NOT NULL CHECK (balance_nature IN ('ASSET','LIABILITY')),
  currency_code text NOT NULL CHECK (currency_code = 'BRL'),
  status text NOT NULL CHECK (status IN ('ACTIVE','ARCHIVED')),
  institution_name text,
  created_at fm.technical_instant NOT NULL DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP),
  UNIQUE (workspace_id,id),
  CHECK (account_kind <> 'CREDIT_CARD' OR balance_nature = 'LIABILITY')
);
CREATE TABLE fm.balance_reference (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  account_id fm.resource_id NOT NULL,
  amount_minor bigint NOT NULL,
  reference_date fm.financial_day NOT NULL,
  day_position text NOT NULL CHECK (day_position IN ('START_OF_DAY','END_OF_DAY')),
  source text NOT NULL CHECK (source IN ('MANUAL','STATEMENT','IMPORT')),
  status text NOT NULL CHECK (status IN ('ACTIVE','SUPERSEDED')),
  created_at fm.technical_instant NOT NULL DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (workspace_id,account_id) REFERENCES fm.financial_account(workspace_id,id)
);
CREATE UNIQUE INDEX balance_reference_active_point ON fm.balance_reference
  (workspace_id,account_id,reference_date,day_position) WHERE status = 'ACTIVE';
CREATE TABLE fm.transaction_group (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  group_type text NOT NULL CHECK (group_type IN ('TRANSFER','CARD_PAYMENT','OTHER_COMPOSITE')),
  state text NOT NULL CHECK (state IN ('ACTIVE','BROKEN','VOIDED')),
  created_at fm.technical_instant NOT NULL DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP),
  UNIQUE (workspace_id,id)
);
CREATE TABLE fm.counterparty (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  identifier_type text,
  identifier_value text,
  relationship_hint text,
  status text NOT NULL CHECK (status IN ('ACTIVE','ARCHIVED')),
  UNIQUE (workspace_id,id)
);
CREATE TABLE fm.category (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  normalized_name text GENERATED ALWAYS AS
    (lower(btrim(regexp_replace(normalize(name, NFKC), '[[:space:]]+', ' ', 'g')))) STORED,
  category_scope text NOT NULL CHECK (category_scope IN ('EXPENSE','INCOME','BOTH')),
  sort_order integer NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','ARCHIVED')),
  is_seeded boolean NOT NULL,
  UNIQUE (workspace_id,id)
);
CREATE UNIQUE INDEX category_active_name ON fm.category(workspace_id,normalized_name) WHERE status = 'ACTIVE';
CREATE TABLE fm.subcategory (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  category_id fm.resource_id NOT NULL,
  name text NOT NULL CHECK (btrim(name) <> ''),
  sort_order integer NOT NULL,
  status text NOT NULL CHECK (status IN ('ACTIVE','ARCHIVED')),
  UNIQUE (workspace_id,id),
  UNIQUE (workspace_id,category_id,id),
  FOREIGN KEY (workspace_id,category_id) REFERENCES fm.category(workspace_id,id)
);
CREATE TABLE fm.tag (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  name text NOT NULL CHECK (btrim(name) <> ''),
  normalized_name text GENERATED ALWAYS AS
    (lower(btrim(regexp_replace(normalize(name, NFKC), '[[:space:]]+', ' ', 'g')))) STORED,
  status text NOT NULL CHECK (status IN ('ACTIVE','ARCHIVED')),
  UNIQUE (workspace_id,id)
);
CREATE UNIQUE INDEX tag_active_name ON fm.tag(workspace_id,normalized_name) WHERE status = 'ACTIVE';
CREATE TABLE fm.financial_transaction (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  account_id fm.resource_id NOT NULL,
  group_id fm.resource_id,
  counterparty_id fm.resource_id,
  financial_date fm.financial_day NOT NULL,
  account_amount_minor bigint NOT NULL,
  economic_kind text NOT NULL CHECK (economic_kind IN
    ('INCOME','EXPENSE','EXPENSE_REVERSAL','TRANSFER','DEBT_SETTLEMENT','ADJUSTMENT','OTHER')),
  original_description text,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  origin_kind text NOT NULL CHECK (origin_kind IN ('MANUAL','IMPORT','DOCUMENT','SYSTEM')),
  version bigint NOT NULL CHECK (version > 0),
  deleted_at fm.technical_instant,
  created_at fm.technical_instant NOT NULL DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP),
  updated_at fm.technical_instant NOT NULL DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (workspace_id,account_id) REFERENCES fm.financial_account(workspace_id,id),
  FOREIGN KEY (workspace_id,group_id) REFERENCES fm.transaction_group(workspace_id,id),
  FOREIGN KEY (workspace_id,counterparty_id) REFERENCES fm.counterparty(workspace_id,id),
  CHECK (updated_at >= created_at),
  CHECK (deleted_at IS NULL OR deleted_at >= created_at)
);
CREATE INDEX transaction_workspace_date ON fm.financial_transaction(workspace_id,financial_date DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX transaction_account_date ON fm.financial_transaction(workspace_id,account_id,financial_date DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX transaction_group_lookup ON fm.financial_transaction(workspace_id,group_id) WHERE group_id IS NOT NULL;
CREATE TABLE fm.transaction_allocation (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  transaction_id fm.resource_id NOT NULL,
  category_id fm.resource_id NOT NULL,
  subcategory_id fm.resource_id,
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  note text,
  UNIQUE (workspace_id,id),
  FOREIGN KEY (workspace_id,transaction_id) REFERENCES fm.financial_transaction(workspace_id,id),
  FOREIGN KEY (workspace_id,category_id) REFERENCES fm.category(workspace_id,id),
  FOREIGN KEY (workspace_id,category_id,subcategory_id) REFERENCES fm.subcategory(workspace_id,category_id,id)
);
CREATE INDEX allocation_transaction ON fm.transaction_allocation(workspace_id,transaction_id);
CREATE INDEX allocation_category ON fm.transaction_allocation(workspace_id,category_id,transaction_id);
CREATE TABLE fm.transaction_tag (
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  transaction_id fm.resource_id NOT NULL,
  tag_id fm.resource_id NOT NULL,
  PRIMARY KEY (workspace_id,transaction_id,tag_id),
  FOREIGN KEY (workspace_id,transaction_id) REFERENCES fm.financial_transaction(workspace_id,id),
  FOREIGN KEY (workspace_id,tag_id) REFERENCES fm.tag(workspace_id,id)
);
CREATE TABLE fm.transaction_revision (
  id fm.resource_id PRIMARY KEY,
  workspace_id fm.resource_id NOT NULL REFERENCES fm.workspace(id),
  transaction_id fm.resource_id NOT NULL,
  version bigint NOT NULL CHECK (version > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  actor_type text NOT NULL CHECK (actor_type IN ('LOCAL_USER','MEMBER','SYSTEM','SUPPORT')),
  actor_id text,
  device_id fm.resource_id,
  change_source text NOT NULL CHECK (change_source IN ('MANUAL','IMPORT','SYNC_RESOLUTION','REVERSAL','MIGRATION','SYSTEM')),
  created_at fm.technical_instant NOT NULL DEFAULT date_trunc('milliseconds', CURRENT_TIMESTAMP),
  UNIQUE (workspace_id,id),
  UNIQUE (workspace_id,transaction_id,version),
  FOREIGN KEY (workspace_id,transaction_id) REFERENCES fm.financial_transaction(workspace_id,id)
);

CREATE FUNCTION fm.reject_revision_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FM_REVISION_IMMUTABLE';
END $$;
CREATE TRIGGER revision_immutable BEFORE UPDATE OR DELETE ON fm.transaction_revision
  FOR EACH ROW EXECUTE FUNCTION fm.reject_revision_mutation();

CREATE FUNCTION fm.reject_identity_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF (to_jsonb(NEW)->'id') IS DISTINCT FROM (to_jsonb(OLD)->'id')
    OR (to_jsonb(NEW)->'workspace_id') IS DISTINCT FROM (to_jsonb(OLD)->'workspace_id') THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FM_IDENTITY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;

-- Serialize allocation changes on the same parent, including moving a split.
CREATE FUNCTION fm.lock_allocation_parents() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM id FROM fm.financial_transaction
    WHERE (workspace_id,id) IN
      ((NEW.workspace_id,NEW.transaction_id),(OLD.workspace_id,OLD.transaction_id))
    ORDER BY id FOR UPDATE;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER allocation_parent_lock BEFORE INSERT OR UPDATE OR DELETE ON fm.transaction_allocation
  FOR EACH ROW EXECUTE FUNCTION fm.lock_allocation_parents();
CREATE FUNCTION fm.check_allocation_total(workspace uuid, movement uuid) RETURNS void
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE total numeric; expected numeric; count_parts bigint;
BEGIN
  SELECT abs(account_amount_minor::numeric) INTO expected FROM fm.financial_transaction
    WHERE workspace_id = workspace AND id = movement;
  SELECT count(*),sum(amount_minor) INTO count_parts,total FROM fm.transaction_allocation
    WHERE workspace_id = workspace AND transaction_id = movement;
  -- Zero splits means explicitly unclassified. Once classified, splits are complete.
  IF count_parts > 0 AND (expected IS NULL OR total <> expected) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'FM_ALLOCATION_TOTAL_INVALID';
  END IF;
END $$;
CREATE FUNCTION fm.validate_allocation_total() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_TABLE_NAME = 'financial_transaction' THEN
    PERFORM fm.check_allocation_total(NEW.workspace_id,NEW.id);
  ELSE
    IF TG_OP <> 'DELETE' THEN PERFORM fm.check_allocation_total(NEW.workspace_id,NEW.transaction_id); END IF;
    IF TG_OP <> 'INSERT' THEN PERFORM fm.check_allocation_total(OLD.workspace_id,OLD.transaction_id); END IF;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER allocation_total AFTER INSERT OR UPDATE OR DELETE ON fm.transaction_allocation
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fm.validate_allocation_total();
CREATE CONSTRAINT TRIGGER transaction_allocation_total AFTER INSERT OR UPDATE ON fm.financial_transaction
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fm.validate_allocation_total();

-- A restrictive boundary never grants access. A future authorization migration
-- must add explicit permissive policies; absent those policies, all access is denied.
DO $$
DECLARE relation text; key text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['workspace','financial_account','balance_reference',
    'transaction_group','counterparty','category','subcategory','tag','financial_transaction',
    'transaction_allocation','transaction_tag','transaction_revision'] LOOP
    key := CASE WHEN relation = 'workspace' THEN 'id' ELSE 'workspace_id' END;
    EXECUTE format('ALTER TABLE fm.%I ENABLE ROW LEVEL SECURITY',relation);
    EXECUTE format('ALTER TABLE fm.%I FORCE ROW LEVEL SECURITY',relation);
    EXECUTE format('CREATE POLICY workspace_boundary ON fm.%I AS RESTRICTIVE USING
      (%I = nullif(current_setting(''app.workspace_id'',true),'''')::uuid)
      WITH CHECK (%I = nullif(current_setting(''app.workspace_id'',true),'''')::uuid)',relation,key,key);
    IF relation NOT IN ('transaction_revision','transaction_tag') THEN
      EXECUTE format('CREATE TRIGGER identity_immutable BEFORE UPDATE ON fm.%I
        FOR EACH ROW EXECUTE FUNCTION fm.reject_identity_mutation()',relation);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA fm FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA fm FROM PUBLIC;
