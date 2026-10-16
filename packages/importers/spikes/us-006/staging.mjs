import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ImportError } from './contract.mjs';

export const migration = readFileSync(
  new URL('./migrations/0001-synthetic-staging.sql', import.meta.url),
  'utf8',
);
export const migrationHash = createHash('sha256')
  .update(migration)
  .digest('hex');
export class Staging {
  constructor(filename, sql = migration) {
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(
        'PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;',
      );
      this.db.exec('BEGIN IMMEDIATE');
      const exists = this.db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'",
        )
        .get();
      const checksum = createHash('sha256').update(sql).digest('hex');
      if (exists) {
        const rows = this.db.prepare('SELECT * FROM schema_version').all();
        if (
          rows.length !== 1 ||
          rows[0].version !== 1 ||
          rows[0].checksum !== checksum
        )
          throw new ImportError('MIGRATION_MISMATCH');
      } else {
        this.db.exec(sql);
        this.db.prepare('INSERT INTO schema_version VALUES(1,?)').run(checksum);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {
        /* Connection closes below. */
      }
      this.db.close();
      throw error;
    }
    this.insert = this.db.prepare(
      'INSERT INTO import_item VALUES(?,?,?,?,?,?)',
    );
  }
  begin(context) {
    this.db.exec('BEGIN IMMEDIATE');
    this.db
      .prepare(
        "INSERT INTO import_batch VALUES('synthetic-batch',?,?,'PREPARING',NULL)",
      )
      .run(context.workspace_id, context.account_id);
  }
  consume(row) {
    this.insert.run(
      'synthetic-batch',
      row.row_no,
      row.disposition,
      row.normalized_date,
      row.normalized_amount_minor === null
        ? null
        : BigInt(row.normalized_amount_minor),
      JSON.stringify(row),
    );
  }
  finish(metadata) {
    this.db
      .prepare(
        "UPDATE import_batch SET status='REVIEW',source_metadata=? WHERE id='synthetic-batch'",
      )
      .run(JSON.stringify(metadata));
    this.db.exec('COMMIT');
  }
  rollback() {
    this.db.exec('ROLLBACK');
  }
  close() {
    this.db.close();
  }
}
