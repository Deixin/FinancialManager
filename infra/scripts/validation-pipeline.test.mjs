import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import {
  digest,
  objectDigest,
  relativeInput,
  protocolSources,
  changedInputs,
  isCritical,
  isGoverned,
  selectSuites,
  safetyChanges,
  unclassifiedInputs,
  safetyInputsFor,
} from '../validation/policy.mjs';
import {
  readRecord,
  assertProtocolSources,
  readCatalog,
  currentEvidenceValidator,
  root,
} from '../validation/evidence.mjs';
import { assertCatalogCurrent } from '../validation/planner.mjs';
import { verifyCompletedRun, archiveReport } from '../validation/runner.mjs';

function fixture(t) {
  mkdirSync(path.join(root, '.tools'), { recursive: true });
  const directory = mkdtempSync(path.join(root, '.tools/validation-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(path.join(directory, 'docs/quality/evidence'), { recursive: true });
  mkdirSync(path.join(directory, 'apps'), { recursive: true });
  mkdirSync(path.join(directory, 'infra/scripts'), { recursive: true });
  writeFileSync(path.join(directory, 'apps/money.ts'), 'SYNTHETIC EXACT I64');
  writeFileSync(
    path.join(directory, 'infra/scripts/consumer.test.mjs'),
    'SYNTHETIC CONSUMER',
  );
  const report = {
    scope: 'synthetic-protocol',
    passed: true,
    resources_closed: true,
    completed_at_utc: '2026-10-21T12:00:01.000Z',
    source_sha256: {
      'apps/money.ts': digest('SYNTHETIC EXACT I64'),
      'infra/scripts/consumer.test.mjs': digest('SYNTHETIC CONSUMER'),
    },
  };
  const bytes = JSON.stringify(report);
  const entry = {
    scope: report.scope,
    report: 'docs/quality/evidence/synthetic.json',
    sha256: digest(bytes),
    content_sha256: objectDigest(report),
    sourceBase: '',
  };
  writeFileSync(path.join(directory, entry.report), bytes);
  return { directory, report, entry, bytes };
}

test('immutable evidence rejects edited bytes, scope substitution and traversal', (t) => {
  const f = fixture(t);
  assert.deepEqual(readRecord(f.entry, f.directory), f.report);
  assert.throws(
    () => readRecord({ ...f.entry, scope: 'foreign' }, f.directory),
    /IDENTITY/,
  );
  for (const file of [
    '../../secret',
    '/etc/secret',
    'C:/secret',
    'a\\..\\secret',
  ])
    assert.throws(() => relativeInput(file), /PATH_INVALID/);
  writeFileSync(path.join(f.directory, f.entry.report), f.bytes + ' ');
  assert.throws(() => readRecord(f.entry, f.directory), /ARTIFACT_CHANGED/);
});

test('catalog-only consumer edits do not renew a protocol but financial changes and deletions do', (t) => {
  const f = fixture(t);
  assertProtocolSources(f.report, f.entry, f.directory);
  writeFileSync(
    path.join(f.directory, 'infra/scripts/consumer.test.mjs'),
    'SYNTHETIC NEW REFERENCE',
  );
  assertProtocolSources(f.report, f.entry, f.directory);
  writeFileSync(
    path.join(f.directory, 'apps/money.ts'),
    'SYNTHETIC WRONG MONEY',
  );
  assert.throws(
    () => assertProtocolSources(f.report, f.entry, f.directory),
    /INPUT_CHANGED/,
  );
  rmSync(path.join(f.directory, 'apps/money.ts'));
  assert.throws(
    () => assertProtocolSources(f.report, f.entry, f.directory),
    /INPUT_CHANGED/,
  );
});

test('planning covers added and deleted inputs, critical guards and full verification', () => {
  assert.deepEqual(
    changedInputs({ a: 'old', removed: 'x' }, { a: 'new', added: 'y' }),
    ['a', 'added', 'removed'],
  );
  for (const file of [
    'apps/desktop/src-tauri/src/keys.rs',
    'packages/domain/src/money.ts',
    'packages/storage-schema/src/revisions.ts',
    'apps/api/persistence/postgres/migrations/new.sql',
  ])
    assert.equal(isCritical(file), true, file);
  assert.equal(isGoverned('packages/domain/src/new-policy.ts'), true);
  assert.equal(isGoverned('infra/scripts/example.test.mjs'), false);
  const states = [
    { scope: 'A', changed: [] },
    { scope: 'B', changed: ['apps/editor.ts'] },
  ];
  assert.deepEqual(
    selectSuites(states).map((s) => s.selected),
    [false, true],
  );
  assert.deepEqual(
    selectSuites(states, { full: true }).map((s) => s.selected),
    [true, true],
  );
  assert.equal(
    selectSuites([{ scope: 'A', changed: ['apps/keys.rs'] }])[0].reason,
    'critical',
  );
});

test('freshness gate refuses a successful exit with an old report or inputs changed in flight', (t) => {
  const { report, entry } = fixture(t);
  const valid = {
    entry,
    report,
    before: { a: 'one' },
    after: { a: 'one' },
    startedAt: Date.parse('2026-10-21T12:00:00.000Z'),
    outputModifiedAt: Date.parse('2026-10-21T12:00:01.000Z'),
    finishedAt: Date.parse('2026-10-21T12:00:02.000Z'),
    previousTimestamp: '2026-10-20T12:00:01.000Z',
  };
  verifyCompletedRun(valid);
  for (const change of [
    { after: { a: 'two' } },
    { report: { ...report, passed: false } },
    { report: { ...report, scope: 'foreign' } },
    { report: { ...report, completed_at_utc: '2026-10-20T12:00:01.000Z' } },
    { previousTimestamp: report.completed_at_utc },
    { outputModifiedAt: Date.parse('2026-10-20T12:00:01.000Z') },
    { outputModifiedAt: undefined },
  ])
    assert.throws(
      () => verifyCompletedRun({ ...valid, ...change }),
      /NOT_FRESH_OR_INPUTS_CHANGED/,
    );
  const deterministic = { ...report };
  delete deterministic.completed_at_utc;
  verifyCompletedRun({
    ...valid,
    report: deterministic,
    previousTimestamp: undefined,
  });
  assert.throws(
    () =>
      verifyCompletedRun({
        ...valid,
        report: deterministic,
        outputModifiedAt: valid.startedAt - 1,
      }),
    /NOT_FRESH/,
  );
});

test('archiving preserves original execution bytes and refuses a corrupted content-addressed destination', (t) => {
  const f = fixture(t);
  const catalog = { safetyBaselines: {} };
  const destination = archiveReport(catalog, f.entry, f.bytes, {}, f.directory);
  assert.equal(
    readFileSync(path.join(f.directory, destination), 'utf8'),
    f.bytes,
  );
  assert.equal(
    readFileSync(
      path.join(f.directory, 'docs/quality/evidence/synthetic.json'),
      'utf8',
    ),
    f.bytes,
  );
  assert.equal(f.entry.origin.kind, 'executed');
  archiveReport(catalog, f.entry, f.bytes, {}, f.directory);
  writeFileSync(path.join(f.directory, destination), 'SYNTHETIC TAMPERING');
  assert.throws(
    () => archiveReport(catalog, f.entry, f.bytes, {}, f.directory),
    /IMMUTABLE/,
  );
});

test('an unregistered synthetic report cannot use the historical compatibility path', () => {
  const validate = (report, { matchSources = true } = {}) => {
    if (matchSources || !report.passed)
      throw Error('SYNTHETIC_VALIDATOR_REJECTED');
    return report;
  };
  assert.throws(
    () =>
      currentEvidenceValidator(validate)({
        scope: 'unregistered',
        passed: true,
      }),
    /REJECTED/,
  );
});

test('critical changes reach every protocol and a completed step survives queue resumption', () => {
  const before = { 'apps/keys.rs': 'old' },
    after = { 'apps/keys.rs': 'new' };
  const first = digest(JSON.stringify(Object.entries(before).sort()));
  const next = digest(JSON.stringify(Object.entries(after).sort()));
  const baselines = { [first]: before, [next]: after };
  const states = ['completed', 'pending'].map((scope) => ({
    scope,
    changed: safetyChanges(
      baselines,
      scope === 'completed' ? next : first,
      after,
    ),
  }));
  assert.deepEqual(
    selectSuites(states).map((s) => s.selected),
    [false, true],
  );
  assert.throws(
    () => safetyChanges({ [first]: after }, first, after),
    /BASELINE_INVALID/,
  );
  const inventory = { 'packages/domain/old.ts': 'one' };
  assert.deepEqual(
    unclassifiedInputs(
      inventory,
      { ...inventory, 'packages/domain/new.ts': 'two' },
      new Set(),
    ),
    ['packages/domain/new.ts'],
  );
  assert.deepEqual(unclassifiedInputs(inventory, {}, new Set()), [
    'packages/domain/old.ts',
  ]);
  assert.deepEqual(
    unclassifiedInputs(
      inventory,
      { ...inventory, 'packages/domain/new.ts': 'two' },
      new Set(['packages/domain/new.ts']),
    ),
    [],
  );
});

test('Desktop guards propagate within Desktop while shared financial guards cover both runtimes', () => {
  const inputs = {
    'apps/desktop/src-tauri/src/keys.rs': 'native',
    'packages/domain/src/money.ts': 'shared',
  };
  assert.deepEqual(
    safetyInputsFor({ scope: 'example-windows' }, inputs),
    inputs,
  );
  assert.deepEqual(
    safetyInputsFor({ scope: 'example-browser' }, inputs),
    inputs,
  );
  assert.deepEqual(safetyInputsFor({ scope: 'example-shared' }, inputs), {
    'packages/domain/src/money.ts': 'shared',
  });
});

test('the mandatory final gate checks every active report and refuses uncovered product changes', async () => {
  const plan = await assertCatalogCurrent();
  assert.equal(plan.suites.length, readCatalog().entries.length);
  assert.equal(
    plan.suites.some((suite) => suite.selected),
    false,
  );
  assert.deepEqual(
    protocolSources(
      { source_sha256: { '../../package.json': 'abc' } },
      'infra/environments',
    ),
    { 'package.json': 'abc' },
  );
});
