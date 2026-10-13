use crate::vault::{Installation, Preview, data, open_database, preview, validate_database};
use crate::{Result, SecretKey, VaultError, key_literal, random_key};
use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, Payload},
};
use argon2::{Algorithm, Argon2, Params, Version};
use rusqlite::params;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::Path;
use uuid::Uuid;
use zeroize::Zeroizing;

pub const HEADER_SIZE: usize = 54;
pub const MAX_SNAPSHOT_SIZE: usize = 16 * 1024 * 1024;
pub const MAX_PACKAGE_SIZE: usize = HEADER_SIZE + 32 + MAX_SNAPSHOT_SIZE + 16;
const MAGIC: &[u8; 8] = b"FMUS001\0";

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RestoreCheckpoint {
    Staged,
    KeyStored,
}

fn check_password(password: &[u8]) -> Result<()> {
    if !(12..=1024).contains(&password.len()) {
        return Err(VaultError::Limit);
    }
    Ok(())
}

fn derive(password: &[u8], salt: &[u8]) -> Result<SecretKey> {
    check_password(password)?;
    let mut key = Zeroizing::new([0; 32]);
    let params = Params::new(65_536, 3, 1, Some(32)).map_err(|_| VaultError::Unsupported)?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password, salt, key.as_mut())
        .map_err(|_| VaultError::Authentication)?;
    Ok(key)
}

pub(crate) fn seal(payload: &[u8], password: &[u8]) -> Result<Vec<u8>> {
    if payload.len() < 32 || payload.len() > MAX_SNAPSHOT_SIZE + 32 {
        return Err(VaultError::Limit);
    }
    let mut salt = [0; 16];
    let mut nonce = [0; 12];
    getrandom::fill(&mut salt).map_err(|_| VaultError::SecretStore)?;
    getrandom::fill(&mut nonce).map_err(|_| VaultError::SecretStore)?;
    let mut header = Vec::with_capacity(HEADER_SIZE);
    header.extend_from_slice(MAGIC);
    header.extend_from_slice(&1u16.to_le_bytes());
    for cost in [65_536u32, 3, 1] {
        header.extend_from_slice(&cost.to_le_bytes());
    }
    header.extend_from_slice(&salt);
    header.extend_from_slice(&nonce);
    header.extend_from_slice(&((payload.len() + 16) as u32).to_le_bytes());
    let key = derive(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| VaultError::Authentication)?;
    let ciphertext = cipher
        .encrypt(
            &nonce.into(),
            Payload {
                msg: payload,
                aad: &header,
            },
        )
        .map_err(|_| VaultError::Authentication)?;
    header.extend_from_slice(&ciphertext);
    Ok(header)
}

pub(crate) fn unseal(package: &[u8], password: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if package.len() < HEADER_SIZE + 32 + 16 || package.len() > MAX_PACKAGE_SIZE {
        return Err(VaultError::Limit);
    }
    if &package[..8] != MAGIC || package[8..10] != 1u16.to_le_bytes() {
        return Err(VaultError::Unsupported);
    }
    // A fixed, versioned cost prevents untrusted headers from selecting expensive KDFs.
    for (offset, expected) in [(10, 65_536u32), (14, 3), (18, 1)] {
        if package[offset..offset + 4] != expected.to_le_bytes() {
            return Err(VaultError::Unsupported);
        }
    }
    let length =
        u32::from_le_bytes(package[50..54].try_into().map_err(|_| VaultError::Limit)?) as usize;
    if length != package.len() - HEADER_SIZE {
        return Err(VaultError::Limit);
    }
    let key = derive(password, &package[22..38])?;
    let nonce: [u8; 12] = package[38..50].try_into().map_err(|_| VaultError::Limit)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref()).map_err(|_| VaultError::Authentication)?;
    let payload = cipher
        .decrypt(
            &nonce.into(),
            Payload {
                msg: &package[HEADER_SIZE..],
                aad: &package[..HEADER_SIZE],
            },
        )
        .map_err(|_| VaultError::Authentication)?;
    Ok(Zeroizing::new(payload))
}

fn read_limited(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let file = File::open(path)?;
    if file.metadata()?.len() > limit as u64 {
        return Err(VaultError::Limit);
    }
    let mut bytes = Vec::new();
    file.take(limit as u64 + 1).read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(VaultError::Limit);
    }
    Ok(bytes)
}

