import {
  readEvidenceFile as readFileSync,
  currentEvidenceValidator,
} from '../validation/evidence.mjs';
/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';

import { spawnSync } from 'node:child_process';
import {
  importCount,
  captureImportBatch,
  captureImportSource,
  captureImportCounts,
  captureImportQuery,
  captureImportEffect,
  itemDispositions,
  effectActions,
} from '../../packages/domain/dist/imports.js';
import { createImportCentralService } from '../../packages/finance-ports/dist/imports.js';
import { createSqliteImportCentralService } from '../../packages/storage-schema/dist/import-central.js';
import { createPostgresImportCentralService } from '../../packages/persistence-postgres/dist/import-central.js';
import { id, at, grant, request } from '../import-central/harness.mjs';
import {
  validateImportEvidence as rawValidateImportEvidence,
  importChecks,
} from '../import-central/evidence.mjs';

const validateImportEvidence = currentEvidenceValidator(
  rawValidateImportEvidence,
);

const w = id(1),
  account = id(2),
  base = () => ({
    id: id(3),
    workspace_id: w,
    target_account_id: account,
    batch_kind: 'IMPORT',
    status: 'PREPARING',
    reverses_batch_id: null,
    created_by_member_id: id(90),
    created_at: at,
    committed_at: null,
    version: '1',
    failure_code: null,
  });
