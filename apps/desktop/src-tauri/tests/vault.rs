#![cfg(feature = "vault-smoke")]
use financial_manager_desktop::{
    LocalError, Result, SecretKey, identity,
    keys::{KeyStore, random_key},
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    vault_probe as probe,
};
use std::{
    collections::HashMap,
    fs,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU8, Ordering},
    },
};
use uuid::Uuid;
#[derive(Default)]
struct Keys {
    values: Mutex<HashMap<(Uuid, Uuid), SecretKey>>,
    fault: AtomicU8,
}
impl KeyStore for Keys {
    fn get(&self, i: Uuid, w: Uuid) -> Result<SecretKey> {
        if self.fault.load(Ordering::SeqCst) == 1 {
            return Err(LocalError::StorageUnavailable);
        }
        self.values
            .lock()
            .unwrap()
            .get(&(i, w))
            .cloned()
            .ok_or(LocalError::KeyMissing)
    }
    fn put_new(&self, i: Uuid, w: Uuid, key: &SecretKey) -> Result<()> {
        let mode = self.fault.load(Ordering::SeqCst);
        if mode == 2 {
            return Err(LocalError::StorageUnavailable);
        }
        let mut values = self.values.lock().unwrap();
        if let std::collections::hash_map::Entry::Vacant(entry) = values.entry((i, w)) {
            entry.insert(key.clone());
        } else {
            return Err(LocalError::IntegrityFailure);
        }
        if mode == 3 {
            Err(LocalError::StorageUnavailable)
        } else {
            Ok(())
        }
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
        if self.fault.load(Ordering::SeqCst) == 4 {
            return Err(LocalError::StorageUnavailable);
        }
        self.values.lock().unwrap().remove(&(i, w));
        Ok(())
    }
}
fn input() -> CreateWorkspace {
    CreateWorkspace {
        workspace_id: identity::new_id().unwrap().to_string(),
        display_name: "SYNTHETIC US032".into(),
        purpose: Purpose::Personal,
    }
}

