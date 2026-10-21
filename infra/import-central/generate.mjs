import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { fileURLToPath } from 'node:url';
const root = new URL('../../', import.meta.url);
const statuses =
  "'PREPARING','REVIEW','CONFIRMING','COMMITTED','FAILED','REVERSED','PARTIALLY_REVERSED'";
const dispositions =
  "'NEW','DUPLICATE','POSSIBLE_DUPLICATE','UPDATE','INVALID','SKIPPED','COMMITTED'";
const actions = "'CREATE','UPDATE','LINK','UNLINK','RESTORE','DELETE'";
const uuid = (n) =>
  `length(${n})=36 AND ${n}=lower(${n}) AND substr(${n},9,1)='-' AND substr(${n},14,1)='-' AND substr(${n},19,1)='-' AND substr(${n},24,1)='-' AND length(replace(${n},'-',''))=32 AND replace(${n},'-','') NOT GLOB '*[^0-9a-f]*' AND ${n}<>'00000000-0000-0000-0000-000000000000'`;
const day = (n) =>
  `length(${n})=10 AND ${n} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND ${n} BETWEEN '0001-01-01' AND '9999-12-31' AND date(${n},'+0 days')=${n}`;
function schema(pg) {
  const p = pg ? 'fm.' : '',
    table = (n) => p + n;
  const id = (n, optional = false) =>
    pg
      ? `${n} fm.resource_id${optional ? '' : ' NOT NULL'}`
      : `${n} TEXT${optional ? '' : ' NOT NULL'} CHECK(${optional ? n + ' IS NULL OR ' : ''}(${uuid(n)}))`;
  const date = (n) =>
    pg
      ? `${n} fm.financial_day`
      : `${n} TEXT CHECK(${n} IS NULL OR coalesce((${day(n)}),0))`;
  const instant = (n, optional = false) =>
    pg
      ? `${n} fm.technical_instant${optional ? '' : ' NOT NULL'}`
      : `${n} TEXT${optional ? '' : ' NOT NULL'} CHECK(${optional ? n + ' IS NULL OR ' : ''}coalesce((length(${n})=24 AND ${day('substr(' + n + ',1,10)')} AND strftime('%Y-%m-%dT%H:%M:%fZ',${n})=${n} AND substr(${n},12,2) BETWEEN '00' AND '23' AND substr(${n},15,2) BETWEEN '00' AND '59' AND substr(${n},18,2) BETWEEN '00' AND '59'),0))`;
  const identity = [
    id('id') + ' PRIMARY KEY',
    id('workspace_id') + ` REFERENCES ${table('workspace')}(id)`,
  ];
  const json = (name, kind, fallback) =>
    pg
      ? `${name} jsonb NOT NULL DEFAULT '${fallback}'::jsonb CHECK(jsonb_typeof(${name})='${kind}' AND octet_length(${name}::text)<=16384)`
      : `${name} TEXT NOT NULL DEFAULT '${fallback}' CHECK(json_valid(${name}) AND json_type(${name})='${kind}' AND length(CAST(${name} AS BLOB))<=16384)`;
  const fk = (keys, target, columns = keys) =>
    `FOREIGN KEY(workspace_id,${keys}) REFERENCES ${table(target)}(workspace_id,${columns})`;
  const tables = [
    [
      'import_batch',
      [
        ...identity,
        id('target_account_id', true),
        "batch_kind TEXT NOT NULL CHECK(batch_kind IN ('IMPORT','REVERSAL'))",
        `status TEXT NOT NULL CHECK(status IN (${statuses}))`,
        id('reverses_batch_id', true),
        id('created_by_member_id', true),
        instant('created_at'),
        instant('committed_at', true),
        `${pg ? 'version bigint' : 'version INTEGER'} NOT NULL DEFAULT 1 CHECK(version>0)`,
        'failure_code TEXT CHECK(failure_code IS NULL OR (length(failure_code) BETWEEN 1 AND 64 AND ' +
          (pg
            ? "failure_code ~ '^[A-Z][A-Z0-9_]*$'"
            : "substr(failure_code,1,1) GLOB '[A-Z]' AND failure_code NOT GLOB '*[^A-Z0-9_]*'") +
          '))',
        "CHECK((batch_kind='IMPORT' AND reverses_batch_id IS NULL) OR (batch_kind='REVERSAL' AND reverses_batch_id IS NOT NULL AND reverses_batch_id<>id))",
        "CHECK((status IN ('COMMITTED','REVERSED','PARTIALLY_REVERSED')) = (committed_at IS NOT NULL))",
        'CHECK(committed_at IS NULL OR committed_at>=created_at)',
        "CHECK((status='FAILED') = (failure_code IS NOT NULL))",
        fk('target_account_id', 'financial_account', 'id'),
        fk('reverses_batch_id', 'import_batch', 'id'),
      ],
    ],
    [
      'import_source',
      [
        ...identity,
        id('batch_id'),
        'file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255)',
        pg
          ? "file_hash TEXT NOT NULL CHECK(file_hash ~ '^[a-f0-9]{64}$')"
          : "file_hash TEXT NOT NULL CHECK(length(file_hash)=64 AND file_hash NOT GLOB '*[^a-f0-9]*')",
        'format TEXT NOT NULL CHECK(length(format) BETWEEN 1 AND 32)',
        'parser_name TEXT CHECK(parser_name IS NULL OR length(parser_name) BETWEEN 1 AND 120)',
        'parser_version TEXT CHECK(parser_version IS NULL OR length(parser_version) BETWEEN 1 AND 40)',
        'detected_currency TEXT CHECK(detected_currency IS NULL OR length(detected_currency)=3)',
        date('period_start'),
        date('period_end'),
        instant('imported_at'),
        'CHECK((parser_name IS NULL) = (parser_version IS NULL))',
        'CHECK(period_start IS NULL OR period_end IS NULL OR period_start<=period_end)',
        'UNIQUE(workspace_id,batch_id,id)',
        fk('batch_id', 'import_batch', 'id'),
      ],
    ],
    [
      'import_item',
      [
        ...identity,
        id('batch_id'),
        id('source_id', true),
        `${pg ? 'row_no bigint' : 'row_no INTEGER'} CHECK(row_no IS NULL OR row_no BETWEEN 1 AND 200000)`,
        'source_external_id TEXT CHECK(source_external_id IS NULL OR length(source_external_id)<=256)',
        date('normalized_date'),
        `${pg ? 'normalized_amount_minor bigint' : 'normalized_amount_minor INTEGER'}`,
        'original_description TEXT CHECK(original_description IS NULL OR length(original_description)<=20000)',
        'proposed_name TEXT CHECK(proposed_name IS NULL OR length(proposed_name) BETWEEN 1 AND 120)',
        `disposition TEXT NOT NULL CHECK(disposition IN (${dispositions}))`,
        json('validation_errors', 'array', '[]'),
        json('provenance', 'object', '{}'),
        `${pg ? 'version bigint' : 'version INTEGER'} NOT NULL DEFAULT 1 CHECK(version>0)`,
        'UNIQUE(workspace_id,batch_id,id)',
        "CHECK(disposition IN ('INVALID','SKIPPED') OR (normalized_date IS NOT NULL AND normalized_amount_minor IS NOT NULL))",
        fk('batch_id', 'import_batch', 'id'),
        fk('batch_id,source_id', 'import_source', 'batch_id,id'),
      ],
    ],
    [
      'import_effect',
      [
        ...identity,
        id('batch_id'),
        id('import_item_id'),
        id('transaction_id'),
        `action TEXT NOT NULL CHECK(action IN (${actions}))`,
        id('before_revision_id', true),
        id('after_revision_id', true),
        instant('created_at'),
        "CHECK(action<>'CREATE' OR (before_revision_id IS NULL AND after_revision_id IS NOT NULL))",
        "CHECK(action NOT IN ('UPDATE','RESTORE','DELETE') OR (before_revision_id IS NOT NULL AND after_revision_id IS NOT NULL AND before_revision_id<>after_revision_id))",
        fk('batch_id', 'import_batch', 'id'),
        fk('batch_id,import_item_id', 'import_item', 'batch_id,id'),
        fk('transaction_id', 'financial_transaction', 'id'),
        fk(
          'transaction_id,before_revision_id',
          'transaction_revision',
          'transaction_id,id',
        ),
        fk(
          'transaction_id,after_revision_id',
          'transaction_revision',
          'transaction_id,id',
        ),
      ],
    ],
  ];
  let out =
    '-- US-050 opt-in import ledger. No original files; runtime access remains denied without explicit authorization.\n';
  out += `CREATE UNIQUE INDEX revision_import_identity ON ${table('transaction_revision')}(workspace_id,transaction_id,id);\n`;
  for (const [n, columns] of tables)
    out += `CREATE TABLE ${table(n)}(\n  ${[...columns, 'UNIQUE(workspace_id,id)'].join(',\n  ')}\n)${pg ? '' : ' STRICT'};\n`;
  for (const [n, cols] of [
    ['import_batch', 'workspace_id,created_at DESC,id DESC'],
    ['import_source', 'workspace_id,batch_id,id'],
    ['import_item', 'workspace_id,batch_id,disposition'],
    ['import_effect', 'workspace_id,batch_id,id'],
  ])
    out += `CREATE INDEX ${n}_central_lookup ON ${table(n)}(${cols});\n`;
  if (pg) {
    out += `CREATE FUNCTION fm.reject_import_effect_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FM_IMPORT_EFFECT_IMMUTABLE'; END $$;\nCREATE TRIGGER effect_immutable BEFORE UPDATE OR DELETE ON fm.import_effect FOR EACH ROW EXECUTE FUNCTION fm.reject_import_effect_mutation();\n`;
    for (const [n] of tables)
      out += `ALTER TABLE fm.${n} ENABLE ROW LEVEL SECURITY;\nALTER TABLE fm.${n} FORCE ROW LEVEL SECURITY;\nCREATE POLICY workspace_boundary ON fm.${n} AS RESTRICTIVE USING(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid) WITH CHECK(workspace_id=nullif(current_setting('app.workspace_id',true),'')::uuid);\nCREATE TRIGGER identity_immutable BEFORE UPDATE ON fm.${n} FOR EACH ROW EXECUTE FUNCTION fm.reject_identity_mutation();\nREVOKE ALL ON fm.${n} FROM PUBLIC;\n`;
    out +=
      'REVOKE ALL ON FUNCTION fm.reject_import_effect_mutation() FROM PUBLIC;\n';
  } else {
    for (const [n] of tables)
      out += `CREATE TRIGGER ${n}_identity_immutable BEFORE UPDATE ON ${n} WHEN NEW.id<>OLD.id OR NEW.workspace_id<>OLD.workspace_id BEGIN SELECT RAISE(ABORT,'FM_IDENTITY_IMMUTABLE'); END;\n`;
    out +=
      "CREATE TRIGGER effect_update_immutable BEFORE UPDATE ON import_effect BEGIN SELECT RAISE(ABORT,'FM_IMPORT_EFFECT_IMMUTABLE'); END;\nCREATE TRIGGER effect_delete_immutable BEFORE DELETE ON import_effect BEGIN SELECT RAISE(ABORT,'FM_IMPORT_EFFECT_IMMUTABLE'); END;\n";
  }
  return out;
}
function down(pg) {
  const p = pg ? 'fm.' : '',
    counts = ['import_batch', 'import_source', 'import_item', 'import_effect']
      .map((t) => `(SELECT count(*) FROM ${p + t})`)
      .join('+');
  let out = pg
    ? `LOCK TABLE fm.import_batch,fm.import_source,fm.import_item,fm.import_effect IN ACCESS EXCLUSIVE MODE;\nALTER TABLE fm.import_batch NO FORCE ROW LEVEL SECURITY;\nALTER TABLE fm.import_source NO FORCE ROW LEVEL SECURITY;\nALTER TABLE fm.import_item NO FORCE ROW LEVEL SECURITY;\nALTER TABLE fm.import_effect NO FORCE ROW LEVEL SECURITY;\nDO $$ BEGIN IF ${counts}>0 THEN RAISE EXCEPTION USING ERRCODE='23514',MESSAGE='FM_IMPORT_ROLLBACK_NOT_EMPTY'; END IF; END $$;\n`
    : `CREATE TEMP TABLE _import_rollback_guard(n INTEGER NOT NULL CHECK(n=0)) STRICT;\nINSERT INTO _import_rollback_guard VALUES(${counts});\nDROP TABLE _import_rollback_guard;\n`;
  for (const n of [
    'import_effect',
    'import_item',
    'import_source',
    'import_batch',
  ])
    out += `DROP TABLE ${p + n};\n`;
  out += `DROP INDEX ${p}revision_import_identity;\n`;
  if (pg) out += 'DROP FUNCTION fm.reject_import_effect_mutation();\n';
  return out;
}
const up = schema(false),
  rollback = down(false),
  entry = {
    version: 3,
    name: 'import-ledger',
    up,
    down: rollback,
    destructive: false,
  };
