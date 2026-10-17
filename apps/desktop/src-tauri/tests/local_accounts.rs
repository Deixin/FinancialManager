#![cfg(feature = "accounts-smoke")]
// All accounts and keys in these tests are explicitly synthetic and disposable.
use financial_manager_desktop::{
    LocalError, Result, SecretKey,
    account_model::AccountChange,
    account_probe,
    commands::LocalState,
    identity,
    keys::KeyStore,
    local_lock::{ConfigurePin, PinInput},
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    lock_store::PolicyStore,
};
use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use uuid::Uuid;
use zeroize::Zeroizing;
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
    fn put_new(&self, i: Uuid, w: Uuid, k: &SecretKey) -> Result<()> {
        let mut v = self.values.lock().unwrap();
        if v.insert((i, w), k.clone()).is_some() {
            return Err(LocalError::IntegrityFailure);
        }
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
    fn write(&self, _: Uuid, b: &[u8]) -> Result<()> {
        *self.0.lock().unwrap() = Some(Zeroizing::new(b.to_vec()));
        Ok(())
    }
}
fn id(n: u64) -> String {
    format!("0199d040-0000-7000-8000-{n:012}")
}
fn create(n: u64, amount: &str) -> AccountChange {
    serde_json::from_value(serde_json::json!({"kind":"CREATE","account":{"id":id(n),"name":"SYNTHETIC US040 ACCOUNT","institution_name":null,"account_kind":"CHECKING","balance_nature":"ASSET","currency_code":"BRL"},"reference":{"id":id(n+1000),"amount_minor":amount,"reference_date":"2026-10-01","day_position":"START_OF_DAY"}})).unwrap()
}
fn workspace(i: &Installation, n: u64) {
    i.create(CreateWorkspace {
        workspace_id: id(n),
        display_name: "SYNTHETIC US040 WORKSPACE".into(),
        purpose: Purpose::Personal,
    })
    .unwrap();
}
fn change(value: serde_json::Value) -> AccountChange {
    serde_json::from_value(value).unwrap()
}
fn database(i: &Installation, keys: &Keys, workspace: u64) -> rusqlite::Connection {
    let (install, root) = i.probe_details();
    let key = keys
        .get(install, identity::resource_id(&id(workspace)).unwrap())
        .unwrap();
    open_database(
        &root.join("workspaces").join(id(workspace)).join("vault.db"),
        &key,
    )
    .unwrap()
}
#[test]
fn pure_native_plans_match_all_62_shared_domain_vectors() {
    assert_eq!(account_probe::verify_vectors().unwrap(), 62);
}
#[test]
fn encrypted_create_replay_and_reopen_preserve_i64_and_workspace_isolation() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys.clone()).unwrap();
    workspace(&i, 1);
    workspace(&i, 90);
    assert!(
        i.apply_account_change(&id(1), create(2, "9223372036854775807"), || Ok(()))
            .unwrap()
            .changed
    );
    assert!(
        !i.apply_account_change(&id(1), create(2, "9223372036854775807"), || Ok(()))
            .unwrap()
            .changed
    );
    let before = i.read_accounts(&id(1)).unwrap();
    assert!(before.accounts[0].references[0].amount_minor == "9223372036854775807");
    assert!(i.read_accounts(&id(90)).unwrap().accounts.is_empty());
    let (_, path) = i.probe_details();
    let bytes = std::fs::read(path.join("workspaces").join(id(1)).join("vault.db")).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3"));
    assert!(
        !bytes
            .windows(b"SYNTHETIC US040 ACCOUNT".len())
            .any(|p| p == b"SYNTHETIC US040 ACCOUNT")
    );
    drop(i);
    let reopened = Installation::open(root.path(), keys).unwrap();
    assert!(reopened.read_accounts(&id(1)).unwrap().accounts == before.accounts);
}
#[test]
fn explicit_metadata_base_archiving_and_legacy_values_preserve_references() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys.clone()).unwrap();
    workspace(&i, 1);
    i.apply_account_change(&id(1), create(2, "-9223372036854775808"), || Ok(()))
        .unwrap();
    let legacy = "  SYNTHETIC LEGACY ".to_owned() + &"x".repeat(140) + "  ";
    let db = database(&i, &keys, 1);
    db.execute(
        "UPDATE financial_account SET name=?,institution_name=''",
        [&legacy],
    )
    .unwrap();
    drop(db);
    let state = i.read_accounts(&id(1)).unwrap().accounts.remove(0);
    let refs = state.references.clone();
    let archive = serde_json::json!({"kind":"UPDATE","base":state.account,"name":legacy,"institution_name":"","status":"ARCHIVED"});
    i.apply_account_change(&id(1), change(archive.clone()), || Ok(()))
        .unwrap();
    assert!(
        !i.apply_account_change(&id(1), change(archive.clone()), || Ok(()))
            .unwrap()
            .changed
    );
    let after = i.read_accounts(&id(1)).unwrap().accounts.remove(0);
    assert!(after.references == refs);
    assert!(after.account.status == "ARCHIVED" && after.account.name == legacy);
    let mut stale = archive;
    stale["name"] = serde_json::json!("SYNTHETIC STALE");
    assert!(matches!(
        i.apply_account_change(&id(1), change(stale), || Ok(())),
        Err(LocalError::StaleAccount)
    ));
}
#[test]
fn reference_replacement_retains_history_and_rejects_stale_base() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys).unwrap();
    workspace(&i, 1);
    i.apply_account_change(&id(1), create(2, "100000"), || Ok(()))
        .unwrap();
    let update = serde_json::json!({"kind":"REFERENCE","account_id":id(2),"reference":{"id":id(1003),"amount_minor":"9007199254740993","reference_date":"2026-10-02","day_position":"END_OF_DAY"},"replaces_id":id(1002)});
    i.apply_account_change(&id(1), change(update.clone()), || Ok(()))
        .unwrap();
    assert!(
        !i.apply_account_change(&id(1), change(update.clone()), || Ok(()))
            .unwrap()
            .changed
    );
    let state = i.read_accounts(&id(1)).unwrap().accounts.remove(0);
    assert!(
        state.references.len() == 2
            && state.references[0].status == "SUPERSEDED"
            && state.references[1].amount_minor == "9007199254740993"
    );
    let mut stale = update;
    stale["reference"]["id"] = serde_json::json!(id(1004));
    assert!(matches!(
        i.apply_account_change(&id(1), change(stale), || Ok(())),
        Err(LocalError::StaleAccount)
    ));
}
#[test]
fn cancellation_before_commit_rolls_back_account_and_initial_reference() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys).unwrap();
    workspace(&i, 1);
    assert!(matches!(
        i.apply_account_change(&id(1), create(2, "1"), || Err(LocalError::LocalLocked)),
        Err(LocalError::LocalLocked)
    ));
    assert!(i.read_accounts(&id(1)).unwrap().accounts.is_empty());
}
#[test]
fn failed_reference_insert_and_cancellation_restore_superseded_status() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys).unwrap();
    workspace(&i, 1);
    for n in [2, 3] {
        i.apply_account_change(&id(1), create(n, "1"), || Ok(()))
            .unwrap();
    }
    let before = i.read_accounts(&id(1)).unwrap().accounts;
    let replace = |reference: u64| {
        change(
            serde_json::json!({"kind":"REFERENCE","account_id":id(2),"replaces_id":id(1002),"reference":{"id":id(reference),"amount_minor":"2","reference_date":"2026-10-02","day_position":"END_OF_DAY"}}),
        )
    };
    assert!(
        i.apply_account_change(&id(1), replace(1003), || Ok(()))
            .is_err()
    );
    assert!(i.read_accounts(&id(1)).unwrap().accounts == before);
    assert!(
        i.apply_account_change(&id(1), replace(1004), || Err(LocalError::LocalLocked))
            .is_err()
    );
    assert!(i.read_accounts(&id(1)).unwrap().accounts == before);
}
#[test]
fn pin_locked_commands_never_fetch_financial_keys() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let state = LocalState::with_policies(
        root.path().into(),
        keys.clone(),
        Arc::new(Policies::default()),
    );
    state
        .create(CreateWorkspace {
            workspace_id: id(1),
            display_name: "SYNTHETIC US040 LOCK".into(),
            purpose: Purpose::Personal,
        })
        .unwrap();
    state
        .configure(ConfigurePin {
            current_pin: None,
            new_pin: "721947350682".into(),
            confirm_pin: "721947350682".into(),
        })
        .unwrap();
    state.force_lock();
    keys.reads.store(0, Ordering::SeqCst);
    assert!(matches!(
        state.read_accounts(&id(1)),
        Err(LocalError::LocalLocked)
    ));
    assert!(matches!(
        state.apply_account_change(&id(1), create(2, "1")),
        Err(LocalError::LocalLocked)
    ));
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    state
        .unlock(PinInput {
            pin: "721947350682".into(),
        })
        .unwrap();
    assert!(state.read_accounts(&id(1)).unwrap().accounts.is_empty());
}
#[test]
fn concurrent_writes_from_one_base_return_one_explicit_conflict() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let state = Arc::new(LocalState::with_policies(
        root.path().into(),
        keys,
        Arc::new(Policies::default()),
    ));
    state
        .create(CreateWorkspace {
            workspace_id: id(1),
            display_name: "SYNTHETIC US040 CONCURRENT".into(),
            purpose: Purpose::Personal,
        })
        .unwrap();
    state.apply_account_change(&id(1), create(2, "1")).unwrap();
    let base = state
        .read_accounts(&id(1))
        .unwrap()
        .accounts
        .remove(0)
        .account;
    let workers=(0..2).map(|n|{let state=state.clone();let base=base.clone();std::thread::spawn(move||state.apply_account_change(&id(1),change(serde_json::json!({"kind":"UPDATE","base":base,"name":format!("SYNTHETIC {n}"),"institution_name":null,"status":"ACTIVE"}))))}).collect::<Vec<_>>();
    let results = workers
        .into_iter()
        .map(|w| w.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| matches!(r, Err(LocalError::StaleAccount)))
            .count(),
        1
    );
}
#[test]
fn oversized_command_is_rejected_before_fetching_financial_key() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys.clone()).unwrap();
    workspace(&i, 1);
    i.apply_account_change(&id(1), create(2, "1"), || Ok(()))
        .unwrap();
    let mut base = i.read_accounts(&id(1)).unwrap().accounts.remove(0).account;
    base.name = "x".repeat(1024 * 1024);
    keys.reads.store(0, Ordering::SeqCst);
    assert!(matches!(i.apply_account_change(&id(1),change(serde_json::json!({"kind":"UPDATE","name":base.name,"institution_name":null,"status":"ACTIVE","base":base})),||Ok(())),Err(LocalError::AccountLimit)));
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
}
#[test]
fn oversized_snapshot_fails_without_returning_a_partial_balance() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys.clone()).unwrap();
    workspace(&i, 1);
    let db = database(&i, &keys, 1);
    db.execute("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<200001) INSERT INTO financial_account(id,workspace_id,name,account_kind,balance_nature,currency_code,status) SELECT printf('0199d040-0000-7000-8000-%012d',x),?,'SYNTHETIC LIMIT','CASH','ASSET','BRL','ACTIVE' FROM n",[id(1)]).unwrap();
    drop(db);
    assert!(matches!(
        i.read_accounts(&id(1)),
        Err(LocalError::AccountLimit)
    ));
}
