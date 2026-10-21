import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
  existsSync,
  rmSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { hashes, pending, validateEvidence } from './evidence.mjs';
import {
  decodeImportPage,
  decodeImportDetail,
} from '../../apps/desktop/dist/local-imports.js';
import { defaultImportQuery } from '../../packages/domain/dist/imports.js';
import { decodeMovementsSnapshot } from '../../apps/desktop/dist/local-movements.js';
import { verifyNativeParity } from './parity.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us050-desktop-imports'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: '1' },
  pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] =
  path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin') +
  path.delimiter +
  env[pathKey];
const report = {
  format_version: 1,
  scope: 'us050-desktop-imports-windows',
  passed: false,
  synthetic_only: true,
  checks: {},
  versions: { node: process.versions.node, rust: '1.99.0', tauri: '2.12.3' },
  pending,
};
let own,
  store,
  stage = 'startup',
  revoked = false;
let financialBefore;
const stores = [];
function run(cmd, args, cwd = crate, expected = 0) {
  const r = spawnSync(cmd, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 900000,
    maxBuffer: 16 * 1024 * 1024,
  });
  if (r.status !== expected)
    writeFileSync(
      path.join(directory, 'diagnostic.log'),
      (r.stdout ?? '') + (r.stderr ?? ''),
    );
  assert.equal(r.status, expected, 'IMPORT_NATIVE_COMMAND_FAILED');
  return r;
}
function probe(mode, folder = store, expected = 0) {
  const output = path.join(own, 'probe.json');
  run(
    path.join(target, 'debug/imports-probe.exe'),
    [mode, folder, output],
    root,
    expected,
  );
  return expected === 0 ? JSON.parse(readFileSync(output)) : null;
}
function step(name, fn) {
  stage = name;
  fn();
  report.checks[name] = true;
  console.log('US050 native: ' + name);
}
try {
  mkdirSync(directory, { recursive: true });
  own = mkdtempSync(path.join(directory, 'owned-'));
  store = path.join(own, 'source');
  stores.push(store);
  step('locked_clippy_seven_sqlcipher_tests_and_102_shared_vectors', () => {
    assert.equal(process.platform + '-' + process.arch, 'win32-x64');
    report.versions.rust = run('rustc', ['--version']).stdout.trim();
    run(
      process.execPath,
      ['infra/local-workspaces/generate.mjs', '--check'],
      root,
    );
    run(
      process.execPath,
      ['infra/imports-desktop/generate.mjs', '--check'],
      root,
    );
    run('cargo', ['fmt', '--all', '--', '--check']);
    run('cargo', [
      'clippy',
      '--locked',
      '--features',
      'imports-smoke',
      '--all-targets',
      '--',
      '-D',
      'warnings',
    ]);
    const t = run('cargo', [
      'test',
      '--locked',
      '--lib',
      '--features',
      'imports-smoke',
      'import_tests',
      '--',
      '--test-threads=1',
    ]);
    assert.match(t.stdout, /7 passed; 0 failed; 0 ignored/);
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'imports-smoke',
      '--bin',
      'imports-probe',
      '--bin',
      'imports-smoke',
    ]);
    run('cargo', ['build', '--locked', '--bin', 'financial-manager']);
  });
  step('production_35_narrow_permissions', () => {
    const p = JSON.parse(
      readFileSync(path.join(crate, 'capabilities/entry-main.json')),
    ).permissions;
    assert.equal(p.length, 35);
    for (const c of [
      'list_local_imports',
      'read_local_import',
      'prepare_local_import',
    ])
      assert.ok(p.includes('allow-' + c.replaceAll('_', '-')));
    const binary = readFileSync(
      path.join(target, 'debug/financial-manager.exe'),
    );
    const handler = readFileSync(path.join(crate, 'src/commands.rs'), 'utf8')
      .split('pub fn production_builder()')[1]
      .match(/generate_handler!\[([\s\S]*?)\]/)[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    assert.deepEqual(
      handler,
      p.map((c) => c.replace(/^allow-/, '').replaceAll('-', '_')),
    );
    for (const marker of [
      'SYNTHETIC US050 driver',
      'IMPORT_PROTOCOL_FAILED',
      'IMPORT_SMOKE_FAILED',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.ok(!binary.includes(Buffer.from(marker, encoding)));
  });
  step('independent_process_reopens_ledger', () => {
    probe('prepare');
    const a = probe('read'),
      b = probe('read');
    assert.deepEqual(a, b);
    const w = a.detail.batch.workspace_id;
    decodeImportPage(a.page, w, { ...defaultImportQuery, limit: 100 });
    decodeImportDetail(a.detail, w, {
      id: a.detail.batch.id,
      effect_after: null,
      effect_limit: 100,
    });
    assert.equal(a.detail.counts.total_items, '7');
    assert.equal(a.detail.counts.total_effects, '6');
    const snapshot = decodeMovementsSnapshot(probe('movements').snapshot, w);
    financialBefore = JSON.parse(JSON.stringify(snapshot));
    delete financialBefore.balance.read_at;
  });
  stage = 'shared_port_matches_native_pages_details_prepare_and_replay';
  await verifyNativeParity(
    probe('read'),
    probe('parity'),
    probe('prepare-header'),
  );
  report.checks[stage] = true;
  console.log('US050 native: ' + stage);
  step('webview_real_commands_and_frozen_retry', () => {
    const output = path.join(own, 'webview.json');
    run(
      path.join(target, 'debug/imports-smoke.exe'),
      [output, path.join(own, 'profile'), store],
      root,
    );
    const r = JSON.parse(readFileSync(output));
    assert.equal(r.passed, true);
    assert.equal(Object.values(r.checks).filter(Boolean).length, 6);
    report.versions.webview2 = 'real-native-host';
    const after = probe('movements').snapshot;
    delete after.balance.read_at;
    assert.deepEqual(after, financialBefore);
  });
  step('portable_restore_without_source_credentials', () => {
    const before = probe('read').detail;
    probe('backup');
    probe('cleanup');
    revoked = true;
    probe('read', store, 1);
    const restored = store + '.restored';
    stores.push(restored);
    const r = probe('restore');
    assert.notEqual(r.workspace.id, before.batch.workspace_id);
    assert.notEqual(r.detail.batch.id, before.batch.id);
    assert.deepEqual(r.detail.counts, before.counts);
    assert.equal(r.detail.sources[0].file_hash, before.sources[0].file_hash);
    assert.equal(r.detail.effects.length, 6);
    for (const e of r.detail.effects) {
      assert.ok(
        before.effects.every(
          (old) => old.id !== e.id && old.transaction_id !== e.transaction_id,
        ),
      );
    }
    assert.equal(r.preview.record_counts.import_item, '7');
  });
  report.passed = true;
} catch (error) {
  writeFileSync(path.join(directory, 'failure.log'), String(error));
  report.passed = false;
  report.failure_stage = stage;
  process.exitCode = 1;
} finally {
  if (own && existsSync(path.join(own, 'webview.json')))
    writeFileSync(
      path.join(directory, 'webview-diagnostic.json'),
      readFileSync(path.join(own, 'webview.json')),
    );
  let clean = true;
  for (const s of stores) {
    if (!existsSync(s) || (s === store && revoked)) continue;
    try {
      probe('cleanup', s);
    } catch {
      clean = false;
    }
  }
  if (own && clean) {
    const resolved = path.resolve(own);
    assert.ok(resolved.startsWith(path.resolve(directory) + path.sep));
    rmSync(resolved, { recursive: true, force: true });
  }
  report.resources_closed = clean && (!own || !existsSync(own));
  report.checks.owned_keys_profiles_files_removed = report.resources_closed;
  report.source_sha256 = hashes();
  if (report.passed) validateEvidence(report);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    path.join(directory, 'windows.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
}
