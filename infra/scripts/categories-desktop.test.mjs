/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  captureLocalCategory,
  createLocalCategoriesGateway,
  decodeCategoriesSnapshot,
  decodeCategoryResult,
  LocalCategoryError,
  localCategoryMessage,
} from '../../apps/desktop/dist/local-categories.js';
import {
  planCategories,
  categoryDefaults,
} from '../../packages/domain/dist/categories.js';
import {
  browserChecks,
  nativeChecks,
  validateDesktopCategoryEvidence,
} from '../categories-desktop/evidence.mjs';
const id = (n) => '0199d244-0000-7000-8000-' + String(n).padStart(12, '0'),
  w = id(1),
  empty = { workspace_id: w, purpose: 'PERSONAL', categories: [] },
  seed = {
    kind: 'SEED',
    profile_version: 1,
    purpose: 'PERSONAL',
    ids: categoryDefaults('PERSONAL').map((_, i) => id(100 + i)),
  };
test('category gateway is native-only and captures immutable UUIDv7 intents before invocation', () => {
  assert.equal(createLocalCategoriesGateway(), null);
  const raw = structuredClone(seed),
    captured = captureLocalCategory(raw, w);
  raw.ids[0] = id(999);
  assert.equal(captured.ids[0], id(100));
  assert.ok(Object.isFrozen(captured.ids));
  for (const c of [
    { ...seed, ids: seed.ids.map((i) => i.replace('-7000-', '-4000-')) },
    {
      kind: 'CREATE',
      id: id(500),
      name: 'SYNTHETIC',
      category_scope: 'BOTH',
      sort_order: 0.1,
    },
    { ...seed, reset: true },
  ])
    assert.throws(() => captureLocalCategory(c, w), {
      code: 'INVALID_CATEGORY_CHANGE',
    });
});
test('category snapshot validates complete workspace purpose identifiers bounded catalog and frozen DTOs', () => {
  const rows = planCategories(w, 'PERSONAL', [], seed).map((p) => p.after),
    snapshot = decodeCategoriesSnapshot({ ...empty, categories: rows }, w);
  assert.ok(
    Object.isFrozen(snapshot) &&
      Object.isFrozen(snapshot.categories) &&
      Object.isFrozen(snapshot.categories[0]),
  );
  for (const mutate of [
    (s) => (s.workspace_id = id(2)),
    (s) => (s.purpose = 'UNKNOWN'),
    (s) => (s.path = 'SYNTHETIC'),
    (s) => s.categories.push(s.categories[0]),
    (s) => (s.categories[0].workspace_id = id(2)),
    (s) => (s.categories[0].is_seeded = 1),
    (s) => (s.categories[0].id = 'SYNTHETIC INVALID ID'),
  ]) {
    const s = structuredClone({ ...empty, categories: rows });
    mutate(s);
    assert.throws(() => decodeCategoriesSnapshot(s, w), {
      code: 'INVALID_RESPONSE',
    });
  }
});
test('category acknowledgement binds full expected catalog and supports exact seed or create replay after lost acknowledgement', () => {
  const plans = planCategories(w, 'PERSONAL', [], seed),
    result = {
      changed: true,
      category_ids: plans.map((p) => p.after.id),
      categories: plans.map((p) => p.after),
    };
  assert.equal(decodeCategoryResult(result, seed, empty).changed, true);
  assert.equal(
    decodeCategoryResult(
      { ...result, changed: false, category_ids: [] },
      seed,
      empty,
    ).changed,
    false,
  );
  for (const mutate of [
    (r) => r.category_ids.reverse(),
    (r) => (r.categories[0].name = 'SYNTHETIC WRONG ACK'),
    (r) => (r.categories[0].is_seeded = false),
    (r) => r.categories.pop(),
    (r) => (r.changed = false),
    (r) => (r.extra = 'SYNTHETIC'),
  ]) {
    const r = structuredClone(result);
    mutate(r);
    assert.throws(() => decodeCategoryResult(r, seed, empty), {
      code: 'INVALID_RESPONSE',
    });
  }
});
test('category update response cannot silently accept another state or imply a successful stale edit', () => {
  const categories = planCategories(w, 'PERSONAL', [], seed).map(
      (p) => p.after,
    ),
    base = { ...empty, categories },
    command = {
      kind: 'UPDATE',
      base: categories[0],
      name: 'SYNTHETIC RENAMED',
      status: 'ACTIVE',
      sort_order: 0,
    },
    plans = planCategories(w, 'PERSONAL', categories, command),
    after = [plans[0].after, ...categories.slice(1)];
  assert.equal(
    decodeCategoryResult(
      { changed: true, category_ids: [categories[0].id], categories: after },
      command,
      base,
    ).changed,
    true,
  );
  assert.throws(
    () =>
      decodeCategoryResult(
        { changed: false, category_ids: [], categories: after },
        command,
        base,
      ),
    { code: 'INVALID_RESPONSE' },
  );
  assert.throws(
    () =>
      decodeCategoryResult(
        { changed: true, category_ids: [categories[0].id], categories },
        command,
        base,
      ),
    { code: 'INVALID_RESPONSE' },
  );
  assert.ok(
    !localCategoryMessage(
      new LocalCategoryError('SYNTHETIC PRIVATE SQL'),
    ).includes('PRIVATE'),
  );
});
test('category native corpus is reproducible from the current shared service with 52 synthetic cases', () => {
  const r = spawnSync(
    process.execPath,
    ['infra/categories-desktop/generate.mjs', '--check'],
    { encoding: 'utf8' },
  );
  assert.equal(r.status, 0, r.stderr);
  const f = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us044-categories.json'),
  );
  assert.equal(f.synthetic_only, true);
  assert.equal(f.vectors.length, 52);
  assert.ok(
    f.vectors.some((v) => v.expected.error === 'CATEGORY_SEED_CONFLICT'),
  );
  assert.ok(
    f.vectors.some((v) => v.expected.error === 'CATEGORY_NAME_CONFLICT'),
  );
});
test('category product handler exposes exactly the 25 narrow capability commands and excludes finish probes', () => {
  const capability = JSON.parse(
    readFileSync('apps/desktop/src-tauri/capabilities/entry-main.json'),
  );
  assert.equal(capability.permissions.length, 29);
  const handler = readFileSync('apps/desktop/src-tauri/src/commands.rs', 'utf8')
    .split('pub fn production_builder()')[1]
    .match(/generate_handler!\[([\s\S]*?)\]/)[1]
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  assert.deepEqual(
    handler,
    capability.permissions.map((p) =>
      p.replace(/^allow-/, '').replaceAll('-', '_'),
    ),
  );
  assert.ok(!handler.some((c) => c.includes('finish_')));
});
const evidence = (kind) =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-044-desktop-categories-' +
        kind +
        '-2026-10-18-us047-associations.json',
    ),
  );
test('category Desktop evidence requires all UI SQLCipher interruption portability and cleanup gates', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateDesktopCategoryEvidence(evidence(kind)).passed, true);
    for (const name of checks) {
      const r = evidence(kind);
      delete r.checks[name];
      assert.throws(() => validateDesktopCategoryEvidence(r));
    }
  }
});
test('category Desktop evidence rejects stale sources private payloads invented human approval and cloud completion', () => {
  for (const mutate of [
    (r) => (r.pending = []),
    (r) => (r.resources_closed = false),
    (r) => (r.source_sha256['package.json'] = '0'.repeat(64)),
    (r) => (r.category_name = 'SYNTHETIC PRIVATE'),
    (r) => (r.checks.cloud_complete = true),
    (r) => (r.versions.tauri = '0.0.0'),
    (r) => (r.completed_at_utc = 'invalid'),
  ]) {
    const r = evidence('windows');
    mutate(r);
    assert.throws(() => validateDesktopCategoryEvidence(r));
  }
});
