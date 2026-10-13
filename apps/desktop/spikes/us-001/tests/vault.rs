use financial_manager_vault_spike::backup::RestoreCheckpoint;
use financial_manager_vault_spike::secrets::{KeyStore, WindowsKeyStore};
use financial_manager_vault_spike::vault::{Installation, data, open_database, synthetic_fixture};
use financial_manager_vault_spike::{Result, SecretKey, VaultError, random_key};
use rusqlite::{Connection, OpenFlags};
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Mutex};
use tempfile::TempDir;
use uuid::Uuid;
use zeroize::Zeroizing;

const PASSWORD: &[u8] = b"SYNTHETIC RECOVERY SECRET ONLY";

#[derive(Default)]
struct MemoryKeys(Mutex<HashMap<(Uuid, Uuid), SecretKey>>);
impl KeyStore for MemoryKeys {
    fn get(&self, installation: Uuid, workspace: Uuid) -> Result<SecretKey> {
        self.0
            .lock()
            .unwrap()
            .get(&(installation, workspace))
            .map(|key| Zeroizing::new(**key))
            .ok_or(VaultError::KeyMissing)
    }
    fn put_new(&self, installation: Uuid, workspace: Uuid, key: &SecretKey) -> Result<()> {
        let mut keys = self.0.lock().unwrap();
        if keys.contains_key(&(installation, workspace)) {
            return Err(VaultError::KeyExists);
        }
        keys.insert((installation, workspace), Zeroizing::new(**key));
        Ok(())
    }
    fn delete(&self, installation: Uuid, workspace: Uuid) -> Result<()> {
        self.0.lock().unwrap().remove(&(installation, workspace));
        Ok(())
    }
}

struct Denied;
impl KeyStore for Denied {
    fn get(&self, _: Uuid, _: Uuid) -> Result<SecretKey> {
        Err(VaultError::SecretStore)
    }
    fn put_new(&self, _: Uuid, _: Uuid, _: &SecretKey) -> Result<()> {
        Err(VaultError::SecretStore)
    }
    fn delete(&self, _: Uuid, _: Uuid) -> Result<()> {
        Err(VaultError::SecretStore)
    }
}

fn install(keys: Arc<dyn KeyStore>) -> (TempDir, Installation) {
    let directory = tempfile::tempdir().unwrap();
    let installation = Installation::open(directory.path(), keys).unwrap();
    (directory, installation)
}

#[test]
fn encrypted_vault_reopens_exact_int64_and_rejects_missing_or_wrong_key() {
    let keys = Arc::new(MemoryKeys::default());
    let (directory, installation) = install(keys.clone());
    let workspace = installation.create_fixture().unwrap();
    let path = installation.workspace_path(workspace);
    let bytes = fs::read(&path).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3"));
    assert!(
        !bytes
            .windows(b"SYNTHETIC".len())
            .any(|part| part == b"SYNTHETIC")
    );
    installation.verify_fixture(workspace).unwrap();
    let key = keys.get(installation.id(), workspace).unwrap();
    let connection = open_database(&path, &key, false).unwrap();
    let version: String = connection
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .unwrap();
    assert!(version.starts_with("4."));
    let json = serde_json::to_value(data(&connection).unwrap()).unwrap();
    assert!(json["account_references_minor"][0].is_string());
    drop(connection);
    let without_key = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    assert!(
        without_key
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row
                .get::<_, i64>(0))
            .is_err()
    );
    drop(without_key);
    assert!(open_database(&path, &random_key().unwrap(), false).is_err());
    let identity = installation.id();
    drop(installation);
    let restarted = Installation::open(directory.path(), keys.clone()).unwrap();
    restarted.verify_fixture(workspace).unwrap();
    keys.delete(identity, workspace).unwrap();
    let before = fs::read(&path).unwrap();
    assert!(matches!(
        restarted.open_workspace(workspace),
        Err(VaultError::KeyMissing)
    ));
    assert!(
        before == fs::read(&path).unwrap(),
        "Missing key must not modify the vault"
    );
    assert!(matches!(
        keys.get(identity, workspace),
        Err(VaultError::KeyMissing)
    ));
}

