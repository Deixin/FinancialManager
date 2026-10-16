import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  Staging,
  migration,
} from '../../packages/importers/spikes/us-006/staging.mjs';
import { parseStatement } from '../../packages/importers/spikes/us-006/parse.mjs';
import {
  context,
  mapping,
  csvFixture,
  ofxFixture,
} from '../importers/fixtures.mjs';
import { Buffer } from 'node:buffer';

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), 'fm-us006-synthetic-'));
  const handles = [];
  t.after(() => {
    for (const store of handles) store.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith('fm-us006-synthetic-'));
    rmSync(directory, { recursive: true, force: true });
  });
  const file = path.join(directory, 'staging.sqlite');
  return {
    file,
    open: () => {
      const store = new Staging(file);
      handles.push(store);
      return store;
    },
  };
}
test('import staging: interrupted migration rolls back and modified checksum cannot reopen', (t) => {
  const files = fixture(t);
  assert.throws(
    () =>
      new Staging(
        files.file,
        migration + '\nSELECT nonexistent_synthetic_function();',
      ),
  );
  const raw = new DatabaseSync(files.file);
  assert.equal(
    raw
      .prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'")
      .get().n,
    0,
  );
  raw.close();
  files.open();
  assert.throws(() => new Staging(files.file, migration + '\n-- changed'), {
    code: 'MIGRATION_MISMATCH',
  });
});
test('import staging: late structural error rolls back every prepared row and batch', async (t) => {
  const store = fixture(t).open();
  store.begin(context);
  let consumed = 0;
  await assert.rejects(
    parseStatement(
      {
        context,
        format: 'OFX',
        encoding: 'utf-8',
        extension: '.ofx',
        mime: 'application/x-ofx',
        bytes: Buffer.from(ofxFixture(5).slice(0, -6)),
      },
      {
        consume: (row) => {
          consumed++;
          store.consume(row);
        },
      },
    ),
    { code: 'INVALID_OFX' },
  );
  assert.equal(consumed, 5);
  store.rollback();
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM import_item').get().n,
    0,
  );
  assert.equal(
    store.db.prepare('SELECT count(*) AS n FROM import_batch').get().n,
    0,
  );
});
test('import staging: committed REVIEW persists exact SQLite integers and exposes no financial tables', async (t) => {
  const files = fixture(t);
  const store = files.open();
  store.begin(context);
  const metadata = await parseStatement(
    {
      context,
      format: 'CSV',
      encoding: 'utf-8',
      extension: '.csv',
      mime: 'text/csv',
      mapping,
      bytes: Buffer.from(csvFixture(5)),
    },
    { consume: (row) => store.consume(row) },
  );
  store.finish(metadata);
  const reopened = files.open();
  const query = reopened.db.prepare(
    'SELECT normalized_amount_minor AS amount FROM import_item ORDER BY row_no',
  );
  query.setReadBigInts(true);
  assert.deepEqual(
    query.all().map((row) => row.amount.toString()),
    [
      '9007199254740993',
      '-9223372036854775808',
      '9223372036854775807',
      '-123456',
      '1',
    ],
  );
  assert.equal(
    reopened.db.prepare('SELECT status FROM import_batch').get().status,
    'REVIEW',
  );
  assert.equal(
    reopened.db
      .prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'financial_%'",
      )
      .get().n,
    0,
  );
});
