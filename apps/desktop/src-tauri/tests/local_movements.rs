#![cfg(feature = "accounts-smoke")]
// All accounts and keys in these tests are explicitly synthetic and disposable.
use financial_manager_desktop::{
    LocalError, Result, SecretKey,
    account_model::AccountChange,
    commands::LocalState,
    identity,
    keys::KeyStore,
    local_lock::{ConfigurePin, PinInput},
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    lock_store::PolicyStore,
    movement_model::{AccountDescriptor, ManualCommand, State},
    movement_probe,
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
    format!("0199d141-0000-7000-8000-{n:012}")
}
fn create(n: u64, amount: &str) -> AccountChange {
    serde_json::from_value(serde_json::json!({"kind":"CREATE","account":{"id":id(n),"name":"SYNTHETIC US041 ACCOUNT","institution_name":null,"account_kind":"CHECKING","balance_nature":"ASSET","currency_code":"BRL"},"reference":{"id":id(n+1000),"amount_minor":amount,"reference_date":"2026-10-01","day_position":"START_OF_DAY"}})).unwrap()
}
fn workspace(i: &Installation, n: u64) {
    i.create(CreateWorkspace {
        workspace_id: id(n),
        display_name: "SYNTHETIC US041 WORKSPACE".into(),
        purpose: Purpose::Personal,
    })
    .unwrap();
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

fn command(v: serde_json::Value) -> ManualCommand {
    serde_json::from_value(v).unwrap()
}
fn add(i: &Installation, n: u64, kind: &str, amount: &str) -> serde_json::Value {
    let a = i
        .read_accounts(&id(1))
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.account.id == id(2))
        .unwrap()
        .account;
    serde_json::json!({"kind":"CREATE","id":id(n),"account":AccountDescriptor::from(&a),"financial_date":"2026-10-17","amount_minor":amount,"movement_kind":kind,"display_name":"SYNTHETIC US041 MOVEMENT","original_description":"SYNTHETIC ORIGINAL"})
}
fn setup() -> (tempfile::TempDir, Arc<Keys>, Installation) {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys.clone()).unwrap();
    workspace(&i, 1);
    workspace(&i, 90);
    for n in [2, 3] {
        i.apply_account_change(&id(1), create(n, "1000"), || Ok(()))
            .unwrap();
    }
    (root, keys, i)
}
fn apply(i: &Installation, v: serde_json::Value) {
    i.apply_manual_movement(&id(1), command(v), || Ok(()))
        .unwrap();
}
fn base(i: &Installation, n: u64) -> State {
    i.read_movements(&id(1))
        .unwrap()
        .transactions
        .into_iter()
        .find(|s| s.id == id(n))
        .unwrap()
}
#[test]
fn all_80_shared_manual_and_revision_plans_match_native() {
    assert_eq!(movement_probe::verify_vectors().unwrap(), 80);
}
#[test]
fn encrypted_creation_history_isolation_and_reopen() {
    let (root, keys, i) = setup();
    apply(&i, add(&i, 10, "INCOME", "9007199254740993"));
    apply(&i, add(&i, 11, "EXPENSE", "200"));
    let snapshot = i.read_movements(&id(1)).unwrap();
    assert_eq!(snapshot.transactions.len(), 2);
    assert_eq!(snapshot.history.len(), 2);
    assert!(snapshot.history.iter().all(|h| h.compatible));
    assert_eq!(
        base(&i, 10).content.account_amount_minor,
        "9007199254740993"
    );
    assert_eq!(base(&i, 11).content.account_amount_minor, "-200");
    assert!(i.read_movements(&id(90)).unwrap().transactions.is_empty());
    assert!(
        snapshot
            .transactions
            .iter()
            .all(|s| s.content.account_id == id(2))
    );
    let (_, path) = i.probe_details();
    let bytes = std::fs::read(path.join("workspaces").join(id(1)).join("vault.db")).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3"));
    assert!(!bytes.windows(17).any(|p| p == b"SYNTHETIC US041 MO"));
    drop(i);
    let reopened = Installation::open(root.path(), keys).unwrap();
    assert!(reopened.read_movements(&id(1)).unwrap().transactions == snapshot.transactions);
}
#[test]
fn edit_moves_one_account_preserves_original_and_delete_restore_revisions() {
    let (_root, _keys, i) = setup();
    apply(&i, add(&i, 10, "INCOME", "500"));
    let a = i
        .read_accounts(&id(1))
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.account.id == id(3))
        .unwrap()
        .account;
    apply(
        &i,
        serde_json::json!({"kind":"EDIT","base":base(&i,10),"account":AccountDescriptor::from(&a),"financial_date":"2026-10-16","amount_minor":"250","movement_kind":"EXPENSE","display_name":"SYNTHETIC EDIT"}),
    );
    let edited = base(&i, 10);
    assert_eq!(edited.content.account_id, id(3));
    assert_eq!(edited.content.account_amount_minor, "-250");
    assert_eq!(
        edited.content.original_description.as_deref(),
        Some("SYNTHETIC ORIGINAL")
    );
    assert_eq!(edited.version, "2");
    apply(&i, serde_json::json!({"kind":"DELETE","base":edited}));
    let deleted = base(&i, 10);
    assert!(deleted.content.deleted && deleted.deleted_at.is_some());
    assert!(i.read_accounts(&id(1)).unwrap().movements.is_empty());
    let no_op = i
        .apply_manual_movement(
            &id(1),
            command(serde_json::json!({"kind":"DELETE","base":deleted})),
            || Ok(()),
        )
        .unwrap();
    assert!(!no_op.changed && no_op.version == "3" && no_op.revision_id.is_none());
    apply(&i, serde_json::json!({"kind":"RESTORE","base":base(&i,10)}));
    assert_eq!(base(&i, 10).version, "4");
    assert!(!base(&i, 10).content.deleted);
    assert_eq!(i.read_movements(&id(1)).unwrap().history.len(), 4);
}
#[test]
fn stale_base_forged_base_and_replay_never_overwrite() {
    let (_root, _keys, i) = setup();
    let input = add(&i, 10, "INCOME", "1");
    apply(&i, input.clone());
    assert!(matches!(
        i.apply_manual_movement(&id(1), command(input), || Ok(())),
        Err(LocalError::VersionConflict)
    ));
    let mut forged = base(&i, 10);
    forged.content.display_name = "SYNTHETIC FORGED".into();
    assert!(matches!(
        i.apply_manual_movement(
            &id(1),
            command(serde_json::json!({"kind":"DELETE","base":forged})),
            || Ok(())
        ),
        Err(LocalError::ManualBaseConflict)
    ));
    let old = base(&i, 10);
    apply(&i, serde_json::json!({"kind":"DELETE","base":old}));
    assert!(matches!(
        i.apply_manual_movement(
            &id(1),
            command(serde_json::json!({"kind":"RESTORE","base":old})),
            || Ok(())
        ),
        Err(LocalError::VersionConflict)
    ));
    assert_eq!(base(&i, 10).version, "2");
}
#[test]
fn failures_after_writes_rollback_transaction_and_audit() {
    let (_root, _keys, i) = setup();
    for failure in [LocalError::StorageUnavailable, LocalError::LocalLocked] {
        assert!(
            i.apply_manual_movement(&id(1), command(add(&i, 10, "INCOME", "1")), || Err(failure))
                .is_err()
        );
        let s = i.read_movements(&id(1)).unwrap();
        assert!(s.transactions.is_empty() && s.history.is_empty());
    }
}
#[test]
fn adjustment_preserves_signed_i64_and_legacy_history_is_not_interpreted() {
    let (_root, keys, i) = setup();
    let a = i.read_accounts(&id(1)).unwrap().accounts.remove(0).account;
    apply(
        &i,
        serde_json::json!({"kind":"ADJUST","id":id(10),"account":AccountDescriptor::from(&a),"financial_date":"2026-10-17","delta_minor":"-9223372036854775808","reason":"SYNTHETIC RECONCILIATION"}),
    );
    let mut b = base(&i, 10);
    assert_eq!(b.content.economic_kind, "ADJUSTMENT");
    assert_eq!(b.content.account_amount_minor, "-9223372036854775808");
    let db = database(&i, &keys, 1);
    db.execute(
        "UPDATE financial_transaction SET version=2 WHERE id=?",
        [id(10)],
    )
    .unwrap();
    b.version = "2".into();
    db.execute("INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,actor_id,device_id,change_source,created_at) SELECT ?,workspace_id,transaction_id,2,?,actor_type,actor_id,device_id,change_source,created_at FROM transaction_revision LIMIT 1",[id(901),"{\"legacy\":true}".into()])
    .unwrap();
    let s = i.read_movements(&id(1)).unwrap();
    assert!(!s.history[1].compatible && s.history[1].snapshot.is_none());
    assert!(s.transactions[0] == b);
}
#[test]
fn archived_accounts_and_imported_records_are_read_only() {
    let (_root, keys, i) = setup();
    apply(&i, add(&i, 10, "EXPENSE", "1"));
    let db = database(&i, &keys, 1);
    db.execute(
        "UPDATE financial_transaction SET origin_kind='IMPORT' WHERE id=?",
        [id(10)],
    )
    .unwrap();
    assert!(matches!(
        i.apply_manual_movement(
            &id(1),
            command(serde_json::json!({"kind":"DELETE","base":base(&i,10)})),
            || Ok(())
        ),
        Err(LocalError::ManualMovementReadOnly)
    ));
    db.execute(
        "UPDATE financial_account SET status='ARCHIVED' WHERE id=?",
        [id(2)],
    )
    .unwrap();
    assert!(matches!(
        i.apply_manual_movement(&id(1), command(add(&i, 11, "EXPENSE", "1")), || Ok(())),
        Err(LocalError::ManualAccountArchived)
    ));
    assert_eq!(i.read_movements(&id(1)).unwrap().history.len(), 1);
}
#[test]
fn pin_lock_prevents_both_movement_commands_before_key_fetch() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let s = LocalState::with_policies(
        root.path().into(),
        keys.clone(),
        Arc::new(Policies::default()),
    );
    s.create(CreateWorkspace {
        workspace_id: id(1),
        display_name: "SYNTHETIC US041".into(),
        purpose: Purpose::Personal,
    })
    .unwrap();
    s.apply_account_change(&id(1), create(2, "1")).unwrap();
    let a = s.read_accounts(&id(1)).unwrap().accounts.remove(0).account;
    let c = command(
        serde_json::json!({"kind":"ADJUST","id":id(10),"account":AccountDescriptor::from(&a),"financial_date":"2026-10-17","delta_minor":"1","reason":"SYNTHETIC"}),
    );
    s.configure(ConfigurePin {
        current_pin: None,
        new_pin: "721947350682".into(),
        confirm_pin: "721947350682".into(),
    })
    .unwrap();
    s.force_lock();
    keys.reads.store(0, Ordering::SeqCst);
    assert!(matches!(
        s.read_movements(&id(1)),
        Err(LocalError::LocalLocked)
    ));
    assert!(matches!(
        s.apply_manual_movement(&id(1), c),
        Err(LocalError::LocalLocked)
    ));
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    s.unlock(PinInput {
        pin: "721947350682".into(),
    })
    .unwrap();
    assert!(s.read_movements(&id(1)).unwrap().transactions.is_empty());
}
#[test]
fn oversized_commands_and_history_fail_without_partial_result() {
    let (_root, keys, i) = setup();
    let mut c = add(&i, 10, "INCOME", "1");
    c["display_name"] = serde_json::json!("x".repeat(1024 * 1024));
    keys.reads.store(0, Ordering::SeqCst);
    assert!(matches!(
        i.apply_manual_movement(&id(1), command(c), || Ok(())),
        Err(LocalError::MovementLimit)
    ));
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    apply(&i, add(&i, 10, "INCOME", "1"));
    let db = database(&i, &keys, 1);
    db.execute(
        "INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,actor_id,device_id,change_source,created_at) SELECT ?,workspace_id,transaction_id,2,?,actor_type,actor_id,device_id,change_source,created_at FROM transaction_revision LIMIT 1",
        [id(901),serde_json::to_string(&serde_json::json!({"synthetic":"x".repeat(32 * 1024 * 1024 + 1)})).unwrap()],
    )
    .unwrap();
    assert!(matches!(
        i.read_movements(&id(1)),
        Err(LocalError::MovementLimit)
    ));
}

