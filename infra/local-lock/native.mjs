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
import {
  lockHashes,
  permissions,
  pending,
  validateLockEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us033-lock'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  probe = path.join(target, 'debug/lock-probe.exe');
const env = { ...process.env, CARGO_TARGET_DIR: target },
  pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH',
  perl = path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin');
if (existsSync(perl)) env[pathKey] = perl + path.delimiter + env[pathKey];
const report = {
  format_version: 3,
  scope: 'us033-local-lock-windows',
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
  const result = spawnSync(command, args, {
    cwd,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(result.status, expected, 'LOCAL_LOCK_NATIVE_COMMAND_FAILED');
  return result;
};
const step = (name, action) => {
  stage = name;
  action();
  report.checks[name] = true;
  console.log('US-033 native: ' + name);
};
const invoke = (mode, store, expected = 0) => {
  const output = path.join(own, 'probe.json');
  run(probe, [mode, store, output], root, expected, 120000);
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
    argon2: '0.6.0',
  };
  step('rustfmt_clippy_seventeen_privacy_tests', () => {
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
      run('cargo', ['test', '--locked', '--test', 'local_lock']).stdout,
      /10 passed; 0 failed; 0 ignored/,
    );
    assert.match(
      run('cargo', ['test', '--locked', '--test', 'local_hello']).stdout,
      /7 passed; 0 failed; 0 ignored/,
    );
  });
  step('locked_build_without_default_probe', () => {
    run('cargo', ['build', '--locked', '--bin', 'financial-manager']);
    const binary = readFileSync(
      path.join(target, 'debug/financial-manager.exe'),
    );
    for (const canary of [
      'SYNTHETIC_US033_ONLY',
      'US033_LOCK_PROBE_FAILED',
      '721947350682',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.equal(binary.includes(Buffer.from(canary, encoding)), false);
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'lock-smoke',
      '--bin',
      'lock-probe',
      '--bin',
      'lock-smoke',
      '--bin',
      'hello-manual',
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
    for (const name of ['lock-probe', 'lock-smoke', 'hello-manual'])
      assert.deepEqual(
        metadata.targets.find((t) => t.name === name)['required-features'],
        ['lock-smoke'],
      );
  });
  step('only_narrow_privacy_and_backup_permissions', () => {
    assert.deepEqual(
      JSON.parse(
        readFileSync(path.join(crate, 'capabilities/entry-main.json'), 'utf8'),
      ).permissions,
      permissions,
    );
  });
  step('windows_hello_availability_from_native_api', () => {
    const output = path.join(own, 'availability.json');
    run(probe, ['hello-availability', own, output]);
    const availability = JSON.parse(readFileSync(output, 'utf8'));
    assert.ok(
      [
        'AVAILABLE',
        'NOT_CONFIGURED',
        'DISABLED_BY_POLICY',
        'DEVICE_BUSY',
        'UNAVAILABLE',
      ].includes(availability),
    );
    report.versions.windows_hello = availability;
  });
  const store = prepare('main');
  invoke('enable', store);
  step('os_policy_not_plaintext_and_financial_state_preserved', () =>
    invoke('verify-files', store),
  );
  step('locked_commands_and_wrong_pin_preserve_ciphertext', () =>
    invoke('negative', store),
  );
  step('restart_requires_pin', () => invoke('restart', store));
  step('change_disable_requires_current_pin', () =>
    invoke('change-disable', store),
  );
  for (const [mode, gate] of [
    ['before', 'enable_crash_before_policy_write'],
    ['after', 'enable_crash_after_policy_write'],
  ])
    step(gate, () => {
      const fixture = prepare(mode);
      invoke('crash-' + mode, fixture, 73);
      invoke('recover-' + mode, fixture);
    });
  invoke('enable', store);
  stage = 'native_webview';
  const output = path.join(own, 'webview.json');
  run(
    path.join(target, 'debug/lock-smoke.exe'),
    [output, path.join(own, 'webview-profile'), store],
    root,
    0,
    120000,
  );
  const ui = JSON.parse(readFileSync(output, 'utf8'));
  assert.deepEqual(Object.keys(ui).sort(), ['checks', 'passed']);
  assert.equal(ui.passed, true);
  assert.deepEqual(
    Object.keys(ui.checks).sort(),
    [
      'boot_locked_without_names',
      'wrong_pin_preserves_closed_view',
      'unlock_through_native_commands',
      'manual_and_blur_remove_financial_tree',
      'policy_and_disable_with_current_pin',
      'no_storage_or_egress',
    ].sort(),
  );
  for (const [name, value] of Object.entries(ui.checks)) {
    assert.equal(value, true);
    report.checks['webview_' + name] = true;
    console.log('US-033 native: webview_' + name);
  }
  report.passed = true;
} catch {
  report.passed = false;
  process.exitCode = 1;
  console.error('US033_NATIVE_FAILED_' + stage.toUpperCase());
} finally {
  try {
    if (own) {
      const resolved = path.resolve(own),
        relative = path.relative(directory, resolved);
      assert.ok(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      );
      assert.equal(lstatSync(resolved).isSymbolicLink(), false);
      let failed = false;
      for (const store of cases) {
        try {
          if (!existsSync(store)) continue;
          assert.equal(lstatSync(store).isSymbolicLink(), false);
          assert.equal(
            readFileSync(path.join(store, '.us033-fixture'), 'utf8'),
            'SYNTHETIC_US033_ONLY\n',
          );
          invoke('cleanup', store);
        } catch {
          failed = true;
        }
      }
      assert.equal(failed, false, 'OWNED_CREDENTIAL_CLEANUP_FAILED');
      for (let attempt = 0; attempt < 20; attempt++) {
        try {
          rmSync(resolved, { recursive: true, force: true });
          break;
        } catch (error) {
          if (attempt === 19) throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      assert.equal(existsSync(resolved), false);
      report.checks.owned_credentials_profiles_and_files_removed = true;
    }
    if (locked) {
      rmdirSync(path.join(directory, '.native-lock'));
      report.resources_closed = true;
    }
  } catch {
    report.passed = false;
    process.exitCode = 1;
    console.error('US033_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = lockHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateLockEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
