// Source of the portable SQLite migration. No native UDFs/extensions required.
const uuid = (name) =>
  `length(${name})=36 AND ${name}=lower(${name}) AND substr(${name},9,1)='-' AND substr(${name},14,1)='-' AND substr(${name},19,1)='-' AND substr(${name},24,1)='-' AND length(replace(${name},'-',''))=32 AND replace(${name},'-','') NOT GLOB '*[^0-9a-f]*' AND ${name}<>'00000000-0000-0000-0000-000000000000'`;
const identifier = (name, optional = false) =>
  `${name} TEXT ${optional ? '' : 'NOT NULL'} CHECK (${optional ? name + ' IS NULL OR ' : ''}(${uuid(name)}))`;
const dayCheck = (name) =>
  `length(${name})=10 AND ${name} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND ${name} BETWEEN '0001-01-01' AND '9999-12-31' AND date(${name},'+0 days')=${name}`;
const day = (name) =>
  `${name} TEXT NOT NULL CHECK(coalesce((${dayCheck(name)}),0))`;
const instant = (name, optional = false) =>
  `${name} TEXT ${optional ? '' : "NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))"} CHECK (${optional ? name + ' IS NULL OR ' : ''}coalesce((length(${name})=24 AND ${dayCheck('substr(' + name + ',1,10)')} AND strftime('%Y-%m-%dT%H:%M:%fZ',${name})=${name} AND substr(${name},12,2) BETWEEN '00' AND '23' AND substr(${name},15,2) BETWEEN '00' AND '59' AND substr(${name},18,2) BETWEEN '00' AND '59'),0))`;
const text = (name) => `${name} TEXT NOT NULL CHECK(trim(${name})<>'')`;
const enumeration = (name, values) =>
  `${name} TEXT NOT NULL CHECK(${name} IN (${values
    .split(' ')
    .map((v) => "'" + v + "'")
    .join(',')}))`;
const identity = () => [
  identifier('id') + ' PRIMARY KEY',
  identifier('workspace_id') + ' REFERENCES workspace(id)',
];
const foreign = (key, table, columns = 'id') =>
  `FOREIGN KEY(workspace_id,${key}) REFERENCES ${table}(workspace_id,${columns})`;
