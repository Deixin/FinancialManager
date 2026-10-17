#![cfg(feature = "backup-smoke")]
// Synthetic FIN-002 only; every file and secret belongs to this fixture.
use financial_manager_desktop::{
    LocalError, Result, SecretKey,
    backup_destination::BackupDestination,
    backup_probe,
    commands::{BackupJob, LocalState},
    keys::KeyStore,
    local_backup::{CreateBackup, HEADER_SIZE, MAX_PACKAGE, read_verified},
    local_lock::ConfigurePin,
    local_workspaces::{Installation, open_database},
    lock_store::PolicyStore,
    vault_probe,
    windows_hello::WindowsHello,
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs::{self, File},
    path::PathBuf,
    sync::{
        Arc, Barrier, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread,
};
use uuid::Uuid;
use zeroize::Zeroizing;
const PASSWORD: &str = "SYNTHETIC backup password US034";
#[derive(Default)]
struct Keys {
    values: Mutex<HashMap<(Uuid, Uuid), SecretKey>>,
    reads: AtomicUsize,
    puts: AtomicUsize,
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
        Ok(())
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
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
#[derive(Default)]
struct Destination {
    path: Mutex<Option<PathBuf>>,
    barrier: Mutex<Option<Arc<Barrier>>>,
    calls: AtomicUsize,
}
impl BackupDestination for Destination {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let barrier = self.barrier.lock().unwrap().take();
        if let Some(barrier) = barrier {
            barrier.wait();
            barrier.wait();
        }
        Ok(self.path.lock().unwrap().clone())
    }
}
fn input() -> CreateBackup {
    CreateBackup {
        workspace_id: vault_probe::dataset_workspace().to_string(),
        password: PASSWORD.into(),
        confirmation: PASSWORD.into(),
    }
}
struct Fixture {
    state: Arc<LocalState>,
    keys: Arc<Keys>,
    policies: Arc<Policies>,
    destination: Arc<Destination>,
    store: PathBuf,
    source: PathBuf,
    before: Vec<u8>,
    baseline: String,
    temp: tempfile::TempDir,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let store = temp.path().join("installation");
        let keys = Arc::new(Keys::default());
        let policies = Arc::new(Policies::default());
        let destination = Arc::new(Destination::default());
        let installation = vault_probe::fixture(&store, keys.clone()).unwrap();
        let mut db = vault_probe::open_fixture(&store, keys.as_ref()).unwrap();
        vault_probe::migrate(&mut db).unwrap();
        let baseline = vault_probe::snapshot(&db).unwrap();
        drop(db);
        drop(installation);
        let source = vault_probe::vault_path(&store);
        let before = fs::read(&source).unwrap();
        let state = Arc::new(LocalState::with_backup_destination(
            store.clone(),
            keys.clone(),
            policies.clone(),
            Arc::new(WindowsHello),
            destination.clone(),
        ));
        Self {
            state,
            keys,
            policies,
            destination,
            store,
            source,
            before,
            baseline,
            temp,
        }
    }
    fn prepare(&self) -> BackupJob {
        self.state.prepare_backup(input()).unwrap()
    }
    fn export(&self, name: &str) -> PathBuf {
        let path = self.temp.path().join(name);
        let job = self.prepare();
        assert_eq!(
            self.state
                .finish_backup(job, Some(path.clone()))
                .unwrap()
                .outcome,
            "CREATED"
        );
        path
    }
    fn unchanged(&self) {
        assert_eq!(fs::read(&self.source).unwrap(), self.before);
        let db = vault_probe::open_fixture(&self.store, self.keys.as_ref()).unwrap();
        assert_eq!(vault_probe::snapshot(&db).unwrap(), self.baseline);
        assert_eq!(fs::read_dir(self.store.join("staging")).unwrap().count(), 0);
        assert_eq!(self.keys.puts.load(Ordering::SeqCst), 1);
    }
}
#[test]
fn closed_input_and_password_confirmation_fail_before_keys_or_staging() {
    let f = Fixture::new();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    for value in [
        "",
        "short",
        "            ",
        "x".repeat(129).as_str(),
        "with\ncontrol character",
    ] {
        let mut request = input();
        request.password = value.into();
        request.confirmation = value.into();
        assert_eq!(
            f.state.prepare_backup(request).err().unwrap(),
            LocalError::InvalidBackupPassword
        );
    }
    let mut mismatch = input();
    mismatch.confirmation = "SYNTHETIC DIFFERENT".into();
    assert_eq!(
        f.state.prepare_backup(mismatch).err().unwrap(),
        LocalError::InvalidBackupPassword
    );
    assert!(serde_json::from_str::<CreateBackup>(r#"{"workspace_id":"0199d025-0000-7000-8000-000000000001","password":"SYNTHETIC only","confirmation":"SYNTHETIC only","destination":"C:/forbidden"}"#).is_err());
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    f.unchanged();
}
#[test]
fn authenticated_manifest_and_independent_snapshot_preserve_every_financial_column() {
    let f = Fixture::new();
    let path = f.export("portable.fmbackup");
    let key_reads = f.keys.reads.load(Ordering::SeqCst);
    let backup = read_verified(&path, PASSWORD).unwrap();
    assert_eq!(backup.manifest.format_version, 1);
    assert_eq!(backup.manifest.schema_version, 2);
    assert_eq!(backup.manifest.record_counts.len(), 15);
    assert_eq!(backup.manifest.record_counts["_schema_migration"], "2");
    assert_eq!(
        backup.manifest.integrity_hashes["payload.enc"],
        format!("{:x}", Sha256::digest(&backup.snapshot))
    );
    assert_eq!(
        backup_probe::inspect(&backup, &f.temp.path().join("independent-inspection")).unwrap(),
        f.baseline
    );
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), key_reads);
    let device = f
        .keys
        .values
        .lock()
        .unwrap()
        .values()
        .next()
        .unwrap()
        .clone();
    assert_ne!(backup.snapshot_key.as_ref(), device.as_ref());
    let snapshot = f.temp.path().join("wrong-key.db");
    fs::write(&snapshot, &backup.snapshot).unwrap();
    assert!(open_database(&snapshot, &device).is_err());
    f.unchanged();
}
#[test]
fn repeated_exports_use_fresh_salt_nonce_and_key_without_plaintext_or_secret_store_writes() {
    let f = Fixture::new();
    let first = f.export("first.fmbackup");
    let second = f.export("second.fmbackup");
    let a = fs::read(&first).unwrap();
    let b = fs::read(&second).unwrap();
    assert_ne!(&a[22..50], &b[22..50]);
    assert_ne!(a, b);
    for bytes in [&a, &b] {
        for canary in [
            PASSWORD.as_bytes(),
            b"SYNTHETIC",
            b"financial_transaction",
            b"workspace_id",
            b"SQLite format 3",
        ] {
            assert!(!bytes.windows(canary.len()).any(|part| part == canary));
        }
    }
    let a = read_verified(&first, PASSWORD).unwrap();
    let b = read_verified(&second, PASSWORD).unwrap();
    assert_ne!(a.snapshot_key.as_ref(), b.snapshot_key.as_ref());
    assert_eq!(a.manifest.record_counts, b.manifest.record_counts);
    f.unchanged();
}
#[test]
fn wrong_password_and_tampering_of_header_manifest_ciphertext_or_tag_never_succeed() {
    let f = Fixture::new();
    let path = f.export("original.fmbackup");
    let original = fs::read(&path).unwrap();
    assert_eq!(
        read_verified(&path, "SYNTHETIC wrong password")
            .err()
            .unwrap(),
        LocalError::BackupAuthenticationFailed
    );
    for offset in [0, 8, 10, 22, 38, 50, HEADER_SIZE + 4, original.len() - 1] {
        let mut changed = original.clone();
        changed[offset] ^= 1;
        let target = f.temp.path().join("tampered.fmbackup");
        fs::write(&target, changed).unwrap();
        assert!(read_verified(&target, PASSWORD).is_err());
    }
    assert_eq!(fs::read(path).unwrap(), original);
    f.unchanged();
}
#[test]
fn bounds_unknown_format_and_hostile_kdf_are_rejected_without_financial_access() {
    let f = Fixture::new();
    let path = f.export("valid.fmbackup");
    let original = fs::read(path).unwrap();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    let target = f.temp.path().join("hostile.fmbackup");
    File::create(&target)
        .unwrap()
        .set_len(MAX_PACKAGE as u64 + 1)
        .unwrap();
    assert_eq!(
        read_verified(&target, PASSWORD).err().unwrap(),
        LocalError::BackupLimit
    );
    fs::write(&target, [0; 5]).unwrap();
    assert_eq!(
        read_verified(&target, PASSWORD).err().unwrap(),
        LocalError::BackupLimit
    );
    for offset in [8, 10, 14, 18] {
        let mut changed = original.clone();
        changed[offset..offset + 2].copy_from_slice(&u16::MAX.to_le_bytes());
        fs::write(&target, changed).unwrap();
        assert_eq!(
            read_verified(&target, PASSWORD).err().unwrap(),
            LocalError::UnsupportedBackup
        );
    }
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    f.unchanged();
}
#[test]
fn authenticated_unsupported_manifest_and_inconsistent_counts_fail_validation() {
    let f = Fixture::new();
    let original = f.export("original.fmbackup");
    for kind in ["schema", "checksum", "descriptor", "version", "counts"] {
        let target = f.temp.path().join(format!("{kind}.fmbackup"));
        backup_probe::forge(&original, &target, &f.store, PASSWORD, kind).unwrap();
        if kind == "counts" {
            let backup = read_verified(&target, PASSWORD).unwrap();
            assert!(
                backup_probe::inspect(&backup, &f.temp.path().join("invalid-inspection")).is_err()
            );
        } else {
            assert!(read_verified(&target, PASSWORD).is_err());
        }
    }
    f.unchanged();
}
#[test]
fn publication_never_overwrites_and_rejects_internal_or_invalid_destinations() {
    let f = Fixture::new();
    let existing = f.temp.path().join("existing.fmbackup");
    fs::write(&existing, b"SYNTHETIC EXISTING FILE").unwrap();
    assert_eq!(
        f.state
            .finish_backup(f.prepare(), Some(existing.clone()))
            .err()
            .unwrap(),
        LocalError::BackupAlreadyExists
    );
    assert_eq!(fs::read(existing).unwrap(), b"SYNTHETIC EXISTING FILE");
    for target in [
        f.store.join("forbidden.fmbackup"),
        f.temp.path().join("wrong-extension.db"),
    ] {
        assert_eq!(
            f.state
                .finish_backup(f.prepare(), Some(target.clone()))
                .err()
                .unwrap(),
            LocalError::BackupDestinationUnavailable
        );
        assert!(!target.exists());
    }
    f.unchanged();
}
#[test]
fn locked_export_and_owned_dialog_cancellation_do_not_release_more_keys() {
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
    assert_eq!(
        f.state.prepare_backup(input()).err().unwrap(),
        LocalError::LocalLocked
    );
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    f.state
        .unlock(financial_manager_desktop::local_lock::PinInput {
            pin: "721947350682".into(),
        })
        .unwrap();
    let job = f.prepare();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    let lease = job.lease();
    let other = f.state.clone();
    let barrier = Arc::new(Barrier::new(2));
    *f.destination.barrier.lock().unwrap() = Some(barrier.clone());
    let worker = thread::spawn(move || other.choose_backup_destination(lease, 42));
    barrier.wait();
    assert!(f.state.status().unwrap().locked);
    assert_eq!(f.state.list().err().unwrap(), LocalError::LocalLocked);
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    barrier.wait();
    let destination = worker.join().unwrap().unwrap();
    assert_eq!(
        f.state.finish_backup(job, destination).unwrap().outcome,
        "CANCELED"
    );
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    assert_eq!(f.destination.calls.load(Ordering::SeqCst), 1);
    f.unchanged();
}
#[test]
fn single_flight_manual_lock_and_other_installation_reject_stale_jobs() {
    let f = Fixture::new();
    let job = f.prepare();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    assert_eq!(
        f.state.prepare_backup(input()).err().unwrap(),
        LocalError::RequestConflict
    );
    f.state.lock().unwrap();
    let target = f.temp.path().join("stale.fmbackup");
    assert_eq!(
        f.state
            .finish_backup(job, Some(target.clone()))
            .err()
            .unwrap(),
        LocalError::LocalLocked
    );
    assert!(!target.exists());
    assert_eq!(f.keys.reads.load(Ordering::SeqCst), reads);
    let job = f.prepare();
    let other = LocalState::with_policies(
        f.temp.path().join("other-installation"),
        f.keys.clone(),
        f.policies.clone(),
    );
    assert_eq!(
        other
            .finish_backup(job, Some(target.clone()))
            .err()
            .unwrap(),
        LocalError::LocalLocked
    );
    assert!(!target.exists());
    drop(f.prepare());
    f.unchanged();
    // The installation lock is still owned by the original state; independent access fails.
    assert_eq!(
        Installation::open(&f.store, f.keys.clone()).err().unwrap(),
        LocalError::InstallationBusy
    );
}
