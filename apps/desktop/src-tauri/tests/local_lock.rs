use financial_manager_desktop::{
    LocalError, Result, SecretKey,
    commands::LocalState,
    identity,
    keys::KeyStore,
    local_lock::{ConfigurePin, LocalLock, PinInput},
    local_workspaces::{CreateWorkspace, Purpose},
    lock_store::PolicyStore,
};
use std::{
    collections::HashMap,
    fs,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU8, AtomicUsize, Ordering},
    },
    thread,
};
use uuid::Uuid;
use zeroize::Zeroizing;
const PIN: &str = "721947350682";
const SECOND: &str = "682035741921";
#[derive(Default)]
struct Policies {
    value: Mutex<Option<Zeroizing<Vec<u8>>>>,
    fault: AtomicU8,
    writes: AtomicUsize,
}
impl PolicyStore for Policies {
    fn read(&self, _: Uuid) -> Result<Option<Zeroizing<Vec<u8>>>> {
        if self.fault.load(Ordering::SeqCst) == 1 {
            return Err(LocalError::StorageUnavailable);
        }
        Ok(self.value.lock().unwrap().clone())
    }
    fn write(&self, _: Uuid, bytes: &[u8]) -> Result<()> {
        self.writes.fetch_add(1, Ordering::SeqCst);
        let mode = self.fault.load(Ordering::SeqCst);
        if mode == 2 {
            return Err(LocalError::StorageUnavailable);
        }
        *self.value.lock().unwrap() = Some(Zeroizing::new(bytes.to_vec()));
        if mode == 3 {
            Err(LocalError::StorageUnavailable)
        } else {
            Ok(())
        }
    }
}
#[derive(Default)]
struct Keys {
    values: Mutex<HashMap<(Uuid, Uuid), SecretKey>>,
    reads: AtomicUsize,
    puts: AtomicUsize,
    barrier: Mutex<Option<Arc<std::sync::Barrier>>>,
}
impl KeyStore for Keys {
    fn get(&self, i: Uuid, w: Uuid) -> Result<SecretKey> {
        self.reads.fetch_add(1, Ordering::SeqCst);
        let barrier = self.barrier.lock().unwrap().take();
        if let Some(barrier) = barrier {
            barrier.wait();
            barrier.wait();
        }
        self.values
            .lock()
            .unwrap()
            .get(&(i, w))
            .cloned()
            .ok_or(LocalError::KeyMissing)
    }
    fn put_new(&self, i: Uuid, w: Uuid, key: &SecretKey) -> Result<()> {
        self.puts.fetch_add(1, Ordering::SeqCst);
        let mut values = self.values.lock().unwrap();
        if values.contains_key(&(i, w)) {
            return Err(LocalError::IntegrityFailure);
        }
        values.insert((i, w), key.clone());
        Ok(())
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
        self.values.lock().unwrap().remove(&(i, w));
        Ok(())
    }
}
fn pin(value: &str) -> PinInput {
    PinInput { pin: value.into() }
}
fn configure(old: Option<&str>, new: &str) -> ConfigurePin {
    ConfigurePin {
        current_pin: old.map(str::to_owned),
        new_pin: new.into(),
        confirm_pin: new.into(),
    }
}
fn workspace() -> CreateWorkspace {
    CreateWorkspace {
        workspace_id: identity::new_id().unwrap().to_string(),
        display_name: "SYNTHETIC US033".into(),
        purpose: Purpose::Personal,
    }
}
fn state(root: &std::path::Path, keys: &Arc<Keys>, policies: &Arc<Policies>) -> LocalState {
    LocalState::with_policies(root.into(), keys.clone(), policies.clone())
}
fn gate(root: &std::path::Path, policies: &Arc<Policies>) -> LocalLock {
    LocalLock::load(
        Uuid::parse_str("0199d033-0000-7000-8000-000000000001").unwrap(),
        root,
        policies.clone(),
    )
    .unwrap()
}

