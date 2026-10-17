use crate::{LocalError, Result, SecretKey};
use uuid::Uuid;
use zeroize::Zeroizing;

pub trait KeyStore: Send + Sync {
    fn get(&self, installation: Uuid, workspace: Uuid) -> Result<SecretKey>;
    fn put_new(&self, installation: Uuid, workspace: Uuid, key: &SecretKey) -> Result<()>;
    fn delete(&self, installation: Uuid, workspace: Uuid) -> Result<()>;
}

pub fn random_key() -> Result<SecretKey> {
    let mut key = Zeroizing::new([0; 32]);
    getrandom::fill(key.as_mut()).map_err(|_| LocalError::StorageUnavailable)?;
    Ok(key)
}

#[cfg(windows)]
pub struct WindowsKeyStore;
#[cfg(windows)]
impl WindowsKeyStore {
    fn entry(installation: Uuid, workspace: Uuid) -> Result<keyring_core::Entry> {
        use keyring_core::api::CredentialStoreApi;
        windows_native_keyring_store::Store::new()
            .map_err(|_| LocalError::StorageUnavailable)?
            .build(
                "com.miudos.financial-manager.desktop.local.v1",
                &format!("{installation}/{workspace}"),
                Some(&std::collections::HashMap::from([("persistence", "Local")])),
            )
            .map_err(|_| LocalError::StorageUnavailable)
    }
}
#[cfg(windows)]
impl KeyStore for WindowsKeyStore {
    fn get(&self, installation: Uuid, workspace: Uuid) -> Result<SecretKey> {
        let bytes = Zeroizing::new(Self::entry(installation, workspace)?.get_secret().map_err(
            |error| match error {
                keyring_core::Error::NoEntry => LocalError::KeyMissing,
                _ => LocalError::StorageUnavailable,
            },
        )?);
        if bytes.len() != 32 {
            return Err(LocalError::IntegrityFailure);
        }
        let mut key = Zeroizing::new([0; 32]);
        key.copy_from_slice(&bytes);
        Ok(key)
    }
    fn put_new(&self, installation: Uuid, workspace: Uuid, key: &SecretKey) -> Result<()> {
        let entry = Self::entry(installation, workspace)?;
        match entry.get_secret() {
            Ok(bytes) => {
                drop(Zeroizing::new(bytes));
                return Err(LocalError::IntegrityFailure);
            }
            Err(keyring_core::Error::NoEntry) => (),
            Err(_) => return Err(LocalError::StorageUnavailable),
        }
        entry
            .set_secret(key.as_ref())
            .map_err(|_| LocalError::StorageUnavailable)?;
        if self.get(installation, workspace)?.as_ref() != key.as_ref() {
            return Err(LocalError::IntegrityFailure);
        }
        Ok(())
    }
    fn delete(&self, installation: Uuid, workspace: Uuid) -> Result<()> {
        match Self::entry(installation, workspace)?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
            Err(_) => Err(LocalError::StorageUnavailable),
        }
    }
}