const unique = 'UNIQUE(workspace_id,id)';
const active = () => enumeration('status', 'ACTIVE ARCHIVED');
const entities = [
  [
    'workspace',
    [
      identifier('id') + ' PRIMARY KEY',
      text('display_name'),
      enumeration('purpose', 'PERSONAL BUSINESS OTHER'),
      enumeration('storage_mode', 'LOCAL CLOUD'),
      "default_currency TEXT NOT NULL CHECK(default_currency='BRL')",
      'legal_name TEXT',
      'tax_identifier TEXT',
      'legal_nature TEXT',
      identifier('sync_generation'),
      instant('created_at'),
    ],
  ],
  [
    'financial_account',
    [
      ...identity(),
      text('name'),
      enumeration(
        'account_kind',
        'CHECKING SAVINGS DIGITAL CASH CREDIT_CARD INVESTMENT_SIMPLE LOAN_SIMPLE OTHER',
      ),
      enumeration('balance_nature', 'ASSET LIABILITY'),
      "currency_code TEXT NOT NULL CHECK(currency_code='BRL')",
      active(),
      'institution_name TEXT',
      instant('created_at'),
      unique,
      "CHECK(account_kind<>'CREDIT_CARD' OR balance_nature='LIABILITY')",
    ],
  ],
  [
    'balance_reference',
    [
      ...identity(),
      identifier('account_id'),
      'amount_minor INTEGER NOT NULL',
      day('reference_date'),
      enumeration('day_position', 'START_OF_DAY END_OF_DAY'),
      enumeration('source', 'MANUAL STATEMENT IMPORT'),
      enumeration('status', 'ACTIVE SUPERSEDED'),
      instant('created_at'),
      unique,
      foreign('account_id', 'financial_account'),
    ],
  ],
  [
    'transaction_group',
    [
      ...identity(),
      enumeration('group_type', 'TRANSFER CARD_PAYMENT OTHER_COMPOSITE'),
      enumeration('state', 'ACTIVE BROKEN VOIDED'),
      instant('created_at'),
      unique,
    ],
  ],
  [
    'counterparty',
    [
      ...identity(),
      text('display_name'),
      'identifier_type TEXT',
      'identifier_value TEXT',
      'relationship_hint TEXT',
      active(),
      unique,
    ],
  ],
  [
    'category',
    [
      ...identity(),
      text('name'),
      text('normalized_name'),
      enumeration('category_scope', 'EXPENSE INCOME BOTH'),
      'sort_order INTEGER NOT NULL',
      active(),
      'is_seeded INTEGER NOT NULL CHECK(is_seeded IN(0,1))',
      unique,
    ],
  ],
  [
    'subcategory',
    [
      ...identity(),
      identifier('category_id'),
      text('name'),
      'sort_order INTEGER NOT NULL',
      active(),
      unique,
      'UNIQUE(workspace_id,category_id,id)',
      foreign('category_id', 'category'),
    ],
  ],
  [
    'tag',
    [...identity(), text('name'), text('normalized_name'), active(), unique],
  ],
  [
    'financial_transaction',
    [
      ...identity(),
      identifier('account_id'),
      identifier('group_id', true),
      identifier('counterparty_id', true),
      day('financial_date'),
      'account_amount_minor INTEGER NOT NULL',
      enumeration(
        'economic_kind',
        'INCOME EXPENSE EXPENSE_REVERSAL TRANSFER DEBT_SETTLEMENT ADJUSTMENT OTHER',
      ),
      'original_description TEXT',
      text('display_name'),
      enumeration('origin_kind', 'MANUAL IMPORT DOCUMENT SYSTEM'),
      'version INTEGER NOT NULL CHECK(version>0)',
      instant('deleted_at', true),
      instant('created_at'),
      instant('updated_at'),
      unique,
      foreign('account_id', 'financial_account'),
      foreign('group_id', 'transaction_group'),
      foreign('counterparty_id', 'counterparty'),
      'CHECK(updated_at>=created_at)',
      'CHECK(deleted_at IS NULL OR deleted_at>=created_at)',
      `FOREIGN KEY(workspace_id,id) REFERENCES _allocation_commit_guard(workspace_id,transaction_id) DEFERRABLE INITIALLY DEFERRED`,
    ],
  ],
  [
    'transaction_allocation',
    [
      ...identity(),
      identifier('transaction_id'),
      identifier('category_id'),
      identifier('subcategory_id', true),
      'amount_minor INTEGER NOT NULL CHECK(amount_minor>0)',
      'note TEXT',
      unique,
      foreign('transaction_id', 'financial_transaction'),
      foreign('category_id', 'category'),
      foreign('category_id,subcategory_id', 'subcategory', 'category_id,id'),
    ],
  ],
  [
    'transaction_tag',
    [
      identifier('workspace_id') + ' REFERENCES workspace(id)',
      identifier('transaction_id'),
      identifier('tag_id'),
      'PRIMARY KEY(workspace_id,transaction_id,tag_id)',
      foreign('transaction_id', 'financial_transaction'),
      foreign('tag_id', 'tag'),
    ],
  ],
  [
    'transaction_revision',
    [
      ...identity(),
      identifier('transaction_id'),
      'version INTEGER NOT NULL CHECK(version>0)',
      "snapshot TEXT NOT NULL CHECK(CASE WHEN json_valid(snapshot) THEN json_type(snapshot)='object' ELSE 0 END)",
      enumeration('actor_type', 'LOCAL_USER MEMBER SYSTEM SUPPORT'),
      'actor_id TEXT',
      identifier('device_id', true),
      enumeration(
        'change_source',
        'MANUAL IMPORT SYNC_RESOLUTION REVERSAL MIGRATION SYSTEM',
      ),
      instant('created_at'),
      unique,
      'UNIQUE(workspace_id,transaction_id,version)',
      foreign('transaction_id', 'financial_transaction'),
    ],
  ],
];
export const businessTables = Object.freeze(entities.map(([name]) => name));
const guardUpdate = (alias) =>
  `UPDATE _allocation_commit_guard SET valid=(SELECT valid FROM _allocation_status WHERE workspace_id=${alias}.workspace_id AND transaction_id=${alias}.transaction_id) WHERE workspace_id=${alias}.workspace_id AND transaction_id=${alias}.transaction_id;`;
