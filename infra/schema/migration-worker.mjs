import { openProbeDatabase } from './sqlite-adapter.mjs';
import { createDualPool } from './dual-postgres.mjs';
import { migratePostgresTo, sha256 } from './postgres-migrations.mjs';
import { migrateSqliteTo } from '../../packages/storage-schema/dist/migrations.js';
process.once('message', async (message) => {
  let sqlite, pool;
  const pause = async (stage) => {
    if (message.checkpoint === stage) {
      process.send({ checkpoint: stage });
      await new Promise(() => {});
    }
  };
  const wrap = async (sql, values, execute) => {
    if (sql === 'COMMIT') await pause('before_commit');
    const result = await execute();
    if (/\b(?:CREATE|DROP) INDEX (?:fm\.)?balance_reference_lookup/.test(sql))
      await pause('after_ddl');
    if (
      /^(INSERT INTO|DELETE FROM) (?:fm\.schema_migration|_schema_migration)\b/.test(
        sql,
      ) &&
      String(values?.[0]) === '2'
    )
      await pause('after_history');
    return result;
  };
  try {
    let result;
    if (message.engine === 'sqlite') {
      sqlite = openProbeDatabase(message.filename);
      await sqlite.db.exec('PRAGMA busy_timeout=5000');
      const db = {
        rows: sqlite.db.rows,
        exec: (sql) => wrap(sql, [], () => sqlite.db.exec(sql)),
        run: (sql, values) =>
          wrap(sql, values, () => sqlite.db.run(sql, values)),
      };
      result = await migrateSqliteTo(db, { target: message.target, sha256 });
    } else if (message.engine === 'postgres') {
      pool = createDualPool('fm_schema_migrator', message.password);
      result = await migratePostgresTo(
        {
          async connect() {
            const client = await pool.connect();
            return {
              query: (sql, values) =>
                wrap(sql, values, () => client.query(sql, values)),
              release: (discard) => client.release(discard),
            };
          },
        },
        { target: message.target },
      );
    } else throw new Error('ENGINE_INVALID');
    process.send({ result });
  } catch {
    process.send({ failed: true });
    process.exitCode = 1;
  } finally {
    sqlite?.close();
    await pool?.end();
    process.disconnect();
  }
});
