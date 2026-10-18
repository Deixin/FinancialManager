//! SYNTHETIC_US046_ALLOCATIONS_ONLY. Owned synthetic process fixture, never a product IPC.
use financial_manager_desktop::{
    LocalError, Result,
    backup_destination::BackupDestination,
    commands::LocalState,
    counterparty_association_model::{Command, Selection},
    counterparty_probe as probe, identity,
    keys::{KeyStore, WindowsKeyStore},
    local_backup::CreateBackup,
    local_lock::PinInput,
    local_restore::PreviewRestore,
    local_workspaces::open_database,
    lock_store::WindowsPolicyStore,
    movement_model::State,
    restore_probe,
    restore_source::RestoreSource,
    windows_hello::WindowsHello,
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};
type Checked<T> = std::result::Result<T, Box<dyn std::error::Error>>;
fn check<T, E>(r: std::result::Result<T, E>) -> Checked<T> {
    r.map_err(|_| "CLASSIFICATION_PROBE_FAILED".into())
}
fn id(n: u64) -> String {
    format!("0199d345-0000-7000-8000-{n:012}")
}
fn owner(root: &Path) -> Checked<()> {
    if fs::read_to_string(root.join(".us045-taxonomy-fixture"))?
        != "SYNTHETIC_US045_ACCOUNTS_ONLY\n"
        || fs::symlink_metadata(root)?.file_type().is_symlink()
    {
        return Err("SYNTHETIC_ROOT_REQUIRED".into());
    }
    Ok(())
}
fn workspace(root: &Path) -> Checked<String> {
    let w = fs::read_to_string(root.join("other.id"))?;
    check(identity::resource_id(&w))?;
    Ok(w)
}
fn installation(root: &Path) -> Checked<uuid::Uuid> {
    check(identity::resource_id(&fs::read_to_string(
        root.join(".installation-id"),
    )?))
}
fn state(root: &Path) -> Checked<LocalState> {
    let s = LocalState::new(root.join("source"), Arc::new(WindowsKeyStore));
    if check(s.status())?.enabled {
        check(s.unlock(PinInput {
            pin: "721947350682".into(),
        }))?;
    }
    Ok(s)
}
fn command(base: State) -> Command {
    Command {
        base,
        counterparty: Selection::Set {
            counterparty_id: id(900),
        },
    }
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
    let w = workspace(root)?;
    let package = root.join("classification.fmbackup");
    let native = LocalState::with_backup_destination(
        source.clone(),
        Arc::new(WindowsKeyStore),
        Arc::new(WindowsPolicyStore),
        Arc::new(WindowsHello),
        Arc::new(Destination(package.clone())),
    );
    if check(native.status())?.enabled {
        check(native.unlock(PinInput {
            pin: "721947350682".into(),
        }))?;
    }
    let before = check(native.read_counterparties(&w, true))?
        .movements
        .ok_or("MOVEMENTS_REQUIRED")?;
    let base = before
        .transactions
        .iter()
        .find(|r| r.id == id(810))
        .ok_or("SYNTHETIC_BASE_REQUIRED")?
        .clone();
    let job = check(native.prepare_backup(CreateBackup {
        workspace_id: w.clone(),
        password: "SYNTHETIC CLASSIFICATION PORTABLE PASSWORD".into(),
        confirmation: "SYNTHETIC CLASSIFICATION PORTABLE PASSWORD".into(),
    }))?;
    let destination = check(native.choose_backup_destination(job.lease(), 0))?;
    check(native.finish_backup(job, destination))?;
    drop(native);
    let iid = installation(&source)?;
    let wid = check(identity::resource_id(&w))?;
    let key = check(WindowsKeyStore.get(iid, wid))?;
    let db = check(open_database(
        &source.join("workspaces").join(&w).join("vault.db"),
        &key,
    ))?;
    let expected = check(restore_probe::semantic_snapshot(&db))?;
    drop(db);
    drop(key);
    check(WindowsKeyStore.delete(iid, wid))?;
    if WindowsKeyStore.get(iid, wid).err() != Some(LocalError::KeyMissing) {
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
    let selected = check(restored.finish_restore_selection(job, path))?;
    let preview = check(restored.preview_restore(PreviewRestore {
        selection_id: selected.selection_id.ok_or("SELECTION_REQUIRED")?,
        password: "SYNTHETIC CLASSIFICATION PORTABLE PASSWORD".into(),
    }))?;
    if restored
        .apply_counterparty_association(
            &w,
            vec![Command {
                base,
                counterparty: Selection::Keep {},
            }],
        )
        .err()
        != Some(LocalError::RequestConflict)
    {
        return Err("PREPARED_RESTORE_WRITE_ALLOWED".into());
    }
    let new = check(restored.confirm_restore(&preview.restore_id))?;
    if new.id == w {
        return Err("OLD_AUTHORITY_REUSED".into());
    }
    let snapshot = check(restored.read_counterparties(&new.id, true))?;
    drop(restored);
    let key = check(WindowsKeyStore.get(
        installation(&target)?,
        check(identity::resource_id(&new.id))?,
    ))?;
    let db = check(open_database(
        &target.join("workspaces").join(&new.id).join("vault.db"),
        &key,
    ))?;
    if check(restore_probe::semantic_snapshot(&db))? != expected {
        return Err("RESTORE_GRAPH_CHANGED".into());
    }
    Ok(
        serde_json::json!({"passed":true,"snapshot":snapshot,"source_key_deleted":true,"prepared_restore_refused_write":true}),
    )
}

fn run() -> Checked<()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        return Err("ARGUMENTS_INVALID".into());
    }
    let mode = &args[0];
    let root = PathBuf::from(&args[1]);
    owner(&root)?;
    let w = workspace(&root)?;
    let value = match mode.as_str() {
        "seed" => {
            let s = state(&root)?;
            for n in [900, 901] {
                let item = serde_json::json!({"id":id(n),"workspace_id":w,"display_name":format!("SYNTHETIC COUNTERPARTY {n}"),"identifier_type":null,"identifier_value":null,"relationship_hint":"SUPPLIER","status":"ACTIVE"});
                check(s.apply_counterparty_change(
                    &w,
                    check(serde_json::from_value(
                        serde_json::json!({"kind":"CREATE","item":item}),
                    ))?,
                ))?;
            }
            serde_json::json!({"passed":true})
        }
        "read" => {
            let s = state(&root)?;
            serde_json::json!({"passed":true,"snapshot":check(s.read_counterparties(&w,true))?})
        }
        "setup-crash" => {
            let s = state(&root)?;
            let snap = check(s.read_movements(&w))?;
            let commands = [821, 822]
                .into_iter()
                .map(|n| {
                    command(
                        snap.transactions
                            .iter()
                            .find(|r| r.id == id(n))
                            .unwrap()
                            .clone(),
                    )
                })
                .collect::<Vec<_>>();
            fs::write(
                root.join("counterparties-command.json"),
                serde_json::to_vec(&commands)?,
            )?;
            serde_json::json!({"passed":true,"snapshot":snap,"commands":commands})
        }
        "crash-first" | "crash-before" | "crash-after" | "rollback" => {
            let s = state(&root)?;
            let commands: Vec<Command> =
                serde_json::from_slice(&fs::read(root.join("counterparties-command.json"))?)?;
            match mode.as_str() {
                "crash-first" => probe::crash_at(1),
                "crash-before" => probe::crash_at(2),
                "crash-after" => probe::crash_at(3),
                _ => probe::fail_at(1),
            };
            let r = s.apply_counterparty_association(&w, commands);
            if mode == "rollback" {
                if r.err() != Some(LocalError::StorageUnavailable) {
                    return Err("FAULT_MISSING".into());
                }
                serde_json::json!({"passed":true})
            } else {
                serde_json::json!({"passed":true,"result":check(r)?})
            }
        }
        "roundtrip" => roundtrip(&root)?,
        _ => return Err("MODE_INVALID".into()),
    };
    fs::write(&args[2], serde_json::to_vec_pretty(&value)?)?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("US047_COUNTERPARTIES_PROBE_FAILED");
        std::process::exit(1)
    }
}
