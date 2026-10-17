use crate::{LocalError, Result};
use uuid::Uuid;
use zeroize::Zeroizing;

/// A separate OS credential. Never stores the SQLCipher key or the PIN itself.
pub trait PolicyStore: Send + Sync {
    fn read(&self, installation: Uuid) -> Result<Option<Zeroizing<Vec<u8>>>>;
    fn write(&self, installation: Uuid, bytes: &[u8]) -> Result<()>;
}
#[cfg(windows)]
pub struct WindowsPolicyStore;
#[cfg(windows)]
impl WindowsPolicyStore {
    fn entry(id: Uuid) -> Result<keyring_core::Entry> {
        use keyring_core::api::CredentialStoreApi;
        windows_native_keyring_store::Store::new()
            .map_err(|_| LocalError::StorageUnavailable)?
            .build(
                "com.miudos.financial-manager.desktop.privacy.v1",
                &id.to_string(),
                Some(&std::collections::HashMap::from([("persistence", "Local")])),
            )
            .map_err(|_| LocalError::StorageUnavailable)
    }
    // Explicitly available to synthetic native cleanup, never exposed over IPC.
    #[cfg(any(
        test,
        feature = "workspace-smoke",
        feature = "vault-smoke",
        feature = "lock-smoke"
    ))]
    pub fn cleanup(id: Uuid) -> Result<()> {
        match Self::entry(id)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(LocalError::StorageUnavailable),
        }
    }
}
#[cfg(windows)]
impl PolicyStore for WindowsPolicyStore {
    fn read(&self, id: Uuid) -> Result<Option<Zeroizing<Vec<u8>>>> {
        match Self::entry(id)?.get_secret() {
            Ok(value) if value.len() <= 2048 => Ok(Some(Zeroizing::new(value))),
            Ok(value) => {
                drop(Zeroizing::new(value));
                Err(LocalError::IntegrityFailure)
            }
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(_) => Err(LocalError::StorageUnavailable),
        }
    }
    fn write(&self, id: Uuid, bytes: &[u8]) -> Result<()> {
        if bytes.len() > 2048 {
            return Err(LocalError::IntegrityFailure);
        }
        Self::entry(id)?
            .set_secret(bytes)
            .map_err(|_| LocalError::StorageUnavailable)?;
        if self.read(id)?.as_deref().map(Vec::as_slice) != Some(bytes) {
            return Err(LocalError::StorageUnavailable);
        }
        Ok(())
    }
}
