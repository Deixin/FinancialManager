import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { nextDesktopEntryScreen } from '../../apps/desktop/dist/entry-model.js';
import {
  browserChecks,
  nativeChecks,
  validateEntryEvidence,
} from '../entry/evidence.mjs';
test('Desktop local entry is repeatable, independent of identity and rejects unknown transitions', () => {
  assert.equal(
    nextDesktopEntryScreen('ENTRY', 'CONTINUE_LOCAL'),
    'LOCAL_SETUP',
  );
  assert.equal(
    nextDesktopEntryScreen('LOCAL_SETUP', 'CONTINUE_LOCAL'),
    'LOCAL_SETUP',
  );
  assert.equal(nextDesktopEntryScreen('LOCAL_SETUP', 'BACK_TO_ENTRY'), 'ENTRY');
  assert.equal(nextDesktopEntryScreen('ENTRY', 'BACK_TO_ENTRY'), 'ENTRY');
  assert.throws(
    () => nextDesktopEntryScreen('CLOUD', 'CONTINUE_LOCAL'),
    /DESKTOP_ENTRY_STATE_INVALID/,
  );
  assert.throws(
    () => nextDesktopEntryScreen('ENTRY', 'CREATE_CLOUD_USER'),
    /DESKTOP_ENTRY_ACTION_INVALID/,
  );
});
test('production Desktop host has no IPC privileges or smoke handler and embeds only local assets', () => {
  const config = JSON.parse(
    readFileSync(
      new URL('../../apps/desktop/src-tauri/tauri.conf.json', import.meta.url),
      'utf8',
    ),
  );
  const capability = JSON.parse(
    readFileSync(
      new URL(
        '../../apps/desktop/src-tauri/capabilities/entry-main.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  assert.deepEqual(capability.permissions, []);
  assert.equal(config.app.withGlobalTauri, false);
  assert.equal(config.build.devUrl, undefined);
  assert.match(config.app.security.csp, /default-src 'self'/);
  assert.doesNotMatch(
    config.app.security.csp,
    /https:|unsafe-inline|unsafe-eval|\*/,
  );
  assert.doesNotMatch(
    readFileSync(
      new URL('../../apps/desktop/src-tauri/src/main.rs', import.meta.url),
      'utf8',
    ),
    /invoke_handler|include_str|entry.smoke/,
  );
  assert.equal(config.bundle.active, false);
});
test('Desktop browser and native evidence require every real gate, exact sources and honest scope', () => {
  for (const [filename, checks] of [
    ['us-030-entry-browser-2026-10-16.json', browserChecks],
    ['us-030-entry-windows-2026-10-16.json', nativeChecks],
  ]) {
    const load = () =>
      JSON.parse(
        readFileSync(
          new URL('../../docs/quality/evidence/' + filename, import.meta.url),
          'utf8',
        ),
      );
    assert.equal(validateEntryEvidence(load()).passed, true);
    for (const name of checks) {
      const report = load();
      delete report.checks[name];
      assert.throws(
        () => validateEntryEvidence(report),
        /ENTRY_EVIDENCE_INVALID/,
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
        r.workspace_created = true;
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
        () => validateEntryEvidence(report),
        /ENTRY_EVIDENCE_INVALID/,
      );
    }
    const old = load();
    old.source_sha256['package.json'] = '0'.repeat(64);
    assert.equal(
      validateEntryEvidence(old, { matchSources: false }).passed,
      true,
    );
    old.source_sha256['package.json'] = 'invalid';
    assert.throws(
      () => validateEntryEvidence(old, { matchSources: false }),
      /ENTRY_EVIDENCE_INVALID/,
    );
  }
});
