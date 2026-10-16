import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { applyInitialMigration } from '../../apps/api/persistence/postgres/migrate.mjs';
import { gates, validateSchemaEvidence } from '../schema/evidence.mjs';
const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../docs/quality/evidence/us-020-postgresql-2026-10-16.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
test('archived schema evidence requires real PostgreSQL gates, cleanup and current migration sources', () => {
  assert.equal(validateSchemaEvidence(fixture()).passed, true);
  for (const gate of gates) {
    const report = fixture();
    report.checks[gate] = false;
    assert.throws(
      () => validateSchemaEvidence(report),
      /SCHEMA_EVIDENCE_INVALID/,
    );
  }
});
test('schema evidence rejects payloads, stale hashes, incomplete scope, versions and timestamps', () => {
  for (const mutate of [
    (report) => {
      report.payload = 'SYNTHETIC_PRIVATE_CANARY';
    },
    (report) => {
      report.source_sha256[
        'apps/api/persistence/postgres/migrations/0001-financial-core.sql'
      ] = '0'.repeat(64);
    },
    (report) => {
      report.pending = [];
    },
    (report) => {
      report.resources_closed = false;
    },
    (report) => {
      report.versions.postgresql = '19.0';
    },
    (report) => {
      report.completed_at_utc = 'invalid';
    },
    (report) => {
      report.scope = 'product-authorization-complete';
    },
  ]) {
    const report = fixture();
    mutate(report);
    assert.throws(
      () => validateSchemaEvidence(report),
      /SCHEMA_EVIDENCE_INVALID/,
    );
  }
});
test('migration connection failure cannot expose the driver message or credentials', async () => {
  await assert.rejects(
    applyInitialMigration({
      connect() {
        throw new Error('SYNTHETIC_PRIVATE_DRIVER_CANARY');
      },
    }),
    { message: 'MIGRATION_FAILED' },
  );
});
test('migration rollback failure discards the broken connection with a fixed error', async () => {
  let discarded;
  const client = {
    async query(sql) {
      if (sql !== 'BEGIN') throw new Error('SYNTHETIC_PRIVATE_SQL_CANARY');
    },
    release(value) {
      discarded = value;
    },
  };
  await assert.rejects(
    applyInitialMigration({
      async connect() {
        return client;
      },
    }),
    { message: 'MIGRATION_FAILED' },
  );
  assert.equal(discarded, true);
});
