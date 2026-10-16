-- Derived lookup only; no financial rows are rewritten.
ALTER TABLE _schema_migration RENAME TO _schema_migration_v1;
CREATE TABLE _schema_migration(version INTEGER PRIMARY KEY CHECK(version>0),checksum TEXT NOT NULL CHECK(length(checksum)=64 AND checksum NOT GLOB '*[^a-f0-9]*')) STRICT;
INSERT INTO _schema_migration SELECT version,checksum FROM _schema_migration_v1;
DROP TABLE _schema_migration_v1;
CREATE INDEX balance_reference_lookup ON balance_reference(workspace_id,account_id,reference_date DESC,id DESC);
