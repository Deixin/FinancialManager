-- US-005 SYNTHETIC ONLY. All sequence/version/money values are BIGINT.
CREATE SCHEMA us005 AUTHORIZATION us005_owner;
REVOKE ALL ON SCHEMA us005 FROM PUBLIC;
CREATE TABLE us005.schema_version(version integer PRIMARY KEY, checksum text NOT NULL);
CREATE TABLE us005.workspace(id uuid PRIMARY KEY, generation uuid NOT NULL, head bigint NOT NULL DEFAULT 0 CHECK(head>=0), floor bigint NOT NULL DEFAULT 0 CHECK(floor>=0));
CREATE TABLE us005.membership(workspace_id uuid REFERENCES us005.workspace, user_id uuid, active boolean NOT NULL DEFAULT true, can_write boolean NOT NULL, PRIMARY KEY(workspace_id,user_id));
CREATE TABLE us005.device(workspace_id uuid, user_id uuid, id uuid, active boolean NOT NULL DEFAULT true, PRIMARY KEY(workspace_id,user_id,id), FOREIGN KEY(workspace_id,user_id) REFERENCES us005.membership);
CREATE TABLE us005.account_scope(workspace_id uuid, user_id uuid, account_id uuid, PRIMARY KEY(workspace_id,user_id,account_id), FOREIGN KEY(workspace_id,user_id) REFERENCES us005.membership);
CREATE TABLE us005.record(workspace_id uuid REFERENCES us005.workspace, entity_id uuid, account_id uuid NOT NULL, version bigint NOT NULL CHECK(version>0), deleted boolean NOT NULL, snapshot jsonb NOT NULL, amount_minor bigint GENERATED ALWAYS AS ((snapshot->>'amount_minor')::bigint) STORED, PRIMARY KEY(workspace_id,entity_id));
CREATE TABLE us005.revision(workspace_id uuid, entity_id uuid, account_id uuid NOT NULL, version bigint NOT NULL, deleted boolean NOT NULL, snapshot jsonb NOT NULL, changed_fields text[] NOT NULL, actor_id uuid NOT NULL, device_id uuid NOT NULL, source text NOT NULL, PRIMARY KEY(workspace_id,entity_id,version), FOREIGN KEY(workspace_id,entity_id) REFERENCES us005.record);
CREATE TABLE us005.change(workspace_id uuid, generation uuid, sequence bigint, entity_id uuid NOT NULL, account_id uuid NOT NULL, version bigint NOT NULL, deleted boolean NOT NULL, snapshot jsonb NOT NULL, PRIMARY KEY(workspace_id,generation,sequence), FOREIGN KEY(workspace_id,entity_id,version) REFERENCES us005.revision);
CREATE TABLE us005.tombstone(workspace_id uuid, generation uuid, entity_id uuid, account_id uuid NOT NULL, version bigint NOT NULL, sequence bigint NOT NULL, PRIMARY KEY(workspace_id,generation,entity_id));
CREATE TABLE us005.conflict(workspace_id uuid, id uuid, account_id uuid NOT NULL, entity_id uuid NOT NULL, base_version bigint NOT NULL, remote_version bigint NOT NULL, base_snapshot jsonb, remote_snapshot jsonb NOT NULL, local_proposal jsonb NOT NULL, state text NOT NULL CHECK(state IN ('OPEN','RESOLVED')), resolved_version bigint, PRIMARY KEY(workspace_id,id));
CREATE TABLE us005.receipt(workspace_id uuid, generation uuid, operation_id uuid, account_id uuid NOT NULL, actor_id uuid NOT NULL, device_id uuid NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(workspace_id,generation,operation_id));
ALTER TABLE us005.revision ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE us005.change ADD COLUMN committed_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE us005.conflict ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
ALTER TABLE us005.receipt ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();

