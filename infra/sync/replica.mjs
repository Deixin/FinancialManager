import { DatabaseSync } from 'node:sqlite';
import {
  validateOperation,
  SyncError,
  counter,
} from '../../apps/api/spikes/us-005/protocol.mjs';

// Plain SQLite is only an instrument for SYNTHETIC fixtures. Product adapters
// must use the SQLCipher vaults validated separately by US-001/US-002.
export class Replica {
  constructor(filename, workspaceId, generation) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY CHECK(version=1));
      INSERT OR IGNORE INTO schema_version VALUES(1);
      CREATE TABLE IF NOT EXISTS meta(id INTEGER PRIMARY KEY CHECK(id=1),workspace TEXT NOT NULL,generation TEXT NOT NULL,cursor TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS confirmed(id TEXT PRIMARY KEY,body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS outbox(position INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS conflict(id TEXT PRIMARY KEY,body TEXT NOT NULL);`);
    this.db
      .prepare("INSERT OR IGNORE INTO meta VALUES(1,?,?,'0')")
      .run(workspaceId, generation);
    if (this.meta().workspace !== workspaceId)
      throw new SyncError('WRONG_REPLICA');
  }
  meta() {
    return this.db.prepare('SELECT * FROM meta').get();
  }
  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  enqueue(op, beforeCommit = () => {}) {
    validateOperation(op);
    const meta = this.meta();
    if (op.workspace_id !== meta.workspace || op.generation !== meta.generation)
      throw new SyncError('WRONG_REPLICA');
    this.transaction(() => {
      this.db
        .prepare("INSERT INTO outbox(id,body,state) VALUES(?,?,'PENDING')")
        .run(op.operation_id, JSON.stringify(op));
      beforeCommit();
    });
  }
  pending() {
    return this.db
      .prepare(
        "SELECT body FROM outbox WHERE state='PENDING' ORDER BY position",
      )
      .all()
      .map((row) => JSON.parse(row.body));
  }
  acknowledge(id, result) {
    const states = {
      APPLIED: 'CONFIRMED',
      MERGED: 'CONFIRMED',
      CONFLICT: 'CONFLICT',
      REJECTED_PERMISSION: 'REVOKED',
      STALE_GENERATION: 'QUARANTINED',
    };
    if (states[result.status])
      this.db
        .prepare('UPDATE outbox SET state=? WHERE id=?')
        .run(states[result.status], id);
  }
  apply(response, { snapshot = false, beforeCommit = () => {} } = {}) {
    if (response.status !== 'OK') throw new SyncError(response.status);
    const meta = this.meta();
    if (!snapshot && response.generation !== meta.generation)
      throw new SyncError('STALE_GENERATION');
    if (
      !counter(response.cursor) ||
      ((!snapshot || response.generation === meta.generation) &&
        BigInt(response.cursor) < BigInt(meta.cursor))
    )
      throw new SyncError('STALE_RESPONSE');
    this.transaction(() => {
      if (snapshot) {
        this.db.exec('DELETE FROM confirmed; DELETE FROM conflict;');
        // No rebase/replay of an old binding, even if the record IDs match.
        if (response.generation !== meta.generation)
          this.db.exec(
            "UPDATE outbox SET state='QUARANTINED' WHERE state='PENDING'",
          );
      }
      for (const row of snapshot ? response.records : response.changes) {
        const existing = this.db
          .prepare('SELECT body FROM confirmed WHERE id=?')
          .get(row.entity_id);
        if (
          !existing ||
          BigInt(JSON.parse(existing.body).version) < BigInt(row.version)
        )
          this.db
            .prepare(
              'INSERT INTO confirmed VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
            )
            .run(
              row.entity_id,
              JSON.stringify({
                entity_id: row.entity_id,
                account_id: row.account_id,
                version: row.version,
                deleted: row.deleted,
                snapshot: row.snapshot,
              }),
            );
      }
      for (const conflict of response.conflicts)
        this.db
          .prepare(
            'INSERT INTO conflict VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body',
          )
          .run(conflict.id, JSON.stringify(conflict));
      this.db
        .prepare('UPDATE meta SET generation=?,cursor=? WHERE id=1')
        .run(response.generation, response.cursor);
      beforeCommit();
    });
  }
  state() {
    return {
      meta: this.meta(),
      records: this.db
        .prepare('SELECT body FROM confirmed ORDER BY id')
        .all()
        .map((row) => JSON.parse(row.body)),
      outbox: this.db
        .prepare('SELECT id,state FROM outbox ORDER BY position')
        .all(),
      conflicts: this.db
        .prepare('SELECT body FROM conflict ORDER BY id')
        .all()
        .map((row) => JSON.parse(row.body)),
    };
  }
  close() {
    this.db.close();
  }
}
