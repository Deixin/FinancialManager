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
  entryHashes,
  entryPending,
  validateEntryEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us030-entry'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target');
const report = {
  format_version: 1,
  scope: 'us030-desktop-entry-windows',
  passed: false,
  checks: {},
  versions: {},
  pending: entryPending,
};
const env = { ...process.env, CARGO_TARGET_DIR: target };
let profile,
  locked = false,
  stage = 'configuration';
const run = (args) => {
  const result = spawnSync('cargo', args, {
    cwd: crate,
    env,
    windowsHide: true,
    encoding: 'utf8',
    timeout: 900000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw Error('NATIVE_BUILD_FAILED');
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
  const version = spawnSync('rustc', ['--version'], {
    cwd: crate,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
  assert.equal(version.status, 0);
  report.versions = {
    rust: version.stdout.trim(),
    tauri: '2.12.3',
    platform: 'win32-x64',
  };
  stage = 'locked_build_and_clippy';
  run(['fmt', '--all', '--', '--check']);
  run([
    'clippy',
    '--locked',
    '--all-targets',
    '--features',
    'entry-smoke',
    '--',
    '-D',
    'warnings',
  ]);
  run(['build', '--locked', '--bin', 'financial-manager']);
  report.checks.locked_build_and_clippy = true;
  assert.deepEqual(
    JSON.parse(
      readFileSync(path.join(crate, 'capabilities/entry-main.json'), 'utf8'),
    ).permissions,
    [],
  );
  assert.equal(
    readFileSync(path.join(crate, 'src/main.rs'), 'utf8').includes(
      'invoke_handler',
    ),
    false,
  );
  report.checks.production_capability_has_no_permissions = true;
  run([
    'build',
    '--locked',
    '--features',
    'entry-smoke',
    '--bin',
    'entry-smoke',
  ]);
  stage = 'webview_smoke';
  profile = mkdtempSync(path.join(directory, 'run-'));
  const output = path.join(profile, 'report.json');
  const result = spawnSync(
    path.join(target, 'debug/entry-smoke.exe'),
    [output, path.join(profile, 'webview')],
    { cwd: root, windowsHide: true, encoding: 'utf8', timeout: 60000 },
  );
  assert.equal(result.status, 0);
  const native = JSON.parse(readFileSync(output, 'utf8'));
  assert.equal(native.passed, true);
  const expected = [
    'embedded_entry',
    'cloud_disabled_offline',
    'local_without_identity',
    'local_heading_focus',
    'return_to_entry',
    'no_network_or_storage',
  ];
  assert.deepEqual(Object.keys(native.checks).sort(), expected.sort());
  for (const name of expected) {
    assert.equal(native.checks[name], true);
    report.checks[name] = true;
  }
  report.passed = true;
} catch {
  process.exitCode = 1;
  console.error('US030_NATIVE_FAILED_' + stage.toUpperCase());
} finally {
  try {
    if (profile) {
      const resolved = path.resolve(profile),
        relative = path.relative(directory, resolved);
      assert.ok(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      );
      assert.equal(lstatSync(resolved).isSymbolicLink(), false);
      // WebView2 can release its cache handles shortly after the app exits.
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
    }
    if (locked) {
      rmdirSync(path.join(directory, '.native-lock'));
      report.checks.owned_profile_removed = true;
      report.resources_closed = true;
    }
  } catch {
    report.passed = false;
    process.exitCode = 1;
    console.error('US030_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = entryHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateEntryEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
