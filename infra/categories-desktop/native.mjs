/* global setTimeout */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { permissions } from '../local-lock/evidence.mjs';
import { decodeCategoriesSnapshot } from '../../apps/desktop/dist/local-categories.js';
import {
  desktopCategoryHashes,
  pending,
  validateDesktopCategoryEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us044-desktop-categories'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  probe = path.join(target, 'debug/categories-probe.exe'),
  env = { ...process.env, CARGO_TARGET_DIR: target },
  pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] =
  path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin') +
  path.delimiter +
  env[pathKey];
const report = {
  format_version: 5,
  scope: 'us044-desktop-categories-windows',
  passed: false,
  synthetic_only: true,
  checks: {},
  versions: {},
  pending,
};
let own,
  locked = false,
  stage = 'configuration';
const cases = [];
const run = (command, args, cwd = crate, expected = 0) => {
  const r = spawnSync(command, args, {
    cwd,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(r.status, expected, 'CATEGORY_NATIVE_COMMAND_FAILED');
  return r;
};
const step = (name, action) => {
  stage = name;
  action();
  report.checks[name] = true;
  console.log('US044 category native: ' + name);
};
const invoke = (mode, store, expected = 0) => {
  const output = path.join(own, 'probe.json');
  run(probe, [mode, store, output], root, expected);
  if (expected !== 0) return null;
  const value = JSON.parse(readFileSync(output));
  assert.equal(value.passed, true);
  return value;
};
const prepare = (name) => {
  const store = path.join(own, name);
  cases.push(store);
  invoke('prepare', store);
  return store;
};
try {
  assert.equal(process.platform + '-' + process.arch, 'win32-x64');
  for (const folder of [path.join(root, '.tools'), directory]) {
    if (existsSync(folder))
      assert.equal(lstatSync(folder).isSymbolicLink(), false);
    else mkdirSync(folder);
  }
  mkdirSync(path.join(directory, '.native-lock'));
  locked = true;
  own = mkdtempSync(path.join(directory, 'run-'));
  report.versions = {
    node: process.versions.node,
    rust: run('rustc', ['--version']).stdout.trim(),
    tauri: '2.12.3',
    platform: 'win32-x64',
    aes_gcm: '0.11.1',
    argon2: '0.6.0',
  };
  step('locked_clippy_nine_tests_and_52_shared_vectors', () => {
    run('cargo', ['fmt', '--all', '--', '--check']);
    run('cargo', [
      'clippy',
      '--locked',
      '--all-targets',
      '--all-features',
      '--',
      '-D',
      'warnings',
    ]);
    assert.match(
      run('cargo', [
        'test',
        '--locked',
        '--lib',
        '--features',
        'categories-smoke',
        'category_tests',
      ]).stdout,
      /9 passed; 0 failed; 0 ignored/,
    );
    run(
      process.execPath,
      [path.join(root, 'infra/categories-desktop/generate.mjs'), '--check'],
      root,
    );
  });
  step('thirty_two_permissions_real_production_handler_and_no_probe', () => {
    assert.equal(permissions.length, 32);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(crate, 'capabilities/entry-main.json')))
        .permissions,
      permissions,
    );
    const handler = readFileSync(path.join(crate, 'src/commands.rs'), 'utf8')
      .split('pub fn production_builder()')[1]
      .match(/generate_handler!\[([\s\S]*?)\]/)[1]
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    assert.deepEqual(
      handler,
      permissions.map((p) => p.replace(/^allow-/, '').replaceAll('-', '_')),
    );
    run('cargo', ['build', '--locked', '--bin', 'financial-manager']);
    const binary = readFileSync(
      path.join(target, 'debug/financial-manager.exe'),
    );
    for (const marker of [
      'SYNTHETIC_US044_DESKTOP_ONLY',
      'US044_CATEGORY_VECTOR_MISMATCH',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.equal(binary.includes(Buffer.from(marker, encoding)), false);
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'categories-smoke',
      '--bin',
      'categories-probe',
      '--bin',
      'categories-smoke',
    ]);
    const p = JSON.parse(
      run('cargo', [
        'metadata',
        '--locked',
        '--no-deps',
        '--format-version',
        '1',
      ]).stdout,
    ).packages.find((p) => p.name === 'financial-manager-desktop');
    assert.deepEqual(p.features.default ?? [], []);
    for (const name of ['categories-probe', 'categories-smoke'])
      assert.deepEqual(
        p.targets.find((t) => t.name === name)['required-features'],
        ['categories-smoke'],
      );
  });
  const store = prepare('main');
  invoke('enable-pin', store);
  stage = 'webview';
  const output = path.join(own, 'webview.json');
  run(
    path.join(target, 'debug/categories-smoke.exe'),
    [output, path.join(own, 'webview-profile'), path.join(store, 'source')],
    root,
  );
  const ui = JSON.parse(readFileSync(output));
  assert.deepEqual(Object.keys(ui).sort(), ['checks', 'passed']);
  assert.equal(ui.passed, true);
  assert.deepEqual(
    Object.keys(ui.checks).sort(),
    [
      'category_crud_seed_and_order',
      'archive_keeps_seed_provenance',
      'lost_ack_frozen_category_id',
      'workspace_isolation',
      'lock_removes_financial_tree',
      'no_storage_or_egress',
    ].sort(),
  );
  for (const [name, value] of Object.entries(ui.checks)) {
    assert.equal(value, true);
    report.checks['webview_' + name] = true;
  }
  step('independent_process_reopens_edited_categories', () => {
    const raw = invoke('category-snapshot', store).snapshot,
      s = decodeCategoriesSnapshot(raw, raw.workspace_id);
    assert.equal(s.categories.length, 10);
    assert.equal(
      s.categories.find((r) => r.name === 'SYNTHETIC US044 UI').is_seeded,
      false,
    );
    const seeded = s.categories.find(
      (r) => r.name === 'SYNTHETIC US044 RENAMED',
    );
    assert.equal(seeded.is_seeded, true);
    assert.equal(seeded.status, 'ACTIVE');
    assert.equal(seeded.sort_order, 1);
  });
  step('used_category_preserves_financial_graph_and_balances', () =>
    invoke('category-used', store),
  );
  step('failed_seed_rolls_back_every_row', () => {
    const s = prepare('rollback');
    invoke('category-fail', s);
    assert.equal(invoke('category-snapshot', s).snapshot.categories.length, 0);
  });
  for (const [mode, code] of [
    ['first', 78],
    ['before', 79],
    ['after', 80],
  ])
    step('crash_' + mode + '_commit_atomic_seed', () => {
      const s = prepare('crash-' + mode);
      invoke('category-crash-' + mode, s, code);
      const count = invoke('category-snapshot', s).snapshot.categories.length;
      assert.equal(count, mode === 'after' ? 9 : 0);
      const result = invoke('category-seed', s).result;
      assert.equal(result.categories.length, 9);
      assert.equal(result.changed, mode !== 'after');
    });
  step('portable_restore_keeps_category_metadata_without_source_key', () => {
    const raw = invoke('roundtrip', store).snapshot,
      s = decodeCategoriesSnapshot(raw, raw.workspace_id);
    assert.equal(s.categories.length, 10);
    assert.ok(
      s.categories.some(
        (r) => r.name === 'SYNTHETIC US044 RENAMED' && r.is_seeded,
      ),
    );
    assert.ok(
      s.categories.some((r) => r.name === 'SYNTHETIC US044 UI' && !r.is_seeded),
    );
  });
  report.passed = true;
} catch {
  process.exitCode = 1;
  report.passed = false;
  const file = own && path.join(own, 'webview.json');
  if (file && existsSync(file)) {
    const d = JSON.parse(readFileSync(file));
    if (Number.isInteger(d.failure_stage))
      console.error('US044_WEBVIEW_STAGE_' + d.failure_stage);
  }
  console.error('US044_CATEGORY_NATIVE_FAILED_' + stage.toUpperCase());
} finally {
  try {
    if (own) {
      const relative = path.relative(directory, path.resolve(own));
      assert.ok(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      );
      assert.equal(lstatSync(own).isSymbolicLink(), false);
      let failed = false;
      for (const store of cases)
        try {
          if (!existsSync(store)) continue;
          assert.equal(lstatSync(store).isSymbolicLink(), false);
          assert.equal(
            readFileSync(path.join(store, '.us044-fixture'), 'utf8'),
            'SYNTHETIC_US044_ACCOUNTS_ONLY\n',
          );
          invoke('cleanup', store);
        } catch {
          failed = true;
        }
      assert.equal(failed, false, 'OWNED_KEY_CLEANUP_FAILED');
      for (let attempt = 0; attempt < 20; attempt++)
        try {
          rmSync(own, { recursive: true, force: true });
          break;
        } catch (e) {
          if (attempt === 19) throw e;
          await new Promise((r) => setTimeout(r, 500));
        }
      assert.equal(existsSync(own), false);
      report.checks.owned_keys_profiles_and_files_removed = true;
    }
    if (locked) {
      rmdirSync(path.join(directory, '.native-lock'));
      report.resources_closed = true;
    }
  } catch {
    report.passed = false;
    process.exitCode = 1;
    console.error('US044_CATEGORY_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = desktopCategoryHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateDesktopCategoryEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
