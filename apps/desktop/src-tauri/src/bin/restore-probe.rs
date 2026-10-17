//! Explicitly synthetic installations only. Not part of the default product.
use financial_manager_desktop::{
    LocalError, Result,
    commands::LocalState,
    identity,
    keys::{KeyStore, WindowsKeyStore},
    local_backup::CreateBackup,
    local_lock::ConfigurePin,
    local_restore::PreviewRestore,
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    lock_store::{PolicyStore, WindowsPolicyStore},
    restore_probe,
    restore_source::RestoreSource,
    vault_probe as vault,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;
type Checked<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const MARKER: &str = "SYNTHETIC_US035_ONLY\n";
const PASSWORD: &str = "SYNTHETIC restore password US035";
fn check<T, E>(value: std::result::Result<T, E>) -> Checked<T> {
    value.map_err(|_| "RESTORE_CHECK_FAILED".into())
}
fn hash(path: &Path) -> Checked<String> {
    Ok(format!("{:x}", Sha256::digest(fs::read(path)?)))
}
fn iid(root: &Path) -> Checked<Uuid> {
    check(identity::resource_id(&fs::read_to_string(
        root.join(".installation-id"),
    )?))
}
struct Source(PathBuf);
impl RestoreSource for Source {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Ok(Some(self.0.clone()))
    }
}
fn state(root: &Path) -> LocalState {
    LocalState::with_restore_source(
        root.join("target"),
        Arc::new(WindowsKeyStore),
        Arc::new(WindowsPolicyStore),
        Arc::new(Source(root.join("package.fmbackup"))),
    )
}
fn unchanged(root: &Path) -> Checked<()> {
    if hash(&vault::vault_path(&root.join("source")))?
        != fs::read_to_string(root.join("source.sha256"))?
    {
        return Err("SOURCE_CHANGED".into());
    }
    let existing = fs::read_to_string(root.join("existing.id"))?;
    if hash(
        &root
            .join("target/workspaces")
            .join(existing)
            .join("vault.db"),
    )? != fs::read_to_string(root.join("existing.sha256"))?
    {
        return Err("EXISTING_CHANGED".into());
    }
    Ok(())
}
fn verify(root: &Path) -> Checked<()> {
    let target = root.join("target");
    let installation = check(Installation::open(&target, Arc::new(WindowsKeyStore)))?;
    let rows = check(installation.list())?;
    if rows.len() != 2 {
        return Err("WORKSPACE_COUNT".into());
    }
    let existing = fs::read_to_string(root.join("existing.id"))?;
    let restored = rows
        .iter()
        .find(|r| r.id != existing)
        .ok_or("RESTORED_MISSING")?;
    let key =
        check(WindowsKeyStore.get(iid(&target)?, check(identity::resource_id(&restored.id))?))?;
    let db = check(open_database(
        &target
            .join("workspaces")
            .join(&restored.id)
            .join("vault.db"),
        &key,
    ))?;
    if check(restore_probe::semantic_snapshot(&db))?
        != fs::read_to_string(root.join("baseline.sha256"))?
    {
        return Err("GRAPH_CHANGED".into());
    }
    if restored.storage_mode != "LOCAL" || restored.id == vault::dataset_workspace().to_string() {
        return Err("AUTHORITY_NOT_NEW".into());
    }
    if check(vault::has_plaintext(&target, &key))? {
        return Err("PLAINTEXT_FOUND".into());
    }
    drop(db);
    drop(installation);
    unchanged(root)
}
fn run() -> Checked<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        return Err("ARGUMENTS_INVALID".into());
    }
    let mode = args[0].as_str();
    let root = PathBuf::from(&args[1]);
    let source = root.join("source");
    let target = root.join("target");
    let package = root.join("package.fmbackup");
    if mode == "prepare" {
        if root.exists() {
            return Err("FRESH_ROOT_REQUIRED".into());
        }
        fs::create_dir(&root)?;
        fs::write(root.join(".us035-fixture"), MARKER)?;
        let installation = check(vault::fixture(&source, Arc::new(WindowsKeyStore)))?;
        let mut db = check(vault::open_fixture(&source, &WindowsKeyStore))?;
        check(vault::migrate(&mut db))?;
        fs::write(
            root.join("baseline.sha256"),
            check(restore_probe::semantic_snapshot(&db))?,
        )?;
        drop(db);
        drop(installation);
        fs::write(
            root.join("source.sha256"),
            hash(&vault::vault_path(&source))?,
        )?;
        let native = LocalState::new(source.clone(), Arc::new(WindowsKeyStore));
        let job = check(native.prepare_backup(CreateBackup {
            workspace_id: vault::dataset_workspace().to_string(),
            password: PASSWORD.into(),
            confirmation: PASSWORD.into(),
        }))?;
        check(native.finish_backup(job, Some(package)))?;
        drop(native);
        let installation = check(Installation::open(&target, Arc::new(WindowsKeyStore)))?;
        let id = check(identity::new_id().map_err(|_| LocalError::StorageUnavailable))?;
        check(installation.create(CreateWorkspace {
            workspace_id: id.to_string(),
            display_name: "SYNTHETIC existing US035".into(),
            purpose: Purpose::Personal,
        }))?;
        drop(installation);
        fs::write(root.join("existing.id"), id.to_string())?;
        fs::write(
            root.join("existing.sha256"),
            hash(
                &target
                    .join("workspaces")
                    .join(id.to_string())
                    .join("vault.db"),
            )?,
        )?;
    } else {
        if fs::read_to_string(root.join(".us035-fixture"))? != MARKER
            || fs::symlink_metadata(&root)?.file_type().is_symlink()
        {
            return Err("SYNTHETIC_ROOT_REQUIRED".into());
        }
        match mode {
            "cleanup" => {
                for installation in [&source, &target] {
                    if !installation.join(".installation-id").exists() {
                        continue;
                    }
                    if fs::symlink_metadata(installation)?.file_type().is_symlink() {
                        return Err("OWNERSHIP_INVALID".into());
                    }
                    let id = iid(installation)?;
                    check(WindowsPolicyStore::cleanup(id))?;
                    if check(WindowsPolicyStore.read(id))?.is_some() {
                        return Err("POLICY_REMAINS".into());
                    }
                    check(vault::cleanup_keys(installation, &WindowsKeyStore))?;
                }
            }
            "erase-source-key" => {
                let id = iid(&source)?;
                check(WindowsKeyStore.delete(id, vault::dataset_workspace()))?;
                if WindowsKeyStore.get(id, vault::dataset_workspace()).err()
                    != Some(LocalError::KeyMissing)
                {
                    return Err("KEY_REMAINS".into());
                }
            }
            "enable-pin" => {
                let native = state(&root);
                check(native.configure(ConfigurePin {
                    current_pin: None,
                    new_pin: "721947350682".into(),
                    confirm_pin: "721947350682".into(),
                }))?;
            }
            "restore" | "preview-cancel" | "crash-staged" | "crash-before" | "crash-after" => {
                let phase = match mode {
                    "crash-staged" => 1,
                    "crash-before" => 2,
                    "crash-after" => 3,
                    _ => 0,
                };
                restore_probe::crash_at(phase);
                let native = state(&root);
                let job = check(native.begin_restore_selection())?;
                let path = check(native.choose_restore_source(job.lease(), 42))?;
                let selection = check(native.finish_restore_selection(job, path))?
                    .selection_id
                    .ok_or("SELECTION_MISSING")?;
                let preview = check(native.preview_restore(PreviewRestore {
                    selection_id: selection,
                    password: PASSWORD.into(),
                }))?;
                if check(native.list())?.len() != 1
                    || fs::read_dir(target.join("staging"))?.count() != 1
                {
                    return Err("PREVIEW_PUBLISHED".into());
                }
                unchanged(&root)?;
                if mode == "preview-cancel" {
                    let id = check(identity::resource_id(&preview.restore_id))?;
                    check(native.cancel_restore())?;
                    if fs::read_dir(target.join("staging"))?.next().is_some()
                        || WindowsKeyStore.get(iid(&target)?, id).err()
                            != Some(LocalError::KeyMissing)
                        || check(native.list())?.len() != 1
                    {
                        return Err("CANCELED_STAGE_REMAINS".into());
                    }
                } else {
                    fs::write(root.join("restored.id"), &preview.restore_id)?;
                    check(native.confirm_restore(&preview.restore_id))?;
                    drop(native);
                    if phase != 0 {
                        return Err("CHECKPOINT_NOT_REACHED".into());
                    }
                    verify(&root)?;
                }
            }
            "negative" => {
                let native = state(&root);
                let job = check(native.begin_restore_selection())?;
                let path = check(native.choose_restore_source(job.lease(), 42))?;
                let selection = check(native.finish_restore_selection(job, path))?
                    .selection_id
                    .ok_or("SELECTION_MISSING")?;
                if native
                    .preview_restore(PreviewRestore {
                        selection_id: selection.clone(),
                        password: "SYNTHETIC incorrect secret".into(),
                    })
                    .is_ok()
                {
                    return Err("WRONG_PASSWORD_ACCEPTED".into());
                }
                let original = fs::read(&package)?;
                let mut altered = original.clone();
                let n = altered.len() - 1;
                altered[n] ^= 1;
                fs::write(&package, altered)?;
                let accepted = native
                    .preview_restore(PreviewRestore {
                        selection_id: selection,
                        password: PASSWORD.into(),
                    })
                    .is_ok();
                fs::write(&package, original)?;
                if accepted {
                    return Err("TAMPERING_ACCEPTED".into());
                }
                if check(native.list())?.len() != 1
                    || fs::read_dir(target.join("staging"))?.next().is_some()
                {
                    return Err("PARTIAL_RESTORE".into());
                }
                unchanged(&root)?;
            }
            "verify" | "verify-ui" => verify(&root)?,
            "replay" => {
                let id = fs::read_to_string(root.join("restored.id"))?;
                let native = state(&root);
                let a = check(native.confirm_restore(&id))?;
                let b = check(native.confirm_restore(&id))?;
                if a != b || check(native.list())?.len() != 2 {
                    return Err("REPLAY_DUPLICATED".into());
                }
                drop(native);
                verify(&root)?;
            }
            "recover-staged" | "recover-before" | "recover-after" => {
                let stages = fs::read_dir(target.join("staging"))?
                    .map(|e| e.map(|e| e.file_name().to_string_lossy().to_string()))
                    .collect::<std::result::Result<Vec<_>, _>>()?;
                let after = mode == "recover-after";
                if stages.len() != usize::from(!after) {
                    return Err("CHECKPOINT_MISSING".into());
                }
                for id in &stages {
                    let key = check(
                        WindowsKeyStore.get(iid(&target)?, check(identity::resource_id(id))?),
                    )?;
                    if check(vault::has_plaintext(&target, &key))? {
                        return Err("PLAINTEXT_STAGING".into());
                    }
                }
                let native = state(&root);
                if check(native.list())?.len() != if after { 2 } else { 1 } {
                    return Err("PARTIAL_PUBLICATION".into());
                }
                drop(native);
                if fs::read_dir(target.join("staging"))?.next().is_some() {
                    return Err("STAGING_REMAINS".into());
                }
                for id in stages {
                    if WindowsKeyStore
                        .get(iid(&target)?, check(identity::resource_id(&id))?)
                        .err()
                        != Some(LocalError::KeyMissing)
                    {
                        return Err("ORPHAN_KEY".into());
                    }
                }
                if after {
                    verify(&root)?;
                }
                unchanged(&root)?;
            }
            _ => return Err("MODE_INVALID".into()),
        }
    }
    fs::write(&args[2], b"{\"passed\":true}")?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("US035_RESTORE_PROBE_FAILED");
        std::process::exit(1);
    }
}
