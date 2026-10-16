import pg from 'pg';
import { applyInitialMigration } from '../../apps/api/persistence/postgres/migrate.mjs';
import { businessTables } from './sqlite-model.mjs';
import { corpus } from './us021-corpus.mjs';
export function createDualPool(user, password, max = 1) {
  const pool = new pg.Pool({
    host: '127.0.0.1',
    port: 43221,
    database: 'us021',
    user,
    password,
    max,
    options: '-c search_path=pg_catalog -c timezone=UTC',
    connectionTimeoutMillis: 2000,
    idleTimeoutMillis: 1000,
    query_timeout: 10000,
  });
  pool.on('error', () => {});
  pool.on('connect', (client) => client.on('error', () => {}));
  return pool;
}
function translate(sql, values = []) {
  const match = sql.match(
    /^INSERT INTO (category|tag)\(([^)]+)\) VALUES \(([^)]+)\)$/,
  );
  if (match) {
    const names = match[2].split(',');
    const index = names.indexOf('normalized_name');
    if (index >= 0) {
      names.splice(index, 1);
      values = values.filter((_, position) => position !== index);
      sql = `INSERT INTO ${match[1]}(${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`;
    }
  }
  sql = sql.replace(
    new RegExp('\\b(' + businessTables.join('|') + ')\\b', 'g'),
    (name) => 'fm.' + name,
  );
  let position = 0;
  return {
    text: sql.replace(/\?/g, () => '$' + ++position),
    values: [...values],
  };
}
export async function prepareDualPostgres(credentials, admin) {
  for (const value of Object.values(credentials))
    if (!/^[a-f0-9]{64}$/.test(value))
      throw new Error('SYNTHETIC_CREDENTIAL_REQUIRED');
  await admin.query(`CREATE ROLE fm_schema_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE fm_schema_migrator LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.migrator}';
    CREATE ROLE us021_fixture NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    CREATE ROLE us021_a LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.a}';
    CREATE ROLE us021_b LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${credentials.b}';
    GRANT fm_schema_owner TO fm_schema_migrator; GRANT us021_fixture TO us021_a,us021_b;
    REVOKE ALL ON DATABASE us021 FROM PUBLIC;REVOKE CREATE ON SCHEMA public FROM PUBLIC;
    GRANT CONNECT ON DATABASE us021 TO fm_schema_migrator,us021_fixture;GRANT CREATE ON DATABASE us021 TO fm_schema_owner;`);
  const migrator = createDualPool('fm_schema_migrator', credentials.migrator);
  try {
    await applyInitialMigration(migrator);
  } finally {
    await migrator.end();
  }
  await admin.query(`GRANT USAGE ON SCHEMA fm TO us021_fixture; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA fm TO us021_fixture; REVOKE ALL ON fm.schema_migration FROM us021_fixture; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA fm TO us021_fixture;
    CREATE SCHEMA us021_test;REVOKE ALL ON SCHEMA us021_test FROM PUBLIC;
    CREATE TABLE us021_test.access(database_role name NOT NULL,workspace_id uuid NOT NULL,PRIMARY KEY(database_role,workspace_id));
    GRANT USAGE ON SCHEMA us021_test TO us021_fixture;GRANT SELECT ON us021_test.access TO us021_fixture;`);
  await admin.query('INSERT INTO us021_test.access VALUES($1,$2),($3,$4)', [
    'us021_a',
    corpus.workspace_a,
    'us021_b',
    corpus.workspace_b,
  ]);
  for (const table of businessTables) {
    const key = table === 'workspace' ? 'id' : 'workspace_id';
    await admin.query(
      `CREATE POLICY synthetic_authorized_fixture ON fm.${table} TO us021_fixture USING(EXISTS(SELECT 1 FROM us021_test.access a WHERE a.database_role=session_user AND a.workspace_id=${table}.${key})) WITH CHECK(EXISTS(SELECT 1 FROM us021_test.access a WHERE a.database_role=session_user AND a.workspace_id=${table}.${key}))`,
    );
  }
  const a = createDualPool('us021_a', credentials.a),
    b = createDualPool('us021_b', credentials.b);
  const begin = async (client, workspace) => {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.workspace_id',$1,true)", [
      workspace,
    ]);
  };
  try {
    for (const row of corpus.seed) {
      const workspace =
        row.table === 'workspace' ? row.values.id : row.values.workspace_id;
      const pool = workspace === corpus.workspace_a ? a : b;
      const client = await pool.connect();
      try {
        await begin(client, workspace);
        const values = { ...row.values };
        const names = Object.keys(values);
        await client.query(
          translate(
            `INSERT INTO ${row.table}(${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`,
            Object.values(values),
          ),
        );
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
        throw new Error('POSTGRES_CORPUS_SEED_FAILED');
      } finally {
        client.release();
      }
    }
    const client = await a.connect();
    let active = false;
    const adapter = {
      async exec(sql) {
        if (sql === 'BEGIN IMMEDIATE') {
          await begin(client, corpus.workspace_a);
          active = true;
        } else {
          try {
            await client.query(sql);
          } finally {
            if (sql === 'COMMIT' || sql === 'ROLLBACK') active = false;
          }
        }
      },
      async run(sql, values) {
        await client.query(translate(sql, values));
      },
      async rows(sql, values = []) {
        if (active) return (await client.query(translate(sql, values))).rows;
        await begin(client, corpus.workspace_a);
        try {
          const result = await client.query(translate(sql, values));
          await client.query('COMMIT');
          return result.rows;
        } catch {
          await client.query('ROLLBACK');
          throw new Error('POSTGRES_CORPUS_QUERY_FAILED');
        }
      },
    };
    return {
      adapter,
      async close() {
        if (active) await client.query('ROLLBACK');
        client.release();
        await a.end();
        await b.end();
      },
    };
  } catch (error) {
    await a.end();
    await b.end();
    throw error;
  }
}