#[test]
fn allocation_resize_and_tags_survive_save_rollback_delete_and_restore() {
    let (_root, keys, i) = setup();
    apply(&i, add(&i, 10, "EXPENSE", "500"));
    // Synthetic legacy classification, through the unchanged schema constraints.
    let mut db = database(&i, &keys, 1);
    let tx = db.transaction().unwrap();
    tx.execute("INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) VALUES(?,?,'SYNTHETIC','synthetic','EXPENSE',1,'ACTIVE',0)", [id(20),id(1)]).unwrap();
    tx.execute("INSERT INTO tag(id,workspace_id,name,normalized_name,status) VALUES(?,?,'SYNTHETIC','synthetic','ACTIVE')",[id(21),id(1)]).unwrap();
    tx.execute("INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor,note) VALUES(?,?,?,?,NULL,500,'SYNTHETIC NOTE')",[id(22),id(1),id(10),id(20)]).unwrap();
    tx.execute(
        "INSERT INTO transaction_tag(workspace_id,transaction_id,tag_id) VALUES(?,?,?)",
        [id(1), id(10), id(21)],
    )
    .unwrap();
    tx.commit().unwrap();
    drop(db);
    let a = i
        .read_accounts(&id(1))
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.account.id == id(3))
        .unwrap()
        .account;
    let edit = |base: State, amount: &str| {
        command(
            serde_json::json!({"kind":"EDIT","base":base,"account":AccountDescriptor::from(&a),"financial_date":"2026-10-17","amount_minor":amount,"movement_kind":"EXPENSE","display_name":"SYNTHETIC CLASSIFIED"}),
        )
    };
    i.apply_manual_movement(&id(1), edit(base(&i, 10), "250"), || Ok(()))
        .unwrap();
    let saved = base(&i, 10);
    assert_eq!(saved.content.allocations[0].amount_minor, "250");
    assert_eq!(
        saved.content.allocations[0].note.as_deref(),
        Some("SYNTHETIC NOTE")
    );
    assert_eq!(saved.content.tag_ids, vec![id(21)]);
    assert_eq!(saved.content.account_id, id(3));
    assert!(
        i.apply_manual_movement(&id(1), edit(saved.clone(), "300"), || Err(
            LocalError::StorageUnavailable
        ))
        .is_err()
    );
    assert!(base(&i, 10) == saved);
    assert_eq!(i.read_movements(&id(1)).unwrap().history.len(), 2);
    apply(&i, serde_json::json!({"kind":"DELETE","base":saved}));
    apply(&i, serde_json::json!({"kind":"RESTORE","base":base(&i,10)}));
    let restored = base(&i, 10);
    assert_eq!(restored.version, "4");
    assert_eq!(restored.content.allocations[0].amount_minor, "250");
    assert_eq!(restored.content.tag_ids, vec![id(21)]);
}
