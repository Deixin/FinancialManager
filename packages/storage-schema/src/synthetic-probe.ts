import { normalizedName } from './index.js';
import type { SqliteConnection } from './index.js';
import { syntheticCorpus } from './generated-probe.js';
export { syntheticCorpus };
export type ProbeStatement = Readonly<{
  sql: string;
  parameters: readonly (string | number | null)[];
}>;
export type ProbeCase = Readonly<{
  name: string;
  statements: readonly ProbeStatement[];
  reject?: boolean;
  query?: Readonly<{
    sql: string;
    parameters: readonly (string | number | null)[];
    rows: readonly Readonly<Record<string, string | null>>[];
  }>;
}>;
export async function seedSyntheticSqlite(db: SqliteConnection): Promise<void> {
  await db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of syntheticCorpus.seed) {
      const values: Record<string, string | null> = { ...row.values };
      if (row.table === 'category' || row.table === 'tag') {
        const name = normalizedName(String(values.name));
        if (
          values.normalized_name !== undefined &&
          values.normalized_name !== name
        )
          throw new Error('NORMALIZATION_MISMATCH');
        values.normalized_name = name;
      }
      const fields = Object.keys(values);
      await db.run(
        `INSERT INTO ${row.table}(${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`,
        Object.values(values),
      );
    }
    await db.exec('COMMIT');
  } catch {
    try {
      await db.exec('ROLLBACK');
    } catch {
      /* caller closes */
    }
    throw new Error('SYNTHETIC_SEED_FAILED');
  }
}
export async function runSyntheticCases(
  db: SqliteConnection,
): Promise<readonly string[]> {
  const passed: string[] = [];
  for (const item of syntheticCorpus.cases as readonly ProbeCase[]) {
    let rejected = false;
    try {
      await db.exec('BEGIN IMMEDIATE');
      for (const action of item.statements)
        await db.run(action.sql, action.parameters);
      await db.exec('COMMIT');
    } catch {
      rejected = true;
      try {
        await db.exec('ROLLBACK');
      } catch {
        /* PostgreSQL already rolled back */
      }
    }
    if (rejected !== Boolean(item.reject))
      throw new Error('PROBE_' + item.name.toUpperCase());
    if (item.query) {
      const rows = (await db.rows(item.query.sql, item.query.parameters)).map(
        (row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              value === null ? null : String(value),
            ]),
          ),
      );
      if (JSON.stringify(rows) !== JSON.stringify(item.query.rows))
        throw new Error('PROBE_' + item.name.toUpperCase());
    }
    passed.push(item.name);
  }
  return Object.freeze(passed);
}
