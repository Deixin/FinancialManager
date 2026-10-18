import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  decodeLocalWorkspace,
  localWorkspaceMessage,
  LocalWorkspaceError,
  createLocalWorkspaceGateway,
} from '../../apps/desktop/dist/local-workspaces.js';
import {
  browserChecks,
  nativeChecks,
  validateWorkspaceEvidence,
} from '../local-workspaces/evidence.mjs';
import { sqliteCatalog } from '../../packages/storage-schema/dist/migrations.js';
const row = {
  id: '0199d031-0000-7000-8000-000000000001',
  display_name: 'SYNTHETIC WORKSPACE',
  purpose: 'PERSONAL',
  storage_mode: 'LOCAL',
  default_currency: 'BRL',
  created_at: '2026-10-16T00:00:00.000Z',
};
test('local workspace decoder rejects cloud authority, extra identity fields and malformed native data', () => {
  assert.equal(decodeLocalWorkspace(row).id, row.id);
  assert.ok(Object.isFrozen(decodeLocalWorkspace(row)));
  for (const change of [
    { storage_mode: 'CLOUD' },
    { default_currency: 'USD' },
    { cloud_user_id: row.id },
    { display_name: '' },
    { display_name: 'x'.repeat(121) },
    { created_at: '2026-10-16T00:00:00Z' },
    { id: '../vault.db' },
    { purpose: 'OWNER' },
  ])
    assert.throws(
      () => decodeLocalWorkspace({ ...row, ...change }),
      /LOCAL_WORKSPACE_OPERATION_FAILED/,
    );
  assert.throws(() => decodeLocalWorkspace(null));
  assert.throws(() => decodeLocalWorkspace([row]));
});
test('native errors are projected to safe user messages without SQL, financial payloads or causes', () => {
  assert.equal(
    localWorkspaceMessage(new Error('SYNTHETIC_PRIVATE_SQL')),
    localWorkspaceMessage(null),
  );
  assert.ok(
    !localWorkspaceMessage(new Error('SYNTHETIC_PRIVATE_SQL')).includes(
      'SYNTHETIC_PRIVATE',
    ),
  );
  assert.match(
    localWorkspaceMessage(new LocalWorkspaceError('KEY_MISSING')),
    /Nenhum dado foi substituído/,
  );
  assert.match(
    localWorkspaceMessage(new LocalWorkspaceError('REQUEST_CONFLICT')),
    /Volte à lista/,
  );
  assert.equal(createLocalWorkspaceGateway(), null);
});
test('Rust catalog is reproducible and shares the exact existing migration checksums', () => {
  assert.equal(
    spawnSync(
      process.execPath,
      ['infra/local-workspaces/generate.mjs', '--check'],
      { encoding: 'utf8', windowsHide: true },
    ).status,
    0,
  );
  const source = readFileSync(
    new URL(
      '../../apps/desktop/src-tauri/src/migration_catalog.rs',
      import.meta.url,
    ),
    'utf8',
  );
  for (const item of sqliteCatalog) assert.ok(source.includes(item.checksum));
});
test('local workspace reports require every gate, current sources, cleanup and remaining vault gates', () => {
  for (const [kind, checks] of [
    ['browser', browserChecks],
    ['windows', nativeChecks],
  ]) {
    const historical = JSON.parse(
      readFileSync(
        new URL(
          '../../docs/quality/evidence/us-031-workspaces-' +
            kind +
            '-2026-10-17.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.equal(
      validateWorkspaceEvidence(historical, { matchSources: false }).passed,
      true,
    );
    const prior = JSON.parse(
      readFileSync(
        new URL(
          '../../docs/quality/evidence/us-031-workspaces-' +
            kind +
            '-2026-10-17-us032.json',
          import.meta.url,
        ),
        'utf8',
      ),
    );
    assert.equal(
      validateWorkspaceEvidence(prior, { matchSources: false }).passed,
      true,
    );
    assert.throws(
      () => validateWorkspaceEvidence(prior),
      /WORKSPACE_EVIDENCE_INVALID/,
    );
    const load = () =>
      JSON.parse(
        readFileSync(
          new URL(
            '../../docs/quality/evidence/us-031-workspaces-' +
              kind +
              '-2026-10-18-us043-desktop.json',
            import.meta.url,
          ),
          'utf8',
        ),
      );
    assert.equal(validateWorkspaceEvidence(load()).passed, true);
    for (const gate of checks) {
      const report = load();
      delete report.checks[gate];
      assert.throws(
        () => validateWorkspaceEvidence(report),
        /WORKSPACE_EVIDENCE_INVALID/,
      );
    }
    for (const mutate of [
      (r) => {
        r.pending = [];
      },
      (r) => {
        r.resources_closed = false;
      },
      (r) => {
        r.cofre_homologado = true;
      },
      (r) => {
        r.source_sha256['package.json'] = '0'.repeat(64);
      },
      (r) => {
        r.completed_at_utc = 'invalid';
      },
    ]) {
      const report = load();
      mutate(report);
      assert.throws(
        () => validateWorkspaceEvidence(report),
        /WORKSPACE_EVIDENCE_INVALID/,
      );
    }
  }
});
