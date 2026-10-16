-- US-006 SYNTHETIC ONLY. This database has no financial transaction table.
CREATE TABLE schema_version(version INTEGER PRIMARY KEY CHECK(version=1), checksum TEXT NOT NULL);
CREATE TABLE import_batch(
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, account_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('PREPARING','REVIEW')), source_metadata TEXT
);
CREATE TABLE import_item(
  batch_id TEXT NOT NULL REFERENCES import_batch(id) ON DELETE CASCADE,
  row_no INTEGER NOT NULL CHECK(row_no>0), disposition TEXT NOT NULL,
  normalized_date TEXT, normalized_amount_minor INTEGER, body TEXT NOT NULL,
  PRIMARY KEY(batch_id,row_no)
);
