/* global setTimeout */
import assert from 'node:assert/strict';
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
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  workspaceHashes,
  validateWorkspaceEvidence,
  pending,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us031-workspaces'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target');
const env = { ...process.env, CARGO_TARGET_DIR: target };
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const perl = path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin');
if (existsSync(perl)) env[pathKey] = perl + path.delimiter + env[pathKey];
const report = {
  format_version: 2,
  scope: 'us031-local-workspace-windows',
  passed: false,
  checks: {},
  versions: {},
  pending,
};
let own,
  locked = false,
  stage = 'configuration';
const run = (command, args, cwd = crate, timeout = 900000) => {
  const result = spawnSync(command, args, {
    cwd,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw Error('WORKSPACE_NATIVE_COMMAND_FAILED');
  return result;
};
const step = (name, operation) => {
  stage = name;
  operation();
  report.checks[name] = true;
  console.log('US-031 native: ' + name);
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
    rust: run('rustc', ['--version']).stdout.trim(),
    tauri: '2.12.3',
    platform: 'win32-x64',
  };
  step('locked_clippy_build_and_six_rust_tests', () => {
    run(
      process.execPath,
      [path.join(root, 'infra/local-workspaces/generate.mjs'), '--check'],
      root,
    );
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
    const tests = run('cargo', [
      'test',
      '--locked',
      '--lib',
      '--features',
      'workspace-smoke',
    ]);
    assert.match(tests.stdout, /6 passed; 0 failed; 0 ignored/);
    run('cargo', ['build', '--locked', '--bin', 'financial-manager']);
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'workspace-smoke',
      '--bin',
      'workspace-smoke',
      '--bin',
      'workspace-probe',
    ]);
  });
  const store = path.join(own, 'store'),
    probe = path.join(target, 'debug/workspace-probe.exe'),
    smoke = path.join(target, 'debug/workspace-smoke.exe');
  step('only_narrow_product_permissions', () => {
    assert.deepEqual(
      JSON.parse(
        readFileSync(path.join(crate, 'capabilities/entry-main.json'), 'utf8'),
      ).permissions,
      [
        'allow-list-local-workspaces',
        'allow-create-local-workspace',
        'allow-open-local-workspace',
        'allow-local-lock-status',
        'allow-lock-local-session',
        'allow-unlock-local-session',
        'allow-configure-local-pin',
        'allow-disable-local-pin',
        'allow-configure-local-hello',
        'allow-unlock-local-hello',
      ],
    );
    assert.equal(
      readFileSync(path.join(crate, 'src/main.rs'), 'utf8').includes(
        'finish_workspace_smoke',
      ),
      false,
    );
  });
  const ui = (mode) => {
    const output = path.join(own, mode + '.json');
    run(
      smoke,
      [output, path.join(own, 'webview-' + mode), store, mode],
      root,
      60000,
    );
    const r = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(r.passed, true);
    assert.deepEqual(
      Object.keys(r.checks).sort(),
      [
        'local_form_without_identity',
        'created_via_narrow_ipc',
        'empty_overview_without_fake_balance',
        'reopened_or_listed',
        'no_web_storage_or_egress',
      ].sort(),
    );
    assert.ok(Object.values(r.checks).every((value) => value === true));
  };
  step('create_through_production_commands', () => ui('create'));
  stage = 'persistent_database_probe';
  const verify = path.join(own, 'verify.json');
  run(probe, ['verify', store, verify], root, 60000);
  const check = JSON.parse(readFileSync(verify, 'utf8'));
  assert.equal(check.passed, true);
  for (const [name, value] of Object.entries(check.checks)) {
    assert.equal(value, true);
    report.checks[name] = true;
  }
  step('reopen_in_another_webview_process', () => ui('reopen'));
  for (const [mode, gate] of [
    ['crash_key', 'recover_after_key_process_exit'],
    ['crash_db', 'recover_after_commit_process_exit'],
  ])
    step(gate, () => {
      const result = spawnSync(
        probe,
        [mode, store, path.join(own, 'unused.json')],
        { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 60000 },
      );
      assert.equal(result.status, 73);
      const file = path.join(own, 'recover.json');
      run(probe, ['recover', store, file], root, 60000);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
        passed: true,
        recovered: true,
      });
    });
  report.passed = true;
} catch {
  process.exitCode = 1;
  console.error('US031_NATIVE_FAILED_' + stage.toUpperCase());
} finally {
  try {
    if (own) {
      const resolved = path.resolve(own),
        relative = path.relative(directory, resolved);
      assert.ok(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      );
      assert.equal(lstatSync(resolved).isSymbolicLink(), false);
      const store = path.join(resolved, 'store');
      if (existsSync(path.join(store, '.installation-id'))) {
        const output = path.join(resolved, 'cleanup.json');
        run(
          path.join(target, 'debug/workspace-probe.exe'),
          ['cleanup', store, output],
          root,
          60000,
        );
        assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), {
          passed: true,
          keys_removed: true,
        });
      }
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
      report.checks.owned_keys_profiles_and_files_removed = true;
    }
    if (locked) {
      rmdirSync(path.join(directory, '.native-lock'));
      report.resources_closed = true;
    }
  } catch {
    report.passed = false;
    process.exitCode = 1;
    console.error('US031_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = workspaceHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateWorkspaceEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
