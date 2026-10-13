//! US-001: isolated experiment. Only explicitly synthetic datasets are supported.

pub mod backup;
#[cfg(windows)]
pub mod demo;
pub mod secrets;
pub mod vault;

use thiserror::Error;
use zeroize::Zeroizing;

pub type Result<T> = std::result::Result<T, VaultError>;
pub type SecretKey = Zeroizing<[u8; 32]>;

// Error messages are allowlisted: underlying SQL, paths and secrets are never logged.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum VaultError {
    #[error("IO_FAILURE")]
    Io,
    #[error("INSTALLATION_BUSY")]
    Busy,
    #[error("INVALID_INSTALLATION_OR_WORKSPACE")]
    Invalid,
    #[error("KEY_MISSING")]
    KeyMissing,
    #[error("SECRET_STORE_UNAVAILABLE")]
    SecretStore,
    #[error("KEY_ALREADY_EXISTS")]
    KeyExists,
    #[error("VAULT_INTEGRITY_OR_SCHEMA_FAILURE")]
    Integrity,
    #[error("VAULT_SCHEMA_DEFINITION_MISMATCH")]
    Schema,
    #[error("SNAPSHOT_ATTACH_FAILED")]
    SnapshotAttach,
    #[error("SNAPSHOT_EXPORT_FAILED")]
    SnapshotExport,
    #[error("UNSUPPORTED_VERSION_OR_PARAMETERS")]
    Unsupported,
    #[error("BACKUP_AUTHENTICATION_FAILED")]
    Authentication,
    #[error("BACKUP_SIZE_OR_PASSWORD_LIMIT")]
    Limit,
    #[error("INTERRUPTED_BEFORE_PUBLICATION")]
    Interrupted,
}

impl From<std::io::Error> for VaultError {
    fn from(_: std::io::Error) -> Self {
        Self::Io
    }
}

impl From<rusqlite::Error> for VaultError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Integrity
    }
}

pub fn random_key() -> Result<SecretKey> {
    let mut key = Zeroizing::new([0; 32]);
    getrandom::fill(key.as_mut()).map_err(|_| VaultError::SecretStore)?;
    Ok(key)
}

pub(crate) fn key_literal(key: &SecretKey) -> Zeroizing<String> {
    use std::fmt::Write;
    let mut encoded = Zeroizing::new(String::with_capacity(67));
    encoded.push_str("x'");
    for byte in key.iter() {
        write!(encoded, "{byte:02x}").expect("writing a String cannot fail");
    }
    encoded.push('\'');
    encoded
}
