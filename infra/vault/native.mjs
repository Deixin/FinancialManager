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
import { pending, vaultHashes, validateVaultEvidence } from './evidence.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url)),
  directory = path.join(root, '.tools/us032-vault'),
  crate = path.join(root, 'apps/desktop/src-tauri'),
  target = path.join(root, 'apps/desktop/spikes/us-001/target'),
  probe = path.join(target, 'debug/vault-probe.exe');
const env = { ...process.env, CARGO_TARGET_DIR: target };
const pathKey =
  Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
const perl = path.join(root, '.tools/strawberry-perl-5.42.3.1/perl/bin');
if (existsSync(perl)) env[pathKey] = perl + path.delimiter + env[pathKey];
const report = {
  format_version: 1,
  scope: 'us032-product-vault-windows',
  passed: false,
  synthetic_only: true,
  dataset_id: 'FIN-002',
  dataset_version: 1,
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
  assert.equal(result.status, expected, 'VAULT_NATIVE_COMMAND_FAILED');
  return result;
};
const step = (name, operation) => {
  stage = name;
  operation();
  report.checks[name] = true;
  console.log('US-032 native: ' + name);
};
const invoke = (mode, store, phase) => {
  const output = path.join(own, 'probe.json');
  run(
    probe,
    [mode, store, output, ...(phase ? [String(phase)] : [])],
    root,
    0,
    60000,
  );
  return JSON.parse(readFileSync(output, 'utf8'));
};
const prepare = (name) => {
  const store = path.join(own, name);
  cases.push(store);
  const result = invoke('prepare', store);
  assert.deepEqual(
    Object.keys(result).sort(),
    ['passed', 'cipher', 'sqlite', 'flags'].sort(),
  );
  assert.equal(result.passed, true);
  assert.equal(result.cipher, '4.14.0 community');
  assert.deepEqual(result.flags, {
    foreign_keys: true,
    recursive_triggers: true,
    trusted_schema: true,
    temp_store: true,
    synchronous: true,
    secure_delete: true,
    cipher_memory_security: true,
    journal_delete: true,
  });
  assert.match(result.sqlite, /^3\.\d+\.\d+$/);
  if (report.versions.sqlite)
    assert.equal(result.sqlite, report.versions.sqlite);
  report.versions.sqlcipher = result.cipher;
  report.versions.sqlite = result.sqlite;
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
  };
  step('rustfmt_clippy_eight_fault_tests', () => {
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
      '--test',
      'vault',
      '--features',
      'vault-smoke',
    ]);
    assert.match(tests.stdout, /8 passed; 0 failed; 0 ignored/);
  });
  step('locked_default_and_probe_build', () => {
    run('cargo', ['build', '--locked', '--bin', 'financial-manager']);
    run('cargo', [
      'build',
      '--locked',
      '--features',
      'vault-smoke',
      '--bin',
      'vault-probe',
    ]);
  });
  step('default_binary_and_ipc_exclude_probe', () => {
    const metadata = JSON.parse(
      run('cargo', [
        'metadata',
        '--locked',
        '--no-deps',
        '--format-version',
        '1',
      ]).stdout,
    );
    const product = metadata.packages.find(
      (p) => p.name === 'financial-manager-desktop',
    );
    assert.deepEqual(product.features.default ?? [], []);
    assert.deepEqual(
      product.targets.find((t) => t.name === 'vault-probe')[
        'required-features'
      ],
      ['vault-smoke'],
    );
    const binary = readFileSync(
      path.join(target, 'debug/financial-manager.exe'),
    );
    for (const canary of [
      'SYNTHETIC_PRIVATE_VAULT_CANARY',
      'SYNTHETIC_US032_ONLY',
      'US032_VAULT_PROBE_FAILED',
    ])
      for (const encoding of ['utf8', 'utf16le'])
        assert.equal(binary.includes(Buffer.from(canary, encoding)), false);
    for (const source of ['src/main.rs', 'build.rs', 'src/commands.rs'])
      assert.equal(
        readFileSync(path.join(crate, source), 'utf8').includes('vault_probe'),
        false,
      );
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
        'allow-create-local-backup',
        'allow-select-local-backup',
        'allow-preview-local-restore',
        'allow-confirm-local-restore',
        'allow-cancel-local-restore',
        'allow-read-local-accounts',
        'allow-apply-local-account-change',
        'allow-read-local-movements',
        'allow-apply-local-manual-movement',
        'allow-read-local-transfers',
        'allow-apply-local-transfer',
        'allow-read-local-card-payments',
        'allow-apply-local-card-payment',
        'allow-read-local-categories',
        'allow-apply-local-category-change',
        'allow-read-local-taxonomy',
        'allow-apply-local-taxonomy-change',
        'allow-apply-local-classification-change',
        'allow-apply-local-allocation-change',
        'allow-read-local-counterparties',
        'allow-apply-local-counterparty-change',
        'allow-apply-local-counterparty-association',
        'allow-list-local-imports',
        'allow-read-local-import',
        'allow-prepare-local-import',
      ],
    );
  });
  let first;
  step('runtime_sqlcipher_and_eight_pragmas', () => {
    first = prepare('ddl');
  });
  for (const [phase, name, gate] of [
    [1, 'ddl', 'migration_after_ddl'],
    [2, 'history', 'migration_after_history'],
    [3, 'commit', 'migration_before_commit'],
  ])
    step(gate, () => {
      const store = phase === 1 ? first : prepare(name);
      run(
        probe,
        [
          'migration-child',
          store,
          path.join(own, 'unused.json'),
          String(phase),
        ],
        root,
        73,
        60000,
      );
      assert.deepEqual(invoke('migration-recover', store), {
        passed: true,
        history_and_financial_state_preserved: true,
      });
    });
  let journal;
  step('hot_journal_ciphertext', () => {
    journal = prepare('journal');
    assert.deepEqual(invoke('upgrade', journal), { passed: true });
    run(
      probe,
      ['journal-child', journal, path.join(own, 'unused.json')],
      root,
      73,
      60000,
    );
    assert.deepEqual(invoke('journal-inspect', journal), {
      passed: true,
      hot_journal_encrypted: true,
    });
  });
  step('hot_journal_recovery_preserves_financial_state', () => {
    assert.deepEqual(invoke('journal-recover', journal), {
      passed: true,
      hot_journal_recovered_without_plaintext: true,
    });
  });
  step('cross_process_installation_lock', () => {
    assert.deepEqual(invoke('lock-parent', prepare('lock')), {
      passed: true,
      locked: true,
    });
  });
  report.passed = true;
} catch {
  report.passed = false;
  process.exitCode = 1;
  console.error('US032_NATIVE_FAILED_' + stage.toUpperCase());
} finally {
  try {
    if (own) {
      const resolved = path.resolve(own),
        relative = path.relative(directory, resolved);
      assert.ok(
        relative && !relative.startsWith('..') && !path.isAbsolute(relative),
      );
      assert.equal(lstatSync(resolved).isSymbolicLink(), false);
      let cleanupFailed = false;
      for (const store of cases) {
        try {
          if (!existsSync(store)) continue;
          assert.equal(lstatSync(store).isSymbolicLink(), false);
          assert.equal(
            readFileSync(path.join(store, '.us032-fixture'), 'utf8'),
            'SYNTHETIC_US032_ONLY\n',
          );
          assert.deepEqual(invoke('cleanup', store), {
            passed: true,
            keys_removed: true,
          });
        } catch {
          cleanupFailed = true;
        }
      }
      assert.equal(cleanupFailed, false, 'OWNED_CREDENTIAL_CLEANUP_FAILED');
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
      report.checks.owned_credentials_and_files_removed = true;
    }
    if (locked) {
      rmdirSync(path.join(directory, '.native-lock'));
      report.resources_closed = true;
    }
  } catch {
    report.passed = false;
    process.exitCode = 1;
    console.error('US032_NATIVE_CLEANUP_FAILED');
  }
  if (locked) {
    report.source_sha256 = vaultHashes();
    report.completed_at_utc = new Date().toISOString();
    if (report.passed) validateVaultEvidence(report);
    writeFileSync(
      path.join(directory, 'windows.json'),
      JSON.stringify(report, null, 2) + '\n',
    );
  }
}
