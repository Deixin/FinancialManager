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
import { resourceId } from '../../packages/contracts/dist/index.js';
import {
  movementHashes,
  pending,
  validateMovementEvidence,
} from './evidence.mjs';
import { decodeMovementsSnapshot } from '../../apps/desktop/dist/local-movements.js';
import { accountRows } from '../../apps/desktop/dist/local-accounts.js';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us041-desktop-movements'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  probe = path.join(target, 'debug/movements-probe.exe');
const env = { ...process.env, CARGO_TARGET_DIR: target },
  pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] =
  path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin') +
  path.delimiter +
  env[pathKey];
const report = {
  format_version: 2,
  scope: 'us041-desktop-movements-windows',
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
  assert.equal(r.status, expected, 'DESKTOP_ACCOUNT_NATIVE_COMMAND_FAILED');
  return r;
};
const step = (name, action) => {
  stage = name;
  action();
  report.checks[name] = true;
  console.log('US041 movements native: ' + name);
};
const invoke = (mode, store, expected = 0) => {
  const output = path.join(own, 'probe.json');
  run(probe, [mode, store, output], root, expected, 900000);
  if (expected !== 0) return null;
  const value = JSON.parse(readFileSync(output, 'utf8'));
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
  step('locked_clippy_ten_tests_and_80_shared_vectors', () => {
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
    const output = run('cargo', [
      'test',
      '--locked',
      '--features',
      'movements-smoke',
      '--test',
      'local_movements',
    ]).stdout;
    assert.match(output, /10 passed; 0 failed; 0 ignored/);
    run(
      process.execPath,
      ['infra/movements-desktop/generate.mjs', '--check'],
      root,
    );
  });
  step('twenty_one_narrow_permissions_without_default_probes', () => {
    run('cargo', ['build', '--locked', '--bin', 'financial-manager']);
    const binary = readFileSync(
      path.join(target, 'debug/financial-manager.exe'),
    );
    for (const marker of [
      'SYNTHETIC_US041_DESKTOP_ONLY',
      'US041_NATIVE_MOVEMENT_PROBE_FAILED',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.equal(binary.includes(Buffer.from(marker, encoding)), false);
    assert.deepEqual(
      JSON.parse(readFileSync(path.join(crate, 'capabilities/entry-main.json')))
        .permissions,
      permissions,
    );
    assert.equal(permissions.length, 21);
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
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'movements-smoke',
      '--bin',
      'movements-probe',
      '--bin',
      'movements-smoke',
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
    for (const name of ['movements-probe', 'movements-smoke'])
      assert.deepEqual(
        p.targets.find((t) => t.name === name)['required-features'],
        ['movements-smoke'],
      );
  });
  const store = prepare('main');
  invoke('enable-pin', store);
  stage = 'webview';
  const output = path.join(own, 'webview.json');
  run(
    path.join(target, 'debug/movements-smoke.exe'),
    [output, path.join(own, 'webview-profile'), path.join(store, 'source')],
    root,
  );
  const ui = JSON.parse(readFileSync(output));
  assert.deepEqual(Object.keys(ui).sort(), ['checks', 'passed']);
  assert.equal(ui.passed, true);
  assert.deepEqual(
    Object.keys(ui.checks).sort(),
    [
      'crud_history_and_soft_deletion',
      'explicit_adjustment',
      'lost_ack_frozen_intent',
      'workspace_isolation',
      'lock_removes_financial_data',
      'no_storage_or_egress',
    ].sort(),
  );
  for (const [name, value] of Object.entries(ui.checks)) {
    assert.equal(value, true);
    report.checks['webview_' + name] = true;
  }
  step('independent_reopen_and_account_balances', () => {
    const value = invoke('verify-ui', store),
      snapshot = decodeMovementsSnapshot(
        value.snapshot,
        value.snapshot.balance.workspace_id,
      );
    const rows = accountRows(snapshot.balance, '2026-10-17');
    assert.equal(
      rows.find(
        (r) => r.state.account.id === '0199d141-0000-7000-8000-000000000002',
      ).value.balance.amount_minor,
      '130123',
    );
    assert.equal(
      rows.find(
        (r) => r.state.account.id === '0199d141-0000-7000-8000-000000000003',
      ).value.balance.amount_minor,
      '200000',
    );
    assert.equal(snapshot.history.length, 6);
  });
  step('crash_before_commit_no_partial_transaction_or_revision', () => {
    const crashed = prepare('before');
    invoke('crash-before', crashed, 76);
    const id = resourceId(readFileSync(path.join(crashed, 'other.id'), 'utf8')),
      journal = path.join(crashed, 'source/workspaces', id, 'vault.db-journal');
    assert.ok(existsSync(journal));
    const bytes = readFileSync(journal);
    assert.ok(bytes.length > 512);
    for (const marker of ['SYNTHETIC CRASH', 'SQLite format 3'])
      assert.equal(bytes.includes(Buffer.from(marker)), false);
    invoke('verify-before', crashed);
    assert.equal(existsSync(journal), false);
  });
  step('crash_after_commit_explicit_conflict_without_duplicate', () => {
    const committed = prepare('after');
    invoke('crash-after', committed, 77);
    invoke('verify-after', committed);
  });
  step('portable_backup_restores_history_with_new_ids', () => {
    const value = invoke('roundtrip', store),
      snapshot = decodeMovementsSnapshot(
        value.snapshot,
        value.snapshot.balance.workspace_id,
      );
    assert.equal(snapshot.transactions.length, 3);
    assert.equal(snapshot.history.length, 6);
    assert.ok(
      snapshot.history.every(
        (h) =>
          h.compatible &&
          h.snapshot.after.workspace_id === snapshot.balance.workspace_id,
      ),
    );
    const amounts = accountRows(snapshot.balance, '2026-10-17')
      .map((r) => r.value.balance.amount_minor)
      .sort();
    assert.deepEqual(amounts, ['130123', '200000']);
  });
  report.passed = true;
} catch {
  const uiFile = own && path.join(own, 'webview.json');
  if (uiFile && existsSync(uiFile)) {
    const diagnostic = JSON.parse(readFileSync(uiFile, 'utf8'));
    if (
      Number.isInteger(diagnostic.failure_stage) &&
      diagnostic.failure_stage >= 0 &&
      diagnostic.failure_stage <= 12
    )
      console.error('US041_WEBVIEW_FAILED_STAGE_' + diagnostic.failure_stage);
  }
  report.passed = false;
  process.exitCode = 1;
  console.error('US041_NATIVE_FAILED_' + stage.toUpperCase());
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
            readFileSync(path.join(store, '.us041-fixture'), 'utf8'),
            'SYNTHETIC_US041_DESKTOP_ONLY\n',
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
    console.error('US041_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = movementHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateMovementEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
