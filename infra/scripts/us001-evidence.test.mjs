import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGuestEvidence } from '../homologation/us001-evidence.mjs';

// Explicitly synthetic metadata; no financial payloads or credentials.
const syntheticReport = {
  passed: true,
  different_windows_installation: true,
  interactive_session: true,
  original_key_removed_before_transfer: true,
  binary_hashes_verified: true,
  backup_hash_verified: true,
  wrong_password_rejected: true,
  tampering_rejected: true,
  crash_recovery_both_checkpoints: true,
  preview_without_publication: true,
  new_workspace: true,
  exact_synthetic_data: true,
  existing_vault_preserved: true,
  reboot_key_recovery: true,
  webview_ipc: true,
};

test('rejects an otherwise successful guest report from the initial logon', () => {
  assert.throws(
    () =>
      validateGuestEvidence(
        syntheticReport,
        '2026-10-13T12:00:00Z',
        '2026-10-13T11:59:59Z',
      ),
    /GUEST_RESULT_PREDATES_REBOOT/,
  );
  assert.doesNotThrow(() =>
    validateGuestEvidence(
      syntheticReport,
      '2026-10-13T12:00:00Z',
      '2026-10-13T12:01:00Z',
    ),
  );
});

test('rejects a successful report that lacks proof of restored key persistence', () => {
  const incomplete = { ...syntheticReport };
  delete incomplete.reboot_key_recovery;
  assert.throws(
    () =>
      validateGuestEvidence(
        incomplete,
        '2026-10-13T12:00:00Z',
        '2026-10-13T12:01:00Z',
      ),
    /GUEST_EVIDENCE_INCOMPLETE/,
  );
});
