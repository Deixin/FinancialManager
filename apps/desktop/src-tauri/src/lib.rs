pub mod backup_destination;
pub mod commands;
pub mod identity;
pub mod keys;
pub mod local_backup;
pub mod local_lock;
pub mod local_restore;
pub mod local_workspaces;
pub mod lock_store;
mod migrations;
pub mod restore_source;
pub mod windows_hello;

pub type Result<T> = std::result::Result<T, LocalError>;
pub type SecretKey = zeroize::Zeroizing<[u8; 32]>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LocalError {
    InvalidWorkspace,
    StorageUnavailable,
    InstallationBusy,
    KeyMissing,
    IntegrityFailure,
    UnsupportedSchema,
    NotFound,
    RequestConflict,
    LocalLocked,
    InvalidPin,
    AuthenticationFailed,
    RetryLater,
    HelloUnavailable,
    HelloCanceled,
    HelloFailed,
    InvalidBackupPassword,
    BackupLimit,
    BackupAuthenticationFailed,
    UnsupportedBackup,
    BackupDestinationUnavailable,
    BackupAlreadyExists,
    BackupVerificationFailed,
    RestoreUnavailable,
}
impl From<std::io::Error> for LocalError {
    fn from(_: std::io::Error) -> Self {
        Self::StorageUnavailable
    }
}
impl From<rusqlite::Error> for LocalError {
    fn from(_: rusqlite::Error) -> Self {
        Self::IntegrityFailure
    }
}

#[cfg(test)]
mod local_workspace_tests;

pub mod workspace_model;

// Test instrumentation only; the production host never enables this feature.
#[cfg(feature = "vault-smoke")]
pub mod vault_probe;

#[cfg(feature = "backup-smoke")]
pub mod backup_probe;

#[cfg(feature = "restore-smoke")]
pub mod restore_probe;