const counts = () => ({
  items: Object.fromEntries(itemDispositions.map((k) => [k, '0'])),
  effects: Object.fromEntries(effectActions.map((k) => [k, '0'])),
  total_items: '0',
  total_effects: '0',
});
test('import counters reject noncanonical overflow floating and unbounded strings', () => {
  assert.equal(importCount('9223372036854775807'), '9223372036854775807');
  for (const v of [
    1,
    1n,
    '01',
    '-1',
    '1.0',
    '1e3',
    '9223372036854775808',
    '1'.repeat(20000),
  ])
    assert.throws(() => importCount(v), { code: 'INVALID_IMPORT_STATE' });
  const c = counts();
  c.items.NEW = '1';
  assert.throws(() => captureImportCounts(c));
  c.total_items = '1';
  assert.ok(Object.isFrozen(captureImportCounts(c).items));
});
test('import status timestamps failure and reversal identity reject contradictory metadata', () => {
  for (const mutate of [
    (b) => (b.status = 'COMMITTED'),
    (b) => (b.failure_code = 'PRIVATE ERROR'),
    (b) => (b.batch_kind = 'REVERSAL'),
    (b) => (b.version = '0'),
    (b) => (b.created_at = '2026-02-30T00:00:00.000Z'),
    (b) => (b.workspace_id = id(999)),
    (b) => (b.extra = true),
  ]) {
    const b = base();
    mutate(b);
    assert.throws(() => captureImportBatch(b, w));
  }
  assert.equal(
    captureImportBatch(
      { ...base(), status: 'FAILED', failure_code: 'PARSER_REJECTED' },
      w,
    ).failure_code,
    'PARSER_REJECTED',
  );
});
test('source metadata accepts no paths blobs extra keys or inconsistent parser and periods', () => {
  const source = {
    id: id(4),
    workspace_id: w,
    batch_id: id(3),
    file_name: 'SYNTHETIC.ofx',
    file_hash: 'a'.repeat(64),
    format: 'OFX',
    parser_name: null,
    parser_version: null,
    detected_currency: 'BRL',
    period_start: '2026-10-01',
    period_end: '2026-10-20',
    imported_at: at,
  };
  for (const mutate of [
    (s) => (s.file_name = '../SYNTHETIC.ofx'),
    (s) => (s.original_bytes = 'SYNTHETIC'),
    (s) => (s.file_hash = 'invalid'),
    (s) => (s.parser_name = 'unpaired'),
    (s) => (s.period_start = '2026-10-21'),
    (s) => (s.detected_currency = 'brl'),
  ]) {
    const s = structuredClone(source);
    mutate(s);
    assert.throws(() => captureImportSource(s, w, id(3)));
  }
  assert.ok(Object.isFrozen(captureImportSource(source, w, id(3))));
});
test('import query snapshots are strict ordered-keyset inputs and deeply immutable', () => {
  const raw = {
      statuses: ['REVIEW'],
      account_id: account,
      cursor: { id: id(10), created_at: at },
      limit: 1,
    },
    captured = captureImportQuery(raw);
  raw.cursor.id = id(11);
  raw.statuses.push('FAILED');
  assert.equal(captured.cursor.id, id(10));
  assert.deepEqual(captured.statuses, ['REVIEW']);
  assert.ok(Object.isFrozen(captured.cursor));
  for (const bad of [
    { ...raw, limit: 0 },
    { ...raw, limit: 101 },
    { ...raw, statuses: ['REVIEW', 'REVIEW'] },
    { ...raw, offset: 0 },
  ])
    assert.throws(() => captureImportQuery(bad), {
      code: 'INVALID_IMPORT_REQUEST',
    });
  assert.throws(() =>
    captureImportEffect(
      {
        id: id(4),
        workspace_id: w,
        batch_id: id(99),
        import_item_id: id(5),
        transaction_id: id(6),
        action: 'LINK',
        before_revision_id: null,
        after_revision_id: null,
        created_at: at,
      },
      w,
      id(3),
    ),
  );
});
test('authorization errors and invalid commands never acquire a storage transaction', async () => {
  let connections = 0;
  const service = createImportCentralService({
    authorize: async () => {
      throw Error('SYNTHETIC SECRET');
    },
    now: () => at,
    store: {
      async transaction() {
        connections++;
        throw Error('MUST_NOT_CONNECT');
      },
    },
  });
  await assert.rejects(service.list(request(w)), {
    code: 'ACCESS_DENIED',
    message: 'ACCESS_DENIED',
  });
  await assert.rejects(
    service.prepare(request(w), { id: 'bad', target_account_id: account }),
    { code: 'INVALID_IMPORT_REQUEST' },
  );
  assert.equal(connections, 0);
});
test('adapter corruption cannot forge ordering scope totals or success', async () => {
  const tx = {
    workspace: async () => ({ storage_mode: 'CLOUD' }),
    candidates: async () => [base(), base()],
    sources: async () => [],
    counts: async () => counts(),
  };
  const service = createImportCentralService({
    authorize: async (r) => grant(r),
    now: () => at,
    store: { transaction: async (_s, _m, run) => run(tx) },
  });
  await assert.rejects(service.list(request(w)), {
    code: 'INVALID_IMPORT_STATE',
  });
  tx.candidates = async () => [{ ...base(), workspace_id: id(9) }];
  await assert.rejects(service.list(request(w)), {
    code: 'INVALID_IMPORT_STATE',
  });
  tx.candidates = async () => [base()];
  tx.counts = async () => ({ ...counts(), total_items: '1' });
  await assert.rejects(service.list(request(w)), {
    code: 'INVALID_IMPORT_STATE',
  });
});
test('import service and driver configuration fail closed', () => {
  assert.throws(() => createImportCentralService({}), {
    code: 'CONFIGURATION_INVALID',
  });
  assert.throws(() => createSqliteImportCentralService({}), {
    code: 'CONFIGURATION_INVALID',
  });
  assert.throws(() => createPostgresImportCentralService({}), {
    code: 'CONFIGURATION_INVALID',
  });
});
test('effect revision requirements match durable create and mutation semantics', () => {
  const effect = {
    id: id(4),
    workspace_id: w,
    batch_id: id(3),
    import_item_id: id(5),
    transaction_id: id(6),
    action: 'CREATE',
    before_revision_id: null,
    after_revision_id: id(7),
    created_at: at,
  };
  assert.equal(captureImportEffect(effect, w, id(3)).after_revision_id, id(7));
  for (const bad of [
    { ...effect, after_revision_id: null },
    { ...effect, before_revision_id: id(8) },
    { ...effect, action: 'UPDATE' },
    { ...effect, action: 'DELETE', before_revision_id: id(7) },
  ])
    assert.throws(() => captureImportEffect(bad, w, id(3)), {
      code: 'INVALID_IMPORT_STATE',
    });
});
test('trusted account grants are frozen before storage can retain or mutate inputs', async () => {
  const mutable = { ...grant(request(w)), account_ids: [account] };
  const unit = createImportCentralService({
    authorize: async () => mutable,
    now: () => at,
    store: {
      async transaction(scope, mode, run) {
        mutable.account_ids[0] = id(99);
        assert.equal(mode, 'READ');
        assert.deepEqual(scope.account_ids, [account]);
        assert.ok(Object.isFrozen(scope.account_ids));
        return run({
          workspace: async () => ({ storage_mode: 'CLOUD' }),
          candidates: async () => [],
        });
      },
    },
  });
  assert.deepEqual((await unit.list(request(w))).items, []);
});
test('excess source coverage and item totals fail explicitly rather than truncate', async () => {
  const tx = {
    workspace: async () => ({ storage_mode: 'CLOUD' }),
    candidates: async () => [base()],
    sources: async () => Array(17).fill({}),
    counts: async () => counts(),
  };
  const service = createImportCentralService({
    authorize: async (r) => grant(r),
    now: () => at,
    store: { transaction: async (_scope, _mode, run) => run(tx) },
  });
  await assert.rejects(service.list(request(w)), { code: 'IMPORT_LIMIT' });
  tx.sources = async () => [];
  tx.counts = async () => ({
    ...counts(),
    items: { ...counts().items, NEW: '200001' },
    total_items: '200001',
  });
  await assert.rejects(service.list(request(w)), { code: 'IMPORT_LIMIT' });
});
test('import migration generator is reproducible and remains opt-in', () => {
  const result = spawnSync(
    process.execPath,
    ['infra/import-central/generate.mjs', '--check'],
    { windowsHide: true, encoding: 'utf8' },
  );
  assert.equal(result.status, 0);
  const generated = readFileSync(
    'packages/storage-schema/src/generated-migrations.ts',
    'utf8',
  );
  assert.equal(generated.includes('import-ledger'), false);
});
test('import evidence binds real engines every gate cleanup and exact source hashes', () => {
  const report = JSON.parse(
    readFileSync('docs/quality/evidence/us-050-import-central-2026-10-20.json'),
  );
  assert.equal(validateImportEvidence(report).passed, true);
  for (const name of importChecks) {
    const invalid = structuredClone(report);
    delete invalid.checks[name];
    assert.throws(() => validateImportEvidence(invalid));
  }
  const invalid = structuredClone(report);
  invalid.resources_closed = false;
  assert.throws(() => validateImportEvidence(invalid));
  const stale = structuredClone(report);
  stale.source_sha256['packages/domain/src/imports.ts'] = '0'.repeat(64);
  assert.throws(() => validateImportEvidence(stale));
});