export function sqliteSql() {
  let sql = `-- Generated from infra/schema/sqlite-model.mjs. US-021. No network or native UDFs.\nCREATE TABLE _schema_migration(version INTEGER PRIMARY KEY CHECK(version=1),checksum TEXT NOT NULL CHECK(length(checksum)=64 AND checksum NOT GLOB '*[^a-f0-9]*')) STRICT;\n`;
  for (const [name, columns] of entities)
    sql += `CREATE TABLE ${name}(\n  ${columns.join(',\n  ')}\n) STRICT;\n`;
  sql += `CREATE TABLE _allocation_valid_anchor(valid INTEGER PRIMARY KEY CHECK(valid=1)) STRICT;
INSERT INTO _allocation_valid_anchor VALUES(1);
CREATE TABLE _allocation_commit_guard(
  workspace_id TEXT NOT NULL,transaction_id TEXT NOT NULL,valid INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,transaction_id),
  FOREIGN KEY(workspace_id,transaction_id) REFERENCES financial_transaction(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(valid) REFERENCES _allocation_valid_anchor(valid) DEFERRABLE INITIALLY DEFERRED
) STRICT;
-- Exact positive accumulation in base 2^32, saturating above 2^63.
-- Each addition stays within INTEGER, even for invalid totals and INT64_MIN.
CREATE VIEW _allocation_status AS SELECT t.workspace_id,t.id AS transaction_id,
  coalesce((WITH RECURSIVE
    parts AS (SELECT row_number() OVER(ORDER BY id) AS n,
      amount_minor/4294967296 AS hi,amount_minor%4294967296 AS lo
      FROM transaction_allocation WHERE workspace_id=t.workspace_id AND transaction_id=t.id),
    sums(n,hi,lo) AS (SELECT 0,0,0 UNION ALL
      SELECT p.n,min(2147483649,s.hi+p.hi+(s.lo+p.lo)/4294967296),(s.lo+p.lo)%4294967296
      FROM sums s JOIN parts p ON p.n=s.n+1)
    SELECT hi=CASE WHEN t.account_amount_minor<0 THEN -(t.account_amount_minor/4294967296) ELSE t.account_amount_minor/4294967296 END
      AND lo=CASE WHEN t.account_amount_minor<0 THEN -(t.account_amount_minor%4294967296) ELSE t.account_amount_minor%4294967296 END
    FROM sums WHERE n>0 ORDER BY n DESC LIMIT 1),1) AS valid
  FROM financial_transaction t;
CREATE TRIGGER guard_insert_checked BEFORE INSERT ON _allocation_commit_guard BEGIN
  SELECT CASE WHEN NEW.valid<>coalesce((SELECT valid FROM _allocation_status WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.transaction_id),-1)
    THEN RAISE(ABORT,'ALLOCATION_GUARD_INVALID') END;
END;
CREATE TRIGGER guard_update_checked BEFORE UPDATE ON _allocation_commit_guard BEGIN
  SELECT CASE WHEN NEW.workspace_id<>OLD.workspace_id OR NEW.transaction_id<>OLD.transaction_id
    OR NEW.valid<>coalesce((SELECT valid FROM _allocation_status WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.transaction_id),-1)
    THEN RAISE(ABORT,'ALLOCATION_GUARD_INVALID') END;
END;
CREATE TRIGGER transaction_guard_insert AFTER INSERT ON financial_transaction BEGIN
  INSERT INTO _allocation_commit_guard VALUES(NEW.workspace_id,NEW.id,1);
END;
CREATE TRIGGER transaction_guard_update AFTER UPDATE OF account_amount_minor ON financial_transaction BEGIN
  UPDATE _allocation_commit_guard SET valid=(SELECT valid FROM _allocation_status WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.id)
    WHERE workspace_id=NEW.workspace_id AND transaction_id=NEW.id;
END;
CREATE TRIGGER allocation_guard_insert AFTER INSERT ON transaction_allocation BEGIN ${guardUpdate('NEW')} END;
CREATE TRIGGER allocation_guard_delete AFTER DELETE ON transaction_allocation BEGIN ${guardUpdate('OLD')} END;
CREATE TRIGGER allocation_guard_update AFTER UPDATE ON transaction_allocation BEGIN ${guardUpdate('OLD')} ${guardUpdate('NEW')} END;
CREATE TRIGGER revision_immutable_update BEFORE UPDATE ON transaction_revision BEGIN SELECT RAISE(ABORT,'REVISION_IMMUTABLE'); END;
CREATE TRIGGER revision_immutable_delete BEFORE DELETE ON transaction_revision BEGIN SELECT RAISE(ABORT,'REVISION_IMMUTABLE'); END;
CREATE UNIQUE INDEX category_active_name ON category(workspace_id,normalized_name) WHERE status='ACTIVE';
CREATE UNIQUE INDEX tag_active_name ON tag(workspace_id,normalized_name) WHERE status='ACTIVE';
CREATE UNIQUE INDEX balance_reference_active_point ON balance_reference(workspace_id,account_id,reference_date,day_position) WHERE status='ACTIVE';
CREATE INDEX transaction_workspace_date ON financial_transaction(workspace_id,financial_date DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX transaction_account_date ON financial_transaction(workspace_id,account_id,financial_date DESC,id DESC) WHERE deleted_at IS NULL;
CREATE INDEX transaction_group_lookup ON financial_transaction(workspace_id,group_id) WHERE group_id IS NOT NULL;
CREATE INDEX allocation_transaction ON transaction_allocation(workspace_id,transaction_id);
CREATE INDEX allocation_category ON transaction_allocation(workspace_id,category_id,transaction_id);
`;
  for (const table of businessTables.filter(
    (table) => !['transaction_tag', 'transaction_revision'].includes(table),
  ))
    sql += `CREATE TRIGGER ${table}_identity_immutable BEFORE UPDATE ON ${table} WHEN NEW.id<>OLD.id${table === 'workspace' ? '' : ' OR NEW.workspace_id<>OLD.workspace_id'} BEGIN SELECT RAISE(ABORT,'IDENTITY_IMMUTABLE'); END;\n`;
  return sql;
}
