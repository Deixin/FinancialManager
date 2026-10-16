-- Derived lookup only; no financial rows are rewritten.
ALTER TABLE fm.schema_migration DROP CONSTRAINT schema_migration_version_check;
ALTER TABLE fm.schema_migration ADD CONSTRAINT schema_migration_version_check CHECK(version>0);
CREATE INDEX balance_reference_lookup ON fm.balance_reference(workspace_id,account_id,reference_date DESC,id DESC);
