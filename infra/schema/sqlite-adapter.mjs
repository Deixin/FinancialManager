import { DatabaseSync } from 'node:sqlite';
export function openProbeDatabase(filename) {
  const native = new DatabaseSync(filename);
  const db = Object.freeze({
    async exec(sql) {
      native.exec(sql);
    },
    async run(sql, values = []) {
      native.prepare(sql).run(...values);
    },
    async rows(sql, values = []) {
      const statement = native.prepare(sql);
      statement.setReadBigInts(true);
      return statement
        .all(...values)
        .map((row) =>
          Object.fromEntries(
            Object.entries(row).map(([key, value]) => [
              key,
              typeof value === 'bigint' ? value.toString() : value,
            ]),
          ),
        );
    },
  });
  return { db, native, close: () => native.close() };
}
