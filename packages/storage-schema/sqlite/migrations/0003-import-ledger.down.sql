CREATE TEMP TABLE _import_rollback_guard(n INTEGER NOT NULL CHECK(n=0)) STRICT;
INSERT INTO _import_rollback_guard VALUES((SELECT count(*) FROM import_batch)+(SELECT count(*) FROM import_source)+(SELECT count(*) FROM import_item)+(SELECT count(*) FROM import_effect));
DROP TABLE _import_rollback_guard;
DROP TABLE import_effect;
DROP TABLE import_item;
DROP TABLE import_source;
DROP TABLE import_batch;
DROP INDEX revision_import_identity;
