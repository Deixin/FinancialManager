/* global structuredClone */
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import * as d from '../../packages/domain/dist/imports.js';
import {
  captureLocalImportPrepare,
  captureLocalImportDetail,
  captureLocalImportQuery,
} from '../../apps/desktop/dist/local-imports.js';
export const id = (n) =>
  `0199d050-0000-7000-8000-${String(n).padStart(12, '0')}`;
const w = id(1),
  b = id(100),
  at = '2026-10-20T11:00:00.000Z';
const base = {
  prepare: { id: b, target_account_id: id(10) },
  query: { statuses: [], account_id: null, cursor: null, limit: 2 },
  detail: { id: b, effect_after: null, effect_limit: 2 },
  batch: {
    id: b,
    workspace_id: w,
    target_account_id: id(10),
    batch_kind: 'IMPORT',
    status: 'PREPARING',
    reverses_batch_id: null,
    created_by_member_id: null,
    created_at: at,
    committed_at: null,
    version: '1',
    failure_code: null,
  },
  source: {
    id: id(200),
    workspace_id: w,
    batch_id: b,
    file_name: 'SYNTHETIC-extrato.ofx',
    file_hash: 'a'.repeat(64),
    format: 'OFX',
    parser_name: null,
    parser_version: null,
    detected_currency: null,
    period_start: null,
    period_end: null,
    imported_at: at,
  },
  effect: {
    id: id(400),
    workspace_id: w,
    batch_id: b,
    import_item_id: id(300),
    transaction_id: id(30),
    action: 'CREATE',
    before_revision_id: null,
    after_revision_id: id(40),
    created_at: at,
  },
};
const capture = {
  prepare: captureLocalImportPrepare,
  query: captureLocalImportQuery,
  detail: captureLocalImportDetail,
  batch: (v) => d.captureImportBatch(v, w),
  source: (v) => d.captureImportSource(v, w, b),
  effect: (v) => d.captureImportEffect(v, w, b),
};
const vectors = [];
// UTC normalization rejects offsets, fractional ambiguity and invalid calendar days.
function vector(kind, name, mutate = () => {}) {
  const input = structuredClone(base[kind]);
  mutate(input);
  let valid = true;
  try {
    capture[kind](input);
  } catch {
    valid = false;
  }
  vectors.push({ kind, name, workspace_id: w, batch_id: b, input, valid });
}
for (const kind of Object.keys(base)) {
  vector(kind, 'valid');
  for (const key of Object.keys(base[kind]))
    vector(kind, 'missing_' + key, (v) => {
      delete v[key];
    });
  vector(kind, 'extra', (v) => {
    v.extra = true;
  });
}
for (const at of [
  '2026-02-29T11:00:00.000Z',
  '2026-10-20T11:00:00Z',
  '2026-10-20T11:00:00.000+00:00',
])
  vector('batch', 'invalid_instant_' + at, (v) => {
    v.created_at = at;
  });
for (const status of d.importStatuses)
  vector('batch', 'status_' + status, (v) => {
    v.status = status;
    v.committed_at = ['COMMITTED', 'REVERSED', 'PARTIALLY_REVERSED'].includes(
      status,
    )
      ? at
      : null;
    v.failure_code = status === 'FAILED' ? 'SYNTHETIC_FAILURE' : null;
  });
for (const s of [
  '0',
  '01',
  '-1',
  '9223372036854775807',
  '9223372036854775808',
  '9'.repeat(1000),
])
  vector('batch', 'version_' + s.slice(0, 22), (v) => {
    v.version = s;
  });
for (const s of [
  '..',
  '../a',
  'a:b',
  ' a',
  'a\u0000b',
  '😀'.repeat(128),
  'SYNTHETIC 😀.ofx',
])
  vector('source', 'name_' + s.slice(0, 10), (v) => {
    v.file_name = s;
  });
for (const [field, value] of [
  ['format', 'A-B'],
  ['format', '-A'],
  ['format', 'é'],
  ['parser_name', 'SYNTHETIC'],
  ['period_start', '2025-02-29'],
  ['detected_currency', 'brl'],
  ['file_hash', 'A'.repeat(64)],
])
  vector('source', 'invalid_' + field, (v) => {
    v[field] = value;
  });
for (const action of d.effectActions)
  vector('effect', 'action_' + action, (v) => {
    v.action = action;
    if (action !== 'CREATE') v.before_revision_id = id(41);
  });
for (const n of [0, 1, 100, 101, 1.5]) {
  vector('query', 'limit_' + n, (v) => {
    v.limit = n;
  });
  vector('detail', 'limit_' + n, (v) => {
    v.effect_limit = n;
  });
}
vector('query', 'duplicate_status', (v) => {
  v.statuses = ['FAILED', 'FAILED'];
});
vector('query', 'cursor', (v) => {
  v.cursor = { id: b, created_at: at };
});
vector('prepare', 'v4', (v) => {
  v.id = '0199d050-0000-4000-8000-000000000100';
});
const file = new URL(
    '../../apps/desktop/src-tauri/fixtures/us050-imports.json',
    import.meta.url,
  ),
  output = await prettier.format(JSON.stringify(vectors), {
    ...(await prettier.resolveConfig(file)),
    filepath: file.pathname,
  });
if (process.argv.includes('--check')) {
  if (readFileSync(file, 'utf8') !== output) throw Error('IMPORT_PARITY_DRIFT');
} else writeFileSync(file, output);
console.log('US050 shared import metadata vectors: ' + vectors.length);
