//! SYNTHETIC_US045_CLASSIFICATION_ONLY. Owned synthetic process fixture, never a product IPC.
use financial_manager_desktop::{
    LocalError, Result,
    backup_destination::BackupDestination,
    category_model::Command as Category,
    classification_model::{Command, Selection},
    classification_probe as probe,
    commands::LocalState,
    identity,
    keys::{KeyStore, WindowsKeyStore},
    local_backup::CreateBackup,
    local_lock::PinInput,
    local_restore::PreviewRestore,
    local_workspaces::{Installation, open_database},
    lock_store::WindowsPolicyStore,
    movement_model::State,
    restore_probe,
    restore_source::RestoreSource,
    taxonomy_model::{Command as Taxonomy, Item},
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
        classification: Selection::Set {
            allocation_id: base.content.allocations.first().map_or_else(
                || {
                    id(if base.id == id(810) {
                        1810
                    } else if base.id == id(821) {
                        1821
                    } else {
                        1822
                    })
                },
                |a| a.id.clone(),
            ),
            category_id: id(700),
            subcategory_id: Some(id(702)),
        },
        base,
        tag_ids: vec![id(701)],
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
    let before = check(native.read_movement_classifications(&w))?;
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
        .apply_classification(
            &w,
            vec![Command {
                tag_ids: base.content.tag_ids.clone(),
                base,
                classification: Selection::Keep {},
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
    let snapshot = check(restored.read_movement_classifications(&new.id))?;
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
            for (n, kind, nature) in [
                (800, "CASH", "ASSET"),
                (801, "CHECKING", "ASSET"),
                (802, "CREDIT_CARD", "LIABILITY"),
            ] {
                let c = serde_json::json!({"kind":"CREATE","account":{"id":id(n),"name":format!("SYNTHETIC CLASSIFICATION ACCOUNT {n}"),"institution_name":null,"account_kind":kind,"balance_nature":nature,"currency_code":"BRL"},"reference":{"id":id(n+1000),"amount_minor":"100000","reference_date":"2026-10-01","day_position":"START_OF_DAY"}});
                check(s.apply_account_change(&w, check(serde_json::from_value(c))?))?;
            }
            for n in [700, 704] {
                check(s.apply_category_change(
                    &w,
                    Category::Create {
                        id: id(n),
                        name: format!("SYNTHETIC CLASSIFICATION CATEGORY {n}"),
                        category_scope: "BOTH".into(),
                        sort_order: n as i32,
                    },
                ))?;
            }
            for n in [701, 706] {
                check(s.apply_taxonomy_change(
                    &w,
                    Taxonomy::Create {
                        item: Item::Tag {
                            id: id(n),
                            workspace_id: w.clone(),
                            name: format!("SYNTHETIC CLASSIFICATION TAG {n}"),
                            status: "ACTIVE".into(),
                        },
                    },
                ))?;
            }
            check(s.apply_taxonomy_change(
                &w,
                Taxonomy::Create {
                    item: Item::Subcategory {
                        id: id(702),
                        workspace_id: w.clone(),
                        name: "SYNTHETIC CLASSIFICATION SUB".into(),
                        status: "ACTIVE".into(),
                        category_id: id(700),
                        sort_order: 0,
                    },
                },
            ))?;
            let accounts = check(s.read_accounts(&w))?;
            let descriptor = |n| {
                let a = &accounts
                    .accounts
                    .iter()
                    .find(|r| r.account.id == id(n))
                    .unwrap()
                    .account;
                serde_json::to_value(
                    financial_manager_desktop::movement_model::AccountDescriptor::from(a),
                )
                .unwrap()
            };
            check(s.apply_manual_movement(&w,check(serde_json::from_value(serde_json::json!({"kind":"CREATE","id":id(811),"account":descriptor(800),"financial_date":"2026-10-17","movement_kind":"EXPENSE","amount_minor":"1000","display_name":"SYNTHETIC CLASSIFICATION MANUAL","original_description":"SYNTHETIC ORIGINAL"})))?))?;
            check(s.apply_transfer(&w,check(serde_json::from_value(serde_json::json!({"kind":"CREATE","id":id(820),"source_entry_id":id(821),"target_entry_id":id(822),"source_account":descriptor(800),"target_account":descriptor(801),"financial_date":"2026-10-17","amount_minor":"1000","display_name":"SYNTHETIC CLASSIFICATION TRANSFER","original_description":null})))?))?;
            check(s.apply_card_payment(&w,check(serde_json::from_value(serde_json::json!({"kind":"CREATE","id":id(830),"source_entry_id":id(831),"target_entry_id":id(832),"source_account":descriptor(800),"target_account":descriptor(802),"financial_date":"2026-10-17","amount_minor":"1000","display_name":"SYNTHETIC CLASSIFICATION CARD","original_description":null})))?))?;
            drop(s);
            let i = check(Installation::open(
                &root.join("source"),
                Arc::new(WindowsKeyStore),
            ))?;
            check(probe::seed_import(&i, &w, &id(800), &id(810), false))?;
            check(probe::seed_import(&i, &w, &id(800), &id(812), true))?;
            fs::write(
                root.join("financial-before.sha256"),
                check(probe::financial_digest(&i, &w))?,
            )?;
            serde_json::json!({"passed":true})
        }
        "read" => {
            let s = state(&root)?;
            serde_json::json!({"passed":true,"snapshot":check(s.read_movement_classifications(&w))?})
        }
        "verify-financial" => {
            let s = state(&root)?;
            drop(s);
            let i = check(Installation::open(
                &root.join("source"),
                Arc::new(WindowsKeyStore),
            ))?;
            if check(probe::financial_digest(&i, &w))?
                != fs::read_to_string(root.join("financial-before.sha256"))?
            {
                return Err("FINANCIAL_CONTENT_CHANGED".into());
            }
            serde_json::json!({"passed":true})
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
                root.join("classification-command.json"),
                serde_json::to_vec(&commands)?,
            )?;
            serde_json::json!({"passed":true,"snapshot":snap,"commands":commands})
        }
        "crash-first" | "crash-before" | "crash-after" | "rollback" => {
            let s = state(&root)?;
            let commands: Vec<Command> =
                serde_json::from_slice(&fs::read(root.join("classification-command.json"))?)?;
            match mode.as_str() {
                "crash-first" => probe::crash_at(1),
                "crash-before" => probe::crash_at(2),
                "crash-after" => probe::crash_at(3),
                _ => probe::fail_at(1),
            };
            let r = s.apply_classification(&w, commands);
            if mode == "rollback" {
                if r.err() != Some(LocalError::StorageUnavailable) {
                    return Err("ROLLBACK_FAULT_MISSING".into());
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
        eprintln!("US045_CLASSIFICATION_PROBE_FAILED");
        std::process::exit(1)
    }
}
