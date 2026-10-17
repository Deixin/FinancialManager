#![cfg(feature = "restore-smoke")]
// Explicitly synthetic FIN-002 only. No user files or credentials.
use financial_manager_desktop::{
    LocalError, Result, SecretKey, backup_probe,
    commands::LocalState,
    identity,
    keys::KeyStore,
    local_backup::{CreateBackup, read_verified},
    local_lock::{ConfigurePin, PinInput},
    local_restore::{PreviewRestore, RestorePreview},
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    lock_store::PolicyStore,
    restore_probe,
    restore_source::RestoreSource,
    vault_probe,
};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use uuid::Uuid;
use zeroize::Zeroizing;
const PASSWORD: &str = "SYNTHETIC restore password US035";
#[derive(Default)]
struct Keys {
    values: Mutex<HashMap<(Uuid, Uuid), SecretKey>>,
    reads: AtomicUsize,
    puts: AtomicUsize,
    fail_put: std::sync::atomic::AtomicBool,
    fail_delete: std::sync::atomic::AtomicBool,
}
impl KeyStore for Keys {
    fn get(&self, i: Uuid, w: Uuid) -> Result<SecretKey> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.values
            .lock()
            .unwrap()
            .get(&(i, w))
            .cloned()
            .ok_or(LocalError::KeyMissing)
    }
    fn put_new(&self, i: Uuid, w: Uuid, key: &SecretKey) -> Result<()> {
        let mut values = self.values.lock().unwrap();
        if values.contains_key(&(i, w)) {
            return Err(LocalError::IntegrityFailure);
        }
        self.puts.fetch_add(1, Ordering::SeqCst);
        values.insert((i, w), key.clone());
        if self.fail_put.load(Ordering::SeqCst) {
            return Err(LocalError::StorageUnavailable);
        }
        Ok(())
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
        if self.fail_delete.load(Ordering::SeqCst) {
            return Err(LocalError::StorageUnavailable);
        }
        self.values.lock().unwrap().remove(&(i, w));
        Ok(())
    }
}
#[derive(Default)]
struct Policies(Mutex<Option<Zeroizing<Vec<u8>>>>);
impl PolicyStore for Policies {
    fn read(&self, _: Uuid) -> Result<Option<Zeroizing<Vec<u8>>>> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn write(&self, _: Uuid, bytes: &[u8]) -> Result<()> {
        *self.0.lock().unwrap() = Some(Zeroizing::new(bytes.to_vec()));
        Ok(())
    }
}
struct Source(Mutex<Option<PathBuf>>);
impl RestoreSource for Source {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Ok(self.0.lock().unwrap().clone())
    }
}
struct Fixture {
    state: Arc<LocalState>,
    source_state: Arc<LocalState>,
    keys: Arc<Keys>,
    picker: Arc<Source>,
    source: PathBuf,
    target: PathBuf,
    package: PathBuf,
    existing: String,
    source_before: Vec<u8>,
    existing_before: Vec<u8>,
    baseline: String,
    temp: tempfile::TempDir,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source");
        let target = temp.path().join("target");
        let package = temp.path().join("synthetic.fmbackup");
        let keys = Arc::new(Keys::default());
        let installation = vault_probe::fixture(&source, keys.clone()).unwrap();
        let mut db = vault_probe::open_fixture(&source, keys.as_ref()).unwrap();
        vault_probe::migrate(&mut db).unwrap();
        let baseline = restore_probe::semantic_snapshot(&db).unwrap();
        drop(db);
        drop(installation);
        let source_before = fs::read(vault_probe::vault_path(&source)).unwrap();
        let source_state = Arc::new(LocalState::with_policies(
            source.clone(),
            keys.clone(),
            Arc::new(Policies::default()),
        ));
        let job = source_state
            .prepare_backup(CreateBackup {
                workspace_id: vault_probe::dataset_workspace().to_string(),
                password: PASSWORD.into(),
                confirmation: PASSWORD.into(),
            })
            .unwrap();
        source_state
            .finish_backup(job, Some(package.clone()))
            .unwrap();
        let installation = Installation::open(&target, keys.clone()).unwrap();
        let existing = identity::new_id().unwrap().to_string();
        installation
            .create(CreateWorkspace {
                workspace_id: existing.clone(),
                display_name: "SYNTHETIC existing workspace".into(),
                purpose: Purpose::Personal,
            })
            .unwrap();
        drop(installation);
        let existing_before =
            fs::read(target.join("workspaces").join(&existing).join("vault.db")).unwrap();
        let picker = Arc::new(Source(Mutex::new(Some(package.clone()))));
        let state = Arc::new(LocalState::with_restore_source(
            target.clone(),
            keys.clone(),
            Arc::new(Policies::default()),
            picker.clone(),
        ));
        Self {
            state,
            source_state,
            keys,
            picker,
            source,
            target,
            package,
            existing,
            source_before,
            existing_before,
            baseline,
            temp,
        }
    }
    fn select(&self) -> String {
        let job = self.state.begin_restore_selection().unwrap();
        let path = self.state.choose_restore_source(job.lease(), 42).unwrap();
        self.state
            .finish_restore_selection(job, path)
            .unwrap()
            .selection_id
            .unwrap()
    }
    fn preview(&self) -> RestorePreview {
        let id = self.select();
        self.state
            .preview_restore(PreviewRestore {
                selection_id: id,
                password: PASSWORD.into(),
            })
            .unwrap()
    }
    fn unchanged(&self) {
        assert_eq!(
            fs::read(vault_probe::vault_path(&self.source)).unwrap(),
            self.source_before
        );
        assert_eq!(
            fs::read(
                self.target
                    .join("workspaces")
                    .join(&self.existing)
                    .join("vault.db")
            )
            .unwrap(),
            self.existing_before
        );
    }
    fn db(&self, id: &str) -> rusqlite::Connection {
        let installation =
            Uuid::parse_str(&fs::read_to_string(self.target.join(".installation-id")).unwrap())
                .unwrap();
        open_database(
            &self.target.join("workspaces").join(id).join("vault.db"),
            &self
                .keys
                .get(installation, Uuid::parse_str(id).unwrap())
                .unwrap(),
        )
        .unwrap()
    }
    fn stages(&self) -> usize {
        fs::read_dir(self.target.join("staging")).unwrap().count()
    }
    fn rich_history(&mut self, malformed: bool) {
        use rusqlite::types::ValueRef;
        use serde_json::{Value, json};
        let db = vault_probe::open_fixture(&self.source, self.keys.as_ref()).unwrap();
        let row=db.query_row("SELECT id,account_id,group_id,counterparty_id,financial_date,CAST(account_amount_minor AS TEXT) AS account_amount_minor,economic_kind,original_description,display_name,origin_kind,created_at,updated_at,deleted_at FROM financial_transaction ORDER BY id LIMIT 1",[],|r|{let mut result=serde_json::Map::new();for(index,name)in r.as_ref().column_names().iter().enumerate(){let value=match r.get_ref(index)?{ValueRef::Null=>Value::Null,ValueRef::Text(bytes)=>json!(std::str::from_utf8(bytes).unwrap()),_=>panic!("SYNTHETIC_TYPED_FIXTURE")};result.insert(name.to_string(),value);}Ok(Value::Object(result))}).unwrap();
        let transaction = row["id"].as_str().unwrap();
        let mut content = serde_json::Map::new();
        for name in [
            "account_id",
            "group_id",
            "counterparty_id",
            "financial_date",
            "account_amount_minor",
            "economic_kind",
            "original_description",
            "display_name",
            "origin_kind",
        ] {
            content.insert(name.into(), row[name].clone());
        }
        content.insert("deleted".into(), json!(!row["deleted_at"].is_null()));
        let allocations=db.prepare("SELECT id,category_id,subcategory_id,CAST(amount_minor AS TEXT),note FROM transaction_allocation WHERE transaction_id=? ORDER BY id").unwrap().query_map([transaction],|r|Ok(json!({"id":r.get::<_,String>(0)?,"category_id":r.get::<_,String>(1)?,"subcategory_id":r.get::<_,Option<String>>(2)?,"amount_minor":r.get::<_,String>(3)?,"note":r.get::<_,Option<String>>(4)?}))).unwrap().collect::<std::result::Result<Vec<_>,_>>().unwrap();
        let tags = db
            .prepare("SELECT tag_id FROM transaction_tag WHERE transaction_id=? ORDER BY tag_id")
            .unwrap()
            .query_map([transaction], |r| r.get::<_, String>(0))
            .unwrap()
            .collect::<std::result::Result<Vec<_>, _>>()
            .unwrap();
        content.insert("allocations".into(), json!(allocations));
        content.insert("tag_ids".into(), json!(tags));
        let before = json!({"workspace_id":vault_probe::dataset_workspace().to_string(),"id":transaction,"version":"1","created_at":row["created_at"],"updated_at":row["updated_at"],"deleted_at":row["deleted_at"],"content":content});
        let mut after = before.clone();
        after["version"] = json!("2");
        after["updated_at"] = json!("2026-10-17T12:00:00.000Z");
        // A description exactly equal to an old UUID must stay literal text.
        after["content"]["display_name"] = row["account_id"].clone();
        after["content"]["account_amount_minor"] = json!(i64::MAX.to_string());
        assert!(
            after["content"]["allocations"].as_array().unwrap().len() <= 1,
            "SYNTHETIC_SINGLE_ALLOCATION_REQUIRED"
        );
        for allocation in after["content"]["allocations"].as_array_mut().unwrap() {
            allocation["amount_minor"] = json!(i64::MAX.to_string());
        }
        if malformed {
            after["content"]["account_amount_minor"] = json!(1.5);
        }
        let snapshot =
            json!({"format_version":1,"base_revision":"1","before":before,"after":after});
        db.execute_batch("BEGIN IMMEDIATE").unwrap();
        db.execute("UPDATE financial_transaction SET version=2,updated_at='2026-10-17T12:00:00.000Z',display_name=?,account_amount_minor=? WHERE id=?",rusqlite::params![row["account_id"].as_str().unwrap(),i64::MAX,transaction]).unwrap();
        db.execute(
            "UPDATE transaction_allocation SET amount_minor=? WHERE transaction_id=?",
            rusqlite::params![i64::MAX, transaction],
        )
        .unwrap();
        db.execute("INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,change_source,created_at) VALUES(?,?,?,2,?,'SYSTEM','SYSTEM','2026-10-17T12:00:00.000Z')",rusqlite::params![identity::new_id().unwrap().to_string(),vault_probe::dataset_workspace().to_string(),transaction,snapshot.to_string()]).unwrap();
        db.execute_batch("COMMIT").unwrap();
        self.baseline = restore_probe::semantic_snapshot(&db).unwrap();
        drop(db);
        self.source_before = fs::read(vault_probe::vault_path(&self.source)).unwrap();
        self.package = self.temp.path().join("synthetic-rich.fmbackup");
        let job = self
            .source_state
            .prepare_backup(CreateBackup {
                workspace_id: vault_probe::dataset_workspace().to_string(),
                password: PASSWORD.into(),
                confirmation: PASSWORD.into(),
            })
            .unwrap();
        self.source_state
            .finish_backup(job, Some(self.package.clone()))
            .unwrap();
        *self.picker.0.lock().unwrap() = Some(self.package.clone());
    }
}
#[test]
fn closed_input_invalid_password_and_foreign_selection_fail_without_key_access() {
    let f = Fixture::new();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    let id = identity::new_id().unwrap().to_string();
    for password in ["short", "            ", "SYNTHETIC\nsecret"] {
        assert!(
            f.state
                .preview_restore(PreviewRestore {
                    selection_id: id.clone(),
                    password: password.into()
                })
                .is_err()
        );
    }
    assert!(
        f.state
            .preview_restore(PreviewRestore {
                selection_id: id.clone(),
                password: PASSWORD.into()
            })
            .is_err()
    );
    assert!(
        serde_json::from_value::<PreviewRestore>(
            serde_json::json!({"selection_id":id,"password":PASSWORD,"path":"SYNTHETIC_FORBIDDEN"})
        )
        .is_err()
    );
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    assert_eq!(f.stages(), 0);
    f.unchanged();
}
#[test]
fn independent_installation_restores_full_state_with_new_ids_key_and_authority() {
    let f = Fixture::new();
    let old_generation = vault_probe::open_fixture(&f.source, f.keys.as_ref())
        .unwrap()
        .query_row("SELECT sync_generation FROM workspace", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap();
    let old_installation =
        Uuid::parse_str(&fs::read_to_string(f.source.join(".installation-id")).unwrap()).unwrap();
    let old_key = f
        .keys
        .get(old_installation, vault_probe::dataset_workspace())
        .unwrap();
    // The source device key is unavailable to restoration after export.
    f.keys
        .delete(old_installation, vault_probe::dataset_workspace())
        .unwrap();
    let preview = f.preview();
    assert_ne!(
        preview.restore_id,
        vault_probe::dataset_workspace().to_string()
    );
    assert_eq!(preview.record_counts.len(), 12);
    assert_eq!(f.state.list().unwrap().len(), 1);
    assert_eq!(f.stages(), 1);
    let workspace = f.state.confirm_restore(&preview.restore_id).unwrap();
    assert_eq!(workspace.storage_mode, "LOCAL");
    assert_eq!(workspace.display_name, preview.display_name);
    let db = f.db(&workspace.id);
    assert_eq!(restore_probe::semantic_snapshot(&db).unwrap(), f.baseline);
    let target_installation =
        Uuid::parse_str(&fs::read_to_string(f.target.join(".installation-id")).unwrap()).unwrap();
    assert_ne!(
        f.keys
            .get(target_installation, Uuid::parse_str(&workspace.id).unwrap())
            .unwrap()
            .as_ref(),
        old_key.as_ref()
    );
    assert!(
        open_database(
            &f.target
                .join("workspaces")
                .join(&workspace.id)
                .join("vault.db"),
            &old_key
        )
        .is_err()
    );
    let origin = read_verified(&f.package, PASSWORD).unwrap();
    assert!(
        f.keys
            .get(target_installation, Uuid::parse_str(&workspace.id).unwrap())
            .unwrap()
            .as_ref()
            != origin.snapshot_key.as_ref()
    );
    assert_ne!(workspace.id, origin.manifest.workspace_id);
    let generation = db
        .query_row("SELECT sync_generation FROM workspace", [], |r| {
            r.get::<_, String>(0)
        })
        .unwrap();
    assert_eq!(generation.len(), 36);
    assert_ne!(generation, old_generation);
    drop(db);
    assert_eq!(f.stages(), 0);
    f.unchanged();
    drop(f.state);
    let reopened = Installation::open(&f.target, f.keys.clone()).unwrap();
    assert!(reopened.open_workspace(&workspace.id).unwrap() == workspace);
    let empty = f.temp.path().join("empty-target");
    let native = LocalState::with_restore_source(
        empty.clone(),
        f.keys.clone(),
        Arc::new(Policies::default()),
        f.picker.clone(),
    );
    let job = native.begin_restore_selection().unwrap();
    let selected = native.choose_restore_source(job.lease(), 42).unwrap();
    let selection = native
        .finish_restore_selection(job, selected)
        .unwrap()
        .selection_id
        .unwrap();
    let preview = native
        .preview_restore(PreviewRestore {
            selection_id: selection,
            password: PASSWORD.into(),
        })
        .unwrap();
    assert_eq!(native.list().unwrap().len(), 0);
    let second = native.confirm_restore(&preview.restore_id).unwrap();
    assert_ne!(second.id, workspace.id);
    assert_eq!(native.list().unwrap().len(), 1);
    let installation =
        Uuid::parse_str(&fs::read_to_string(empty.join(".installation-id")).unwrap()).unwrap();
    let key = f
        .keys
        .get(installation, Uuid::parse_str(&second.id).unwrap())
        .unwrap();
    let db = open_database(
        &empty.join("workspaces").join(second.id).join("vault.db"),
        &key,
    )
    .unwrap();
    assert_eq!(restore_probe::semantic_snapshot(&db).unwrap(), f.baseline);
}
#[test]
fn wrong_password_and_tampered_package_never_publish_or_change_existing_workspaces() {
    let f = Fixture::new();
    let selection = f.select();
    let puts = f.keys.puts.load(Ordering::SeqCst);
    assert!(
        f.state
            .preview_restore(PreviewRestore {
                selection_id: selection.clone(),
                password: "SYNTHETIC wrong password".into()
            })
            .is_err()
    );
    let mut bytes = fs::read(&f.package).unwrap();
    let end = bytes.len() - 1;
    bytes[end] ^= 1;
    fs::write(&f.package, bytes).unwrap();
    assert!(
        f.state
            .preview_restore(PreviewRestore {
                selection_id: selection,
                password: PASSWORD.into()
            })
            .is_err()
    );
    assert_eq!(f.stages(), 0);
    assert_eq!(f.keys.puts.load(Ordering::SeqCst), puts);
    assert_eq!(f.state.list().unwrap().len(), 1);
    f.unchanged();
}
#[test]
fn preview_is_encrypted_unpublished_and_cancel_removes_only_its_key_and_stage() {
    let f = Fixture::new();
    let preview = f.preview();
    let id = Uuid::parse_str(&preview.restore_id).unwrap();
    let installation =
        Uuid::parse_str(&fs::read_to_string(f.target.join(".installation-id")).unwrap()).unwrap();
    let path = f
        .target
        .join("staging")
        .join(id.to_string())
        .join("vault.db");
    assert_ne!(&fs::read(&path).unwrap()[..16], b"SQLite format 3\0");
    assert!(f.keys.get(installation, id).is_ok());
    assert_eq!(f.state.list().unwrap().len(), 1);
    f.state.cancel_restore().unwrap();
    assert!(f.keys.get(installation, id).is_err());
    assert_eq!(f.stages(), 0);
    assert!(f.state.confirm_restore(&preview.restore_id).is_err());
    f.unchanged();
}
#[test]
fn every_resource_identity_is_fresh_and_references_remain_inside_new_workspace() {
    let f = Fixture::new();
    let source_db = vault_probe::open_fixture(&f.source, f.keys.as_ref()).unwrap();
    let mut originals = HashSet::new();
    for table in financial_manager_desktop::local_restore::TABLES
        .iter()
        .filter(|t| **t != "transaction_tag")
    {
        let mut q = source_db
            .prepare(&format!("SELECT id FROM {table}"))
            .unwrap();
        for id in q.query_map([], |r| r.get::<_, String>(0)).unwrap() {
            originals.insert(id.unwrap());
        }
    }
    let preview = f.preview();
    let restored = f.state.confirm_restore(&preview.restore_id).unwrap();
    let db = f.db(&restored.id);
    for table in financial_manager_desktop::local_restore::TABLES
        .iter()
        .filter(|t| **t != "transaction_tag")
    {
        let mut q = db.prepare(&format!("SELECT id FROM {table}")).unwrap();
        for id in q.query_map([], |r| r.get::<_, String>(0)).unwrap() {
            let id = id.unwrap();
            assert!(!originals.contains(&id));
            assert_eq!(Uuid::parse_str(&id).unwrap().get_version_num(), 7);
        }
    }
    assert!(
        db.prepare("PRAGMA foreign_key_check")
            .unwrap()
            .query([])
            .unwrap()
            .next()
            .unwrap()
            .is_none()
    );
    assert_eq!(restore_probe::semantic_snapshot(&db).unwrap(), f.baseline);
    f.unchanged();
}
#[test]
fn explicit_lock_invalidates_preview_and_deletes_staging_without_new_key_reads() {
    let f = Fixture::new();
    let preview = f.preview();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    f.state.force_lock();
    f.state.status().unwrap();
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    assert_eq!(f.stages(), 0);
    assert!(f.state.confirm_restore(&preview.restore_id).is_err());
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    f.unchanged();
}
#[test]
fn changed_staging_is_rejected_before_publication_and_without_reading_financial_keys() {
    let f = Fixture::new();
    let preview = f.preview();
    let path = f
        .target
        .join("staging")
        .join(&preview.restore_id)
        .join("vault.db");
    let mut bytes = fs::read(&path).unwrap();
    let n = bytes.len() - 1;
    bytes[n] ^= 1;
    fs::write(path, bytes).unwrap();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    assert!(f.state.confirm_restore(&preview.restore_id).is_err());
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    assert_eq!(f.state.list().unwrap().len(), 1);
    f.state.cancel_restore().unwrap();
    f.unchanged();
}
#[test]
fn confirmation_is_idempotent_across_repeated_requests_and_process_restart() {
    let f = Fixture::new();
    let preview = f.preview();
    let first = f.state.confirm_restore(&preview.restore_id).unwrap();
    assert!(f.state.confirm_restore(&preview.restore_id).unwrap() == first);
    assert_eq!(f.state.list().unwrap().len(), 2);
    assert!(f.state.confirm_restore(&f.existing).is_err());
    f.unchanged();
    drop(f.state);
    let state = LocalState::with_policies(
        f.target.clone(),
        f.keys.clone(),
        Arc::new(Policies::default()),
    );
    assert!(state.confirm_restore(&preview.restore_id).unwrap() == first);
    assert_eq!(state.list().unwrap().len(), 2);
}
#[test]
fn pin_gate_precedes_decryption_and_owned_picker_closes_session() {
    let f = Fixture::new();
    f.state
        .configure(ConfigurePin {
            current_pin: None,
            new_pin: "721947350682".into(),
            confirm_pin: "721947350682".into(),
        })
        .unwrap();
    f.state.lock().unwrap();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    assert!(f.state.begin_restore_selection().is_err());
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    f.state
        .unlock(PinInput {
            pin: "721947350682".into(),
        })
        .unwrap();
    let selection = f.select();
    assert!(f.state.status().unwrap().locked);
    assert!(
        f.state
            .preview_restore(PreviewRestore {
                selection_id: selection.clone(),
                password: PASSWORD.into()
            })
            .is_err()
    );
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    f.state
        .unlock(PinInput {
            pin: "721947350682".into(),
        })
        .unwrap();
    let preview = f
        .state
        .preview_restore(PreviewRestore {
            selection_id: selection,
            password: PASSWORD.into(),
        })
        .unwrap();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    f.state.force_lock();
    assert!(f.state.confirm_restore(&preview.restore_id).is_err());
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    assert_eq!(f.stages(), 0);
    f.unchanged();
}
#[test]
fn authenticated_unsupported_schema_and_inconsistent_counts_are_rejected() {
    let f = Fixture::new();
    for kind in ["schema", "counts", "version"] {
        let path = f.temp.path().join(format!("{kind}.fmbackup"));
        backup_probe::forge(&f.package, &path, &f.target, PASSWORD, kind).unwrap();
        *f.picker.0.lock().unwrap() = Some(path);
        let selection = f.select();
        assert!(
            f.state
                .preview_restore(PreviewRestore {
                    selection_id: selection,
                    password: PASSWORD.into()
                })
                .is_err()
        );
        assert_eq!(f.stages(), 0);
    }
    assert_eq!(f.state.list().unwrap().len(), 1);
    f.unchanged();
}
#[test]
fn ambiguous_key_write_and_failed_cleanup_recover_encrypted_stage_on_restart() {
    let f = Fixture::new();
    f.keys.fail_put.store(true, Ordering::SeqCst);
    f.keys.fail_delete.store(true, Ordering::SeqCst);
    let selection = f.select();
    assert!(
        f.state
            .preview_restore(PreviewRestore {
                selection_id: selection,
                password: PASSWORD.into()
            })
            .is_err()
    );
    assert_eq!(f.stages(), 1);
    f.unchanged();
    f.keys.fail_put.store(false, Ordering::SeqCst);
    f.keys.fail_delete.store(false, Ordering::SeqCst);
    drop(f.state);
    let reopened = Installation::open(&f.target, f.keys.clone()).unwrap();
    assert_eq!(fs::read_dir(f.target.join("staging")).unwrap().count(), 0);
    assert_eq!(reopened.list().unwrap().len(), 1);
    assert_eq!(f.keys.values.lock().unwrap().len(), 2);
}
#[test]
fn pending_preview_blocks_create_recovery_and_new_selection_cancels_it() {
    let f = Fixture::new();
    let preview = f.preview();
    assert!(
        f.state
            .create(CreateWorkspace {
                workspace_id: identity::new_id().unwrap().to_string(),
                display_name: "SYNTHETIC other".into(),
                purpose: Purpose::Personal
            })
            .is_err()
    );
    assert_eq!(f.stages(), 1);
    let job = f.state.begin_restore_selection().unwrap();
    assert_eq!(f.stages(), 0);
    assert!(f.state.begin_restore_selection().is_err());
    assert!(f.state.confirm_restore(&preview.restore_id).is_err());
    assert!(
        f.state
            .finish_restore_selection(job, None)
            .unwrap()
            .selection_id
            .is_none()
    );
    drop(f.state.begin_restore_selection().unwrap());
    f.unchanged();
}

#[test]
fn revision_identity_graph_is_rebased_while_financial_strings_and_literal_uuid_text_survive() {
    let mut f = Fixture::new();
    f.rich_history(false);
    let preview = f.preview();
    let restored = f.state.confirm_restore(&preview.restore_id).unwrap();
    let db = f.db(&restored.id);
    assert_eq!(restore_probe::semantic_snapshot(&db).unwrap(), f.baseline);
    let text: String = db
        .query_row(
            "SELECT snapshot FROM transaction_revision WHERE version=2",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let history: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(
        history["after"]["workspace_id"].as_str().unwrap(),
        restored.id
    );
    assert_ne!(
        history["after"]["content"]["account_id"],
        history["after"]["content"]["display_name"]
    );
    assert!(history["after"]["content"]["account_amount_minor"].is_string());
    assert_eq!(
        history["after"]["content"]["account_amount_minor"].as_str(),
        Some("9223372036854775807")
    );
    f.unchanged();
}
#[test]
fn authenticated_history_with_float_money_is_rejected_without_publishing() {
    let mut f = Fixture::new();
    f.rich_history(true);
    let selection = f.select();
    assert!(
        f.state
            .preview_restore(PreviewRestore {
                selection_id: selection,
                password: PASSWORD.into()
            })
            .is_err()
    );
    assert_eq!(f.stages(), 0);
    assert_eq!(f.state.list().unwrap().len(), 1);
    f.unchanged();
}
