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
  writeFileSync,
  rmSync,
  rmdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { permissions } from '../local-lock/evidence.mjs';
import {
  decodeClassificationSnapshot,
  classificationRows,
  emptyClassificationFilter,
} from '../../apps/desktop/dist/local-classification-filters.js';
import {
  classificationFilterHashes,
  pending,
  validateClassificationFilterEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us045-desktop-classification-filters'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  probe = path.join(target, 'debug/taxonomy-probe.exe'),
  env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: '1' },
  pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] =
  path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin') +
  path.delimiter +
  env[pathKey];
const report = {
  format_version: 1,
  scope: 'us045-desktop-classification-filters-windows',
  passed: false,
  synthetic_only: true,
  checks: {},
  versions: {},
  pending,
};
let own,
  store,
  locked = false,
  stage = 'startup';
const run = (command, args, cwd = crate) => {
    const r = spawnSync(command, args, {
      cwd,
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 900000,
      maxBuffer: 8 * 1024 * 1024,
    });
    assert.equal(r.status, 0, 'FILTER_NATIVE_COMMAND_FAILED');
    return r;
  },
  invoke = (mode) => {
    const output = path.join(own, 'probe.json');
    run(probe, [mode, store, output], root);
    const value = JSON.parse(readFileSync(output));
    assert.equal(value.passed, true);
    return value;
  },
  step = (name, action) => {
    stage = name;
    action();
    report.checks[name] = true;
    console.log('US045 filters native: ' + name);
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
  store = path.join(own, 'fixture');
  report.versions = {
    node: process.versions.node,
    rust: run('rustc', ['--version']).stdout.trim(),
    tauri: '2.12.3',
    platform: 'win32-x64',
  };
  step('locked_clippy_six_read_only_tests', () => {
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
        'taxonomy-smoke',
        'classification_filter_tests',
      ]).stdout,
      /6 passed; 0 failed; 0 ignored/,
    );
  });
  step('unchanged_27_production_permissions_and_no_probe', () => {
    assert.equal(permissions.length, 27);
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
      'SYNTHETIC_US045_FILTERS_ONLY',
      'FILTER_SMOKE_FAILED',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.equal(binary.includes(Buffer.from(marker, encoding)), false);
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'taxonomy-smoke',
      '--bin',
      'taxonomy-probe',
      '--bin',
      'classification-filters-smoke',
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
    assert.deepEqual(
      p.targets.find((t) => t.name === 'classification-filters-smoke')[
        'required-features'
      ],
      ['taxonomy-smoke'],
    );
  });
  invoke('prepare');
  step('independent_process_complete_snapshot', () => {
    const raw = invoke('classification-snapshot').snapshot,
      w = raw.balance.workspace_id,
      s = decodeClassificationSnapshot(raw, w),
      rows = classificationRows(w, s, emptyClassificationFilter, '', '', '');
    assert.ok(rows.length > 0);
    assert.equal(
      rows.length,
      s.movements.transactions.filter((r) => !r.content.deleted).length,
    );
    assert.ok(s.catalog.items.some((r) => r.kind === 'TAG'));
    assert.ok(s.catalog.items.some((r) => r.kind === 'SUBCATEGORY'));
  });
  step('read_preserves_ciphertext_finance_and_audit', () => {
    invoke('classification-snapshot');
    invoke('classification-snapshot');
  });
  invoke('enable-pin');
  stage = 'webview';
  const output = path.join(own, 'webview.json');
  run(
    path.join(target, 'debug/classification-filters-smoke.exe'),
    [output, path.join(own, 'webview-profile'), path.join(store, 'source')],
    root,
  );
  const ui = JSON.parse(readFileSync(output));
  assert.equal(ui.passed, true);
  assert.deepEqual(Object.keys(ui).sort(), ['checks', 'passed']);
  assert.deepEqual(
    Object.keys(ui.checks).sort(),
    [
      'complete_filter_read',
      'category_subcategory_and_tags',
      'workspace_isolation',
      'lock_removes_tree',
      'no_storage_or_egress',
    ].sort(),
  );
  for (const [name, value] of Object.entries(ui.checks)) {
    assert.equal(value, true);
    report.checks['webview_' + name] = true;
  }
  invoke('classification-snapshot');
  report.passed = true;
} catch {
  report.passed = false;
  process.exitCode = 1;
  const file = own && path.join(own, 'webview.json');
  if (file && existsSync(file)) {
    const v = JSON.parse(readFileSync(file));
    if (Number.isInteger(v.failure_stage))
      console.error('US045_FILTER_WEBVIEW_STAGE_' + v.failure_stage);
  }
  console.error('US045_FILTER_NATIVE_FAILED_' + stage.toUpperCase());
} finally {
  try {
    if (own) {
      const relative = path.relative(directory, path.resolve(own));
      assert.ok(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      );
      assert.equal(lstatSync(own).isSymbolicLink(), false);
      if (store && existsSync(store)) {
        assert.equal(lstatSync(store).isSymbolicLink(), false);
        assert.equal(
          readFileSync(path.join(store, '.us045-taxonomy-fixture'), 'utf8'),
          'SYNTHETIC_US045_ACCOUNTS_ONLY\n',
        );
        invoke('cleanup');
      }
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
    console.error('US045_FILTER_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = classificationFilterHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateClassificationFilterEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
