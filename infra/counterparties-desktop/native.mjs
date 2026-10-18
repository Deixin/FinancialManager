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
import { decodeMovementsSnapshot } from '../../apps/desktop/dist/local-movements.js';
import {
  decodeCounterpartySnapshot,
  captureLocalAssociations,
  verifyAssociationRead,
} from '../../apps/desktop/dist/local-counterparties.js';
import { nextRevision } from '../../packages/domain/dist/revisions.js';
import {
  desktopCounterpartyHashes,
  pending,
  validateDesktopCounterpartyEvidence,
} from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us047-desktop-counterparties'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  probe = path.join(target, 'debug/counterparties-probe.exe'),
  fixture = path.join(target, 'debug/taxonomy-probe.exe'),
  env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_BUILD_JOBS: '1' },
  pathKey = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] =
  path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin') +
  path.delimiter +
  env[pathKey];
const report = {
  format_version: 1,
  scope: 'us047-desktop-counterparties-windows',
  passed: false,
  synthetic_only: true,
  checks: {},
  versions: {},
  pending,
};
let own,
  locked = false,
  stage = 'startup';
const stores = [];
const run = (command, args, cwd = crate, expected = 0) => {
    const r = spawnSync(command, args, {
      cwd,
      env,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 900000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (r.status !== expected)
      writeFileSync(
        path.join(directory, 'command-diagnostic.log'),
        r.stderr ?? '',
      );
    assert.equal(r.status, expected, 'CLASSIFICATION_NATIVE_COMMAND_FAILED');
    return r;
  },
  invoke = (mode, store, expected = 0, base = false) => {
    const output = path.join(own, 'probe.json');
    run(base ? fixture : probe, [mode, store, output], root, expected);
    if (expected !== 0) return null;
    const value = JSON.parse(readFileSync(output));
    assert.equal(value.passed, true);
    return value;
  },
  prepare = (name) => {
    const store = path.join(own, name);
    stores.push(store);
    invoke('prepare', store, 0, true);
    run(
      path.join(target, 'debug/allocations-probe.exe'),
      ['seed', store, path.join(own, 'seed.json')],
      root,
    );
    invoke('seed', store);
    return store;
  },
  step = (name, action) => {
    stage = name;
    action();
    report.checks[name] = true;
    console.log('US047 counterparties native: ' + name);
  },
  read = (store) => {
    const raw = invoke('read', store).snapshot;
    return decodeCounterpartySnapshot(raw, raw.workspace_id, true);
  },
  ledger = (s) => {
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.balance.read_at;
    return raw;
  };
function financial(snapshot) {
  const s = ledger(snapshot);
  delete s.history;
  for (const t of s.transactions) {
    delete t.version;
    delete t.updated_at;
    delete t.content.counterparty_id;
  }
  return s;
}
try {
  assert.equal(process.platform + '-' + process.arch, 'win32-x64');
  for (const f of [path.join(root, '.tools'), directory]) {
    if (existsSync(f)) assert.equal(lstatSync(f).isSymbolicLink(), false);
    else mkdirSync(f);
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
  step('locked_clippy_eleven_tests_and_56_shared_vectors', () => {
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
        'counterparties-smoke',
        'counterparty_tests',
      ]).stdout,
      /11 passed; 0 failed; 0 ignored/,
    );
    run(
      process.execPath,
      [path.join(root, 'infra/counterparties-desktop/generate.mjs'), '--check'],
      root,
    );
  });
  step('thirty_two_permissions_real_handler_and_no_probe', () => {
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
      'SYNTHETIC_US047_COUNTERPARTIES_ONLY',
      'US047_ASSOCIATION_VECTOR_MISMATCH',
      'CLASSIFICATION_SMOKE_FAILED',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.equal(binary.includes(Buffer.from(marker, encoding)), false);
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'counterparties-smoke',
      '--bin',
      'counterparties-probe',
      '--bin',
      'counterparties-smoke',
      '--bin',
      'taxonomy-probe',
      '--bin',
      'allocations-probe',
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
    for (const name of ['counterparties-probe', 'counterparties-smoke'])
      assert.deepEqual(
        p.targets.find((t) => t.name === name)['required-features'],
        ['counterparties-smoke'],
      );
  });
  const store = prepare('main');
  invoke('enable-pin', store, 0, true);
  const beforeUi = read(store);
  stage = 'webview';
  const output = path.join(own, 'webview.json');
  run(
    path.join(target, 'debug/counterparties-smoke.exe'),
    [output, path.join(own, 'webview-profile'), path.join(store, 'source')],
    root,
  );
  const ui = JSON.parse(readFileSync(output));
  assert.equal(ui.passed, true);
  assert.deepEqual(Object.keys(ui).sort(), ['checks', 'passed']);
  assert.deepEqual(
    Object.keys(ui.checks).sort(),
    [
      'catalog_reuse_archive_homonyms',
      'import_association_lost_ack_frozen_base',
      'paired_transfer_and_card',
      'clear_noop_and_history',
      'workspace_isolation',
      'lock_removes_editor_tree',
      'no_storage_or_egress',
    ].sort(),
  );
  for (const [name, value] of Object.entries(ui.checks)) {
    assert.equal(value, true);
    report.checks['webview_' + name] = true;
  }
  step('independent_process_reopens_counterparty_history', () => {
    const s = read(store),
      imported = s.movements.transactions.find(
        (r) => r.content.display_name === 'SYNTHETIC CLASSIFICATION IMPORT',
      );
    assert.equal(imported.version, '3');
    assert.equal(imported.content.origin_kind, 'IMPORT');
    assert.equal(
      imported.content.original_description,
      'SYNTHETIC IMPORT ORIGINAL',
    );
    assert.equal(imported.content.counterparty_id, null);
    assert.equal(imported.content.tag_ids.length, 0);
    const history = s.movements.history.filter(
      (r) => r.transaction_id === imported.id,
    );
    assert.equal(history.length, 3);
    assert.deepEqual(
      history.map((r) => r.change_source),
      ['IMPORT', 'MANUAL', 'MANUAL'],
    );
  });
  step('financial_values_balances_economic_kind_and_groups_unchanged', () =>
    assert.deepEqual(
      financial(read(store).movements),
      financial(beforeUi.movements),
    ),
  );
  step('failed_first_save_rolls_back_associations_and_revisions', () => {
    const s = prepare('rollback'),
      initial = invoke('setup-crash', s);
    invoke('rollback', s);
    assert.deepEqual(
      ledger(read(s).movements),
      ledger(
        decodeMovementsSnapshot(
          initial.snapshot,
          initial.snapshot.balance.workspace_id,
        ),
      ),
    );
  });
  for (const [mode, code] of [
    ['first', 78],
    ['before', 79],
    ['after', 80],
  ])
    step('crash_' + mode + '_commit_atomic_associations', () => {
      const s = prepare('crash-' + mode),
        initial = invoke('setup-crash', s);
      invoke('crash-' + mode, s, code);
      const after = read(s);
      if (mode === 'after') {
        const commands = captureLocalAssociations(
            initial.commands,
            after.workspace_id,
          ),
          entries = commands.map((c) => ({
            id: c.base.id,
            changed: true,
            base_revision: c.base.version,
            version: nextRevision(c.base.version),
            revision_id: after.movements.history.find(
              (r) =>
                r.transaction_id === c.base.id &&
                r.version === nextRevision(c.base.version),
            )?.id,
          }));
        verifyAssociationRead(after, commands, entries);
        assert.equal(
          after.movements.history.length,
          initial.snapshot.history.length + 2,
        );
      } else
        assert.deepEqual(
          ledger(after.movements),
          ledger(
            decodeMovementsSnapshot(
              initial.snapshot,
              initial.snapshot.balance.workspace_id,
            ),
          ),
        );
    });
  step(
    'portable_restore_history_without_source_key_and_prepared_write_refusal',
    () => {
      const before = read(store),
        r = invoke('roundtrip', store),
        raw = r.snapshot,
        after = decodeCounterpartySnapshot(raw, raw.workspace_id, true);
      assert.equal(r.source_key_deleted, true);
      assert.equal(r.prepared_restore_refused_write, true);
      assert.notEqual(after.workspace_id, before.workspace_id);
      assert.equal(
        after.movements.transactions.length,
        before.movements.transactions.length,
      );
      assert.equal(
        after.movements.history.length,
        before.movements.history.length,
      );
      const catalogValues = (s) =>
        s.items
          .map((item) =>
            JSON.stringify([
              item.display_name,
              item.identifier_type,
              item.identifier_value,
              item.relationship_hint,
              item.status,
            ]),
          )
          .sort();
      assert.deepEqual(catalogValues(after), catalogValues(before));
      const previousCounterparties = new Set(before.items.map((r) => r.id));
      assert.ok(after.items.every((r) => !previousCounterparties.has(r.id)));
      const ids = new Set(before.movements.transactions.map((r) => r.id));
      assert.ok(after.movements.transactions.every((r) => !ids.has(r.id)));
      assert.ok(after.movements.history.every((r) => r.compatible));
    },
  );
  report.passed = true;
} catch {
  report.passed = false;
  process.exitCode = 1;
  const file = own && path.join(own, 'webview.json');
  if (file && existsSync(file)) {
    const r = JSON.parse(readFileSync(file));
    if (Number.isInteger(r.failure_stage))
      console.error('US047_COUNTERPARTIES_WEBVIEW_STAGE_' + r.failure_stage);
    if (/^[A-Z_]{2,40}$/.test(r.failure_code ?? ''))
      console.error('US047_COUNTERPARTIES_WEBVIEW_CODE_' + r.failure_code);
  }
  console.error('US047_COUNTERPARTIES_NATIVE_FAILED_' + stage.toUpperCase());
} finally {
  try {
    if (own) {
      const rel = path.relative(directory, path.resolve(own));
      assert.ok(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
      assert.equal(lstatSync(own).isSymbolicLink(), false);
      let failed = false;
      for (const store of stores)
        try {
          if (!existsSync(store)) continue;
          assert.equal(lstatSync(store).isSymbolicLink(), false);
          assert.equal(
            readFileSync(path.join(store, '.us045-taxonomy-fixture'), 'utf8'),
            'SYNTHETIC_US045_ACCOUNTS_ONLY\n',
          );
          invoke('cleanup', store, 0, true);
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
    console.error('US047_COUNTERPARTIES_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = desktopCounterpartyHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateDesktopCounterpartyEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
