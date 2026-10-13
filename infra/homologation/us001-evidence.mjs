const required = [
  'passed',
  'different_windows_installation',
  'interactive_session',
  'original_key_removed_before_transfer',
  'binary_hashes_verified',
  'backup_hash_verified',
  'wrong_password_rejected',
  'tampering_rejected',
  'crash_recovery_both_checkpoints',
  'preview_without_publication',
  'new_workspace',
  'exact_synthetic_data',
  'existing_vault_preserved',
  'reboot_key_recovery',
  'webview_ipc',
];

export function validateGuestEvidence(
  report,
  rebootStartedAt,
  resultWrittenAt,
) {
  if (required.some((name) => report[name] !== true)) {
    throw new Error('GUEST_EVIDENCE_INCOMPLETE');
  }
  const boot = Date.parse(rebootStartedAt);
  const result = Date.parse(resultWrittenAt);
  // A Startup item can run during the first logon. Its report must never stand
  // in for verification performed after the requested Windows restart.
  if (!Number.isFinite(boot) || !Number.isFinite(result) || result <= boot) {
    throw new Error('GUEST_RESULT_PREDATES_REBOOT');
  }
}
