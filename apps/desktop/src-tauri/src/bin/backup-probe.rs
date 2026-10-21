use financial_manager_desktop::{
    LocalError, backup_probe,
    commands::LocalState,
    identity,
    keys::{KeyStore, WindowsKeyStore},
    local_backup::{self, CreateBackup},
    local_lock::ConfigurePin,
    lock_store::{PolicyStore, WindowsPolicyStore},
    vault_probe as vault,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
const MARKER: &str = "SYNTHETIC_US034_ONLY\n";
const PASSWORD: &str = "SYNTHETIC backup password US034";
fn request() -> CreateBackup {
    CreateBackup {
        workspace_id: vault::dataset_workspace().to_string(),
        password: PASSWORD.into(),
        confirmation: PASSWORD.into(),
    }
}
fn unchanged(root: &Path) -> std::result::Result<(), Box<dyn std::error::Error>> {
    if format!("{:x}", Sha256::digest(fs::read(vault::vault_path(root))?))
        != fs::read_to_string(root.join("ciphertext.sha256"))?
    {
        return Err("CIPHERTEXT_CHANGED".into());
    }
    let db = vault::open_fixture(root, &WindowsKeyStore).map_err(|_| "FIXTURE_FAILED")?;
    vault::integrity(&db).map_err(|_| "INTEGRITY_FAILED")?;
    if vault::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")?
        != fs::read_to_string(root.join("baseline.sha256"))?
    {
        return Err("STRUCTURED_STATE_CHANGED".into());
    }
    Ok(())
}
fn inspect(root: &Path, path: &Path) -> std::result::Result<(), Box<dyn std::error::Error>> {
    // This branch never opens the source key store/database. Only the recovery secret is used.
    let backup = local_backup::read_verified(path, PASSWORD).map_err(|_| "PACKAGE_FAILED")?;
    if backup.manifest.schema_version != 3
        || backup.manifest.record_counts.len() != 19
        || backup.manifest.format_version != 1
    {
        return Err("MANIFEST_FAILED".into());
    }
    if backup_probe::inspect(&backup, &root.with_extension("inspection"))
        .map_err(|_| "INSPECTION_FAILED")?
        != fs::read_to_string(root.join("baseline.sha256"))?
    {
        return Err("PORTABLE_STATE_CHANGED".into());
    }
    Ok(())
}
fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("ARGUMENTS_INVALID".into());
    }
    let mode = args[0].as_str();
    let root = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);
    let package = root.with_extension("fmbackup");
    if mode == "prepare" {
        if root.exists() {
            return Err("FRESH_ROOT_REQUIRED".into());
        }
        fs::create_dir(&root)?;
        fs::write(root.join(".us034-fixture"), MARKER)?;
        let installation =
            vault::fixture(&root, Arc::new(WindowsKeyStore)).map_err(|_| "FIXTURE_FAILED")?;
        let mut db = vault::open_fixture(&root, &WindowsKeyStore).map_err(|_| "OPEN_FAILED")?;
        vault::migrate(&mut db).map_err(|_| "MIGRATION_FAILED")?;
        fs::write(
            root.join("baseline.sha256"),
            vault::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")?,
        )?;
        drop(db);
        drop(installation);
        fs::write(
            root.join("ciphertext.sha256"),
            format!("{:x}", Sha256::digest(fs::read(vault::vault_path(&root))?)),
        )?;
    } else {
        if fs::read_to_string(root.join(".us034-fixture"))? != MARKER {
            return Err("SYNTHETIC_ROOT_REQUIRED".into());
        }
        let id = identity::resource_id(&fs::read_to_string(root.join(".installation-id"))?)
            .map_err(|_| "IDENTITY_FAILED")?;
        match mode {
            "cleanup" => {
                WindowsPolicyStore::cleanup(id).map_err(|_| "POLICY_CLEANUP_FAILED")?;
                if WindowsPolicyStore
                    .read(id)
                    .map_err(|_| "POLICY_FAILED")?
                    .is_some()
                {
                    return Err("POLICY_REMAINS".into());
                }
                vault::cleanup_keys(&root, &WindowsKeyStore).map_err(|_| "KEY_CLEANUP_FAILED")?;
            }
            "inspect" => inspect(&root, &package)?,
            "negative" => {
                if local_backup::read_verified(&package, "SYNTHETIC wrong password").err()
                    != Some(LocalError::BackupAuthenticationFailed)
                {
                    return Err("WRONG_PASSWORD_ACCEPTED".into());
                }
                let original = fs::read(&package)?;
                let mut tampered = original.clone();
                tampered[local_backup::HEADER_SIZE + 4] ^= 1;
                let path = root.with_extension("tampered.fmbackup");
                fs::write(&path, tampered)?;
                if local_backup::read_verified(&path, PASSWORD).err()
                    != Some(LocalError::BackupAuthenticationFailed)
                    || fs::read(package)? != original
                {
                    return Err("TAMPERING_ACCEPTED".into());
                }
                fs::remove_file(path)?;
                unchanged(&root)?;
            }
            "enable-pin" => {
                LocalState::new(root.clone(), Arc::new(WindowsKeyStore))
                    .configure(ConfigurePin {
                        current_pin: None,
                        new_pin: "721947350682".into(),
                        confirm_pin: "721947350682".into(),
                    })
                    .map_err(|_| "PIN_FAILED")?;
            }
            "verify-ui" => {
                inspect(&root, &root.with_extension("ui.fmbackup"))?;
                unchanged(&root)?;
                let status = LocalState::new(root.clone(), Arc::new(WindowsKeyStore))
                    .status()
                    .map_err(|_| "STATUS_FAILED")?;
                if !status.enabled || !status.locked {
                    return Err("PIN_GATE_CHANGED".into());
                }
            }
            "export" | "crash-snapshot" | "crash-before" | "crash-after" => {
                backup_probe::set_crash(match mode {
                    "crash-snapshot" => 1,
                    "crash-before" => 2,
                    "crash-after" => 3,
                    _ => 0,
                });
                let state = LocalState::new(root.clone(), Arc::new(WindowsKeyStore));
                let job = state
                    .prepare_backup(request())
                    .map_err(|_| "PREPARATION_FAILED")?;
                state
                    .finish_backup(job, Some(package))
                    .map_err(|_| "PUBLICATION_FAILED")?;
                if mode != "export" {
                    return Err("CHECKPOINT_NOT_REACHED".into());
                }
                unchanged(&root)?;
            }
            "recover-snapshot" | "recover-before" | "recover-after" => {
                if mode == "recover-snapshot"
                    && fs::read_dir(root.join("staging"))?.next().is_none()
                {
                    return Err("SNAPSHOT_CHECKPOINT_MISSING".into());
                }
                if mode == "recover-before" {
                    let mut found = false;
                    for entry in fs::read_dir(root.parent().ok_or("PARENT_INVALID")?)? {
                        let entry = entry?;
                        if entry
                            .file_name()
                            .to_string_lossy()
                            .starts_with(".fmbackup-")
                        {
                            inspect(&root, &entry.path())?;
                            found = true;
                        }
                    }
                    if !found {
                        return Err("ENCRYPTED_TEMPORARY_MISSING".into());
                    }
                }
                let key = WindowsKeyStore
                    .get(id, vault::dataset_workspace())
                    .map_err(|_| "KEY_FAILED")?;
                if vault::has_plaintext(&root, &key).map_err(|_| "SCAN_FAILED")? {
                    return Err("PLAINTEXT_FOUND".into());
                }
                if mode == "recover-after" {
                    inspect(&root, &package)?;
                } else if package.exists() {
                    return Err("PARTIAL_PUBLICATION".into());
                }
                let state = LocalState::new(root.clone(), Arc::new(WindowsKeyStore));
                state
                    .open(&vault::dataset_workspace().to_string())
                    .map_err(|_| "RECOVERY_FAILED")?;
                if fs::read_dir(root.join("staging"))?.next().is_some() {
                    return Err("STAGING_REMAINS".into());
                }
                unchanged(&root)?;
            }
            _ => return Err("MODE_INVALID".into()),
        }
    }
    fs::write(output, b"{\"passed\":true}")?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("US034_BACKUP_PROBE_FAILED");
        std::process::exit(1);
    }
}
