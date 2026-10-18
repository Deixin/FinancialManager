//! SYNTHETIC_US043_DESKTOP_ONLY. Not part of the default application.
use financial_manager_desktop::{
    LocalError, Result,
    account_model::AccountChange,
    backup_destination::BackupDestination,
    card_payment_model::Command,
    card_payment_probe,
    commands::LocalState,
    identity,
    keys::{KeyStore, WindowsKeyStore},
    local_backup::CreateBackup,
    local_lock::{ConfigurePin, PinInput},
    local_restore::PreviewRestore,
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    lock_store::{PolicyStore, WindowsPolicyStore},
    movement_model::AccountDescriptor,
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
const MARKER: &str = "SYNTHETIC_US043_DESKTOP_ONLY\n";
const PIN: &str = "721947350682";
const PASSWORD: &str = "SYNTHETIC US043 portable backup password";
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
    let before = check(native.read_card_payments(&account_workspace))?;
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
    let snapshot = check(restored.read_card_payments(&workspace.id))?;
    if snapshot.movements.balance.accounts.len() != before.movements.balance.accounts.len()
        || snapshot
            .movements
            .balance
            .accounts
            .iter()
            .zip(&before.movements.balance.accounts)
            .any(|(a, b)| a.account.id == b.account.id)
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

fn change(i: &Installation, w: &str) -> Checked<Command> {
    let a = check(i.read_accounts(w))?.accounts;
    check(serde_json::from_value(
        serde_json::json!({"kind":"CREATE","id":"0199d243-0000-7000-8000-000000000050","source_entry_id":"0199d243-0000-7000-8000-000000000051","target_entry_id":"0199d243-0000-7000-8000-000000000052","source_account":AccountDescriptor::from(&a[0].account),"target_account":AccountDescriptor::from(&a[1].account),"financial_date":"2026-10-18","amount_minor":"123","display_name":"SYNTHETIC CARD_PAYMENT CRASH","original_description":null}),
    ))
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
        fs::write(root.join(".us043-fixture"), MARKER)?;
        let source = root.join("source");
        drop(check(vault::fixture(&source, Arc::new(WindowsKeyStore)))?);
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
        let w = check(identity::new_id())?.to_string();
        check(native.create(CreateWorkspace {
            workspace_id: w.clone(),
            display_name: "SYNTHETIC US043 EMPTY".into(),
            purpose: Purpose::Personal,
        }))?;
        fs::write(root.join("other.id"), &w)?;
        for n in [2_u64, 3] {
            let c: AccountChange = check(serde_json::from_value(
                serde_json::json!({"kind":"CREATE","account":{"id":format!("0199d243-0000-7000-8000-{n:012}"),"name":format!("SYNTHETIC US043 ACCOUNT {n}"),"institution_name":null,"account_kind":if n==3{"CREDIT_CARD"}else{"CASH"},"balance_nature":if n==3{"LIABILITY"}else{"ASSET"},"currency_code":"BRL"},"reference":{"id":format!("0199d243-0000-7000-8000-{:012}",n+1000),"amount_minor":if n==2{"100000"}else{"200000"},"reference_date":"2026-10-01","day_position":"START_OF_DAY"}}),
            ))?;
            check(native.apply_account_change(&w, c))?;
        }
        serde_json::json!({"passed":true})
    } else {
        if fs::read_to_string(root.join(".us043-fixture"))? != MARKER
            || fs::symlink_metadata(&root)?.file_type().is_symlink()
        {
            return Err("SYNTHETIC_ROOT_REQUIRED".into());
        }
        match mode {
            "enable-pin" => {
                check(check(state(&root))?.configure(ConfigurePin {
                    current_pin: None,
                    new_pin: PIN.into(),
                    confirm_pin: PIN.into(),
                }))?;
                serde_json::json!({"passed":true})
            }
            "verify-ui" => {
                let s = check(check(state(&root))?.read_card_payments(&other(&root)?))?;
                if s.groups.len() != 2
                    || s.movements.transactions.len() != 4
                    || s.movements.history.len() != 10
                    || s.movements.transactions.iter().any(|t| t.content.deleted)
                    || s.movements
                        .transactions
                        .iter()
                        .filter(|t| {
                            t.content.display_name == "SYNTHETIC CARD_PAYMENT EDIT"
                                && t.version == "4"
                                && t.content.original_description.as_deref()
                                    == Some("SYNTHETIC ORIGINAL")
                        })
                        .count()
                        != 2
                    || s.movements
                        .transactions
                        .iter()
                        .filter(|t| t.content.account_amount_minor == "-9007199254740993")
                        .count()
                        != 2
                {
                    return Err("UI_CARD_PAYMENT_STATE_INVALID".into());
                }
                unchanged(&root)?;
                serde_json::json!({"passed":true,"snapshot":s})
            }
            "crash-first" | "crash-after" => {
                let i = check(Installation::open(
                    &root.join("source"),
                    Arc::new(WindowsKeyStore),
                ))?;
                let c = change(&i, &other(&root)?)?;
                card_payment_probe::crash_at(if mode == "crash-first" { 1 } else { 3 });
                check(i.apply_card_payment(&other(&root)?, c, || Ok(())))?;
                return Err("CRASH_NOT_REACHED".into());
            }
            "verify-first" => {
                let s = check(check(state(&root))?.read_card_payments(&other(&root)?))?;
                if !s.groups.is_empty()
                    || !s.movements.transactions.is_empty()
                    || !s.movements.history.is_empty()
                {
                    return Err("PARTIAL_CARD_PAYMENT_REMAINS".into());
                }
                unchanged(&root)?;
                serde_json::json!({"passed":true})
            }
            "verify-after" => {
                let i = check(Installation::open(
                    &root.join("source"),
                    Arc::new(WindowsKeyStore),
                ))?;
                if !matches!(
                    i.apply_card_payment(&other(&root)?, change(&i, &other(&root)?)?, || Ok(())),
                    Err(LocalError::VersionConflict)
                ) {
                    return Err("REPLAY_NOT_CONFLICT".into());
                }
                let s = check(i.read_card_payments(&other(&root)?))?;
                if s.groups.len() != 1
                    || s.movements.transactions.len() != 2
                    || s.movements.history.len() != 2
                {
                    return Err("COMMITTED_CARD_PAYMENT_INVALID".into());
                }
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
        eprintln!("US043_NATIVE_CARD_PAYMENT_PROBE_FAILED");
        std::process::exit(1);
    }
}
