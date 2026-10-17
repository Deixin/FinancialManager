use financial_manager_desktop::{
    LocalError, Result,
    commands::LocalState,
    identity,
    keys::{KeyStore, WindowsKeyStore},
    local_lock::{ConfigurePin, PinInput},
    local_workspaces::{CreateWorkspace, Purpose},
    lock_store::{PolicyStore, WindowsPolicyStore},
    vault_probe as probe,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
};
use uuid::Uuid;
use zeroize::Zeroizing;
const PIN: &str = "721947350682";
const SECOND: &str = "682035741921";
const MARKER: &str = "SYNTHETIC_US033_ONLY\n";
fn pin(value: &str) -> PinInput {
    PinInput { pin: value.into() }
}
fn config(old: Option<&str>, new: &str) -> ConfigurePin {
    ConfigurePin {
        current_pin: old.map(str::to_owned),
        new_pin: new.into(),
        confirm_pin: new.into(),
    }
}
fn unchanged(root: &Path) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let bytes = fs::read(probe::vault_path(root))?;
    if format!("{:x}", Sha256::digest(bytes)) != fs::read_to_string(root.join("ciphertext.sha256"))?
    {
        return Err("DATABASE_CHANGED".into());
    }
    let db = probe::open_fixture(root, &WindowsKeyStore).map_err(|_| "OPEN_FAILED")?;
    probe::integrity(&db).map_err(|_| "INTEGRITY_FAILED")?;
    if probe::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")?
        != fs::read_to_string(root.join("baseline.sha256"))?
    {
        return Err("FINANCIAL_STATE_CHANGED".into());
    }
    Ok(())
}
fn scan(root: &Path, patterns: &[&[u8]]) -> std::io::Result<bool> {
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            if scan(&path, patterns)? {
                return Ok(true);
            }
        } else {
            let bytes = fs::read(path)?;
            if patterns
                .iter()
                .any(|p| !p.is_empty() && bytes.windows(p.len()).any(|part| part == *p))
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
struct CrashStore {
    calls: AtomicU8,
    after: bool,
}
impl PolicyStore for CrashStore {
    fn read(&self, id: Uuid) -> Result<Option<Zeroizing<Vec<u8>>>> {
        WindowsPolicyStore.read(id)
    }
    fn write(&self, id: Uuid, bytes: &[u8]) -> Result<()> {
        let stop = self.calls.fetch_add(1, Ordering::SeqCst) == 1;
        if stop && !self.after {
            std::process::exit(73);
        }
        WindowsPolicyStore.write(id, bytes)?;
        if stop && self.after {
            std::process::exit(73);
        }
        Ok(())
    }
}
fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("ARGUMENTS_INVALID".into());
    }
    let mode = args[0].as_str();
    let root = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);
    if mode == "prepare" {
        if root.exists() {
            return Err("FRESH_SYNTHETIC_ROOT_REQUIRED".into());
        }
        fs::create_dir(&root)?;
        fs::write(root.join(".us033-fixture"), MARKER)?;
        let installation =
            probe::fixture(&root, Arc::new(WindowsKeyStore)).map_err(|_| "FIXTURE_FAILED")?;
        let mut db = probe::open_fixture(&root, &WindowsKeyStore).map_err(|_| "OPEN_FAILED")?;
        probe::migrate(&mut db).map_err(|_| "MIGRATION_FAILED")?;
        fs::write(
            root.join("baseline.sha256"),
            probe::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")?,
        )?;
        drop(db);
        drop(installation);
        fs::write(
            root.join("ciphertext.sha256"),
            format!("{:x}", Sha256::digest(fs::read(probe::vault_path(&root))?)),
        )?;
    } else {
        if fs::read_to_string(root.join(".us033-fixture"))? != MARKER {
            return Err("SYNTHETIC_ROOT_REQUIRED".into());
        }
        let id = identity::resource_id(&fs::read_to_string(root.join(".installation-id"))?)
            .map_err(|_| "IDENTITY_FAILED")?;
        if mode == "cleanup" {
            WindowsPolicyStore::cleanup(id).map_err(|_| "POLICY_CLEANUP_FAILED")?;
            if WindowsPolicyStore
                .read(id)
                .map_err(|_| "POLICY_VERIFY_FAILED")?
                .is_some()
            {
                return Err("POLICY_REMAINS".into());
            }
            probe::cleanup_keys(&root, &WindowsKeyStore).map_err(|_| "KEY_CLEANUP_FAILED")?;
        } else {
            let policies: Arc<dyn PolicyStore> = if mode == "crash-before" || mode == "crash-after"
            {
                Arc::new(CrashStore {
                    calls: AtomicU8::new(0),
                    after: mode == "crash-after",
                })
            } else {
                Arc::new(WindowsPolicyStore)
            };
            let state =
                LocalState::with_policies(root.clone(), Arc::new(WindowsKeyStore), policies);
            match mode {
                "enable" | "crash-before" | "crash-after" => {
                    state
                        .configure(config(None, PIN))
                        .map_err(|_| "ENABLE_FAILED")?;
                    if mode != "enable" {
                        return Err("CHECKPOINT_NOT_REACHED".into());
                    }
                }
                "negative" => {
                    if !state.status().map_err(|_| "STATUS_FAILED")?.locked
                        || state.list().err() != Some(LocalError::LocalLocked)
                        || state.open(&probe::dataset_workspace().to_string()).err()
                            != Some(LocalError::LocalLocked)
                        || state
                            .create(CreateWorkspace {
                                workspace_id: identity::new_id()
                                    .map_err(|_| "ID_FAILED")?
                                    .to_string(),
                                display_name: "SYNTHETIC FORBIDDEN".into(),
                                purpose: Purpose::Personal,
                            })
                            .err()
                            != Some(LocalError::LocalLocked)
                        || state.unlock(pin(SECOND)).err() != Some(LocalError::AuthenticationFailed)
                    {
                        return Err("GATE_FAILED".into());
                    }
                    unchanged(&root)?;
                }
                "restart" | "recover-after" => {
                    if !state.status().map_err(|_| "STATUS_FAILED")?.locked {
                        return Err("RESTART_NOT_LOCKED".into());
                    }
                    state.unlock(pin(PIN)).map_err(|_| "UNLOCK_FAILED")?;
                    state
                        .open(&probe::dataset_workspace().to_string())
                        .map_err(|_| "WORKSPACE_FAILED")?;
                    unchanged(&root)?;
                }
                "recover-before" => {
                    if state.status().map_err(|_| "STATUS_FAILED")?.enabled {
                        return Err("OLD_POLICY_CHANGED".into());
                    }
                    state
                        .open(&probe::dataset_workspace().to_string())
                        .map_err(|_| "WORKSPACE_FAILED")?;
                    unchanged(&root)?;
                }
                "change-disable" => {
                    if state.configure(config(Some(SECOND), SECOND)).err()
                        != Some(LocalError::AuthenticationFailed)
                    {
                        return Err("CURRENT_PIN_BYPASSED".into());
                    }
                    state
                        .configure(config(Some(PIN), SECOND))
                        .map_err(|_| "ROTATION_FAILED")?;
                    state.lock().map_err(|_| "LOCK_FAILED")?;
                    if state.unlock(pin(PIN)).err() != Some(LocalError::AuthenticationFailed) {
                        return Err("OLD_PIN_ACCEPTED".into());
                    }
                    state.unlock(pin(SECOND)).map_err(|_| "UNLOCK_FAILED")?;
                    if state.disable(pin(PIN)).err() != Some(LocalError::AuthenticationFailed) {
                        return Err("DISABLE_BYPASSED".into());
                    }
                    state.disable(pin(SECOND)).map_err(|_| "DISABLE_FAILED")?;
                    if state.status().map_err(|_| "STATUS_FAILED")?.enabled {
                        return Err("STILL_ENABLED".into());
                    }
                    unchanged(&root)?;
                }
                "verify-files" => {
                    let policy = WindowsPolicyStore
                        .read(id)
                        .map_err(|_| "POLICY_FAILED")?
                        .ok_or("POLICY_REQUIRED")?;
                    let key = WindowsKeyStore
                        .get(id, probe::dataset_workspace())
                        .map_err(|_| "KEY_FAILED")?;
                    if scan(
                        &root,
                        &[PIN.as_bytes(), SECOND.as_bytes(), policy.as_slice()],
                    )? || probe::has_plaintext(&root, &key).map_err(|_| "SCAN_FAILED")?
                    {
                        return Err("PLAINTEXT_FOUND".into());
                    }
                    unchanged(&root)?;
                }
                _ => return Err("MODE_INVALID".into()),
            }
        }
    }
    fs::write(output, b"{\"passed\":true}")?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("US033_LOCK_PROBE_FAILED");
        std::process::exit(1);
    }
}