#[test]
fn backup_restores_to_independent_installation_without_original_key() {
    let source_keys = Arc::new(MemoryKeys::default());
    let (_source_dir, source) = install(source_keys.clone());
    let original = source.create_fixture().unwrap();
    let original_key = source_keys.get(source.id(), original).unwrap();
    let backup_dir = tempfile::tempdir().unwrap();
    let backup = backup_dir.path().join("synthetic.fmbackup");
    source.backup(original, &backup, PASSWORD).unwrap();
    source_keys.delete(source.id(), original).unwrap();
    let target_keys = Arc::new(MemoryKeys::default());
    let (target_dir, target) = install(target_keys.clone());
    let existing = target.create_fixture().unwrap();
    let existing_bytes = fs::read(target.workspace_path(existing)).unwrap();
    let preview = target.preview_backup(&backup, PASSWORD).unwrap();
    assert_eq!(
        (
            preview.accounts,
            preview.movements,
            preview.items,
            preview.rules,
            preview.history
        ),
        (1, 3, 2, 1, 1)
    );
    assert_eq!(target.list().unwrap().len(), 1, "Preview must not publish");
    let restored = target.restore(&backup, PASSWORD).unwrap();
    assert_ne!(original, restored);
    assert_ne!(source.id(), target.id());
    target.verify_fixture(restored).unwrap();
    assert!(target_keys.get(target.id(), restored).unwrap().as_ref() != original_key.as_ref());
    assert!(
        existing_bytes == fs::read(target.workspace_path(existing)).unwrap(),
        "Existing workspace must be preserved"
    );
    assert!(data(&target.open_workspace(restored).unwrap()).unwrap() == synthetic_fixture());
    assert!(matches!(
        target_keys.get(target.id(), original),
        Err(VaultError::KeyMissing)
    ));
    assert_eq!(
        fs::read_dir(target_dir.path().join("staging"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn rollback_journal_contains_no_plaintext_fixture_and_rollback_preserves_data() {
    let keys = Arc::new(MemoryKeys::default());
    let (_directory, installation) = install(keys);
    let workspace = installation.create_fixture().unwrap();
    let path = installation.workspace_path(workspace);
    let mut connection = installation.open_workspace(workspace).unwrap();
    let temp_store: i64 = connection
        .pragma_query_value(None, "temp_store", |row| row.get(0))
        .unwrap();
    assert_eq!(temp_store, 2);
    let transaction = connection.transaction().unwrap();
    transaction
        .execute(
            "UPDATE item SET description = 'SYNTHETIC UNCOMMITTED UPDATE'",
            [],
        )
        .unwrap();
    let journal = fs::read(path.with_file_name("vault.db-journal")).unwrap();
    assert!(
        !journal
            .windows(b"SYNTHETIC".len())
            .any(|part| part == b"SYNTHETIC")
    );
    transaction.rollback().unwrap();
    assert!(!path.with_file_name("vault.db-journal").exists());
    installation.verify_fixture(workspace).unwrap();
}

#[test]
fn failed_restore_never_changes_existing_workspaces_or_leaks_staging() {
    let keys = Arc::new(MemoryKeys::default());
    let (_source_dir, source) = install(keys.clone());
    let original = source.create_fixture().unwrap();
    let backup_dir = tempfile::tempdir().unwrap();
    let backup = backup_dir.path().join("synthetic.fmbackup");
    source.backup(original, &backup, PASSWORD).unwrap();
    let package = fs::read(&backup).unwrap();
    let (target_dir, target) = install(Arc::new(MemoryKeys::default()));
    let existing = target.create_fixture().unwrap();
    let before = fs::read(target.workspace_path(existing)).unwrap();
    assert!(
        target
            .restore(&backup, b"SYNTHETIC WRONG PASSWORD")
            .is_err()
    );
    let mut adulterated = package.clone();
    *adulterated.last_mut().unwrap() ^= 1;
    fs::write(&backup, adulterated).unwrap();
    assert!(matches!(
        target.restore(&backup, PASSWORD),
        Err(VaultError::Authentication)
    ));
    fs::write(&backup, &package[..package.len() - 20]).unwrap();
    assert!(target.restore(&backup, PASSWORD).is_err());
    let mut unsupported = package.clone();
    unsupported[8] = 2;
    fs::write(&backup, unsupported).unwrap();
    assert!(matches!(
        target.restore(&backup, PASSWORD),
        Err(VaultError::Unsupported)
    ));
    fs::write(&backup, package).unwrap();
    for stop in [RestoreCheckpoint::Staged, RestoreCheckpoint::KeyStored] {
        assert!(matches!(
            target.restore_with_checkpoint(&backup, PASSWORD, |step| {
                if step == stop {
                    Err(VaultError::Interrupted)
                } else {
                    Ok(())
                }
            }),
            Err(VaultError::Interrupted)
        ));
    }
    assert!(
        before == fs::read(target.workspace_path(existing)).unwrap(),
        "Failures must preserve existing data"
    );
    assert_eq!(target.list().unwrap(), vec![existing]);
    assert_eq!(
        fs::read_dir(target_dir.path().join("staging"))
            .unwrap()
            .count(),
        0
    );
}

#[test]
fn access_denied_does_not_publish_and_does_not_replace_existing_key() {
    let (directory, installation) = install(Arc::new(Denied));
    assert!(matches!(
        installation.create_fixture(),
        Err(VaultError::SecretStore)
    ));
    assert!(installation.list().unwrap().is_empty());
    // Unremoved staging is retained for a later successful recovery when the store is locked.
    assert_eq!(
        fs::read_dir(directory.path().join("staging"))
            .unwrap()
            .count(),
        1
    );
    let keys = MemoryKeys::default();
    let (installation_id, workspace) = (Uuid::now_v7(), Uuid::now_v7());
    let first = random_key().unwrap();
    keys.put_new(installation_id, workspace, &first).unwrap();
    assert_eq!(
        keys.put_new(installation_id, workspace, &random_key().unwrap())
            .unwrap_err(),
        VaultError::KeyExists
    );
    assert!(keys.get(installation_id, workspace).unwrap().as_ref() == first.as_ref());
}

#[test]
fn exclusive_installation_lock_and_missing_identity_fail_closed() {
    let keys = Arc::new(MemoryKeys::default());
    let (directory, installation) = install(keys.clone());
    assert!(matches!(
        Installation::open(directory.path(), keys.clone()),
        Err(VaultError::Busy)
    ));
    drop(installation);
    fs::remove_file(directory.path().join(".installation-id")).unwrap();
    assert!(matches!(
        Installation::open(directory.path(), keys),
        Err(VaultError::Invalid)
    ));
}

#[test]
fn synthetic_schema_migration_rolls_back_on_failure_and_commits_version_atomically() {
    let mut database = Connection::open_in_memory().unwrap();
    {
        let transaction = database.transaction().unwrap();
        transaction
            .execute_batch(include_str!("../migrations/0001-synthetic.sql"))
            .unwrap();
        assert!(
            transaction
                .execute("INSERT INTO workspace VALUES ('invalid', 'CLOUD')", [])
                .is_err()
        );
        // Dropping a failed transaction must not leave a partially applied schema.
    }
    let version: i64 = database
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    let tables: i64 = database
        .query_row(
            "SELECT count(*) FROM sqlite_schema WHERE type = 'table'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!((version, tables), (0, 0));
    let transaction = database.transaction().unwrap();
    transaction
        .execute_batch(include_str!("../migrations/0001-synthetic.sql"))
        .unwrap();
    transaction.commit().unwrap();
    let version: i64 = database
        .pragma_query_value(None, "user_version", |row| row.get(0))
        .unwrap();
    assert_eq!(version, 1);
}

#[test]
fn windows_credential_manager_persists_and_isolates_installations() {
    let keys = WindowsKeyStore;
    let installation = Uuid::now_v7();
    let workspace = Uuid::now_v7();
    let key = random_key().unwrap();
    keys.put_new(installation, workspace, &key).unwrap();
    struct Cleanup(Uuid, Uuid);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = WindowsKeyStore.delete(self.0, self.1);
        }
    }
    let _cleanup = Cleanup(installation, workspace);
    let reopened = WindowsKeyStore.get(installation, workspace).unwrap();
    assert!(reopened.as_ref() == key.as_ref());
    assert!(matches!(
        keys.get(Uuid::now_v7(), workspace),
        Err(VaultError::KeyMissing)
    ));
    assert_eq!(
        keys.put_new(installation, workspace, &random_key().unwrap())
            .unwrap_err(),
        VaultError::KeyExists
    );
}