#[test]
fn runtime_cipher_and_protection_pragmas_are_real() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("vault");
    let keys = Arc::new(Keys::default());
    let _installation = probe::fixture(&root, keys.clone()).unwrap();
    let db = probe::open_fixture(&root, keys.as_ref()).unwrap();
    let report = probe::runtime(&db).unwrap();
    assert!(report["cipher"].as_str().unwrap().starts_with("4.14.0"));
    assert!(
        report["flags"]
            .as_object()
            .unwrap()
            .values()
            .all(|value| value.as_bool() == Some(true))
    );
}
#[test]
fn missing_and_wrong_database_key_never_create_or_replace_files() {
    let temp = tempfile::tempdir().unwrap();
    let absent = temp.path().join("absent.db");
    assert!(open_database(&absent, &random_key().unwrap()).is_err());
    assert!(!absent.exists());
    let root = temp.path().join("vault");
    let keys = Arc::new(Keys::default());
    let _installation = probe::fixture(&root, keys).unwrap();
    let path = probe::vault_path(&root);
    let before = fs::read(&path).unwrap();
    assert!(open_database(&path, &random_key().unwrap()).is_err());
    assert!(fs::read(&path).unwrap() == before);
    let db = rusqlite::Connection::open(&path).unwrap();
    assert!(
        db.query_row("SELECT count(*) FROM workspace", [], |row| row
            .get::<_, i64>(0))
            .is_err()
    );
    assert!(fs::read(path).unwrap() == before);
}
#[test]
fn unavailable_secret_store_preserves_published_financial_data() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("vault");
    let keys = Arc::new(Keys::default());
    let installation = probe::fixture(&root, keys.clone()).unwrap();
    let path = probe::vault_path(&root);
    let before = fs::read(&path).unwrap();
    keys.fault.store(1, Ordering::SeqCst);
    assert!(
        installation
            .open_workspace(&probe::dataset_workspace().to_string())
            .err()
            == Some(LocalError::StorageUnavailable)
    );
    assert!(fs::read(path).unwrap() == before);
    assert!(keys.values.lock().unwrap().len() == 1);
}
#[test]
fn failed_secret_persistence_and_readback_publish_nothing() {
    for mode in [2, 3] {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(Keys::default());
        let installation = Installation::open(temp.path(), keys.clone()).unwrap();
        keys.fault.store(mode, Ordering::SeqCst);
        assert!(installation.create(input()).err() == Some(LocalError::StorageUnavailable));
        assert!(installation.list().unwrap().is_empty());
        assert!(keys.values.lock().unwrap().is_empty());
        assert!(
            fs::read_dir(temp.path().join("staging"))
                .unwrap()
                .next()
                .is_none()
        );
    }
}
#[test]
fn cleanup_failure_keeps_recovery_marker_and_never_removes_published_data() {
    let temp = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let installation = Installation::open(temp.path(), keys.clone()).unwrap();
    let existing = installation.create(input()).unwrap();
    keys.fault.store(4, Ordering::SeqCst);
    assert!(
        installation
            .create_with_hook(input(), |_| Err(LocalError::StorageUnavailable))
            .is_err()
    );
    assert!(
        fs::read_dir(temp.path().join("staging"))
            .unwrap()
            .next()
            .is_some()
    );
    keys.fault.store(0, Ordering::SeqCst);
    drop(installation);
    let recovered = Installation::open(temp.path(), keys.clone()).unwrap();
    assert!(recovered.list().unwrap().len() == 1);
    assert!(recovered.open_workspace(&existing.id).unwrap() == existing);
    assert!(keys.values.lock().unwrap().len() == 1);
}
#[test]
fn tampered_ciphertext_fails_integrity_without_rewriting_database() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("vault");
    let keys = Arc::new(Keys::default());
    let installation = probe::fixture(&root, keys).unwrap();
    let path = probe::vault_path(&root);
    let mut bytes = fs::read(&path).unwrap();
    let index = bytes.len() - 80;
    bytes[index] ^= 0x80;
    fs::write(&path, &bytes).unwrap();
    assert!(
        installation
            .open_workspace(&probe::dataset_workspace().to_string())
            .is_err()
    );
    assert!(fs::read(path).unwrap() == bytes);
}
#[test]
fn schema_and_history_tampering_are_rejected_without_migration_writes() {
    for change in [
        "CREATE TABLE unexpected(value TEXT)",
        "UPDATE _schema_migration SET checksum='0000000000000000000000000000000000000000000000000000000000000000'",
    ] {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("vault");
        let keys = Arc::new(Keys::default());
        let installation = probe::fixture(&root, keys.clone()).unwrap();
        let db = probe::open_fixture(&root, keys.as_ref()).unwrap();
        db.execute_batch(change).unwrap();
        drop(db);
        let path = probe::vault_path(&root);
        let before = fs::read(&path).unwrap();
        assert!(
            installation
                .open_workspace(&probe::dataset_workspace().to_string())
                .is_err()
        );
        assert!(fs::read(path).unwrap() == before);
    }
}
#[test]
fn complete_fixture_is_preserved_by_native_upgrade_and_key_is_absent_from_files() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("vault");
    let keys = Arc::new(Keys::default());
    let installation = probe::fixture(&root, keys.clone()).unwrap();
    let mut db = probe::open_fixture(&root, keys.as_ref()).unwrap();
    let before = probe::snapshot(&db).unwrap();
    assert!(probe::version(&db).unwrap() == 1);
    probe::migrate(&mut db).unwrap();
    assert!(probe::version(&db).unwrap() == 2);
    assert!(probe::snapshot(&db).unwrap() == before);
    let (id, _) = installation.probe_details();
    let secret = keys.get(id, probe::dataset_workspace()).unwrap();
    assert!(!probe::has_plaintext(&root, &secret).unwrap());
}
