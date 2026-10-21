use crate::{
    LocalError, Result, SecretKey, identity,
    keys::{KeyStore, random_key},
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
};
use std::{
    collections::HashMap,
    fs,
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Default)]
struct MemoryKeys(Mutex<HashMap<(Uuid, Uuid), SecretKey>>);
impl KeyStore for MemoryKeys {
    fn get(&self, i: Uuid, w: Uuid) -> Result<SecretKey> {
        self.0
            .lock()
            .unwrap()
            .get(&(i, w))
            .cloned()
            .ok_or(LocalError::KeyMissing)
    }
    fn put_new(&self, i: Uuid, w: Uuid, key: &SecretKey) -> Result<()> {
        let mut map = self.0.lock().unwrap();
        if map.contains_key(&(i, w)) {
            return Err(LocalError::IntegrityFailure);
        }
        map.insert((i, w), key.clone());
        Ok(())
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
        self.0.lock().unwrap().remove(&(i, w));
        Ok(())
    }
}
fn input(id: Uuid, name: &str) -> CreateWorkspace {
    CreateWorkspace {
        workspace_id: id.to_string(),
        display_name: name.into(),
        purpose: Purpose::Personal,
    }
}

#[test]
fn creates_product_workspace_without_cloud_identity_and_reopens_exactly() {
    let directory = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeys::default());
    let id = identity::new_id().unwrap();
    let installation = Installation::open(directory.path(), keys.clone()).unwrap();
    let created = installation
        .create(input(id, " SYNTHETIC US031 PRIVATE NAME "))
        .unwrap();
    assert!(created.display_name == "SYNTHETIC US031 PRIVATE NAME");
    assert!(created.storage_mode == "LOCAL" && created.default_currency == "BRL");
    let (installation_id, root) = installation.probe_details();
    let key = keys.get(installation_id, id).unwrap();
    let path = root
        .join("workspaces")
        .join(id.to_string())
        .join("vault.db");
    let db = open_database(&path, &key).unwrap();
    for name in ["cloud_user", "auth_identity", "workspace_member"] {
        let count: i64 = db
            .query_row(
                "SELECT count(*) FROM sqlite_schema WHERE name=?",
                [name],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count == 0, "CLOUD_TABLE_FORBIDDEN");
    }
    let rows: i64 = db
        .query_row(
            "SELECT count(*) FROM workspace WHERE storage_mode='LOCAL'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert!(rows == 1);
    let count: i64 = db
        .query_row("SELECT count(*) FROM _schema_migration", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert!(count == 3);
    drop(db);
    let bytes = fs::read(&path).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3"));
    assert!(
        !bytes
            .windows(20)
            .any(|part| part == b"SYNTHETIC US031 PRIVA")
    );
    assert!(open_database(&path, &random_key().unwrap()).is_err());
    drop(installation);
    let reopened = Installation::open(directory.path(), keys).unwrap();
    assert!(reopened.open_workspace(&id.to_string()).unwrap() == created);
    assert!(reopened.list().unwrap().len() == 1);
}
#[test]
fn retries_are_idempotent_and_changed_input_cannot_overwrite() {
    let directory = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeys::default());
    let installation = Installation::open(directory.path(), keys).unwrap();
    let id = identity::new_id().unwrap();
    let first = installation.create(input(id, "SYNTHETIC RETRY")).unwrap();
    let second = installation.create(input(id, "SYNTHETIC RETRY")).unwrap();
    assert!(first == second);
    assert!(
        installation.create(input(id, "SYNTHETIC CONFLICT")).err()
            == Some(LocalError::RequestConflict)
    );
    assert!(installation.list().unwrap().len() == 1);
    assert!(installation.open_workspace(&id.to_string()).unwrap() == first);
}
#[test]
fn invalid_input_and_paths_never_create_rows_or_keys() {
    let directory = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeys::default());
    let installation = Installation::open(directory.path(), keys.clone()).unwrap();
    for name in [" ", "SYNTHETIC\0NAME", "\u{feff}", &"x".repeat(121)] {
        assert!(
            installation
                .create(input(identity::new_id().unwrap(), name))
                .is_err()
        );
    }
    for id in [
        "../workspaces",
        "0199D025-0000-7000-8000-000000000001",
        "00000000-0000-0000-0000-000000000000",
    ] {
        assert!(installation.open_workspace(id).err() == Some(LocalError::InvalidWorkspace));
    }
    assert!(installation.list().unwrap().is_empty());
    assert!(keys.0.lock().unwrap().is_empty());
    assert!(serde_json::from_str::<CreateWorkspace>(r#"{"workspace_id":"0199d031-0000-7000-8000-000000000001","display_name":"SYNTHETIC","purpose":"PERSONAL","storage_mode":"CLOUD"}"#).is_err());
}
#[test]
fn missing_key_fails_closed_without_regeneration_or_financial_mutation() {
    let directory = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeys::default());
    let installation = Installation::open(directory.path(), keys.clone()).unwrap();
    let id = identity::new_id().unwrap();
    installation
        .create(input(id, "SYNTHETIC MISSING KEY"))
        .unwrap();
    let (install, root) = installation.probe_details();
    let key = keys.get(install, id).unwrap();
    keys.delete(install, id).unwrap();
    let file = root
        .join("workspaces")
        .join(id.to_string())
        .join("vault.db");
    let before = fs::read(&file).unwrap();
    assert!(installation.open_workspace(&id.to_string()).err() == Some(LocalError::KeyMissing));
    assert!(
        installation
            .create(input(id, "SYNTHETIC MISSING KEY"))
            .err()
            == Some(LocalError::KeyMissing)
    );
    assert!(keys.0.lock().unwrap().is_empty());
    assert!(before == fs::read(file).unwrap());
    keys.put_new(install, id, &key).unwrap();
    assert!(installation.list().unwrap().len() == 1);
}
#[test]
fn failed_staging_cleans_only_its_key_and_preserves_published_workspaces() {
    let directory = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeys::default());
    let installation = Installation::open(directory.path(), keys.clone()).unwrap();
    let valid = identity::new_id().unwrap();
    let expected = installation
        .create(input(valid, "SYNTHETIC EXISTING"))
        .unwrap();
    for stop in ["key_stored", "database_committed"] {
        let id = identity::new_id().unwrap();
        assert!(
            installation
                .create_with_hook(input(id, "SYNTHETIC INTERRUPTED"), |phase| {
                    if phase == stop {
                        Err(LocalError::StorageUnavailable)
                    } else {
                        Ok(())
                    }
                })
                .is_err()
        );
        assert!(installation.open_workspace(&valid.to_string()).unwrap() == expected);
        assert!(installation.list().unwrap().len() == 1);
        assert!(keys.0.lock().unwrap().len() == 1);
    }
    assert!(
        fs::read_dir(directory.path().join("staging"))
            .unwrap()
            .next()
            .is_none()
    );
}
#[test]
fn installation_lock_and_schema_tamper_fail_closed() {
    let directory = tempfile::tempdir().unwrap();
    let keys = Arc::new(MemoryKeys::default());
    let installation = Installation::open(directory.path(), keys.clone()).unwrap();
    assert!(
        Installation::open(directory.path(), keys.clone()).err()
            == Some(LocalError::InstallationBusy)
    );
    let id = identity::new_id().unwrap();
    installation.create(input(id, "SYNTHETIC TAMPER")).unwrap();
    let (install, root) = installation.probe_details();
    let db = open_database(
        &root
            .join("workspaces")
            .join(id.to_string())
            .join("vault.db"),
        &keys.get(install, id).unwrap(),
    )
    .unwrap();
    db.execute_batch("CREATE TABLE unexpected(payload TEXT)")
        .unwrap();
    drop(db);
    assert!(
        installation.open_workspace(&id.to_string()).err() == Some(LocalError::UnsupportedSchema)
    );
}
