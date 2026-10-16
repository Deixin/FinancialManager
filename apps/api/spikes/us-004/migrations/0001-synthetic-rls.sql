-- US-004 synthetic-only schema. This is not the product migration US-020.
CREATE SCHEMA us004 AUTHORIZATION us004_owner;
REVOKE ALL ON SCHEMA us004 FROM PUBLIC;
GRANT USAGE ON SCHEMA us004 TO us004_runtime;

CREATE TABLE us004.schema_version (
  version integer PRIMARY KEY,
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$')
);
CREATE TABLE us004.account (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  synthetic_only boolean NOT NULL DEFAULT true CHECK (synthetic_only),
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE us004.membership (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true,
  can_write boolean NOT NULL,
  can_export boolean NOT NULL,
  scope_mode text NOT NULL CHECK (scope_mode IN ('ALL', 'SELECTED')),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE us004.account_scope (
  workspace_id uuid NOT NULL,
  user_id uuid NOT NULL,
  account_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, user_id, account_id),
  FOREIGN KEY (workspace_id, user_id) REFERENCES us004.membership(workspace_id, user_id),
  FOREIGN KEY (workspace_id, account_id) REFERENCES us004.account(workspace_id, id)
);
CREATE TABLE us004.entry (
  workspace_id uuid NOT NULL,
  id uuid NOT NULL,
  account_id uuid NOT NULL,
  amount_minor bigint NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  synthetic_only boolean NOT NULL DEFAULT true CHECK (synthetic_only),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, account_id) REFERENCES us004.account(workspace_id, id)
);

-- Fixed synthetic UUIDs and INT64 decimal literals; no real financial data.
INSERT INTO us004.account(workspace_id, id) VALUES
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000011'),
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000012'),
('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000021');
INSERT INTO us004.membership(workspace_id, user_id, can_write, can_export, scope_mode) VALUES
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000101', true, true, 'ALL'),
('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000102', true, true, 'ALL'),
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', false, false, 'SELECTED'),
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000104', true, true, 'SELECTED'),
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000105', true, true, 'ALL'),
('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000105', true, true, 'ALL');
INSERT INTO us004.account_scope(workspace_id, user_id, account_id) VALUES
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000011'),
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000011');
INSERT INTO us004.entry(workspace_id, id, account_id, amount_minor) VALUES
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000001001', '00000000-0000-4000-8000-000000000011', 9007199254740993),
('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000001002', '00000000-0000-4000-8000-000000000012', -9223372036854775808),
('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000002001', '00000000-0000-4000-8000-000000000021', 9223372036854775807);

CREATE FUNCTION us004.request_workspace() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.workspace_id', true), '')::uuid $$;
CREATE FUNCTION us004.request_user() RETURNS uuid LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;
CREATE FUNCTION us004.can_write() RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog
AS $$ SELECT EXISTS (SELECT 1 FROM us004.membership m WHERE m.workspace_id = us004.request_workspace() AND m.user_id = us004.request_user() AND m.active AND m.can_write) $$;

ALTER TABLE us004.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE us004.membership FORCE ROW LEVEL SECURITY;
ALTER TABLE us004.account_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE us004.account_scope FORCE ROW LEVEL SECURITY;
ALTER TABLE us004.account ENABLE ROW LEVEL SECURITY;
ALTER TABLE us004.account FORCE ROW LEVEL SECURITY;
ALTER TABLE us004.entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE us004.entry FORCE ROW LEVEL SECURITY;

-- The migration owner manages synthetic membership fixtures explicitly. It has
-- no financial-table policy; FORCE RLS also denies it unscoped financial reads.
CREATE POLICY fixture_membership_admin ON us004.membership TO us004_owner USING (true) WITH CHECK (true);
CREATE POLICY fixture_scope_admin ON us004.account_scope TO us004_owner USING (true) WITH CHECK (true);
CREATE POLICY own_membership ON us004.membership FOR SELECT TO us004_runtime
USING (workspace_id = us004.request_workspace() AND user_id = us004.request_user() AND active);
CREATE POLICY own_scope ON us004.account_scope FOR SELECT TO us004_runtime
USING (workspace_id = us004.request_workspace() AND user_id = us004.request_user()
  AND EXISTS (SELECT 1 FROM us004.membership m WHERE m.workspace_id = account_scope.workspace_id AND m.user_id = account_scope.user_id AND m.active));
CREATE POLICY readable_account ON us004.account FOR SELECT TO us004_runtime
USING (workspace_id = us004.request_workspace() AND EXISTS (
  SELECT 1 FROM us004.membership m WHERE m.workspace_id = account.workspace_id AND m.user_id = us004.request_user() AND m.active
  AND (m.scope_mode = 'ALL' OR EXISTS (SELECT 1 FROM us004.account_scope s WHERE s.workspace_id = account.workspace_id AND s.user_id = m.user_id AND s.account_id = account.id))
));
CREATE POLICY entry_read ON us004.entry FOR SELECT TO us004_runtime
USING (workspace_id = us004.request_workspace() AND EXISTS (SELECT 1 FROM us004.account a WHERE a.workspace_id = entry.workspace_id AND a.id = entry.account_id));
CREATE POLICY entry_insert ON us004.entry FOR INSERT TO us004_runtime
WITH CHECK (workspace_id = us004.request_workspace() AND us004.can_write() AND EXISTS (SELECT 1 FROM us004.account a WHERE a.workspace_id = entry.workspace_id AND a.id = entry.account_id));
CREATE POLICY entry_update ON us004.entry FOR UPDATE TO us004_runtime
USING (workspace_id = us004.request_workspace() AND us004.can_write() AND EXISTS (SELECT 1 FROM us004.account a WHERE a.workspace_id = entry.workspace_id AND a.id = entry.account_id))
WITH CHECK (workspace_id = us004.request_workspace() AND us004.can_write() AND EXISTS (SELECT 1 FROM us004.account a WHERE a.workspace_id = entry.workspace_id AND a.id = entry.account_id));
CREATE POLICY entry_delete ON us004.entry FOR DELETE TO us004_runtime
USING (workspace_id = us004.request_workspace() AND us004.can_write() AND EXISTS (SELECT 1 FROM us004.account a WHERE a.workspace_id = entry.workspace_id AND a.id = entry.account_id));

CREATE VIEW us004.export_entries WITH (security_invoker = true, security_barrier = true) AS
SELECT e.workspace_id, e.id, e.account_id, e.amount_minor FROM us004.entry e
WHERE EXISTS (SELECT 1 FROM us004.membership m WHERE m.workspace_id = e.workspace_id AND m.user_id = us004.request_user() AND m.active AND m.can_export);

REVOKE ALL ON ALL TABLES IN SCHEMA us004 FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA us004 FROM PUBLIC;
GRANT SELECT ON us004.membership, us004.account_scope, us004.account, us004.export_entries TO us004_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON us004.entry TO us004_runtime;
GRANT EXECUTE ON FUNCTION us004.request_workspace(), us004.request_user(), us004.can_write() TO us004_runtime;
