//! SYNTHETIC_US044_ACCOUNTS_ONLY. Not part of the default application.
use financial_manager_desktop::{
    LocalError, Result,
    account_model::AccountChange,
    account_probe,
    backup_destination::BackupDestination,
    category_model::Command,
    category_probe,
    commands::LocalState,
    identity,
    keys::{KeyStore, WindowsKeyStore},
    local_backup::CreateBackup,
    local_lock::{ConfigurePin, PinInput},
    local_restore::PreviewRestore,
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    lock_store::{PolicyStore, WindowsPolicyStore},
    restore_probe,
    restore_source::RestoreSource,
    vault_probe as vault,
    windows_hello::WindowsHello,
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
type Checked<T> = std::result::Result<T, Box<dyn std::error::Error>>;
const MARKER: &str = "SYNTHETIC_US044_ACCOUNTS_ONLY\n";
const PIN: &str = "721947350682";
const PASSWORD: &str = "SYNTHETIC US044 portable backup password";
fn check<T, E>(r: std::result::Result<T, E>) -> Checked<T> {
    r.map_err(|_| "ACCOUNT_PROBE_CHECK_FAILED".into())
}
fn iid(root: &Path) -> Checked<uuid::Uuid> {
    check(identity::resource_id(&fs::read_to_string(
        root.join(".installation-id"),
    )?))
}
fn hash(path: &Path) -> Checked<String> {
    Ok(format!("{:x}", Sha256::digest(fs::read(path)?)))
}
fn other(root: &Path) -> Checked<String> {
    let value = fs::read_to_string(root.join("other.id"))?;
    check(identity::resource_id(&value))?;
    Ok(value)
}
fn state(root: &Path) -> Checked<LocalState> {
    let s = LocalState::new(root.join("source"), Arc::new(WindowsKeyStore));
    if check(s.status())?.enabled {
        check(s.unlock(PinInput { pin: PIN.into() }))?;
    }
    Ok(s)
}
fn unchanged(root: &Path) -> Checked<()> {
    let source = root.join("source");
    if hash(&vault::vault_path(&source))?
        != fs::read_to_string(root.join("original-cipher.sha256"))?
    {
        return Err("ORIGINAL_CIPHER_CHANGED".into());
    }
    let db = check(vault::open_fixture(&source, &WindowsKeyStore))?;
    if check(vault::snapshot(&db))? != fs::read_to_string(root.join("original-state.sha256"))? {
        return Err("ORIGINAL_FINANCIAL_STATE_CHANGED".into());
    }
    Ok(())
}
struct Destination(PathBuf);
impl BackupDestination for Destination {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Ok(Some(self.0.clone()))
    }
}
struct Source(PathBuf);
impl RestoreSource for Source {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Ok(Some(self.0.clone()))
    }
}
fn synthetic_change() -> Checked<AccountChange> {
    check(serde_json::from_value(
        serde_json::json!({"kind":"CREATE","account":{"id":"0199d040-0000-7000-8000-000000000700","name":"SYNTHETIC CRASH ACCOUNT","institution_name":null,"account_kind":"CASH","balance_nature":"ASSET","currency_code":"BRL"},"reference":{"id":"0199d040-0000-7000-8000-000000001700","amount_minor":"9007199254740993","reference_date":"2026-10-17","day_position":"END_OF_DAY"}}),
    ))
}
fn roundtrip(root: &Path) -> Checked<serde_json::Value> {
    let source = root.join("source");
    let account_workspace = other(root)?;
    let package = root.join("accounts.fmbackup");
    let native = LocalState::with_backup_destination(
        source.clone(),
        Arc::new(WindowsKeyStore),
        Arc::new(WindowsPolicyStore),
        Arc::new(WindowsHello),
        Arc::new(Destination(package.clone())),
    );
    if check(native.status())?.enabled {
        check(native.unlock(PinInput { pin: PIN.into() }))?;
    }
    let before = check(native.read_categories(&account_workspace))?;
    let job = check(native.prepare_backup(CreateBackup {
        workspace_id: account_workspace.clone(),
        password: PASSWORD.into(),
        confirmation: PASSWORD.into(),
    }))?;
    let destination = check(native.choose_backup_destination(job.lease(), 0))?;
    check(native.finish_backup(job, destination))?;
    drop(native);
    let key = check(WindowsKeyStore.get(
        iid(&source)?,
        check(identity::resource_id(&account_workspace))?,
    ))?;
    let db = check(open_database(
        &source
            .join("workspaces")
            .join(&account_workspace)
            .join("vault.db"),
        &key,
    ))?;
    let expected = check(restore_probe::semantic_snapshot(&db))?;
    drop(db);
    drop(key);
    check(WindowsKeyStore.delete(
        iid(&source)?,
        check(identity::resource_id(&account_workspace))?,
    ))?;
    if WindowsKeyStore
        .get(
            iid(&source)?,
            check(identity::resource_id(&account_workspace))?,
        )
        .err()
        != Some(LocalError::KeyMissing)
    {
        return Err("SOURCE_KEY_REMAINS".into());
    }
    let target = root.join("target");
    let restored = LocalState::with_restore_source(
        target.clone(),
        Arc::new(WindowsKeyStore),
        Arc::new(WindowsPolicyStore),
        Arc::new(Source(package)),
    );
    let job = check(restored.begin_restore_selection())?;
    let path = check(restored.choose_restore_source(job.lease(), 0))?;
    let selection = check(restored.finish_restore_selection(job, path))?;
    let preview = check(restored.preview_restore(PreviewRestore {
        selection_id: selection.selection_id.ok_or("SELECTION_MISSING")?,
        password: PASSWORD.into(),
    }))?;
    let workspace = check(restored.confirm_restore(&preview.restore_id))?;
    if workspace.id == account_workspace {
        return Err("OLD_AUTHORITY_REUSED".into());
    }
    let snapshot = check(restored.read_categories(&workspace.id))?;
    if snapshot.categories.len() != before.categories.len()
        || snapshot
            .categories
            .iter()
            .zip(&before.categories)
            .any(|(a, b)| a.id == b.id)
    {
        return Err("ACCOUNT_IDS_REUSED".into());
    }
    drop(restored);
    let key =
        check(WindowsKeyStore.get(iid(&target)?, check(identity::resource_id(&workspace.id))?))?;
    let db = check(open_database(
        &target
            .join("workspaces")
            .join(&workspace.id)
            .join("vault.db"),
        &key,
    ))?;
    if check(restore_probe::semantic_snapshot(&db))? != expected {
        return Err("ROUNDTRIP_GRAPH_CHANGED".into());
    }
    Ok(serde_json::json!({"passed":true,"snapshot":snapshot}))
}
fn run() -> Checked<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        return Err("ARGUMENTS_INVALID".into());
    }
    let mode = args[0].as_str();
    let root = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);
    let result = if mode == "prepare" {
        if root.exists() {
            return Err("FRESH_ROOT_REQUIRED".into());
        }
        fs::create_dir(&root)?;
        fs::write(root.join(".us044-fixture"), MARKER)?;
        let source = root.join("source");
        let installation = check(vault::fixture(&source, Arc::new(WindowsKeyStore)))?;
        drop(installation);
        let mut db = check(vault::open_fixture(&source, &WindowsKeyStore))?;
        check(vault::migrate(&mut db))?;
        fs::write(
            root.join("original-state.sha256"),
            check(vault::snapshot(&db))?,
        )?;
        drop(db);
        fs::write(
            root.join("original-cipher.sha256"),
            hash(&vault::vault_path(&source))?,
        )?;
        let native = check(state(&root))?;
        let id = check(identity::new_id())?.to_string();
        check(native.create(CreateWorkspace {
            workspace_id: id.clone(),
            display_name: "SYNTHETIC US044 EMPTY".into(),
            purpose: Purpose::Personal,
        }))?;
        fs::write(root.join("other.id"), id)?;
        serde_json::json!({"passed":true})
    } else {
        if fs::read_to_string(root.join(".us044-fixture"))? != MARKER
            || fs::symlink_metadata(&root)?.file_type().is_symlink()
        {
            return Err("SYNTHETIC_ROOT_REQUIRED".into());
        }
        match mode {
            "category-snapshot" => {
                serde_json::json!({"passed":true,"snapshot":check(state(&root))?.read_categories(&other(&root)?).map_err(|_|"CATEGORY_READ_FAILED")?})
            }
            "category-seed"
            | "category-fail"
            | "category-crash-first"
            | "category-crash-before"
            | "category-crash-after" => {
                let native = check(state(&root))?;
                let w = other(&root)?;
                let command = Command::Seed {
                    profile_version: 1,
                    purpose: "PERSONAL".into(),
                    ids: (100..109)
                        .map(|n| format!("0199d244-0000-7000-8000-{n:012}"))
                        .collect(),
                };
                match mode {
                    "category-fail" => category_probe::fail_after_first(),
                    "category-crash-first" => category_probe::crash_at(1),
                    "category-crash-before" => category_probe::crash_at(2),
                    "category-crash-after" => category_probe::crash_at(3),
                    _ => {}
                }
                let result = native.apply_category_change(&w, command);
                if mode == "category-fail" {
                    if result.err() != Some(LocalError::StorageUnavailable)
                        || !check(native.read_categories(&w))?.categories.is_empty()
                    {
                        return Err("CATEGORY_ROLLBACK_FAILED".into());
                    }
                    serde_json::json!({"passed":true})
                } else {
                    serde_json::json!({"passed":true,"result":check(result)?})
                }
            }
            "category-used" => {
                let native = check(state(&root))?;
                let w = vault::dataset_workspace().to_string();
                let movements = check(native.read_movements(&w))?;
                let used = movements
                    .transactions
                    .iter()
                    .flat_map(|t| t.content.allocations.iter())
                    .map(|a| a.category_id.clone())
                    .collect::<Vec<_>>();
                let mut finance = serde_json::to_value(movements)?;
                finance["balance"]
                    .as_object_mut()
                    .ok_or("SHAPE")?
                    .remove("read_at");
                let before = check(native.read_categories(&w))?
                    .categories
                    .into_iter()
                    .find(|r| used.contains(&r.id))
                    .ok_or("USED_CATEGORY_REQUIRED")?;
                let change = Command::Update {
                    base: before.clone(),
                    name: "SYNTHETIC US044 USED RENAMED".into(),
                    sort_order: 42,
                    status: "ARCHIVED".into(),
                };
                let after = check(native.apply_category_change(&w, change))?
                    .categories
                    .into_iter()
                    .find(|r| r.id == before.id)
                    .ok_or("CATEGORY_MISSING")?;
                let mut current = serde_json::to_value(check(native.read_movements(&w))?)?;
                current["balance"]
                    .as_object_mut()
                    .ok_or("SHAPE")?
                    .remove("read_at");
                if finance != current {
                    return Err("FINANCIAL_HISTORY_CHANGED".into());
                }
                check(native.apply_category_change(
                    &w,
                    Command::Update {
                        base: after,
                        name: before.name,
                        sort_order: before.sort_order,
                        status: before.status,
                    },
                ))?;
                let source = root.join("source");
                let key = check(WindowsKeyStore.get(iid(&source)?, vault::dataset_workspace()))?;
                let db = check(open_database(&vault::vault_path(&source), &key))?;
                if check(vault::snapshot(&db))?
                    != fs::read_to_string(root.join("original-state.sha256"))?
                {
                    return Err("ORIGINAL_GRAPH_CHANGED".into());
                }
                serde_json::json!({"passed":true})
            }
            "snapshot" => {
                serde_json::json!({"passed":true,"snapshot":check(state(&root))?.read_accounts(&vault::dataset_workspace().to_string()).map_err(|_|"SNAPSHOT_FAILED")?})
            }
            "enable-pin" => {
                check(state(&root))?
                    .configure(ConfigurePin {
                        current_pin: None,
                        new_pin: PIN.into(),
                        confirm_pin: PIN.into(),
                    })
                    .map_err(|_| "PIN_FAILED")?;
                serde_json::json!({"passed":true})
            }
            "verify-ui" => {
                let native = check(state(&root))?;
                let snap = check(native.read_accounts(&other(&root)?))?;
                if snap.accounts.len() != 1 {
                    return Err("UI_ACCOUNT_COUNT".into());
                }
                let s = &snap.accounts[0];
                if s.account.name != "SYNTHETIC DESKTOP EDIT"
                    || s.account.institution_name.as_deref() != Some("SYNTHETIC BANK")
                    || s.account.status != "ACTIVE"
                    || s.references.len() != 2
                    || !s
                        .references
                        .iter()
                        .any(|r| r.status == "SUPERSEDED" && r.amount_minor == "9007199254740993")
                    || !s
                        .references
                        .iter()
                        .any(|r| r.status == "ACTIVE" && r.amount_minor == "9007199254740994")
                {
                    return Err("UI_STATE_INVALID".into());
                }
                drop(native);
                unchanged(&root)?;
                serde_json::json!({"passed":true})
            }
            "crash-before" => {
                let source = root.join("source");
                let i = check(Installation::open(&source, Arc::new(WindowsKeyStore)))?;
                account_probe::crash_at(1);
                let _ = i.apply_account_change(&other(&root)?, synthetic_change()?, || Ok(()));
                return Err("CRASH_NOT_REACHED".into());
            }
            "verify-before" => {
                let native = check(state(&root))?;
                if !check(native.read_accounts(&other(&root)?))?
                    .accounts
                    .is_empty()
                {
                    return Err("PARTIAL_ACCOUNT_REMAINS".into());
                }
                drop(native);
                unchanged(&root)?;
                serde_json::json!({"passed":true})
            }
            "crash-after" => {
                account_probe::crash_at(2);
                check(
                    check(state(&root))?.apply_account_change(&other(&root)?, synthetic_change()?),
                )?;
                std::process::exit(75)
            }
            "verify-after" => {
                let native = check(state(&root))?;
                if check(native.apply_account_change(&other(&root)?, synthetic_change()?))?.changed
                {
                    return Err("REPLAY_DUPLICATED".into());
                }
                let s = check(native.read_accounts(&other(&root)?))?;
                if s.accounts.len() != 1
                    || s.accounts[0].references.len() != 1
                    || s.accounts[0].references[0].amount_minor != "9007199254740993"
                {
                    return Err("COMMITTED_STATE_INVALID".into());
                }
                drop(native);
                unchanged(&root)?;
                serde_json::json!({"passed":true})
            }
            "roundtrip" => roundtrip(&root)?,
            "cleanup" => {
                for child in ["source", "target"] {
                    let install = root.join(child);
                    if !install.join(".installation-id").exists() {
                        continue;
                    }
                    if fs::symlink_metadata(&install)?.file_type().is_symlink() {
                        return Err("OWNERSHIP_INVALID".into());
                    }
                    let id = iid(&install)?;
                    check(WindowsPolicyStore::cleanup(id))?;
                    if check(WindowsPolicyStore.read(id))?.is_some() {
                        return Err("POLICY_REMAINS".into());
                    }
                    check(vault::cleanup_keys(&install, &WindowsKeyStore))?;
                }
                serde_json::json!({"passed":true})
            }
            _ => return Err("MODE_INVALID".into()),
        }
    };
    fs::write(output, serde_json::to_vec(&result)?)?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("US044_NATIVE_ACCOUNT_PROBE_FAILED");
        std::process::exit(1);
    }
}
