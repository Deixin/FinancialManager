-- US-014 synthetic infrastructure only. Not a product financial schema.
DO $$
BEGIN
  EXECUTE format('CREATE ROLE fm_identity LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    trim(pg_read_file('/run/secrets/identity-password')));
  EXECUTE format('CREATE ROLE fm_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L',
    trim(pg_read_file('/run/secrets/runtime-password')));
END;
$$;
CREATE DATABASE fm_identity OWNER fm_identity;
REVOKE ALL ON DATABASE fm_identity FROM PUBLIC;
GRANT CONNECT ON DATABASE fm_identity TO fm_identity;
REVOKE ALL ON DATABASE fm_app FROM PUBLIC;
GRANT CONNECT ON DATABASE fm_app TO fm_runtime;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA environment_probe AUTHORIZATION fm_bootstrap;
CREATE TABLE environment_probe.instance (
  singleton BOOLEAN PRIMARY KEY CHECK(singleton),
  profile TEXT NOT NULL CHECK(profile IN ('local','ci','integration','staging')),
  owner UUID NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version = 1)
);
INSERT INTO environment_probe.instance(singleton,profile,owner,schema_version)
SELECT true, configuration->>'profile', (configuration->>'owner')::uuid, 1
FROM (SELECT pg_read_file('/run/config/profile.json')::jsonb AS configuration) AS input;
GRANT USAGE ON SCHEMA environment_probe TO fm_runtime;
GRANT SELECT ON environment_probe.instance TO fm_runtime;
