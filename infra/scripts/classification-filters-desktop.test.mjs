/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  decodeClassificationSnapshot,
  classificationRows,
  classificationReferenceName,
  emptyClassificationFilter as empty,
} from '../../apps/desktop/dist/local-classification-filters.js';
import {
  syntheticClassificationSnapshot,
  workspace as w,
  other,
  id,
} from '../classification-filters-desktop/fixture.mjs';
import {
  validateClassificationFilterEvidence,
  browserChecks,
  nativeChecks,
} from '../classification-filters-desktop/evidence.mjs';
const rows = (q) =>
  classificationRows(
    w,
    decodeClassificationSnapshot(syntheticClassificationSnapshot(), w),
    { ...empty, ...q },
    '',
    '',
    '',
  ).map((r) => r.id);
test('Desktop classification read is complete across dates, excludes deleted records and preserves exact i64 values', () => {
  const raw = syntheticClassificationSnapshot(),
    before = JSON.stringify(raw),
    s = decodeClassificationSnapshot(raw, w);
  assert.equal(rows({}).length, 6);
  assert.ok(rows({}).includes(id(100)));
  assert.equal(
    s.movements.transactions.find((r) => r.id === id(106)).content
      .account_amount_minor,
    '-9007199254740993',
  );
  assert.ok(Object.isFrozen(s.movements.transactions[0].content));
  assert.equal(JSON.stringify(raw), before);
  assert.equal(
    classificationReferenceName(s, 'CATEGORY', id(12)),
    'SYNTHETIC CATEGORY 12',
  );
  assert.equal(
    classificationReferenceName(s, 'TAG', id(12)),
    'SYNTHETIC COLLISION TAG 12',
  );
});
test('Desktop filters match a category and subcategory on the same split, deduplicate overlapping tags and combine ANY or ALL', () => {
  assert.deepEqual(rows({ category_id: id(10), subcategory_id: id(21) }), []);
  assert.equal(rows({ category_id: id(10), subcategory_id: id(20) }).length, 2);
  assert.equal(rows({ tag_ids: [id(30), id(31)], tag_match: 'ANY' }).length, 4);
  assert.deepEqual(rows({ tag_ids: [id(30), id(31)], tag_match: 'ALL' }), [
    id(100),
  ]);
  assert.deepEqual(
    rows({ category_id: id(12), subcategory_id: id(22), tag_ids: [id(32)] }),
    [id(106)],
  );
});
test('Unclassified means no monetary allocations and keeps transfer nature; account and date criteria compose', () => {
  assert.equal(rows({ unclassified_only: true }).length, 3);
  const s = decodeClassificationSnapshot(syntheticClassificationSnapshot(), w);
  assert.equal(classificationRows(w, s, empty, id(3), '', '').length, 1);
  assert.equal(
    classificationRows(w, s, empty, '', '2026-01-01', '2026-12-31').length,
    1,
  );
  assert.equal(
    classificationRows(w, s, empty, '', '', '').find((r) => r.id === id(104))
      .content.economic_kind,
    'TRANSFER',
  );
  assert.deepEqual(
    decodeClassificationSnapshot(syntheticClassificationSnapshot(other), other)
      .movements.transactions,
    [],
  );
});
test('Combined decoder rejects missing catalogs, extras, foreign scope, missing references, mismatched parent and duplicate transactions', () => {
  for (const mutate of [
    (r) => {
      delete r.classification;
    },
    (r) => {
      r.extra = true;
    },
    (r) => {
      r.classification.workspace_id = other;
    },
    (r) => {
      r.classification.items = r.classification.items.filter(
        (r) => r.id !== id(30),
      );
    },
    (r) => {
      r.classification.items[0].category_id = id(11);
    },
    (r) => {
      r.transactions.push(r.transactions[0]);
    },
    (r) => {
      r.balance.movements.pop();
    },
  ]) {
    const raw = syntheticClassificationSnapshot();
    mutate(raw);
    assert.throws(() => decodeClassificationSnapshot(raw, w), {
      code: 'INVALID_RESPONSE',
    });
  }
});
test('Complete snapshot bounds refuse instead of truncating, including UTF16 growth', () => {
  const raw = syntheticClassificationSnapshot();
  raw.transactions = Array(10001).fill(raw.transactions[0]);
  assert.throws(() => decodeClassificationSnapshot(raw, w), {
    code: 'INVALID_RESPONSE',
  });
  const big = syntheticClassificationSnapshot();
  big.transactions[0].content.display_name = '😀'.repeat(2100000);
  assert.throws(() => decodeClassificationSnapshot(big, w), {
    code: 'INVALID_RESPONSE',
  });
});
test('Existing movement IPC remains read only with 35 permissions and classification is an explicit snapshot option', () => {
  const capability = JSON.parse(
    readFileSync('apps/desktop/src-tauri/capabilities/entry-main.json'),
  );
  assert.equal(capability.permissions.length, 35);
  const source = readFileSync(
    'apps/desktop/src-tauri/src/local_classification_filters.rs',
    'utf8',
  );
  assert.match(source, /TransactionBehavior::Deferred/);
  assert.doesNotMatch(source, /db\.execute|tx\.execute/);
  const gateway = readFileSync(
    'apps/desktop/src/local-classification-filters.ts',
    'utf8',
  );
  assert.match(gateway, /includeClassification: true/);
  assert.doesNotMatch(
    gateway,
    /apply_local|localStorage|sessionStorage|indexedDB/,
  );
});
test('Classification filter evidence requires every real browser and Windows gate and immutable source hashes', () => {
  const dir = 'docs/quality/evidence/';
  for (const file of [
    'us-045-desktop-classification-filters-browser-2026-10-20-us050-desktop.json',
    'us-045-desktop-classification-filters-windows-2026-10-20-us050-desktop.json',
  ]) {
    const raw = JSON.parse(readFileSync(dir + file));
    validateClassificationFilterEvidence(raw, { matchSources: true });
    assert.throws(() =>
      validateClassificationFilterEvidence(
        { ...raw, resources_closed: false },
        { matchSources: true },
      ),
    );
    const bad = structuredClone(raw);
    delete bad.checks[Object.keys(bad.checks)[0]];
    assert.throws(() =>
      validateClassificationFilterEvidence(bad, { matchSources: true }),
    );
  }
  assert.ok(browserChecks.length >= 8);
  assert.ok(nativeChecks.length >= 8);
});
