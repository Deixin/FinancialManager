//! Synthetic SQLCipher, migration, portability and shared-policy regression tests.
use crate::{
    import_probe::{PASSWORD, id, seed},
    keys::KeyStore,
    local_backup::CreateBackup,
    local_workspaces::Installation,
    *,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
};
use uuid::Uuid;
#[derive(Default)]
struct Keys(Mutex<HashMap<(Uuid, Uuid), SecretKey>>);
impl KeyStore for Keys {
    fn get(&self, i: Uuid, w: Uuid) -> Result<SecretKey> {
        self.0
            .lock()
            .unwrap()
            .get(&(i, w))
            .cloned()
            .ok_or(LocalError::KeyMissing)
    }
    fn put_new(&self, i: Uuid, w: Uuid, k: &SecretKey) -> Result<()> {
        let mut m = self.0.lock().unwrap();
        if m.contains_key(&(i, w)) {
            return Err(LocalError::RequestConflict);
        }
        m.insert((i, w), k.clone());
        Ok(())
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
        self.0.lock().unwrap().remove(&(i, w));
        Ok(())
    }
}
fn setup() -> (tempfile::TempDir, Installation, Arc<Keys>) {
    let t = tempfile::tempdir().unwrap();
    let k = Arc::new(Keys::default());
    let i = vault_probe::fixture(&t.path().join("source"), k.clone()).unwrap();
    i.open_workspace(&w()).unwrap();
    (t, i, k)
}
fn w() -> String {
    vault_probe::dataset_workspace().to_string()
}
fn q() -> Value {
    json!({"statuses":[],"account_id":null,"cursor":null,"limit":2})
}
fn d() -> Value {
    json!({"id":id(103),"effect_after":null,"effect_limit":2})
}
fn backup(i: &Installation, path: &std::path::Path) {
    i.prepare_backup(&CreateBackup {
        workspace_id: w(),
        password: PASSWORD.into(),
        confirmation: PASSWORD.into(),
    })
    .unwrap()
    .publish(path, &i.root, || true)
    .unwrap();
}
#[test]
fn shared_typescript_metadata_vectors_match_rust() {
    let vectors: Vec<Value> =
        serde_json::from_str(include_str!("../fixtures/us050-imports.json")).unwrap();
    assert!(vectors.len() > 100);
    for v in vectors {
        let i = &v["input"];
        let r = match v["kind"].as_str().unwrap() {
            "prepare" => import_model::prepare(i),
            "query" => import_model::query(i),
            "detail" => import_model::detail(i),
            "batch" => import_model::batch(i, v["workspace_id"].as_str().unwrap()),
            "source" => import_model::source(
                i,
                v["workspace_id"].as_str().unwrap(),
                v["batch_id"].as_str().unwrap(),
            ),
            "effect" => import_model::effect(
                i,
                v["workspace_id"].as_str().unwrap(),
                v["batch_id"].as_str().unwrap(),
            ),
            _ => panic!("UNKNOWN_VECTOR"),
        };
        assert_eq!(
            r.is_ok(),
            v["valid"].as_bool().unwrap(),
            "{} {}",
            v["kind"],
            v["name"]
        );
    }
}
#[test]
fn preparation_replay_conflict_archive_and_rollback_preserve_financial_graph() {
    let (_t, i, _) = setup();
    let db = i.financial_database(&w()).unwrap();
    let account: String = db
        .query_row(
            "SELECT id FROM financial_account WHERE status='ACTIVE' LIMIT 1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let before = vault_probe::snapshot(&db).unwrap();
    let c = json!({"id":id(900),"target_account_id":account});
    assert!(matches!(
        i.prepare_import(&w(), c.clone(), || Err(LocalError::LocalLocked)),
        Err(LocalError::LocalLocked)
    ));
    assert_eq!(
        i.list_imports(&w(), q()).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        i.prepare_import(&w(), c.clone(), || Ok(())).unwrap()["created"],
        true
    );
    assert_eq!(
        i.prepare_import(&w(), c.clone(), || Ok(())).unwrap()["created"],
        false
    );
    db.execute(
        "UPDATE import_batch SET status='FAILED',failure_code='SYNTHETIC',version=2 WHERE id=?",
        [id(900)],
    )
    .unwrap();
    assert_eq!(
        i.prepare_import(&w(), c.clone(), || Ok(())).unwrap()["batch"]["status"],
        "FAILED"
    );
    let mut conflict = c.clone();
    conflict["target_account_id"] = json!(id(999));
    assert!(matches!(
        i.prepare_import(&w(), conflict, || Ok(())),
        Err(LocalError::ImportBaseConflict)
    ));
    db.execute(
        "UPDATE financial_account SET status='ARCHIVED' WHERE id=?",
        [account.clone()],
    )
    .unwrap();
    assert!(i.prepare_import(&w(), c, || Ok(())).is_ok());
    assert!(matches!(
        i.prepare_import(
            &w(),
            json!({"id":id(901),"target_account_id":account}),
            || Ok(())
        ),
        Err(LocalError::ImportAccountUnavailable)
    ));
    db.execute(
        "UPDATE financial_account SET status='ACTIVE' WHERE id=?",
        [account],
    )
    .unwrap();
    assert_eq!(before, vault_probe::snapshot(&db).unwrap());
}
#[test]
fn keyset_filters_reopen_and_workspace_isolation() {
    let (t, i, k) = setup();
    let db = i.financial_database(&w()).unwrap();
    seed(&db, &w()).unwrap();
    let mut input = q();
    let mut ids = vec![];
    loop {
        let p = i.list_imports(&w(), input.clone()).unwrap();
        for s in p["items"].as_array().unwrap() {
            ids.push(s["batch"]["id"].as_str().unwrap().to_owned());
        }
        if p["next_cursor"].is_null() {
            break;
        }
        input["cursor"] = p["next_cursor"].clone();
    }
    assert_eq!(ids.len(), 9);
    assert!(ids.windows(2).all(|p| p[0] > p[1]));
    let mut filtered = q();
    filtered["statuses"] = json!(["COMMITTED"]);
    assert_eq!(
        i.list_imports(&w(), filtered).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(i.list_imports(&id(999), q()).is_err());
    drop(db);
    drop(i);
    let reopened = Installation::open(&t.path().join("source"), k).unwrap();
    assert_eq!(
        reopened.list_imports(&w(), q()).unwrap()["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}
#[test]
fn detailed_counts_and_revision_pages_never_expose_item_financial_content() {
    let (_t, i, _) = setup();
    let db = i.financial_database(&w()).unwrap();
    seed(&db, &w()).unwrap();
    let p = i.read_import(&w(), d()).unwrap();
    assert_eq!(p["counts"]["total_items"], "7");
    assert_eq!(p["counts"]["total_effects"], "6");
    assert_eq!(p["sources"][0]["period_start"], "2026-01-01");
    assert_eq!(p["effects"].as_array().unwrap().len(), 2);
    let mut next = d();
    next["effect_after"] = p["next_effect_cursor"].clone();
    assert_ne!(
        i.read_import(&w(), next).unwrap()["effects"][0]["id"],
        p["effects"][0]["id"]
    );
    let text = serde_json::to_string(&p).unwrap();
    assert!(!text.contains("9007199254740993") && !text.contains("SYNTHETIC ORIGINAL"));
}
#[test]
fn portable_backup_restores_all_import_foreign_keys_with_fresh_authority() {
    let (t, i, _) = setup();
    let db = i.financial_database(&w()).unwrap();
    seed(&db, &w()).unwrap();
    let path = t.path().join("synthetic.fmbackup");
    backup(&i, &path);
    let source_bytes = fs::read(vault_probe::vault_path(&i.root)).unwrap();
    let verified = local_backup::read_verified(&path, PASSWORD).unwrap();
    assert_eq!(verified.manifest.schema_version, 3);
    let target_keys = Arc::new(Keys::default());
    let target = Installation::open(&t.path().join("target"), target_keys).unwrap();
    let p = local_restore::prepare(&target, verified).unwrap();
    assert_eq!(p.preview.record_counts["import_effect"], "6");
    let restored = local_restore::confirm(&target, &p, || true).unwrap();
    assert_ne!(restored.id, w());
    let rdb = target.financial_database(&restored.id).unwrap();
    local_imports::validate_ledger(&rdb, &restored.id).unwrap();
    for table in [
        "import_batch",
        "import_source",
        "import_item",
        "import_effect",
    ] {
        let old: Vec<String> = db
            .prepare(&format!("SELECT id FROM {table}"))
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        let count: i64 = rdb
            .query_row(
                &format!(
                    "SELECT count(*) FROM {table} WHERE id IN (SELECT value FROM json_each(?))"
                ),
                [serde_json::to_string(&old).unwrap()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }
    let (amount,external,description):(i64,String,String)=rdb.query_row("SELECT normalized_amount_minor,source_external_id,original_description FROM import_item LIMIT 1",[],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
    assert_eq!(amount, 9007199254740993);
    assert_eq!(external, "SYNTHETIC-EXTERNAL-ID");
    assert_eq!(description, "SYNTHETIC ORIGINAL");
    assert_eq!(
        source_bytes,
        fs::read(vault_probe::vault_path(&i.root)).unwrap()
    );
    assert_eq!(
        local_restore::confirm(&target, &p, || true).unwrap().id,
        restored.id
    );
}
#[test]
fn authenticated_legacy_v2_backup_migrates_only_staging_and_keeps_empty_import_counts() {
    let (t, i, k) = setup();
    let db = i.financial_database(&w()).unwrap();
    db.execute_batch(include_str!(
        "../../../../packages/storage-schema/sqlite/migrations/0003-import-ledger.down.sql"
    ))
    .unwrap();
    db.execute("DELETE FROM _schema_migration WHERE version=3", [])
        .unwrap();
    db.pragma_update(None, "user_version", 2).unwrap();
    migrations::verify_version(&db, 2).unwrap();
    drop(db);
    let bytes = fs::read(vault_probe::vault_path(&i.root)).unwrap();
    let key = k.get(i.id, vault_probe::dataset_workspace()).unwrap();
    let mut m = local_backup::manifest(
        &local_workspaces::open_database(&vault_probe::vault_path(&i.root), &key).unwrap(),
        &w(),
        &bytes,
    )
    .unwrap();
    m.schema_version = 2;
    let sealed = local_backup::seal(&m, &key, &bytes, PASSWORD).unwrap();
    let package = t.path().join("legacy.fmbackup");
    sealed.publish(&package, &i.root, || true).unwrap();
    let verified = local_backup::read_verified(&package, PASSWORD).unwrap();
    let target = Installation::open(&t.path().join("target"), Arc::new(Keys::default())).unwrap();
    let p = local_restore::prepare(&target, verified).unwrap();
    assert_eq!(p.preview.record_counts["import_batch"], "0");
    let restored = local_restore::confirm(&target, &p, || true).unwrap();
    let rdb = target.financial_database(&restored.id).unwrap();
    assert_eq!(
        local_backup::record_counts(&rdb).unwrap()["_schema_migration"],
        "3"
    );
    assert_eq!(bytes, fs::read(vault_probe::vault_path(&i.root)).unwrap());
    drop(rdb);
    i.open_workspace(&w()).unwrap();
    assert_eq!(
        i.financial_database(&w())
            .unwrap()
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
}
#[test]
fn malformed_metadata_blocks_reads_and_backup_without_removing_data() {
    let (t, i, _) = setup();
    let db = i.financial_database(&w()).unwrap();
    seed(&db, &w()).unwrap();
    db.execute("UPDATE import_source SET file_name='../SYNTHETIC.ofx'", [])
        .unwrap();
    assert!(matches!(
        i.read_import(&w(), d()),
        Err(LocalError::InvalidImportState)
    ));
    let path = t.path().join("bad.fmbackup");
    assert!(
        i.prepare_backup(&CreateBackup {
            workspace_id: w(),
            password: PASSWORD.into(),
            confirmation: PASSWORD.into()
        })
        .is_err()
    );
    assert!(!path.exists());
    assert_eq!(
        db.query_row("SELECT count(*) FROM import_effect", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        6
    );
}
