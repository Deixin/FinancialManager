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
import { canonicalFixture as fixture } from '../../packages/test-fixtures/dist/canonical.js';
import {
  decodeAccountsSnapshot,
  accountRows,
} from '../../apps/desktop/dist/local-accounts.js';
import { resourceId } from '../../packages/contracts/dist/index.js';
import {
  desktopAccountHashes,
  pending,
  validateDesktopAccountEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us040-desktop-accounts'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  probe = path.join(target, 'debug/accounts-probe.exe');
const env = { ...process.env, CARGO_TARGET_DIR: target },
  pathKey =
    Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] =
  path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin') +
  path.delimiter +
  env[pathKey];
const report = {
  format_version: 9,
  scope: 'us040-desktop-accounts-windows',
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
  console.log('US-040 accounts native: ' + name);
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
  step('locked_build_clippy_ten_tests_and_62_domain_vectors', () => {
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
      'accounts-smoke',
      '--test',
      'local_accounts',
    ]).stdout;
    assert.match(output, /10 passed; 0 failed; 0 ignored/);
    run(
      process.execPath,
      ['infra/accounts-desktop/generate.mjs', '--check'],
      root,
    );
  });
  step('thirty_two_narrow_permissions_without_default_probes', () => {
    run('cargo', ['build', '--locked', '--bin', 'financial-manager']);
    const binary = readFileSync(
      path.join(target, 'debug/financial-manager.exe'),
    );
    for (const marker of [
      'SYNTHETIC_US040_ACCOUNTS_ONLY',
      'US040_NATIVE_ACCOUNT_PROBE_FAILED',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.equal(binary.includes(Buffer.from(marker, encoding)), false);
    assert.deepEqual(
      JSON.parse(
        readFileSync(path.join(crate, 'capabilities/entry-main.json'), 'utf8'),
      ).permissions,
      permissions,
    );
    assert.equal(permissions.length, 36);
    // Tauri retains generated permission descriptions across feature builds. Those
    // descriptions grant nothing: verify the actual production handler and grants.
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
      'accounts-smoke',
      '--bin',
      'accounts-probe',
      '--bin',
      'accounts-smoke',
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
    for (const name of ['accounts-probe', 'accounts-smoke'])
      assert.deepEqual(
        metadata.targets.find((t) => t.name === name)['required-features'],
        ['accounts-smoke'],
      );
  });
  let store;
  step('native_fin002_snapshot_matches_shared_domain_goldens', () => {
    store = prepare('main');
    const raw = invoke('snapshot', store).snapshot,
      snapshot = decodeAccountsSnapshot(raw, fixture.workspace_a);
    const expected = fixture.expected.balances.filter(
      (e) => e.workspace_id === fixture.workspace_a,
    );
    assert.ok(expected.length > 0);
    for (const e of expected) {
      const row = accountRows(snapshot, e.as_of).find(
        (r) => r.state.account.id === e.account_id,
      );
      assert.equal(row.value.balance.amount_minor, e.amount_minor);
      assert.equal(row.value.balance.completeness, 'INCOMPLETE');
    }
    invoke('enable-pin', store);
  });
  stage = 'native_webview';
  const output = path.join(own, 'webview.json');
  run(
    path.join(target, 'debug/accounts-smoke.exe'),
    [output, path.join(own, 'webview-profile'), path.join(store, 'source')],
    root,
    0,
    900000,
  );
  const ui = JSON.parse(readFileSync(output, 'utf8'));
  assert.deepEqual(Object.keys(ui).sort(), ['checks', 'passed']);
  assert.equal(ui.passed, true);
  assert.deepEqual(
    Object.keys(ui.checks).sort(),
    [
      'crud_and_canonical_money',
      'reference_history_and_comparison',
      'lost_ack_reuses_same_intent',
      'workspace_switch_isolation',
      'lock_removes_financial_data',
      'no_storage_or_egress',
    ].sort(),
  );
  for (const [name, value] of Object.entries(ui.checks)) {
    assert.equal(value, true);
    report.checks['webview_' + name] = true;
    console.log('US-040 accounts native: webview_' + name);
  }
  step('webview_state_reopened_by_independent_process', () =>
    invoke('verify-ui', store),
  );
  step('crash_before_commit_recovers_without_partial_account', () => {
    const crashed = prepare('before');
    invoke('crash-before', crashed, 74);
    const id = resourceId(readFileSync(path.join(crashed, 'other.id'), 'utf8')),
      journal = path.join(crashed, 'source/workspaces', id, 'vault.db-journal');
    assert.ok(existsSync(journal));
    const bytes = readFileSync(journal);
    assert.ok(bytes.length > 512);
    for (const marker of [
      'SYNTHETIC CRASH ACCOUNT',
      '9007199254740993',
      'SQLite format 3',
    ])
      assert.equal(bytes.includes(Buffer.from(marker)), false);
    invoke('verify-before', crashed);
    assert.equal(existsSync(journal), false);
  });
  step('crash_after_commit_replay_does_not_duplicate', () => {
    const committed = prepare('after');
    invoke('crash-after', committed, 75);
    invoke('verify-after', committed);
  });
  step('backup_restore_in_another_installation_preserves_new_accounts', () => {
    const value = invoke('roundtrip', store),
      snapshot = decodeAccountsSnapshot(
        value.snapshot,
        value.snapshot.workspace_id,
      );
    assert.equal(snapshot.accounts.length, 1);
    assert.equal(snapshot.accounts[0].account.name, 'SYNTHETIC DESKTOP EDIT');
    const row = accountRows(snapshot, '2026-10-17')[0];
    assert.equal(row.value.balance.amount_minor, '9007199254740994');
    assert.equal(snapshot.accounts[0].references.length, 2);
    assert.equal(snapshot.movements.length, 0);
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
      console.error('US040_WEBVIEW_FAILED_STAGE_' + diagnostic.failure_stage);
  }
  report.passed = false;
  process.exitCode = 1;
  console.error('US040_NATIVE_FAILED_' + stage.toUpperCase());
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
            readFileSync(path.join(store, '.us040-fixture'), 'utf8'),
            'SYNTHETIC_US040_ACCOUNTS_ONLY\n',
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
    console.error('US040_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = desktopAccountHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateDesktopAccountEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
