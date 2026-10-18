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
import {
  restoreHashes,
  pending,
  validateRestoreEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us035-restore'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  probe = path.join(target, 'debug/restore-probe.exe');
const env = { ...process.env, CARGO_TARGET_DIR: target },
  pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] =
  path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin') +
  path.delimiter +
  env[pathKey];
const report = {
  format_version: 1,
  scope: 'us035-restore-windows',
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
const run = (command, args, cwd = crate, expected = 0, timeout = 900000) => {
  const r = spawnSync(command, args, {
    cwd,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(r.status, expected, 'RESTORE_NATIVE_COMMAND_FAILED');
  return r;
};
const step = (name, action) => {
  stage = name;
  action();
  report.checks[name] = true;
  console.log('US-035 native: ' + name);
};
const invoke = (mode, store, expected = 0) => {
  const output = path.join(own, 'probe.json');
  run(probe, [mode, store, output], root, expected, 180000);
  if (expected === 0)
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), {
      passed: true,
    });
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
  step('locked_fmt_clippy_fourteen_restore_tests', () => {
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
        '--features',
        'restore-smoke',
        '--test',
        'local_restore',
      ]).stdout,
      /14 passed; 0 failed; 0 ignored/,
    );
  });
  step('default_without_restore_probe_or_wide_permissions', () => {
    run('cargo', ['build', '--locked', '--bin', 'financial-manager']);
    const binary = readFileSync(
      path.join(target, 'debug/financial-manager.exe'),
    );
    for (const canary of [
      'SYNTHETIC_US035_ONLY',
      'US035_RESTORE_PROBE_FAILED',
      'SYNTHETIC restore password US035',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.equal(binary.includes(Buffer.from(canary, encoding)), false);
    assert.deepEqual(
      JSON.parse(
        readFileSync(path.join(crate, 'capabilities/entry-main.json'), 'utf8'),
      ).permissions,
      permissions,
    );
    assert.equal(permissions.length, 25);
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'restore-smoke',
      '--bin',
      'restore-probe',
      '--bin',
      'restore-smoke',
    ]);
    const metadata = JSON.parse(
      run('cargo', [
        'metadata',
        '--locked',
        '--no-deps',
        '--format-version',
        '1',
      ]).stdout,
    ).packages.find((p) => p.name === 'financial-manager-desktop');
    assert.deepEqual(metadata.features.default ?? [], []);
    for (const name of ['restore-probe', 'restore-smoke'])
      assert.deepEqual(
        metadata.targets.find((t) => t.name === name)['required-features'],
        ['restore-smoke'],
      );
  });
  const store = prepare('main');
  step('preview_unpublished_and_source_preserved', () =>
    invoke('preview-cancel', store),
  );
  step('wrong_password_tampered_and_unsupported_fail_closed', () =>
    invoke('negative', store),
  );
  step('independent_installation_new_ids_key_generation', () => {
    invoke('erase-source-key', store);
    invoke('restore', store);
    invoke('verify', store);
  });
  step('replay_idempotent_after_restart', () => invoke('replay', store));
  for (const [mode, gate] of [
    ['staged', 'crash_after_staging_recovers_key'],
    ['before', 'crash_before_publish_recovers_without_new_workspace'],
    ['after', 'crash_after_publish_has_complete_new_workspace'],
  ])
    step(gate, () => {
      const fixture = prepare(mode);
      invoke('crash-' + mode, fixture, 73);
      invoke('recover-' + mode, fixture);
    });
  const uiStore = prepare('ui');
  invoke('enable-pin', uiStore);
  stage = 'native_webview';
  const output = path.join(own, 'webview.json');
  run(
    path.join(target, 'debug/restore-smoke.exe'),
    [output, path.join(own, 'webview-profile'), uiStore],
    root,
    0,
    360000,
  );
  const ui = JSON.parse(readFileSync(output, 'utf8'));
  assert.deepEqual(Object.keys(ui).sort(), ['checks', 'passed']);
  assert.equal(ui.passed, true);
  assert.deepEqual(
    Object.keys(ui.checks).sort(),
    [
      'picker_policy_and_reauthentication',
      'invalid_secret_preserves_existing',
      'verified_preview_counts_and_no_publication',
      'confirmed_restore_opens_new_local_workspace',
      'canceled_preview_removes_stage',
      'no_storage_or_egress',
    ].sort(),
  );
  for (const [name, value] of Object.entries(ui.checks)) {
    assert.equal(value, true);
    report.checks['webview_' + name] = true;
    console.log('US-035 native: webview_' + name);
  }
  step('webview_restored_graph_verified', () => invoke('verify-ui', uiStore));
  report.passed = true;
} catch {
  const uiFile = own && path.join(own, 'webview.json');
  if (uiFile && existsSync(uiFile)) {
    const diagnostic = JSON.parse(readFileSync(uiFile, 'utf8'));
    if (
      Number.isInteger(diagnostic.failure_stage) &&
      diagnostic.failure_stage >= 10 &&
      diagnostic.failure_stage <= 95
    )
      console.error('US035_WEBVIEW_FAILED_STAGE_' + diagnostic.failure_stage);
  }
  report.passed = false;
  process.exitCode = 1;
  console.error('US035_NATIVE_FAILED_' + stage.toUpperCase());
} finally {
  try {
    if (own) {
      const relative = path.relative(directory, path.resolve(own));
      assert.ok(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      );
      assert.equal(lstatSync(own).isSymbolicLink(), false);
      let failed = false;
      for (const store of cases) {
        try {
          if (!existsSync(store)) continue;
          assert.equal(lstatSync(store).isSymbolicLink(), false);
          assert.equal(
            readFileSync(path.join(store, '.us035-fixture'), 'utf8'),
            'SYNTHETIC_US035_ONLY\n',
          );
          invoke('cleanup', store);
        } catch {
          failed = true;
        }
      }
      assert.equal(failed, false, 'OWNED_CREDENTIAL_CLEANUP_FAILED');
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          rmSync(own, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 19) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      assert.equal(existsSync(own), false);
      report.checks.owned_keys_policy_profiles_and_files_removed = true;
    }
    if (locked) {
      rmdirSync(path.join(directory, '.native-lock'));
      report.resources_closed = true;
    }
  } catch {
    report.passed = false;
    process.exitCode = 1;
    console.error('US035_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = restoreHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateRestoreEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
