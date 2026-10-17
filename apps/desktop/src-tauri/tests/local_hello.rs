// Synthetic fixtures; OS success is injected at the Rust port, never through IPC.
use financial_manager_desktop::{
    LocalError, Result, SecretKey,
    commands::LocalState,
    identity,
    keys::KeyStore,
    local_lock::{ConfigurePin, PinInput},
    local_workspaces::{CreateWorkspace, Purpose},
    lock_store::PolicyStore,
    windows_hello::{HelloAvailability, HelloVerifier},
};
use std::{
    collections::HashMap,
    fs,
    sync::{
        Arc, Barrier, Mutex,
        atomic::{AtomicU8, AtomicUsize, Ordering},
    },
    thread,
};
use uuid::Uuid;
use zeroize::Zeroizing;
const PIN: &str = "721947350682";
#[derive(Default)]
struct Policies {
    bytes: Mutex<Option<Zeroizing<Vec<u8>>>>,
    fault: AtomicU8,
}
impl PolicyStore for Policies {
    fn read(&self, _: Uuid) -> Result<Option<Zeroizing<Vec<u8>>>> {
        Ok(self.bytes.lock().unwrap().clone())
    }
    fn write(&self, _: Uuid, bytes: &[u8]) -> Result<()> {
        let fault = self.fault.load(Ordering::SeqCst);
        // Fault only at the v1 -> v2 publication, after PIN authentication persisted.
        if serde_json::from_slice::<serde_json::Value>(bytes).unwrap()["version"] == 2 {
            if fault == 1 {
                return Err(LocalError::StorageUnavailable);
            }
            *self.bytes.lock().unwrap() = Some(Zeroizing::new(bytes.to_vec()));
            if fault == 2 {
                return Err(LocalError::StorageUnavailable);
            }
        } else {
            *self.bytes.lock().unwrap() = Some(Zeroizing::new(bytes.to_vec()));
        }
        Ok(())
    }
}
#[derive(Default)]
struct Keys {
    values: Mutex<HashMap<(Uuid, Uuid), SecretKey>>,
    reads: AtomicUsize,
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
        self.values.lock().unwrap().insert((i, w), key.clone());
        Ok(())
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
        self.values.lock().unwrap().remove(&(i, w));
        Ok(())
    }
}
#[derive(Default)]
struct Hello {
    outcome: AtomicU8,
    calls: AtomicUsize,
    barrier: Mutex<Option<Arc<Barrier>>>,
}
impl HelloVerifier for Hello {
    fn availability(&self) -> HelloAvailability {
        if self.outcome.load(Ordering::SeqCst) == 3 {
            HelloAvailability::NotConfigured
        } else {
            HelloAvailability::Available
        }
    }
    fn verify(&self, window: isize) -> Result<()> {
        assert_eq!(window, 42);
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(barrier) = self.barrier.lock().unwrap().take() {
            barrier.wait();
            barrier.wait();
        }
        match self.outcome.load(Ordering::SeqCst) {
            0 => Ok(()),
            1 => Err(LocalError::HelloCanceled),
            _ => Err(LocalError::HelloFailed),
        }
    }
}
fn pin(value: &str) -> PinInput {
    PinInput { pin: value.into() }
}
fn config(old: Option<&str>) -> ConfigurePin {
    ConfigurePin {
        current_pin: old.map(str::to_owned),
        new_pin: PIN.into(),
        confirm_pin: PIN.into(),
    }
}
fn state(
    root: &std::path::Path,
    keys: &Arc<Keys>,
    policies: &Arc<Policies>,
    hello: &Arc<Hello>,
) -> LocalState {
    LocalState::with_hello(root.into(), keys.clone(), policies.clone(), hello.clone())
}
struct Fixture {
    temp: tempfile::TempDir,
    keys: Arc<Keys>,
    policies: Arc<Policies>,
    hello: Arc<Hello>,
    state: Arc<LocalState>,
    vault: std::path::PathBuf,
    bytes: Vec<u8>,
}
impl Fixture {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let keys = Arc::new(Keys::default());
        let policies = Arc::new(Policies::default());
        let hello = Arc::new(Hello::default());
        let state = Arc::new(state(temp.path(), &keys, &policies, &hello));
        let row = state
            .create(CreateWorkspace {
                workspace_id: identity::new_id().unwrap().to_string(),
                display_name: "SYNTHETIC US033 HELLO".into(),
                purpose: Purpose::Personal,
            })
            .unwrap();
        let vault = temp.path().join("workspaces").join(row.id).join("vault.db");
        let bytes = fs::read(&vault).unwrap();
        state.configure(config(None)).unwrap();
        Self {
            temp,
            keys,
            policies,
            hello,
            state,
            vault,
            bytes,
        }
    }
    fn enable(&self) {
        let status = self
            .state
            .configure_hello(pin(PIN), true, 42, || true)
            .unwrap();
        assert!(status.hello_enabled && status.locked);
    }
    fn preserved_and_closed(&self, reads: usize) {
        assert!(self.state.status().unwrap().locked);
        assert_eq!(self.state.list().err(), Some(LocalError::LocalLocked));
        assert_eq!(self.keys.reads.load(Ordering::SeqCst), reads);
        assert_eq!(fs::read(&self.vault).unwrap(), self.bytes);
    }
}
#[test]
fn opt_in_requires_pin_and_native_success_and_never_accepts_renderer_proofs() {
    let f = Fixture::new();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    assert!(!f.state.status().unwrap().hello_enabled);
    assert_eq!(
        f.state.unlock_with_hello(42, || true).err(),
        Some(LocalError::HelloUnavailable)
    );
    assert_eq!(f.hello.calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        f.state.configure_hello(pin("bad"), true, 42, || true).err(),
        Some(LocalError::AuthenticationFailed)
    );
    for (outcome, error) in [
        (1, LocalError::HelloCanceled),
        (2, LocalError::HelloFailed),
        (3, LocalError::HelloUnavailable),
    ] {
        f.hello.outcome.store(outcome, Ordering::SeqCst);
        assert_eq!(
            f.state.configure_hello(pin(PIN), true, 42, || true).err(),
            Some(error)
        );
        assert!(!f.state.status().unwrap().hello_enabled);
        f.preserved_and_closed(reads);
    }
    assert!(serde_json::from_str::<PinInput>(r#"{"pin":"123456","verified":true}"#).is_err());
}
#[test]
fn v1_policy_migrates_only_after_os_success_and_restart_requires_fresh_consent() {
    let f = Fixture::new();
    let before: serde_json::Value =
        serde_json::from_slice(f.policies.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
    assert_eq!(before["version"], 1);
    f.enable();
    let after: serde_json::Value =
        serde_json::from_slice(f.policies.bytes.lock().unwrap().as_ref().unwrap()).unwrap();
    assert_eq!(after["version"], 2);
    assert_eq!(after["hello"], true);
    assert_eq!(before["pin"]["salt"], after["pin"]["salt"]);
    assert_eq!(before["pin"]["tag"], after["pin"]["tag"]);
    drop(f.state);
    let restarted = state(f.temp.path(), &f.keys, &f.policies, &f.hello);
    assert!(restarted.status().unwrap().locked);
    assert!(!restarted.unlock_with_hello(42, || true).unwrap().locked);
    assert_eq!(restarted.list().unwrap().len(), 1);
    assert_eq!(fs::read(f.vault).unwrap(), f.bytes);
}
#[test]
fn canceled_failed_unavailable_or_background_consent_cannot_read_financial_keys() {
    let f = Fixture::new();
    f.enable();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    for (outcome, error) in [
        (1, LocalError::HelloCanceled),
        (2, LocalError::HelloFailed),
        (3, LocalError::HelloUnavailable),
    ] {
        f.hello.outcome.store(outcome, Ordering::SeqCst);
        assert_eq!(f.state.unlock_with_hello(42, || true).err(), Some(error));
        f.preserved_and_closed(reads);
    }
    f.hello.outcome.store(0, Ordering::SeqCst);
    assert_eq!(
        f.state.unlock_with_hello(42, || false).err(),
        Some(LocalError::LocalLocked)
    );
    f.preserved_and_closed(reads);
    assert!(!f.state.unlock(pin(PIN)).unwrap().locked);
}
#[test]
fn consent_is_single_flight_and_manual_lock_or_policy_change_invalidates_late_success() {
    for mutation in ["lock", "change", "disable"] {
        let f = Fixture::new();
        f.enable();
        let barrier = Arc::new(Barrier::new(2));
        *f.hello.barrier.lock().unwrap() = Some(barrier.clone());
        let other = f.state.clone();
        let worker = thread::spawn(move || other.unlock_with_hello(42, || true));
        barrier.wait();
        assert_eq!(
            f.state.unlock_with_hello(42, || true).err(),
            Some(LocalError::RequestConflict)
        );
        match mutation {
            "change" => {
                f.state.configure(config(Some(PIN))).unwrap();
            }
            "disable" => {
                f.state
                    .configure_hello(pin(PIN), false, 0, || false)
                    .unwrap();
            }
            _ => {
                f.state.lock().unwrap();
            }
        }
        f.state.lock().unwrap();
        barrier.wait();
        assert_eq!(worker.join().unwrap().err(), Some(LocalError::LocalLocked));
        f.preserved_and_closed(f.keys.reads.load(Ordering::SeqCst));
    }
}
#[test]
fn owned_prompt_blur_keeps_keys_closed_until_fresh_verification_returns_to_foreground() {
    let f = Fixture::new();
    f.enable();
    let reads = f.keys.reads.load(Ordering::SeqCst);
    let barrier = Arc::new(Barrier::new(2));
    *f.hello.barrier.lock().unwrap() = Some(barrier.clone());
    let other = f.state.clone();
    let worker = thread::spawn(move || other.unlock_with_hello(42, || true));
    barrier.wait();
    f.state.on_focus_lost();
    f.preserved_and_closed(reads);
    barrier.wait();
    assert!(!worker.join().unwrap().unwrap().locked);
    f.state.on_focus_lost();
    f.preserved_and_closed(reads);
}
#[test]
fn migration_write_failures_are_closed_and_downgrade_or_unknown_versions_reject() {
    for fault in [1, 2] {
        let f = Fixture::new();
        let reads = f.keys.reads.load(Ordering::SeqCst);
        f.policies.fault.store(fault, Ordering::SeqCst);
        assert_eq!(
            f.state.configure_hello(pin(PIN), true, 42, || true).err(),
            Some(LocalError::StorageUnavailable)
        );
        f.preserved_and_closed(reads);
        f.policies.fault.store(0, Ordering::SeqCst);
        assert!(!f.state.unlock(pin(PIN)).unwrap().locked);
        let bytes = f.policies.bytes.lock().unwrap().clone().unwrap();
        drop(f.state);
        for patch in [
            serde_json::json!({"version": 0}),
            serde_json::json!({"version": 3}),
            serde_json::json!({"version": 2, "hello": null}),
            serde_json::json!({"version": 1, "hello": true}),
            serde_json::json!({"version": 2, "hello": "true"}),
            serde_json::json!({"version": 2, "hello": true, "pin": null}),
        ] {
            let mut value: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
            for (key, field) in patch.as_object().unwrap() {
                value[key] = field.clone();
            }
            *f.policies.bytes.lock().unwrap() =
                Some(Zeroizing::new(serde_json::to_vec(&value).unwrap()));
            let s = state(f.temp.path(), &f.keys, &f.policies, &f.hello);
            assert_eq!(s.status().err(), Some(LocalError::IntegrityFailure));
        }
    }
}
#[test]
fn pin_throttle_applies_to_hello_and_pin_change_or_disable_revokes_opt_in() {
    let f = Fixture::new();
    f.enable();
    for _ in 0..5 {
        assert_eq!(
            f.state.unlock(pin("bad")).err(),
            Some(LocalError::AuthenticationFailed)
        );
    }
    let calls = f.hello.calls.load(Ordering::SeqCst);
    assert_eq!(
        f.state.unlock_with_hello(42, || true).err(),
        Some(LocalError::RetryLater)
    );
    assert_eq!(f.hello.calls.load(Ordering::SeqCst), calls);
    for disable in [false, true] {
        let f = Fixture::new();
        f.enable();
        if disable {
            f.state.disable(pin(PIN)).unwrap();
        } else {
            f.state.configure(config(Some(PIN))).unwrap();
        }
        assert!(!f.state.status().unwrap().hello_enabled);
        assert_eq!(
            f.state.unlock_with_hello(42, || true).err(),
            Some(LocalError::HelloUnavailable)
        );
        assert_eq!(fs::read(f.vault).unwrap(), f.bytes);
    }
}