entry.checksum = createHash('sha256')
  .update(
    JSON.stringify([
      entry.version,
      entry.name,
      entry.up,
      entry.down,
      entry.destructive,
    ]),
  )
  .digest('hex');
const outputs = [
  ['packages/storage-schema/sqlite/migrations/0003-import-ledger.up.sql', up],
  [
    'packages/storage-schema/sqlite/migrations/0003-import-ledger.down.sql',
    rollback,
  ],
  [
    'apps/api/persistence/postgres/migrations/0003-import-ledger.up.sql',
    schema(true),
  ],
  [
    'apps/api/persistence/postgres/migrations/0003-import-ledger.down.sql',
    down(true),
  ],
  [
    'packages/storage-schema/src/generated-import-migration.ts',
    await format(
      `// Generated by infra/import-central/generate.mjs. Explicit opt-in; no financial data.\nimport type {Migration} from './migration-plan.js';\nexport const importLedgerMigration:Migration=Object.freeze(${JSON.stringify(entry)});\n`,
      {
        ...(await resolveConfig(
          fileURLToPath(
            new URL(
              'packages/storage-schema/src/generated-import-migration.ts',
              root,
            ),
          ),
        )),
        parser: 'typescript',
      },
    ),
  ],
];
for (const [file, data] of outputs) {
  const url = new URL(file, root);
  if (process.argv.includes('--check')) {
    if (readFileSync(url, 'utf8') !== data)
      throw Error('IMPORT_MIGRATION_GENERATION_DRIFT');
  } else writeFileSync(url, data);
}
console.log('US-050 opt-in import migration generation OK.');
