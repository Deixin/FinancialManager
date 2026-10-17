//! Product .fmbackup v1. No path, database key or manifest is exposed through IPC.
use crate::{LocalError, Result, SecretKey, identity, migrations};
use aes_gcm::{
    Aes256Gcm, KeyInit,
    aead::{Aead, Payload},
};
use argon2::{Algorithm, Argon2, Params, Version};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
use zeroize::{Zeroize, Zeroizing};

pub const MAX_SNAPSHOT: usize = 64 * 1024 * 1024;
pub const MAX_MANIFEST: usize = 64 * 1024;
pub const HEADER_SIZE: usize = 58;
pub const MAX_PACKAGE: usize = HEADER_SIZE + 4 + MAX_MANIFEST + 32 + MAX_SNAPSHOT + 16;
const MAGIC: &[u8; 8] = b"FMBK0034";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateBackup {
    pub workspace_id: String,
    pub password: String,
    pub confirmation: String,
}
impl Drop for CreateBackup {
    fn drop(&mut self) {
        self.password.zeroize();
        self.confirmation.zeroize();
    }
}
pub fn valid_password(value: &str) -> bool {
    (12..=128).contains(&value.chars().count())
        && value.len() <= 1024
        && !value.chars().any(char::is_control)
        && !value.chars().all(char::is_whitespace)
}
impl CreateBackup {
    pub fn validate(&self) -> Result<uuid::Uuid> {
        if !valid_password(&self.password) || self.password != self.confirmation {
            return Err(LocalError::InvalidBackupPassword);
        }
        identity::resource_id(&self.workspace_id).map_err(|_| LocalError::InvalidWorkspace)
    }
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct EncryptionDescriptor {
    pub package: String,
    pub snapshot: String,
    pub kdf: String,
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}
impl Default for EncryptionDescriptor {
    fn default() -> Self {
        Self {
            package: "AES-256-GCM".into(),
            snapshot: "SQLCIPHER-4".into(),
            kdf: "ARGON2ID-19".into(),
            memory_kib: 65_536,
            iterations: 3,
            parallelism: 1,
        }
    }
}
#[derive(Clone, Serialize, Deserialize, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct BackupManifest {
    pub format_version: u16,
    pub workspace_id: String,
    pub schema_version: i64,
    pub created_at: String,
    pub app_version: String,
    pub record_counts: BTreeMap<String, String>,
    pub integrity_hashes: BTreeMap<String, String>,
    pub encryption_descriptor: EncryptionDescriptor,
}
#[derive(Serialize, Clone, PartialEq, Eq, Debug)]
#[serde(deny_unknown_fields)]
pub struct BackupResult {
    pub outcome: &'static str,
    pub created_at: Option<String>,
}
pub struct VerifiedBackup {
    pub manifest: BackupManifest,
    pub snapshot_key: SecretKey,
    pub snapshot: Zeroizing<Vec<u8>>,
}
pub struct SealedBackup {
    bytes: Vec<u8>,
    digest: [u8; 32],
    pub(crate) created_at: String,
}
pub(crate) fn record_counts(db: &Connection) -> Result<BTreeMap<String, String>> {
    let tables = db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?
        .query_map([], |r| r.get::<_, String>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
    let mut counts = BTreeMap::new();
    for table in tables {
        if table.is_empty() || !table.bytes().all(|c| c.is_ascii_lowercase() || c == b'_') {
            return Err(LocalError::UnsupportedSchema);
        }
        let count: i64 = db.query_row(&format!("SELECT count(*) FROM \"{table}\""), [], |r| {
            r.get(0)
        })?;
        if count < 0 {
            return Err(LocalError::IntegrityFailure);
        }
        counts.insert(table, count.to_string());
    }
    Ok(counts)
}
pub(crate) fn validate_snapshot(db: &Connection, manifest: &BackupManifest) -> Result<()> {
    migrations::verify_current(db)?;
    if db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))? != "ok"
        || db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))?
            != manifest.schema_version
        || db.query_row(
            "SELECT count(*) FROM workspace WHERE id=? AND storage_mode='LOCAL'",
            [&manifest.workspace_id],
            |r| r.get::<_, i64>(0),
        )? != 1
        || db.query_row("SELECT count(*) FROM workspace", [], |r| r.get::<_, i64>(0))? != 1
        || record_counts(db)? != manifest.record_counts
    {
        return Err(LocalError::IntegrityFailure);
    }
    Ok(())
}
pub(crate) fn manifest(
    db: &Connection,
    workspace: &str,
    snapshot: &[u8],
) -> Result<BackupManifest> {
    Ok(BackupManifest {
        format_version: 1,
        workspace_id: workspace.into(),
        schema_version: migrations::current_version(),
        created_at: identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?,
        app_version: env!("CARGO_PKG_VERSION").into(),
        record_counts: record_counts(db)?,
        integrity_hashes: BTreeMap::from([(
            "payload.enc".into(),
            format!("{:x}", Sha256::digest(snapshot)),
        )]),
        encryption_descriptor: EncryptionDescriptor::default(),
    })
}
fn derive(password: &str, salt: &[u8]) -> Result<SecretKey> {
    if !valid_password(password) {
        return Err(LocalError::InvalidBackupPassword);
    }
    let mut key = Zeroizing::new([0; 32]);
    let params = Params::new(65_536, 3, 1, Some(32)).map_err(|_| LocalError::UnsupportedBackup)?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(password.as_bytes(), salt, key.as_mut())
        .map_err(|_| LocalError::BackupAuthenticationFailed)?;
    Ok(key)
}
pub(crate) fn seal(
    manifest: &BackupManifest,
    snapshot_key: &SecretKey,
    snapshot: &[u8],
    password: &str,
) -> Result<SealedBackup> {
    if !(4096..=MAX_SNAPSHOT).contains(&snapshot.len()) {
        return Err(LocalError::BackupLimit);
    }
    let json =
        Zeroizing::new(serde_json::to_vec(manifest).map_err(|_| LocalError::IntegrityFailure)?);
    if json.len() > MAX_MANIFEST {
        return Err(LocalError::BackupLimit);
    }
    let mut payload = Zeroizing::new(Vec::with_capacity(4 + json.len() + 32 + snapshot.len()));
    payload.extend_from_slice(&(json.len() as u32).to_le_bytes());
    payload.extend_from_slice(&json);
    payload.extend_from_slice(snapshot_key.as_ref());
    payload.extend_from_slice(snapshot);
    let mut salt = [0; 16];
    let mut nonce = [0; 12];
    getrandom::fill(&mut salt).map_err(|_| LocalError::StorageUnavailable)?;
    getrandom::fill(&mut nonce).map_err(|_| LocalError::StorageUnavailable)?;
    let mut bytes = Vec::with_capacity(HEADER_SIZE + payload.len() + 16);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&1u16.to_le_bytes());
    for value in [65_536u32, 3, 1] {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes.extend_from_slice(&salt);
    bytes.extend_from_slice(&nonce);
    bytes.extend_from_slice(&((payload.len() + 16) as u64).to_le_bytes());
    let key = derive(password, &salt)?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| LocalError::BackupAuthenticationFailed)?;
    let ciphertext = cipher
        .encrypt(
            &nonce.into(),
            Payload {
                msg: &payload,
                aad: &bytes,
            },
        )
        .map_err(|_| LocalError::BackupAuthenticationFailed)?;
    // Validate AEAD round-trip before discarding every recovery/device secret.
    let verified = Zeroizing::new(
        cipher
            .decrypt(
                &nonce.into(),
                Payload {
                    msg: &ciphertext,
                    aad: &bytes,
                },
            )
            .map_err(|_| LocalError::BackupVerificationFailed)?,
    );
    if verified.as_slice() != payload.as_slice() {
        return Err(LocalError::BackupVerificationFailed);
    }
    bytes.extend_from_slice(&ciphertext);
    Ok(SealedBackup {
        digest: Sha256::digest(&bytes).into(),
        bytes,
        created_at: manifest.created_at.clone(),
    })
}
pub fn read_verified(path: &Path, password: &str) -> Result<VerifiedBackup> {
    let bytes = read_limited(path, MAX_PACKAGE)?;
    decode(&bytes, password)
}
fn decode(bytes: &[u8], password: &str) -> Result<VerifiedBackup> {
    if bytes.len() < HEADER_SIZE + 4 + 32 + 4096 + 16 || bytes.len() > MAX_PACKAGE {
        return Err(LocalError::BackupLimit);
    }
    if &bytes[..8] != MAGIC || bytes[8..10] != 1u16.to_le_bytes() {
        return Err(LocalError::UnsupportedBackup);
    }
    for (offset, value) in [(10, 65_536u32), (14, 3), (18, 1)] {
        if bytes[offset..offset + 4] != value.to_le_bytes() {
            return Err(LocalError::UnsupportedBackup);
        }
    }
    let length = u64::from_le_bytes(
        bytes[50..58]
            .try_into()
            .map_err(|_| LocalError::BackupLimit)?,
    );
    if length != (bytes.len() - HEADER_SIZE) as u64 {
        return Err(LocalError::BackupLimit);
    }
    let key = derive(password, &bytes[22..38])?;
    let cipher = Aes256Gcm::new_from_slice(key.as_ref())
        .map_err(|_| LocalError::BackupAuthenticationFailed)?;
    let nonce: [u8; 12] = bytes[38..50]
        .try_into()
        .map_err(|_| LocalError::BackupLimit)?;
    let payload = Zeroizing::new(
        cipher
            .decrypt(
                &nonce.into(),
                Payload {
                    msg: &bytes[HEADER_SIZE..],
                    aad: &bytes[..HEADER_SIZE],
                },
            )
            .map_err(|_| LocalError::BackupAuthenticationFailed)?,
    );
    if payload.len() < 4 {
        return Err(LocalError::BackupLimit);
    }
    let json_len = u32::from_le_bytes(
        payload[..4]
            .try_into()
            .map_err(|_| LocalError::BackupLimit)?,
    ) as usize;
    if json_len > MAX_MANIFEST || json_len + 4 + 32 + 4096 > payload.len() {
        return Err(LocalError::BackupLimit);
    }
    let manifest: BackupManifest = serde_json::from_slice(&payload[4..4 + json_len])
        .map_err(|_| LocalError::UnsupportedBackup)?;
    let snapshot = Zeroizing::new(payload[4 + json_len + 32..].to_vec());
    if snapshot.len() > MAX_SNAPSHOT
        || manifest.format_version != 1
        || manifest.schema_version != migrations::current_version()
        || identity::resource_id(&manifest.workspace_id).is_err()
        || identity::utc_instant(&manifest.created_at).is_err()
        || manifest.app_version.is_empty()
        || manifest.app_version.len() > 64
        || manifest.encryption_descriptor != EncryptionDescriptor::default()
        || manifest.integrity_hashes
            != BTreeMap::from([(
                "payload.enc".into(),
                format!("{:x}", Sha256::digest(&snapshot)),
            )])
        || manifest.record_counts.is_empty()
        || manifest.record_counts.len() > 128
        || manifest.record_counts.iter().any(|(name, count)| {
            name.is_empty()
                || !name.bytes().all(|c| c.is_ascii_lowercase() || c == b'_')
                || count
                    .parse::<u64>()
                    .ok()
                    .is_none_or(|v| v.to_string() != *count)
        })
    {
        return Err(LocalError::UnsupportedBackup);
    }
    let mut snapshot_key = Zeroizing::new([0; 32]);
    snapshot_key.copy_from_slice(&payload[4 + json_len..4 + json_len + 32]);
    Ok(VerifiedBackup {
        manifest,
        snapshot_key,
        snapshot,
    })
}
pub(crate) fn read_limited(path: &Path, limit: usize) -> Result<Vec<u8>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > limit as u64 {
        return Err(LocalError::BackupLimit);
    }
    let mut bytes = Vec::new();
    File::open(path)?
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > limit {
        return Err(LocalError::BackupLimit);
    }
    Ok(bytes)
}
fn verify_file(file: &mut File, size: usize, digest: &[u8; 32]) -> Result<()> {
    if file.metadata()?.len() != size as u64 {
        return Err(LocalError::BackupVerificationFailed);
    }
    file.seek(SeekFrom::Start(0))?;
    let mut hash = Sha256::new();
    let mut buffer = [0; 64 * 1024];
    let mut total = 0usize;
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        total += count;
        if total > size {
            return Err(LocalError::BackupVerificationFailed);
        }
        hash.update(&buffer[..count]);
    }
    let actual: [u8; 32] = hash.finalize().into();
    if total != size || &actual != digest {
        return Err(LocalError::BackupVerificationFailed);
    }
    Ok(())
}
impl SealedBackup {
    pub(crate) fn publish(
        &self,
        destination: &Path,
        installation_root: &Path,
        valid: impl Fn() -> bool,
    ) -> Result<BackupResult> {
        if !destination.is_absolute()
            || !destination
                .extension()
                .is_some_and(|s| s.eq_ignore_ascii_case("fmbackup"))
        {
            return Err(LocalError::BackupDestinationUnavailable);
        }
        let parent = destination
            .parent()
            .ok_or(LocalError::BackupDestinationUnavailable)?
            .canonicalize()?;
        if parent.starts_with(installation_root.canonicalize()?) {
            return Err(LocalError::BackupDestinationUnavailable);
        }
        let target: PathBuf = parent.join(
            destination
                .file_name()
                .ok_or(LocalError::BackupDestinationUnavailable)?,
        );
        match fs::symlink_metadata(&target) {
            Ok(_) => return Err(LocalError::BackupAlreadyExists),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(LocalError::BackupDestinationUnavailable),
        }
        if !valid() {
            return Err(LocalError::LocalLocked);
        }
        let mut temporary = tempfile::Builder::new()
            .prefix(".fmbackup-")
            .tempfile_in(parent)?;
        temporary.write_all(&self.bytes)?;
        temporary.as_file().sync_all()?;
        verify_file(temporary.as_file_mut(), self.bytes.len(), &self.digest)?;
        if !valid() {
            return Err(LocalError::LocalLocked);
        }
        self.checkpoint("before_publish");
        let published = temporary.persist_noclobber(&target).map_err(|e| {
            if e.error.kind() == std::io::ErrorKind::AlreadyExists {
                LocalError::BackupAlreadyExists
            } else {
                LocalError::BackupDestinationUnavailable
            }
        })?;
        drop(published);
        self.checkpoint("after_publish");
        verify_file(&mut File::open(target)?, self.bytes.len(), &self.digest)?;
        Ok(BackupResult {
            outcome: "CREATED",
            created_at: Some(self.created_at.clone()),
        })
    }
    fn checkpoint(&self, _name: &str) {
        #[cfg(feature = "backup-smoke")]
        crate::backup_probe::checkpoint(_name);
    }
}