#[test]
fn optional_default_and_pin_validation_do_not_touch_database_or_store() {
    let temp = tempfile::tempdir().unwrap();
    let policies = Arc::new(Policies::default());
    let mut privacy = gate(temp.path(), &policies);
    assert!(!privacy.status(1000).unwrap().enabled);
    assert!(privacy.require_open().is_ok());
    for value in [
        "",
        "12345",
        "1".repeat(13).as_str(),
        "１２３４５６",
        "123 456",
        " 123456",
    ] {
        assert!(
            privacy.configure(&configure(None, value), 1000).err() == Some(LocalError::InvalidPin)
        );
    }
    let mut mismatch = configure(None, PIN);
    mismatch.confirm_pin = SECOND.into();
    assert!(privacy.configure(&mismatch, 1000).err() == Some(LocalError::InvalidPin));
    assert!(policies.writes.load(Ordering::SeqCst) == 0);
    assert!(fs::read_dir(temp.path()).unwrap().next().is_none());
    assert!(serde_json::from_str::<PinInput>("{\"pin\":\"123456\",\"unlocked\":true}").is_err());
}
#[test]
fn locked_product_commands_cannot_read_or_create_keys_or_expose_names() {
    let temp = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let policies = Arc::new(Policies::default());
    let s = state(temp.path(), &keys, &policies);
    let row = s.create(workspace()).unwrap();
    let path = temp
        .path()
        .join("workspaces")
        .join(&row.id)
        .join("vault.db");
    let bytes = fs::read(&path).unwrap();
    s.configure(configure(None, PIN)).unwrap();
    s.lock().unwrap();
    let reads = keys.reads.load(Ordering::SeqCst);
    let puts = keys.puts.load(Ordering::SeqCst);
    assert!(s.list().err() == Some(LocalError::LocalLocked));
    assert!(s.open(&row.id).err() == Some(LocalError::LocalLocked));
    assert!(s.create(workspace()).err() == Some(LocalError::LocalLocked));
    assert!(keys.reads.load(Ordering::SeqCst) == reads);
    assert!(keys.puts.load(Ordering::SeqCst) == puts);
    assert!(s.unlock(pin(SECOND)).err() == Some(LocalError::AuthenticationFailed));
    assert!(fs::read(path).unwrap() == bytes);
    s.unlock(pin(PIN)).unwrap();
    assert!(s.open(&row.id).unwrap() == row);
}
#[test]
fn restart_is_locked_and_files_do_not_contain_pin_or_verifier() {
    let temp = tempfile::tempdir().unwrap();
    let policies = Arc::new(Policies::default());
    let mut privacy = gate(temp.path(), &policies);
    privacy.configure(&configure(None, PIN), 1000).unwrap();
    assert!(!privacy.status(1000).unwrap().locked);
    drop(privacy);
    let mut privacy = gate(temp.path(), &policies);
    assert!(privacy.status(1001).unwrap().locked);
    let encoded = policies.value.lock().unwrap().clone().unwrap();
    assert!(!encoded.windows(PIN.len()).any(|p| p == PIN.as_bytes()));
    for file in fs::read_dir(temp.path()).unwrap() {
        let bytes = fs::read(file.unwrap().path()).unwrap();
        assert!(!bytes.windows(PIN.len()).any(|p| p == PIN.as_bytes()));
        assert!(bytes.as_slice() != encoded.as_slice());
    }
    privacy.unlock(&pin(PIN), 1001).unwrap();
    assert!(privacy.require_open().is_ok());
}
#[test]
fn five_failures_throttle_across_restart_and_clock_rollback_without_erasure() {
    let temp = tempfile::tempdir().unwrap();
    let policies = Arc::new(Policies::default());
    let mut privacy = gate(temp.path(), &policies);
    privacy.configure(&configure(None, PIN), 1000).unwrap();
    for n in 1..=5 {
        assert!(
            privacy.unlock(&pin("bad"), 1000 + n).err() == Some(LocalError::AuthenticationFailed)
        );
    }
    let before = policies.value.lock().unwrap().clone();
    drop(privacy);
    let mut privacy = gate(temp.path(), &policies);
    assert!(privacy.status(1006).unwrap().retry_after_seconds == 30);
    assert!(privacy.unlock(&pin(PIN), 1006).err() == Some(LocalError::RetryLater));
    assert!(privacy.unlock(&pin(PIN), 999).err() == Some(LocalError::RetryLater));
    assert!(policies.value.lock().unwrap().as_ref() == before.as_ref());
    privacy.unlock(&pin(PIN), 31_005).unwrap();
    assert!(privacy.status(31_005).unwrap().retry_after_seconds == 0);
}
#[test]
fn change_and_disable_require_current_pin_and_never_rekey_the_vault() {
    let temp = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let policies = Arc::new(Policies::default());
    let s = state(temp.path(), &keys, &policies);
    let row = s.create(workspace()).unwrap();
    let path = temp
        .path()
        .join("workspaces")
        .join(&row.id)
        .join("vault.db");
    let bytes = fs::read(&path).unwrap();
    let puts = keys.puts.load(Ordering::SeqCst);
    s.configure(configure(None, PIN)).unwrap();
    assert!(
        s.configure(configure(Some(SECOND), SECOND)).err()
            == Some(LocalError::AuthenticationFailed)
    );
    s.configure(configure(Some(PIN), SECOND)).unwrap();
    s.lock().unwrap();
    assert!(s.unlock(pin(PIN)).err() == Some(LocalError::AuthenticationFailed));
    s.unlock(pin(SECOND)).unwrap();
    assert!(s.disable(pin(PIN)).err() == Some(LocalError::AuthenticationFailed));
    s.disable(pin(SECOND)).unwrap();
    assert!(!s.status().unwrap().enabled);
    s.lock().unwrap();
    assert!(s.open(&row.id).unwrap() == row);
    assert!(keys.puts.load(Ordering::SeqCst) == puts);
    assert!(fs::read(path).unwrap() == bytes);
}
#[test]
fn ambiguous_policy_writes_fail_closed_before_any_financial_key_release() {
    for fault in [2, 3] {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(Keys::default());
        let policies = Arc::new(Policies::default());
        let s = state(temp.path(), &keys, &policies);
        let row = s.create(workspace()).unwrap();
        s.configure(configure(None, PIN)).unwrap();
        let path = temp
            .path()
            .join("workspaces")
            .join(&row.id)
            .join("vault.db");
        let before = fs::read(&path).unwrap();
        let reads = keys.reads.load(Ordering::SeqCst);
        policies.fault.store(fault, Ordering::SeqCst);
        assert!(s.unlock(pin(PIN)).err() == Some(LocalError::StorageUnavailable));
        assert!(s.open(&row.id).err() == Some(LocalError::StorageUnavailable));
        assert!(keys.reads.load(Ordering::SeqCst) == reads);
        assert!(fs::read(path).unwrap() == before);
        policies.fault.store(0, Ordering::SeqCst);
        assert!(s.status().unwrap().locked);
        assert!(s.open(&row.id).err() == Some(LocalError::LocalLocked));
        assert!(keys.reads.load(Ordering::SeqCst) == reads);
        drop(s);
        let s = state(temp.path(), &keys, &policies);
        assert!(s.status().unwrap().locked);
        s.unlock(pin(PIN)).unwrap();
        assert!(s.open(&row.id).is_ok());
    }
}
#[test]
fn missing_or_unavailable_policy_never_silently_disables_protection() {
    for unavailable in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(Keys::default());
        let policies = Arc::new(Policies::default());
        let s = state(temp.path(), &keys, &policies);
        let row = s.create(workspace()).unwrap();
        s.configure(configure(None, PIN)).unwrap();
        drop(s);
        if unavailable {
            policies.fault.store(1, Ordering::SeqCst);
        } else {
            *policies.value.lock().unwrap() = None;
        }
        let s = state(temp.path(), &keys, &policies);
        let reads = keys.reads.load(Ordering::SeqCst);
        assert!(s.status().err() == Some(LocalError::StorageUnavailable));
        assert!(s.open(&row.id).err() == Some(LocalError::StorageUnavailable));
        assert!(s.configure(configure(None, SECOND)).is_err());
        assert!(keys.reads.load(Ordering::SeqCst) == reads);
    }
}
#[test]
fn malformed_policy_and_other_installation_records_fail_closed() {
    let temp = tempfile::tempdir().unwrap();
    let policies = Arc::new(Policies::default());
    let mut privacy = gate(temp.path(), &policies);
    privacy.configure(&configure(None, PIN), 1000).unwrap();
    drop(privacy);
    let original = policies.value.lock().unwrap().clone().unwrap();
    for field in ["version", "installation", "unexpected"] {
        let mut value: serde_json::Value = serde_json::from_slice(&original).unwrap();
        value[field] = match field {
            "version" => serde_json::json!(2),
            "installation" => serde_json::json!(identity::new_id().unwrap().to_string()),
            _ => serde_json::json!(true),
        };
        *policies.value.lock().unwrap() = Some(Zeroizing::new(serde_json::to_vec(&value).unwrap()));
        assert!(
            LocalLock::load(
                Uuid::parse_str("0199d033-0000-7000-8000-000000000001").unwrap(),
                temp.path(),
                policies.clone()
            )
            .is_err()
        );
    }
}
#[test]
fn focus_lock_discards_in_flight_reply_and_blocks_subsequent_key_reads() {
    let temp = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let policies = Arc::new(Policies::default());
    let s = Arc::new(state(temp.path(), &keys, &policies));
    s.create(workspace()).unwrap();
    s.configure(configure(None, PIN)).unwrap();
    let barrier = Arc::new(std::sync::Barrier::new(2));
    *keys.barrier.lock().unwrap() = Some(barrier.clone());
    let other = s.clone();
    let worker = thread::spawn(move || other.list());
    barrier.wait();
    s.force_lock();
    barrier.wait();
    assert!(worker.join().unwrap().err() == Some(LocalError::LocalLocked));
    let reads = keys.reads.load(Ordering::SeqCst);
    assert!(s.list().err() == Some(LocalError::LocalLocked));
    assert!(keys.reads.load(Ordering::SeqCst) == reads);
}
#[test]
fn interrupted_nonsecret_marker_can_be_retried_without_changing_policy_or_keys() {
    let temp = tempfile::tempdir().unwrap();
    let policies = Arc::new(Policies::default());
    fs::write(
        temp.path().join(".local-privacy-v1.pending"),
        b"FINANCIAL_MANAGER_LOCAL",
    )
    .unwrap();
    let mut privacy = gate(temp.path(), &policies);
    privacy.configure(&configure(None, PIN), 1000).unwrap();
    assert!(!temp.path().join(".local-privacy-v1.pending").exists());
    assert!(gate(temp.path(), &policies).status(1001).unwrap().locked);
}