impl Installation {
    pub fn backup(&self, workspace: Uuid, destination: &Path, password: &[u8]) -> Result<()> {
        check_password(password)?;
        let source = self.open_workspace(workspace)?;
        let stage_id = Uuid::now_v7();
        let stage = self.root.join("staging").join(stage_id.to_string());
        fs::create_dir(&stage)?;
        let result = (|| {
            let snapshot_key = random_key()?;
            let snapshot_path = stage.join("snapshot.db");
            // Existing vault connections deliberately lack SQLITE_OPEN_CREATE. ATTACH inherits
            // that flag, so initialize the encrypted destination explicitly before attaching it.
            let empty_snapshot = open_database(&snapshot_path, &snapshot_key, true)?;
            empty_snapshot.pragma_update(None, "user_version", 1)?;
            drop(empty_snapshot);
            source
                .execute(
                    "ATTACH DATABASE ?1 AS snapshot KEY ?2",
                    params![
                        snapshot_path.to_str().ok_or(VaultError::Invalid)?,
                        key_literal(&snapshot_key).as_str(),
                    ],
                )
                .map_err(|_| VaultError::SnapshotAttach)?;
            // One transaction produces a consistent encrypted snapshot, including schema/history.
            source
                .execute_batch(
                    "BEGIN IMMEDIATE; SELECT sqlcipher_export('snapshot');
                PRAGMA snapshot.user_version = 1; COMMIT; DETACH DATABASE snapshot;",
                )
                .map_err(|_| VaultError::SnapshotExport)?;
            let snapshot = open_database(&snapshot_path, &snapshot_key, false)?;
            validate_database(&snapshot)?;
            drop(snapshot);
            let encrypted_database = read_limited(&snapshot_path, MAX_SNAPSHOT_SIZE)?;
            let mut payload = Zeroizing::new(Vec::with_capacity(32 + encrypted_database.len()));
            payload.extend_from_slice(snapshot_key.as_ref());
            payload.extend_from_slice(&encrypted_database);
            let package = seal(&payload, password)?;
            // Never overwrite an existing backup. Publish a complete, synced package atomically.
            let parent = destination.parent().ok_or(VaultError::Invalid)?;
            let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
            temporary.write_all(&package)?;
            temporary.as_file().sync_all()?;
            temporary
                .persist_noclobber(destination)
                .map_err(|_| VaultError::Io)?;
            Ok(())
        })();
        drop(source);
        fs::remove_dir_all(stage)?;
        result
    }

    pub fn preview_backup(&self, source: &Path, password: &[u8]) -> Result<Preview> {
        self.with_backup(source, password, false, |_| Ok(()))
            .map(|(_, preview)| preview)
    }

    pub fn restore(&self, source: &Path, password: &[u8]) -> Result<Uuid> {
        self.restore_with_checkpoint(source, password, |_| Ok(()))
    }

    /// Failure hook is for the spike's fault-injection runner, never exposed to WebView.
    pub fn restore_with_checkpoint(
        &self,
        source: &Path,
        password: &[u8],
        checkpoint: impl Fn(RestoreCheckpoint) -> Result<()>,
    ) -> Result<Uuid> {
        self.with_backup(source, password, true, checkpoint)
            .map(|(id, _)| id)
    }

