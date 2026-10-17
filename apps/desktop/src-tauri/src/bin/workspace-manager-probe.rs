//! SYNTHETIC_US036_ONLY. No production handler or personal workspace is used.
use financial_manager_desktop::{
    commands::LocalState,
    identity,
    keys::{KeyStore, WindowsKeyStore},
    local_workspaces::{CreateWorkspace, Purpose},
    lock_store::{PolicyStore, WindowsPolicyStore},
    vault_probe as vault,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
type Checked<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const MARKER: &str = "SYNTHETIC_US036_ONLY\n";
fn check<T, E>(value: std::result::Result<T, E>) -> Checked<T> {
    value.map_err(|_| "MANAGER_CHECK_FAILED".into())
}
fn hash(path: &Path) -> Checked<String> {
    Ok(format!("{:x}", Sha256::digest(fs::read(path)?)))
}
fn verify(root: &Path, count: usize) -> Checked<()> {
    let state = LocalState::new(root.into(), Arc::new(WindowsKeyStore));
    let rows = check(state.list())?;
    if rows.len() != count || rows.iter().any(|r| r.storage_mode != "LOCAL") {
        return Err("CATALOG_INVALID".into());
    }
    for row in rows {
        if check(state.open(&row.id))? != row {
            return Err("WRONG_CONTEXT".into());
        }
    }
    if hash(&vault::vault_path(root))? != fs::read_to_string(root.join("source.sha256"))? {
        return Err("CIPHERTEXT_CHANGED".into());
    }
    let db = check(vault::open_fixture(root, &WindowsKeyStore))?;
    check(vault::integrity(&db))?;
    if check(vault::snapshot(&db))? != fs::read_to_string(root.join("baseline.sha256"))? {
        return Err("FINANCIAL_STATE_CHANGED".into());
    }
    let installation = check(identity::resource_id(&fs::read_to_string(
        root.join(".installation-id"),
    )?))?;
    let key = check(WindowsKeyStore.get(installation, vault::dataset_workspace()))?;
    if check(vault::has_plaintext(root, &key))? {
        return Err("PLAINTEXT_FOUND".into());
    }
    Ok(())
}
fn run() -> Checked<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        return Err("ARGUMENTS_INVALID".into());
    }
    let mode = args[0].as_str();
    let root = PathBuf::from(&args[1]);
    if mode == "prepare" {
        if root.exists() {
            return Err("FRESH_ROOT_REQUIRED".into());
        }
        fs::create_dir(&root)?;
        fs::write(root.join(".us036-fixture"), MARKER)?;
        let installation = check(vault::fixture(&root, Arc::new(WindowsKeyStore)))?;
        let mut db = check(vault::open_fixture(&root, &WindowsKeyStore))?;
        check(vault::migrate(&mut db))?;
        db.execute(
            "UPDATE workspace SET display_name='SYNTHETIC US036 PRIMARY',purpose='BUSINESS'",
            [],
        )?;
        fs::write(root.join("baseline.sha256"), check(vault::snapshot(&db))?)?;
        drop(db);
        drop(installation);
        fs::write(root.join("source.sha256"), hash(&vault::vault_path(&root))?)?;
        let state = LocalState::new(root.clone(), Arc::new(WindowsKeyStore));
        for index in 1..=12 {
            let id = check(identity::new_id())?.to_string();
            let name = format!("SYNTHETIC US036 SPACE {index:02}");
            let purpose = if index % 2 == 0 {
                Purpose::Business
            } else {
                Purpose::Personal
            };
            let first = check(state.create(CreateWorkspace {
                workspace_id: id.clone(),
                display_name: name.clone(),
                purpose,
            }))?;
            let replay = check(state.create(CreateWorkspace {
                workspace_id: id,
                display_name: name,
                purpose,
            }))?;
            if first != replay {
                return Err("CREATE_NOT_IDEMPOTENT".into());
            }
        }
        drop(state);
        verify(&root, 13)?;
    } else {
        if fs::read_to_string(root.join(".us036-fixture"))? != MARKER
            || fs::symlink_metadata(&root)?.file_type().is_symlink()
        {
            return Err("SYNTHETIC_ROOT_REQUIRED".into());
        }
        match mode {
            "verify" => verify(&root, 13)?,
            "verify-ui" => verify(&root, 15)?,
            "cleanup" => {
                let id = check(identity::resource_id(&fs::read_to_string(
                    root.join(".installation-id"),
                )?))?;
                check(WindowsPolicyStore::cleanup(id))?;
                if check(WindowsPolicyStore.read(id))?.is_some() {
                    return Err("POLICY_REMAINS".into());
                }
                check(vault::cleanup_keys(&root, &WindowsKeyStore))?;
            }
            _ => return Err("MODE_INVALID".into()),
        }
    }
    fs::write(&args[2], b"{\"passed\":true}")?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("US036_WORKSPACE_MANAGER_PROBE_FAILED");
        std::process::exit(1);
    }
}
