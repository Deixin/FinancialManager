use crate::{Result, SecretKey, VaultError};
use uuid::Uuid;
use zeroize::Zeroizing;

pub trait KeyStore: Send + Sync {
    fn get(&self, installation: Uuid, workspace: Uuid) -> Result<SecretKey>;
    fn put_new(&self, installation: Uuid, workspace: Uuid, key: &SecretKey) -> Result<()>;
    fn delete(&self, installation: Uuid, workspace: Uuid) -> Result<()>;
}

#[cfg(windows)]
pub struct WindowsKeyStore;

#[cfg(windows)]
impl WindowsKeyStore {
    fn entry(installation: Uuid, workspace: Uuid) -> Result<keyring_core::Entry> {
        use keyring_core::api::CredentialStoreApi;
        let store =
            windows_native_keyring_store::Store::new().map_err(|_| VaultError::SecretStore)?;
        // LocalMachine persistence survives process restarts without roaming to other hosts.
        let modifiers = std::collections::HashMap::from([("persistence", "Local")]);
        store
            .build(
                "com.miudos.financial-manager.us001",
                &format!("{installation}/{workspace}"),
                Some(&modifiers),
            )
            .map_err(|_| VaultError::SecretStore)
    }
}

#[cfg(windows)]
impl KeyStore for WindowsKeyStore {
    fn get(&self, installation: Uuid, workspace: Uuid) -> Result<SecretKey> {
        let bytes = Zeroizing::new(Self::entry(installation, workspace)?.get_secret().map_err(
            |error| match error {
                keyring_core::Error::NoEntry => VaultError::KeyMissing,
                _ => VaultError::SecretStore,
            },
        )?);
        let mut key = Zeroizing::new([0; 32]);
        if bytes.len() != key.len() {
            return Err(VaultError::SecretStore);
        }
        key.copy_from_slice(&bytes);
        Ok(key)
    }

    fn put_new(&self, installation: Uuid, workspace: Uuid, key: &SecretKey) -> Result<()> {
        let entry = Self::entry(installation, workspace)?;
        match entry.get_secret() {
            Ok(bytes) => {
                drop(Zeroizing::new(bytes));
                return Err(VaultError::KeyExists);
            }
            Err(keyring_core::Error::NoEntry) => (),
            Err(_) => return Err(VaultError::SecretStore),
        }
        entry
            .set_secret(key.as_ref())
            .map_err(|_| VaultError::SecretStore)?;
        let persisted = self.get(installation, workspace)?;
        if persisted.as_ref() != key.as_ref() {
            return Err(VaultError::SecretStore);
        }
        Ok(())
    }

    fn delete(&self, installation: Uuid, workspace: Uuid) -> Result<()> {
        match Self::entry(installation, workspace)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(VaultError::SecretStore),
        }
    }
}