    fn with_backup(
        &self,
        source: &Path,
        password: &[u8],
        commit: bool,
        checkpoint: impl Fn(RestoreCheckpoint) -> Result<()>,
    ) -> Result<(Uuid, Preview)> {
        let package = read_limited(source, MAX_PACKAGE_SIZE)?;
        let payload = unseal(&package, password)?;
        if payload.len() <= 32 {
            return Err(VaultError::Integrity);
        }
        let mut snapshot_key = Zeroizing::new([0; 32]);
        snapshot_key.copy_from_slice(&payload[..32]);
        let workspace = Uuid::now_v7();
        let stage = self.root.join("staging").join(workspace.to_string());
        fs::create_dir(&stage)?;
        let result = (|| {
            let path = stage.join("vault.db");
            // Only SQLCipher ciphertext reaches disk, even during preview and failure recovery.
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&path)?;
            file.write_all(&payload[32..])?;
            file.sync_all()?;
            drop(file);
            let mut database = open_database(&path, &snapshot_key, false)?;
            let preview = preview(&database)?;
            if !commit {
                return Ok((workspace, preview));
            }
            checkpoint(RestoreCheckpoint::Staged)?;
            let before = data(&database)?;
            let new_key = random_key()?;
            database.pragma_update(None, "rekey", key_literal(&new_key).as_str())?;
            let transaction = database.transaction()?;
            transaction.execute(
                "UPDATE workspace SET id = ?1, authority = 'LOCAL'",
                [workspace.to_string()],
            )?;
            transaction.commit()?;
            if validate_database(&database)? != workspace || data(&database)? != before {
                return Err(VaultError::Integrity);
            }
            drop(database);
            let reopened = open_database(&path, &new_key, false)?;
            validate_database(&reopened)?;
            drop(reopened);
            OpenOptions::new().write(true).open(&path)?.sync_all()?;
            self.keys.put_new(self.id, workspace, &new_key)?;
            checkpoint(RestoreCheckpoint::KeyStored)?;
            // Same-volume directory rename is the sole publication point; existing IDs are untouched.
            fs::rename(
                &stage,
                self.root.join("workspaces").join(workspace.to_string()),
            )?;
            Ok((workspace, preview))
        })();
        if stage.exists() && self.keys.delete(self.id, workspace).is_ok() {
            fs::remove_dir_all(stage)?;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::secrets::KeyStore;
    use std::sync::Arc;

    struct NoKeys;
    impl KeyStore for NoKeys {
        fn get(&self, _: Uuid, _: Uuid) -> Result<SecretKey> {
            Err(VaultError::KeyMissing)
        }
        fn put_new(&self, _: Uuid, _: Uuid, _: &SecretKey) -> Result<()> {
            Err(VaultError::SecretStore)
        }
        fn delete(&self, _: Uuid, _: Uuid) -> Result<()> {
            Ok(())
        }
    }

    #[test]
    fn rejects_hostile_header_costs_and_versions_before_kdf() {
        let mut package = vec![0; HEADER_SIZE + 32 + 16];
        package[..8].copy_from_slice(MAGIC);
        package[8..10].copy_from_slice(&1u16.to_le_bytes());
        package[10..14].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(matches!(
            unseal(&package, b"synthetic password"),
            Err(VaultError::Unsupported)
        ));
        package[8..10].copy_from_slice(&2u16.to_le_bytes());
        assert!(matches!(
            unseal(&package, b"synthetic password"),
            Err(VaultError::Unsupported)
        ));
    }

    #[test]
    fn authentication_covers_ciphertext_and_header() {
        let package = seal(&[7; 64], b"synthetic password").unwrap();
        for offset in [22, 38, HEADER_SIZE, package.len() - 1] {
            let mut changed = package.clone();
            changed[offset] ^= 1;
            assert!(matches!(
                unseal(&changed, b"synthetic password"),
                Err(VaultError::Authentication)
            ));
        }
    }

    #[test]
    fn oversized_and_truncated_packages_are_rejected_without_publication() {
        let directory = tempfile::tempdir().unwrap();
        let target =
            Installation::open(&directory.path().join("target"), Arc::new(NoKeys)).unwrap();
        let package = directory.path().join("oversized.fmbackup");
        File::create(&package)
            .unwrap()
            .set_len(MAX_PACKAGE_SIZE as u64 + 1)
            .unwrap();
        assert!(matches!(
            target.restore(&package, b"synthetic password"),
            Err(VaultError::Limit)
        ));
        fs::write(&package, [0; 10]).unwrap();
        assert!(matches!(
            target.restore(&package, b"synthetic password"),
            Err(VaultError::Limit)
        ));
        assert!(target.list().unwrap().is_empty());
    }

    #[test]
    fn authenticated_unsupported_schema_or_triggers_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let target =
            Installation::open(&directory.path().join("target"), Arc::new(NoKeys)).unwrap();
        for mutation in [
            "PRAGMA user_version = 99;",
            "CREATE TRIGGER unexpected AFTER UPDATE ON workspace BEGIN DELETE FROM item; END;",
        ] {
            let encrypted_path = directory.path().join("synthetic.db");
            let key = random_key().unwrap();
            let database = open_database(&encrypted_path, &key, true).unwrap();
            database
                .execute_batch(include_str!("../migrations/0001-synthetic.sql"))
                .unwrap();
            database
                .execute(
                    "INSERT INTO workspace VALUES (?1, 'LOCAL')",
                    [Uuid::now_v7().to_string()],
                )
                .unwrap();
            database.execute_batch(mutation).unwrap();
            drop(database);
            let mut payload = Zeroizing::new(Vec::from(key.as_ref()));
            payload.extend_from_slice(&fs::read(&encrypted_path).unwrap());
            let package = directory.path().join("synthetic.fmbackup");
            fs::write(&package, seal(&payload, b"synthetic password").unwrap()).unwrap();
            assert!(target.restore(&package, b"synthetic password").is_err());
            assert!(target.list().unwrap().is_empty());
            assert_eq!(
                fs::read_dir(directory.path().join("target/staging"))
                    .unwrap()
                    .count(),
                0
            );
            fs::remove_file(encrypted_path).unwrap();
        }
    }
}
