//! Ephemeral selection and bounded host IO. No raw content crosses IPC or disk staging.
use crate::{
    LocalError, Result,
    file_model::{self, Metadata},
    identity,
    restore_source::RestoreSource,
};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    fs::OpenOptions,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

pub struct Controller {
    selected: Mutex<Option<Selection>>,
    workspace: Mutex<Option<String>>,
    epoch: AtomicU64,
    picking: Arc<AtomicBool>,
    source: Arc<dyn RestoreSource>,
}
struct Selection {
    workspace: String,
    batch: String,
    id: String,
    path: PathBuf,
    born: Instant,
    epoch: u64,
}
pub struct Job {
    pub workspace: String,
    pub batch: String,
    pub generation: u64,
    pub installation: uuid::Uuid,
    epoch: u64,
    picking: Arc<AtomicBool>,
    _permit: Permit,
}
struct Permit(Arc<AtomicBool>);
impl Drop for Permit {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl Drop for Job {
    fn drop(&mut self) {
        self.picking.store(false, Ordering::SeqCst);
    }
}
impl Default for Controller {
    fn default() -> Self {
        Self::with_source(Arc::new(crate::import_file_source::WindowsImportSource))
    }
}
impl Controller {
    pub fn with_source(source: Arc<dyn RestoreSource>) -> Self {
        Self {
            selected: Mutex::new(None),
            workspace: Mutex::new(None),
            epoch: AtomicU64::new(0),
            picking: Arc::new(AtomicBool::new(false)),
            source,
        }
    }
    pub fn invalidate(&self) {
        let mut workspace = self.workspace.lock().ok();
        if let Some(binding) = workspace.as_mut() {
            **binding = None;
        }
        self.epoch.fetch_add(1, Ordering::SeqCst);
        if let Ok(mut s) = self.selected.lock() {
            *s = None;
        }
    }
    pub fn cancel_for(&self, workspace: &str) -> Result<()> {
        let mut binding = self
            .workspace
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?;
        if binding.as_deref() != Some(workspace) {
            return Ok(());
        }
        self.epoch.fetch_add(1, Ordering::SeqCst);
        *binding = None;
        *self
            .selected
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)? = None;
        Ok(())
    }
    pub fn blur(&self) {
        if !self.picking.load(Ordering::SeqCst) {
            self.invalidate();
        }
    }
    pub fn begin(
        &self,
        workspace: &str,
        batch: &str,
        generation: u64,
        installation: uuid::Uuid,
        active: Arc<AtomicBool>,
    ) -> Result<Job> {
        active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| LocalError::RequestConflict)?;
        let permit = Permit(active);
        self.invalidate();
        *self
            .workspace
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)? = Some(workspace.into());
        self.picking.store(true, Ordering::SeqCst);
        Ok(Job {
            workspace: workspace.into(),
            batch: batch.into(),
            generation,
            installation,
            epoch: self.epoch.load(Ordering::SeqCst),
            picking: self.picking.clone(),
            _permit: permit,
        })
    }
    pub fn valid(&self, job: &Job) -> bool {
        self.current(job.epoch)
    }
    pub fn current(&self, epoch: u64) -> bool {
        self.epoch.load(Ordering::SeqCst) == epoch
    }
    pub fn choose(&self, window: isize) -> Result<Option<PathBuf>> {
        self.source.choose(window)
    }
    pub fn finish(&self, job: Job, path: Option<PathBuf>) -> Result<Value> {
        if !self.valid(&job) {
            return Err(LocalError::LocalLocked);
        }
        let Some(path) = path else {
            return Ok(json!({"selection_id":null}));
        };
        let id = identity::new_id()
            .map_err(|_| LocalError::StorageUnavailable)?
            .to_string();
        let mut slot = self
            .selected
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?;
        if !self.valid(&job) {
            return Err(LocalError::LocalLocked);
        }
        *slot = Some(Selection {
            workspace: job.workspace.clone(),
            batch: job.batch.clone(),
            id: id.clone(),
            path,
            born: Instant::now(),
            epoch: job.epoch,
        });
        Ok(json!({"selection_id":id}))
    }
    pub fn take(&self, workspace: &str, batch: &str, id: &str) -> Result<(PathBuf, u64)> {
        let mut slot = self
            .selected
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?;
        if slot
            .as_ref()
            .is_none_or(|s| s.workspace != workspace || s.batch != batch || s.id != id)
        {
            return Err(LocalError::InvalidImportRequest);
        }
        let s = slot.take().ok_or(LocalError::InvalidImportRequest)?;
        if s.born.elapsed() > Duration::from_secs(300) || !self.current(s.epoch) {
            return Err(LocalError::RequestConflict);
        }
        Ok((s.path, s.epoch))
    }
}
pub fn request(input: &Value, action: &str, keys: &[&str]) -> Result<()> {
    crate::import_model::exact(input, keys).map_err(|_| LocalError::InvalidImportRequest)?;
    if input["action"] != action {
        return Err(LocalError::InvalidImportRequest);
    }
    Ok(())
}
pub fn read_file(
    path: &Path,
    encoding: &str,
    delimiter: Option<&str>,
    valid: impl Fn() -> bool,
) -> Value {
    match inspect_file(path, encoding, delimiter, None, valid) {
        Ok(v) => v,
        Err(code) => json!({"outcome":"REJECTED","code":code}),
    }
}
pub fn read_for_destination(
    path: &Path,
    encoding: &str,
    delimiter: Option<&str>,
    destination: &crate::ofx_model::Destination,
    valid: impl Fn() -> bool,
) -> Value {
    match inspect_file(path, encoding, delimiter, Some(destination), valid) {
        Ok(v) => v,
        Err(code) => json!({"outcome":"REJECTED","code":code}),
    }
}
fn inspect_file(
    path: &Path,
    encoding: &str,
    delimiter: Option<&str>,
    destination: Option<&crate::ofx_model::Destination>,
    valid: impl Fn() -> bool,
) -> file_model::Check<Value> {
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .ok_or("INVALID_REQUEST")?;
    let metadata = Metadata {
        file_name: name.into(),
        mime: String::new(),
        encoding: encoding.into(),
        delimiter: delimiter.map(str::to_owned),
    };
    if !file_model::valid_name(name) {
        return Err("INVALID_REQUEST");
    }
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        if !matches!(path.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_)))
            || !path.is_absolute()
        {
            return Err("INVALID_REQUEST");
        }
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.share_mode(1).custom_flags(0x00200000 | 0x08000000);
    }
    let mut file = options.open(path).map_err(|_| "FILE_UNAVAILABLE")?;
    let info = file.metadata().map_err(|_| "FILE_UNAVAILABLE")?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if info.file_attributes() & 0x400 != 0 {
            return Err("INVALID_REQUEST");
        }
    }
    if !info.is_file() {
        return Err("INVALID_REQUEST");
    }
    if info.len() > file_model::MAX_BYTES as u64 {
        return Err("FILE_LIMIT");
    }
    let budget = file_model::Budget::new(&valid);
    let mut bytes = Zeroizing::new(Vec::with_capacity(info.len() as usize));
    let mut block = Zeroizing::new([0u8; 16384]);
    loop {
        budget.check()?;
        let remaining = (file_model::MAX_BYTES.saturating_sub(bytes.len()) + 1).min(block.len());
        let n = file
            .read(&mut block[..remaining])
            .map_err(|_| "FILE_UNAVAILABLE")?;
        if n == 0 {
            break;
        }
        if bytes.len() + n > file_model::MAX_BYTES {
            return Err("FILE_LIMIT");
        }
        bytes.extend_from_slice(&block[..n]);
    }
    if bytes.len() as u64 != info.len() {
        return Err("FILE_UNAVAILABLE");
    }
    let inspection = file_model::validate(&metadata, &bytes, || valid() && budget.check().is_ok());
    budget.check()?;
    let inspection = inspection?;
    budget.check()?;
    let hash = format!("{:x}", Sha256::digest(bytes.as_slice()));
    budget.check()?;
    let mut result =
        json!({"outcome":"VALIDATED","file_name":name,"file_hash":hash,"inspection":inspection});
    if inspection.format == "OFX"
        && let Some(destination) = destination
    {
        let normalized = crate::ofx_model::parse(&metadata, &bytes, destination, || {
            valid() && budget.check().is_ok()
        });
        budget.check()?;
        result["normalization"] = normalized?;
    }
    budget.check()?;
    Ok(result)
}

#[cfg(test)]
mod file_tests {
    use super::*;
    #[test]
    fn expired_selection_is_removed_without_reading_file() {
        let controller = Controller::default();
        *controller.selected.lock().unwrap() = Some(Selection {
            workspace: "SYNTHETIC-w".into(),
            batch: "SYNTHETIC-b".into(),
            id: "SYNTHETIC-id".into(),
            path: PathBuf::from("SYNTHETIC-does-not-exist.csv"),
            born: Instant::now() - Duration::from_secs(301),
            epoch: 0,
        });
        assert!(matches!(
            controller.take("SYNTHETIC-w", "SYNTHETIC-b", "SYNTHETIC-id"),
            Err(LocalError::RequestConflict)
        ));
        assert!(controller.selected.lock().unwrap().is_none());
    }
}
