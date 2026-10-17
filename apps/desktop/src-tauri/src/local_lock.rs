use crate::{LocalError, Result, identity, lock_store::PolicyStore};
use argon2::{Algorithm, Argon2, Params, Version};
use ctutils::CtEq;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};
const MARKER: &[u8] = b"FINANCIAL_MANAGER_LOCAL_PRIVACY_V1\n";
const DELAY_MS: u64 = 30_000;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct LockStatus {
    pub enabled: bool,
    pub locked: bool,
    pub retry_after_seconds: u32,
    pub hello_enabled: bool,
    pub hello_availability: crate::windows_hello::HelloAvailability,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PinInput {
    pub pin: String,
}
impl Drop for PinInput {
    fn drop(&mut self) {
        self.pin.zeroize();
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConfigurePin {
    pub current_pin: Option<String>,
    pub new_pin: String,
    pub confirm_pin: String,
}
impl Drop for ConfigurePin {
    fn drop(&mut self) {
        self.current_pin.zeroize();
        self.new_pin.zeroize();
        self.confirm_pin.zeroize();
    }
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
struct PinVerifier {
    salt: [u8; 16],
    tag: [u8; 32],
    failures: u8,
    retry_until_ms: u64,
    last_attempt_ms: u64,
}
impl Drop for PinVerifier {
    fn drop(&mut self) {
        self.tag.zeroize();
    }
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
struct Record {
    version: u8,
    installation: Uuid,
    pin: Option<PinVerifier>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    hello: Option<bool>,
}

pub fn valid_pin(pin: &str) -> bool {
    (6..=12).contains(&pin.len()) && pin.bytes().all(|ch| ch.is_ascii_digit())
}
fn derive(pin: &str, salt: &[u8; 16]) -> Result<Zeroizing<[u8; 32]>> {
    let mut tag = Zeroizing::new([0; 32]);
    let params = Params::new(65_536, 3, 1, Some(32)).map_err(|_| LocalError::StorageUnavailable)?;
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into(pin.as_bytes(), salt, tag.as_mut())
        .map_err(|_| LocalError::StorageUnavailable)?;
    Ok(tag)
}
pub struct LocalLock {
    id: Uuid,
    marker: PathBuf,
    store: Arc<dyn PolicyStore>,
    record: Record,
    unlocked: bool,
    unavailable: bool,
}
impl LocalLock {
    pub fn load(id: Uuid, root: &Path, store: Arc<dyn PolicyStore>) -> Result<Self> {
        let marker = root.join(".local-privacy-v1");
        if marker.exists() {
            let meta = fs::symlink_metadata(&marker)?;
            if !meta.is_file()
                || meta.file_type().is_symlink()
                || meta.len() != MARKER.len() as u64
                || fs::read(&marker)? != MARKER
            {
                return Err(LocalError::IntegrityFailure);
            }
        }
        let record = match store.read(id)? {
            Some(bytes) => {
                if bytes.len() > 2048 {
                    return Err(LocalError::IntegrityFailure);
                }
                let value: Record =
                    serde_json::from_slice(&bytes).map_err(|_| LocalError::IntegrityFailure)?;
                if !matches!((value.version, value.hello), (1, None) | (2, Some(_)))
                    || (value.hello == Some(true) && value.pin.is_none())
                    || value.installation != id
                    || value.pin.as_ref().is_some_and(|p| {
                        p.failures > 5
                            || (p.failures < 5 && p.retry_until_ms != 0)
                            || (p.failures == 5
                                && (p.retry_until_ms < p.last_attempt_ms
                                    || p.retry_until_ms - p.last_attempt_ms != DELAY_MS))
                    })
                {
                    return Err(LocalError::IntegrityFailure);
                }
                value
            }
            None if marker.exists() => return Err(LocalError::StorageUnavailable),
            None => Record {
                version: 1,
                installation: id,
                pin: None,
                hello: None,
            },
        };
        Ok(Self {
            id,
            marker,
            store,
            record,
            unlocked: false,
            unavailable: false,
        })
    }
    pub fn now() -> Result<u64> {
        u64::try_from(identity::system_milliseconds().map_err(|_| LocalError::StorageUnavailable)?)
            .map_err(|_| LocalError::StorageUnavailable)
    }
    pub fn status(&self, now: u64) -> Result<LockStatus> {
        if self.unavailable {
            return Err(LocalError::StorageUnavailable);
        }
        let remaining = self.record.pin.as_ref().map_or(0, |pin| {
            if now < pin.last_attempt_ms {
                DELAY_MS
            } else {
                pin.retry_until_ms.saturating_sub(now).min(DELAY_MS)
            }
        });
        Ok(LockStatus {
            enabled: self.record.pin.is_some(),
            locked: self.record.pin.is_some() && !self.unlocked,
            retry_after_seconds: remaining.div_ceil(1000) as u32,
            hello_enabled: self.record.hello == Some(true),
            hello_availability: crate::windows_hello::HelloAvailability::Unavailable,
        })
    }
    pub fn require_open(&self) -> Result<()> {
        if self.unavailable {
            Err(LocalError::StorageUnavailable)
        } else if self.record.pin.is_some() && !self.unlocked {
            Err(LocalError::LocalLocked)
        } else {
            Ok(())
        }
    }
    pub(crate) fn is_unavailable(&self) -> bool {
        self.unavailable
    }
    pub fn lock(&mut self) {
        self.unlocked = false;
    }
    fn save(&mut self, next: Record) -> Result<()> {
        // Any ambiguous OS write/readback leaves this session fail-closed.
        self.unlocked = false;
        self.unavailable = true;
        let bytes =
            Zeroizing::new(serde_json::to_vec(&next).map_err(|_| LocalError::StorageUnavailable)?);
        self.store.write(self.id, &bytes)?;
        if self.store.read(self.id)?.as_deref().map(Vec::as_slice) != Some(bytes.as_slice()) {
            return Err(LocalError::StorageUnavailable);
        }
        self.record = next;
        self.unavailable = false;
        Ok(())
    }
    fn authenticate(&mut self, pin: &str, now: u64) -> Result<()> {
        if self.unavailable {
            return Err(LocalError::StorageUnavailable);
        }
        let Some(verifier) = &self.record.pin else {
            return Err(LocalError::InvalidPin);
        };
        if now < verifier.last_attempt_ms || now < verifier.retry_until_ms {
            return Err(LocalError::RetryLater);
        }
        // Invalid PIN syntax consumes an attempt too, without an expensive KDF.
        let matches = valid_pin(pin)
            && bool::from(derive(pin, &verifier.salt)?.as_ref().ct_eq(&verifier.tag));
        let mut next = self.record.clone();
        let updated = next.pin.as_mut().ok_or(LocalError::IntegrityFailure)?;
        updated.last_attempt_ms = now;
        if matches {
            updated.failures = 0;
            updated.retry_until_ms = 0;
        } else {
            updated.failures = if updated.failures >= 5 {
                1
            } else {
                updated.failures + 1
            };
            updated.retry_until_ms = if updated.failures == 5 {
                now.checked_add(DELAY_MS)
                    .ok_or(LocalError::StorageUnavailable)?
            } else {
                0
            };
        }
        self.save(next)?;
        if matches {
            Ok(())
        } else {
            Err(LocalError::AuthenticationFailed)
        }
    }
    pub fn unlock(&mut self, input: &PinInput, now: u64) -> Result<()> {
        self.lock();
        self.authenticate(&input.pin, now)?;
        self.unlocked = true;
        Ok(())
    }
    pub fn configure(&mut self, input: &ConfigurePin, now: u64) -> Result<()> {
        if !valid_pin(&input.new_pin) || input.new_pin != input.confirm_pin {
            return Err(LocalError::InvalidPin);
        }
        if self.record.pin.is_some() {
            self.authenticate(input.current_pin.as_deref().unwrap_or(""), now)?;
        } else {
            if input.current_pin.is_some() {
                return Err(LocalError::InvalidPin);
            }
            self.require_open()?;
            // Persist a recoverable disabled record before making its presence mandatory.
            self.save(self.record.clone())?;
            if !self.marker.exists() {
                let pending = self.marker.with_extension("pending");
                if pending.exists() {
                    let metadata = fs::symlink_metadata(&pending)?;
                    if !metadata.is_file()
                        || metadata.file_type().is_symlink()
                        || metadata.len() > MARKER.len() as u64
                        || !MARKER.starts_with(&fs::read(&pending)?)
                    {
                        return Err(LocalError::IntegrityFailure);
                    }
                    fs::remove_file(&pending)?;
                }
                let mut file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&pending)?;
                file.write_all(MARKER)?;
                file.sync_all()?;
                drop(file);
                fs::rename(pending, &self.marker)?;
            }
        }
        let mut salt = [0; 16];
        getrandom::fill(&mut salt).map_err(|_| LocalError::StorageUnavailable)?;
        let tag = derive(&input.new_pin, &salt)?;
        let next = Record {
            version: self.record.version,
            installation: self.id,
            // Changing the fallback PIN revokes Hello opt-in too.
            hello: self.record.hello.map(|_| false),
            pin: Some(PinVerifier {
                salt,
                tag: *tag,
                failures: 0,
                retry_until_ms: 0,
                last_attempt_ms: now,
            }),
        };
        self.save(next)?;
        self.unlocked = true;
        Ok(())
    }
    pub fn disable(&mut self, input: &PinInput, now: u64) -> Result<()> {
        self.authenticate(&input.pin, now)?;
        self.save(Record {
            version: self.record.version,
            installation: self.id,
            pin: None,
            hello: self.record.hello.map(|_| false),
        })
    }
    pub(crate) fn authorize_hello_change(&mut self, input: &PinInput, now: u64) -> Result<()> {
        self.lock();
        self.authenticate(&input.pin, now)
    }
    pub(crate) fn set_hello(&mut self, enabled: bool) -> Result<()> {
        if self.unavailable || self.record.pin.is_none() {
            return Err(LocalError::LocalLocked);
        }
        let mut next = self.record.clone();
        next.version = 2;
        next.hello = Some(enabled);
        self.save(next)
    }
    pub(crate) fn require_hello(&self, now: u64) -> Result<()> {
        let status = self.status(now)?;
        if !status.enabled || !status.hello_enabled {
            return Err(LocalError::HelloUnavailable);
        }
        if status.retry_after_seconds > 0 {
            return Err(LocalError::RetryLater);
        }
        Ok(())
    }
    pub(crate) fn unlock_hello(&mut self, now: u64) -> Result<()> {
        self.require_hello(now)?;
        let mut next = self.record.clone();
        let pin = next.pin.as_mut().ok_or(LocalError::IntegrityFailure)?;
        pin.failures = 0;
        pin.retry_until_ms = 0;
        pin.last_attempt_ms = now;
        self.save(next)?;
        self.unlocked = true;
        Ok(())
    }
}
