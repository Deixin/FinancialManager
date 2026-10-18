/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import {
  captureLocalTaxonomy,
  decodeTaxonomySnapshot,
  decodeTaxonomyResult,
  LocalTaxonomyError,
  localTaxonomyMessage,
} from '../../apps/desktop/dist/local-taxonomy.js';
import {
  planTaxonomy,
  captureTaxonomyCatalog,
} from '../../packages/domain/dist/taxonomy.js';
import {
  syntheticTaxonomyHost,
  workspace as w,
  id,
} from '../taxonomy-desktop/fixture.mjs';
import {
  browserChecks,
  nativeChecks,
  validateDesktopTaxonomyEvidence,
} from '../taxonomy-desktop/evidence.mjs';
const command = () => ({
  kind: 'CREATE',
  item: {
    kind: 'TAG',
    id: id(500),
    workspace_id: w,
    name: 'SYNTHETIC TAG',
    status: 'ACTIVE',
  },
});
const base = () =>
  decodeTaxonomySnapshot(syntheticTaxonomyHost().snapshot(w), w);
const result = (c, b) => {
  const plans = planTaxonomy(
      w,
      { categories: b.categories, items: b.items },
      c,
    ),
    next = captureTaxonomyCatalog(
      {
        categories: b.categories,
        items: b.items
          .filter(
            (r) =>
              !plans.some(
                (p) => p.after.kind === r.kind && p.after.id === r.id,
              ),
          )
          .concat(plans.map((p) => p.after)),
      },
      w,
    );
  return {
    changed: plans.length > 0,
    item_ids: plans.map((p) => ({ kind: p.after.kind, id: p.after.id })),
    ...next,
  };
};
test('Desktop taxonomy vectors are generated from captured shared policy rather than a duplicated UI oracle', () => {
  const run = spawnSync(
    process.execPath,
    ['infra/taxonomy-desktop/generate.mjs', '--check'],
    { encoding: 'utf8', windowsHide: true },
  );
  assert.equal(run.status, 0);
  const vectors = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us045-taxonomy.json'),
  );
  assert.equal(vectors.synthetic_only, true);
  assert.equal(vectors.vectors.length, 77);
  assert.ok(vectors.vectors.some((r) => r.name === 'legacy_duplicate_archive'));
  assert.ok(
    vectors.vectors.some((r) => r.name === 'parent_archived_reactivate'),
  );
});
test('Desktop taxonomy transport freezes IDs bases and items while refusing unknown fields and invalid UUIDs', () => {
  const c = command(),
    captured = captureLocalTaxonomy(c, w);
  c.item.name = 'SYNTHETIC MUTATED';
  assert.equal(captured.item.name, 'SYNTHETIC TAG');
  assert.ok(Object.isFrozen(captured.item));
  for (const change of [
    { ...command(), extra: true },
    { ...command(), item: { ...command().item, amount_minor: '100' } },
    { ...command(), item: { ...command().item, id: 'invalid' } },
    { ...command(), item: { ...command().item, workspace_id: id(2) } },
  ])
    assert.throws(() => captureLocalTaxonomy(change, w), {
      code: 'INVALID_TAXONOMY_CHANGE',
    });
  assert.equal(
    new LocalTaxonomyError('SYNTHETIC PRIVATE CANARY').code,
    'STORAGE_UNAVAILABLE',
  );
  assert.ok(
    !localTaxonomyMessage(Error('SYNTHETIC PRIVATE CANARY')).includes(
      'PRIVATE',
    ),
  );
});
test('Desktop taxonomy snapshots reject foreign malformed duplicated and unbounded catalogs', () => {
  const raw = syntheticTaxonomyHost().snapshot(w);
  for (const change of [
    { ...raw, workspace_id: id(2) },
    { ...raw, extra: true },
    { ...raw, items: [{ ...command().item, extra: true }] },
    { ...raw, items: [command().item, command().item] },
    {
      ...raw,
      items: [
        {
          kind: 'SUBCATEGORY',
          id: id(501),
          workspace_id: w,
          name: 'SYNTHETIC',
          status: 'ACTIVE',
          category_id: id(999),
          sort_order: 0,
        },
      ],
    },
    { ...raw, items: Array(10001).fill(command().item) },
  ])
    assert.throws(() => decodeTaxonomySnapshot(change, w), {
      code: 'INVALID_RESPONSE',
    });
});
test('Desktop taxonomy acknowledgements match the entire shared plan including parent catalog IDs and changed status', () => {
  const b = base(),
    c = captureLocalTaxonomy(command(), w),
    good = result(c, b),
    value = decodeTaxonomyResult(good, c, b);
  assert.equal(value.changed, true);
  assert.ok(Object.isFrozen(value.items[0]));
  for (const mutate of [
    (r) => {
      r.changed = false;
    },
    (r) => {
      r.item_ids = [];
    },
    (r) => {
      r.item_ids[0].kind = 'SUBCATEGORY';
    },
    (r) => {
      r.items[0].name = 'SYNTHETIC WRONG';
    },
    (r) => {
      r.categories[0].name = 'SYNTHETIC OTHER';
    },
    (r) => {
      r.extra = true;
    },
  ]) {
    const raw = structuredClone(good);
    mutate(raw);
    assert.throws(() => decodeTaxonomyResult(raw, c, b), {
      code: 'INVALID_RESPONSE',
    });
  }
});
test('Desktop taxonomy exact CREATE replay accepts a lost acknowledgement without allowing an UPDATE rebase', () => {
  const b = base(),
    c = captureLocalTaxonomy(command(), w),
    good = result(c, b);
  assert.equal(
    decodeTaxonomyResult({ ...good, changed: false, item_ids: [] }, c, b)
      .changed,
    false,
  );
  const next = decodeTaxonomySnapshot(
      { workspace_id: w, categories: good.categories, items: good.items },
      w,
    ),
    update = {
      kind: 'UPDATE',
      base: good.items[0],
      item: { ...good.items[0], name: 'SYNTHETIC RENAMED' },
    };
  assert.throws(
    () =>
      decodeTaxonomyResult(
        { ...result(update, next), changed: false, item_ids: [] },
        update,
        next,
      ),
    { code: 'INVALID_RESPONSE' },
  );
});
test('Desktop taxonomy production exposes exactly twenty-nine narrow commands and excludes default probes', () => {
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
  assert.ok(!handler.some((s) => /sql|query|execute|finish_|probe/.test(s)));
  const cargo = readFileSync('apps/desktop/src-tauri/Cargo.toml', 'utf8');
  assert.ok(
    cargo.includes('required-features=["taxonomy-smoke"]') ||
      cargo.includes('required-features = ["taxonomy-smoke"]'),
  );
});
const evidence = (kind) =>
  JSON.parse(
    readFileSync(
      'docs/quality/evidence/us-045-desktop-taxonomy-' +
        kind +
        '-2026-10-18-us047-associations.json',
    ),
  );
test('Desktop taxonomy evidence requires UI native portability crash rollback and cleanup gates with current sources', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    assert.equal(validateDesktopTaxonomyEvidence(evidence(kind)).passed, true);
    for (const name of checks) {
      const r = evidence(kind);
      delete r.checks[name];
      assert.throws(() => validateDesktopTaxonomyEvidence(r));
    }
  }
});
test('Desktop taxonomy evidence refuses premature transaction editor or human approval and private payloads', () => {
  for (const mutate of [
    (r) => {
      r.pending = [];
    },
    (r) => {
      r.resources_closed = false;
    },
    (r) => {
      r.private_payload = 'SYNTHETIC';
    },
    (r) => {
      r.source_sha256['apps/desktop/src/local-taxonomy.ts'] = '0'.repeat(64);
    },
  ]) {
    const r = evidence('windows');
    mutate(r);
    assert.throws(() => validateDesktopTaxonomyEvidence(r));
  }
});
