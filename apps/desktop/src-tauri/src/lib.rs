pub mod commands;
pub mod identity;
pub mod keys;
pub mod local_workspaces;
mod migrations;

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
