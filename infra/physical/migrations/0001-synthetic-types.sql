-- SYNTHETIC ONLY; no production migration or financial schema is created.
CREATE TABLE schema_version(version INTEGER PRIMARY KEY CHECK(version=1), checksum TEXT NOT NULL) STRICT;
CREATE TABLE sample(
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL COLLATE BINARY,
  occurred_on TEXT NOT NULL CHECK(
    length(occurred_on)=10 AND occurred_on>='0001-01-01'
    AND date(occurred_on) IS NOT NULL AND date(occurred_on)=occurred_on
  ),
  recorded_at TEXT NOT NULL COLLATE BINARY CHECK(
    length(recorded_at)=24 AND recorded_at>='0001-01-01'
    AND substr(recorded_at,12,2) BETWEEN '00' AND '23'
    AND strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at) IS NOT NULL
    AND strftime('%Y-%m-%dT%H:%M:%fZ',recorded_at)=recorded_at
  ),
  exact_value TEXT NOT NULL,
  PRIMARY KEY(workspace_id,id),
  CHECK(
    length(id)=36 AND length(replace(id,'-',''))=32
    AND substr(id,9,1)='-' AND substr(id,14,1)='-'
    AND substr(id,19,1)='-' AND substr(id,24,1)='-'
    AND id NOT GLOB '*[^0-9a-f-]*'
    AND substr(id,15,1) GLOB '[1-8]' AND substr(id,20,1) GLOB '[89ab]'
  ),
  CHECK(
    length(workspace_id)=36 AND length(replace(workspace_id,'-',''))=32
    AND substr(workspace_id,9,1)='-' AND substr(workspace_id,14,1)='-'
    AND substr(workspace_id,19,1)='-' AND substr(workspace_id,24,1)='-'
    AND workspace_id NOT GLOB '*[^0-9a-f-]*'
    AND substr(workspace_id,15,1) GLOB '[1-8]' AND substr(workspace_id,20,1) GLOB '[89ab]'
  )
) STRICT;
CREATE TABLE sample_link(
  workspace_id TEXT NOT NULL, target_id TEXT NOT NULL,
  PRIMARY KEY(workspace_id,target_id),
  FOREIGN KEY(workspace_id,target_id) REFERENCES sample(workspace_id,id)
) STRICT;