CREATE FUNCTION us005.in_workspace(id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT id = nullif(current_setting('app.workspace_id',true),'')::uuid $$;
CREATE FUNCTION us005.is_member() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM us005.membership WHERE active AND user_id=nullif(current_setting('app.user_id',true),'')::uuid) $$;
CREATE FUNCTION us005.can_read(account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT us005.is_member() AND EXISTS(SELECT 1 FROM us005.account_scope WHERE account_id=account AND user_id=nullif(current_setting('app.user_id',true),'')::uuid) $$;
CREATE FUNCTION us005.can_write(account uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT us005.can_read(account) AND EXISTS(SELECT 1 FROM us005.membership WHERE active AND can_write AND user_id=nullif(current_setting('app.user_id',true),'')::uuid) $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA us005 FROM PUBLIC;
GRANT USAGE ON SCHEMA us005 TO us005_runtime;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA us005 TO us005_runtime;
GRANT SELECT ON us005.membership,us005.device,us005.account_scope TO us005_runtime;
-- Row locking needs UPDATE privilege; WITH CHECK(false) forbids actual writes.
GRANT UPDATE ON us005.membership,us005.device,us005.account_scope TO us005_runtime;
GRANT SELECT,UPDATE ON us005.workspace TO us005_runtime;
GRANT SELECT,INSERT,UPDATE ON us005.record,us005.conflict,us005.tombstone TO us005_runtime;
GRANT SELECT,INSERT ON us005.revision,us005.change,us005.receipt TO us005_runtime;

ALTER TABLE us005.workspace ENABLE ROW LEVEL SECURITY;
ALTER TABLE us005.workspace FORCE ROW LEVEL SECURITY;
CREATE POLICY context ON us005.workspace TO us005_runtime USING(us005.in_workspace(id) AND us005.is_member()) WITH CHECK(us005.in_workspace(id) AND us005.is_member());
CREATE POLICY administrator ON us005.workspace TO us005_owner USING(true) WITH CHECK(true);
ALTER TABLE us005.membership ENABLE ROW LEVEL SECURITY;
ALTER TABLE us005.membership FORCE ROW LEVEL SECURITY;
CREATE POLICY context ON us005.membership FOR SELECT TO us005_runtime USING(us005.in_workspace(workspace_id) AND user_id=nullif(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY administrator ON us005.membership TO us005_owner USING(true) WITH CHECK(true);
ALTER TABLE us005.device ENABLE ROW LEVEL SECURITY;
ALTER TABLE us005.device FORCE ROW LEVEL SECURITY;
CREATE POLICY context ON us005.device TO us005_runtime USING(us005.in_workspace(workspace_id) AND user_id=nullif(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY administrator ON us005.device TO us005_owner USING(true) WITH CHECK(true);
ALTER TABLE us005.account_scope ENABLE ROW LEVEL SECURITY;
ALTER TABLE us005.account_scope FORCE ROW LEVEL SECURITY;
CREATE POLICY context ON us005.account_scope TO us005_runtime USING(us005.in_workspace(workspace_id) AND user_id=nullif(current_setting('app.user_id',true),'')::uuid);
CREATE POLICY administrator ON us005.account_scope TO us005_owner USING(true) WITH CHECK(true);
CREATE POLICY lock_only ON us005.membership FOR UPDATE TO us005_runtime USING(us005.in_workspace(workspace_id) AND user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY lock_only ON us005.device FOR UPDATE TO us005_runtime USING(us005.in_workspace(workspace_id) AND user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(false);
CREATE POLICY lock_only ON us005.account_scope FOR UPDATE TO us005_runtime USING(us005.in_workspace(workspace_id) AND user_id=nullif(current_setting('app.user_id',true),'')::uuid) WITH CHECK(false);
DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['record','revision','change','tombstone','conflict','receipt'] LOOP
    EXECUTE format('ALTER TABLE us005.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('ALTER TABLE us005.%I FORCE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY scoped_read ON us005.%I FOR SELECT TO us005_runtime USING(us005.in_workspace(workspace_id) AND us005.can_read(account_id))',name);
    EXECUTE format('CREATE POLICY scoped_insert ON us005.%I FOR INSERT TO us005_runtime WITH CHECK(us005.in_workspace(workspace_id) AND us005.can_write(account_id))',name);
    IF name IN ('record','conflict','tombstone') THEN
      EXECUTE format('CREATE POLICY scoped_update ON us005.%I FOR UPDATE TO us005_runtime USING(us005.in_workspace(workspace_id) AND us005.can_write(account_id)) WITH CHECK(us005.in_workspace(workspace_id) AND us005.can_write(account_id))',name);
    END IF;
  END LOOP;
END $$;
