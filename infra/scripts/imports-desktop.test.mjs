import {
  readEvidenceFile as readFileSync,
  currentEvidenceValidator,
} from '../validation/evidence.mjs';
/* global structuredClone */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  captureLocalImportPrepare,
  captureLocalImportQuery,
  captureLocalImportDetail,
  decodeImportPage,
  decodeImportDetail,
  decodeImportPrepare,
  createLocalImportsGateway,
  localImportMessage,
  LocalImportError,
} from '../../apps/desktop/dist/local-imports.js';
import {
  syntheticImportHost,
  workspace,
  id,
} from '../imports-desktop/fixture.mjs';
import { defaultImportQuery } from '../../packages/domain/dist/imports.js';
import {
  validateEvidence as rawValidateEvidence,
  browserChecks,
  nativeChecks,
} from '../imports-desktop/evidence.mjs';

const validateEvidence = currentEvidenceValidator(rawValidateEvidence);

test('Desktop import inputs capture intent and reject extensions malformed IDs omitted nulls and invalid limits', () => {
  const raw = { ...defaultImportQuery, statuses: ['FAILED'] },
    q = captureLocalImportQuery(raw);
  raw.statuses.push('REVIEW');
  assert.deepEqual(q.statuses, ['FAILED']);
  assert.ok(Object.isFrozen(q.statuses));
  for (const input of [
    { id: id(900) },
    { id: id(900), target_account_id: 'invalid' },
    { id: id(900), target_account_id: id(10), extra: true },
  ])
    assert.throws(() => captureLocalImportPrepare(input));
  for (const input of [
    { id: id(100), effect_limit: 1 },
    { id: id(100), effect_after: null, effect_limit: 0 },
  ])
    assert.throws(() => captureLocalImportDetail(input));
  assert.throws(() =>
    captureLocalImportQuery({ ...defaultImportQuery, limit: 101 }),
  );
  assert.equal(createLocalImportsGateway(), null);
});
test('Desktop import pages validate order filters cursor counts and all-or-nothing shape', async () => {
  const h = syntheticImportHost(),
    q = { ...defaultImportQuery, limit: 2 },
    p = await h.service.list({ workspace_id: workspace }, q);
  assert.equal(decodeImportPage(p, workspace, q).items.length, 2);
  for (const mutate of [
    (r) => r.items.reverse(),
    (r) => r.items.push(r.items[0]),
    (r) => {
      r.items[1].batch.id = r.items[0].batch.id;
      r.items[1].batch.created_at = '2026-10-17T12:00:00.000Z';
      r.next_cursor = {
        id: r.items[1].batch.id,
        created_at: r.items[1].batch.created_at,
      };
    },
    (r) => {
      r.next_cursor.id = id(999);
    },
    (r) => {
      r.items[0].counts.total_items = '99';
    },
    (r) => {
      r.items[0].batch.workspace_id = id(999);
    },
    (r) => {
      r.items[0].sources.push({});
    },
  ]) {
    const bad = structuredClone(p);
    mutate(bad);
    assert.throws(() => decodeImportPage(bad, workspace, q));
  }
  assert.throws(() =>
    decodeImportPage(p, workspace, { ...q, statuses: ['FAILED'] }),
  );
});
test('Desktop import detail binds sources effects revisions pagination and batch IDs', async () => {
  const h = syntheticImportHost(),
    q = { id: id(103), effect_after: null, effect_limit: 50 },
    p = await h.service.detail({ workspace_id: workspace }, q);
  assert.equal(decodeImportDetail(p, workspace, q).effects.length, 1);
  for (const mutate of [
    (r) => {
      r.batch.id = id(999);
    },
    (r) => {
      r.sources[0].file_name = '../private';
    },
    (r) => {
      r.effects[0].batch_id = id(999);
    },
    (r) => {
      r.effects[0].after_revision_id = null;
    },
    (r) => {
      r.next_effect_cursor = id(999);
    },
    (r) => {
      r.counts.total_effects = '0';
    },
    (r) => {
      r.sources[0].parser_name = null;
    },
  ]) {
    const bad = structuredClone(p);
    mutate(bad);
    assert.throws(() => decodeImportDetail(bad, workspace, q));
  }
});
test('Desktop prepare ACK matches immutable ID account actor and new-header invariants with advanced replay', async () => {
  const h = syntheticImportHost(),
    c = captureLocalImportPrepare({
      id: id(900),
      target_account_id: h.account,
    }),
    r = await h.service.prepare({ workspace_id: workspace }, c);
  assert.equal(decodeImportPrepare(r, workspace, c).created, true);
  h.batches.find((b) => b.id === c.id).status = 'REVIEW';
  const replay = await h.service.prepare({ workspace_id: workspace }, c);
  assert.equal(decodeImportPrepare(replay, workspace, c).created, false);
  for (const mutate of [
    (r) => {
      r.batch.id = id(901);
    },
    (r) => {
      r.batch.created_by_member_id = id(902);
    },
    (r) => {
      r.batch.version = '2';
    },
    (r) => {
      r.created = false;
      r.extra = true;
    },
  ]) {
    const bad = structuredClone(r);
    mutate(bad);
    assert.throws(() => decodeImportPrepare(bad, workspace, c));
  }
});
test('Desktop safe errors do not reflect transport paths amounts or document names', () => {
  assert.ok(
    !localImportMessage(
      new LocalImportError('SYNTHETIC_PRIVATE_FILE'),
    ).includes('PRIVATE'),
  );
  assert.match(
    localImportMessage(new LocalImportError('IMPORT_ACCOUNT_UNAVAILABLE')),
    /ativa/,
  );
});
test('Desktop imports share 102 real policy vectors and expose only 35 narrow commands', () => {
  const f = JSON.parse(
    readFileSync('apps/desktop/src-tauri/fixtures/us050-imports.json'),
  );
  assert.equal(f.length, 102);
  assert.ok(f.some((v) => v.name === 'version_9223372036854775807' && v.valid));
  assert.ok(
    f.some((v) => v.name === 'version_9223372036854775808' && !v.valid),
  );
  const p = JSON.parse(
    readFileSync('apps/desktop/src-tauri/capabilities/entry-main.json'),
  ).permissions;
  assert.equal(p.length, 36);
  assert.ok(p.includes('allow-prepare-local-import'));
  assert.ok(!p.some((k) => /sql|filesystem|finish-imports/.test(k)));
});
test('Desktop imports evidence requires current sources every gate and cleanup', () => {
  for (const kind of ['browser', 'windows']) {
    const r = JSON.parse(
      readFileSync(
        'docs/quality/evidence/us-050-desktop-imports-' +
          kind +
          '-2026-10-20.json',
      ),
    );
    assert.equal(validateEvidence(r).passed, true);
    for (const k of kind === 'browser' ? browserChecks : nativeChecks) {
      const bad = structuredClone(r);
      delete bad.checks[k];
      assert.throws(() => validateEvidence(bad));
    }
    for (const patch of [
      { resources_closed: false },
      { passed: false },
      { source_sha256: {} },
      { extra: true },
    ])
      assert.throws(() => validateEvidence({ ...r, ...patch }));
  }
});
