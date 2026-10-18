#![cfg(feature = "card-payments-smoke")]
// All accounts and keys in these tests are explicitly synthetic and disposable.
use crate::{
    LocalError, Result, SecretKey,
    account_model::AccountChange,
    card_payment_model::Command,
    card_payment_probe,
    commands::LocalState,
    identity,
    keys::KeyStore,
    local_lock::{ConfigurePin, PinInput},
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    lock_store::PolicyStore,
    movement_model::AccountDescriptor,
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
    format!("0199d243-0000-7000-8000-{n:012}")
}
fn create(n: u64, amount: &str) -> AccountChange {
    serde_json::from_value(serde_json::json!({"kind":"CREATE","account":{"id":id(n),"name":"SYNTHETIC US043 ACCOUNT","institution_name":null,"account_kind":if n==3 {"CREDIT_CARD"} else {"CHECKING"},"balance_nature":if n==3 {"LIABILITY"} else {"ASSET"},"currency_code":"BRL"},"reference":{"id":id(n+1000),"amount_minor":amount,"reference_date":"2026-10-01","day_position":"START_OF_DAY"}})).unwrap()
}
fn workspace(i: &Installation, n: u64) {
    i.create(CreateWorkspace {
        workspace_id: id(n),
        display_name: "SYNTHETIC US043 WORKSPACE".into(),
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

fn command(v: serde_json::Value) -> Command {
    serde_json::from_value(v).unwrap()
}
fn setup() -> (tempfile::TempDir, Arc<Keys>, Installation) {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys.clone()).unwrap();
    workspace(&i, 1);
    workspace(&i, 90);
    for n in [2, 3] {
        i.apply_account_change(&id(1), create(n, "100000"), || Ok(()))
            .unwrap();
    }
    (root, keys, i)
}
fn input(i: &Installation, n: u64, amount: &str) -> serde_json::Value {
    let a = i.read_accounts(&id(1)).unwrap().accounts;
    serde_json::json!({"kind":"CREATE","id":id(n),"source_entry_id":id(n+1),"target_entry_id":id(n+2),"source_account":AccountDescriptor::from(&a[0].account),"target_account":AccountDescriptor::from(&a[1].account),"financial_date":"2026-10-18","amount_minor":amount,"display_name":"SYNTHETIC CARD_PAYMENT","original_description":"SYNTHETIC ORIGINAL"})
}
fn base(i: &Installation, n: u64) -> serde_json::Value {
    let s = i.read_card_payments(&id(1)).unwrap();
    serde_json::json!({"group_id":id(n),"source":s.movements.transactions.iter().find(|s|s.id==id(n+1)).unwrap(),"target":s.movements.transactions.iter().find(|s|s.id==id(n+2)).unwrap()})
}
fn apply(i: &Installation, v: serde_json::Value) {
    i.apply_card_payment(&id(1), command(v), || Ok(())).unwrap();
}
#[test]
fn all_72_shared_vectors_match_native_card_payment_plans() {
    assert_eq!(card_payment_probe::verify_vectors().unwrap(), 72);
}
#[test]
fn encrypted_pair_reopens_with_group_two_revisions_and_exact_large_money() {
    let (root, keys, i) = setup();
    apply(&i, input(&i, 10, "9007199254740993"));
    let s = i.read_card_payments(&id(1)).unwrap();
    assert_eq!(s.groups.len(), 1);
    assert_eq!(s.groups[0].member_ids, vec![id(11), id(12)]);
    assert_eq!(s.movements.history.len(), 2);
    assert!(s.movements.history.iter().all(|h| h.compatible));
    let pair = base(&i, 10);
    assert_eq!(
        pair["source"]["content"]["account_amount_minor"],
        "-9007199254740993"
    );
    assert_eq!(
        pair["target"]["content"]["account_amount_minor"],
        "-9007199254740993"
    );
    assert!(i.read_card_payments(&id(90)).unwrap().groups.is_empty());
    let (_, path) = i.probe_details();
    let bytes = std::fs::read(path.join("workspaces").join(id(1)).join("vault.db")).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3"));
    assert!(
        !bytes
            .windows(b"SYNTHETIC CARD_PAYMENT".len())
            .any(|p| p == b"SYNTHETIC CARD_PAYMENT")
    );
    drop(i);
    let j = Installation::open(root.path(), keys).unwrap();
    assert!(
        j.read_card_payments(&id(1)).unwrap().movements.transactions == s.movements.transactions
    );
}
#[test]
fn purchase_then_partial_payments_preserve_consumption_and_allow_credit() {
    let (_root, keys, i) = setup();
    let db = database(&i, &keys, 1);
    db.execute(
        "UPDATE balance_reference SET amount_minor=0,reference_date='2026-09-01' WHERE account_id=?",
        [id(3)],
    )
    .unwrap();
    drop(db);
    let accounts = i.read_accounts(&id(1)).unwrap().accounts;
    let purchase:crate::movement_model::ManualCommand=serde_json::from_value(serde_json::json!({"kind":"CREATE","id":id(50),"account":AccountDescriptor::from(&accounts[1].account),"financial_date":"2026-09-15","amount_minor":"12000","movement_kind":"EXPENSE","display_name":"SYNTHETIC CARD PURCHASE","original_description":"SYNTHETIC PURCHASE SOURCE"})).unwrap();
    i.apply_manual_movement(&id(1), purchase, || Ok(()))
        .unwrap();
    apply(&i, input(&i, 10, "5000"));
    apply(&i, input(&i, 20, "8000"));
    let snapshot = i.read_card_payments(&id(1)).unwrap();
    let card_delta: i64 = snapshot
        .movements
        .transactions
        .iter()
        .filter(|s| s.content.account_id == id(3))
        .map(|s| s.content.account_amount_minor.parse::<i64>().unwrap())
        .sum();
    assert_eq!(card_delta, -1000);
    let purchase = snapshot
        .movements
        .transactions
        .iter()
        .find(|s| s.id == id(50))
        .unwrap();
    assert_eq!(purchase.content.financial_date, "2026-09-15");
    assert_eq!(purchase.content.economic_kind, "EXPENSE");
    assert_eq!(purchase.version, "1");
    assert_eq!(
        snapshot
            .movements
            .transactions
            .iter()
            .filter(|s| s.content.economic_kind == "EXPENSE")
            .count(),
        1
    );
    assert!(
        snapshot
            .movements
            .transactions
            .iter()
            .filter(|s| s.content.group_id.is_some())
            .all(|s| s.content.economic_kind == "DEBT_SETTLEMENT"
                && s.content.financial_date == "2026-10-18")
    );
    assert_eq!(snapshot.movements.history.len(), 5);
    let db = database(&i, &keys, 1);
    let source_out:i64=db.query_row("SELECT sum(account_amount_minor) FROM financial_transaction WHERE account_id=? AND economic_kind='DEBT_SETTLEMENT'",[id(2)],|r|r.get(0)).unwrap();
    assert_eq!(source_out, -13000);
    let debt:i64=db.query_row("SELECT amount_minor+(SELECT sum(account_amount_minor) FROM financial_transaction WHERE account_id=? AND deleted_at IS NULL AND financial_date>=balance_reference.reference_date AND financial_date<='2026-10-18') FROM balance_reference WHERE account_id=? AND status='ACTIVE'",[id(3),id(3)],|r|r.get(0)).unwrap();
    assert_eq!(debt, -1000);
}
#[test]
fn edits_and_delete_restore_both_sides_without_erasing_history() {
    let (_root, _keys, i) = setup();
    apply(&i, input(&i, 10, "500"));
    let a = i.read_accounts(&id(1)).unwrap().accounts;
    apply(
        &i,
        serde_json::json!({"kind":"EDIT","base":base(&i,10),"source_account":AccountDescriptor::from(&a[0].account),"target_account":AccountDescriptor::from(&a[1].account),"financial_date":"2026-10-17","amount_minor":"250","display_name":"SYNTHETIC EDIT"}),
    );
    let p = base(&i, 10);
    assert_eq!(p["source"]["content"]["account_id"], id(2));
    assert_eq!(p["target"]["content"]["account_id"], id(3));
    for key in ["source", "target"] {
        assert_eq!(p[key]["version"], "2");
        assert_eq!(
            p[key]["content"]["original_description"],
            "SYNTHETIC ORIGINAL"
        );
    }
    apply(&i, serde_json::json!({"kind":"DELETE","base":p}));
    assert!(i.read_accounts(&id(1)).unwrap().movements.is_empty());
    let deleted = base(&i, 10);
    let no_op = i
        .apply_card_payment(
            &id(1),
            command(serde_json::json!({"kind":"DELETE","base":deleted})),
            || Ok(()),
        )
        .unwrap();
    assert!(
        no_op
            .entries
            .iter()
            .all(|r| !r.changed && r.revision_id.is_none())
    );
    apply(&i, serde_json::json!({"kind":"RESTORE","base":deleted}));
    let p = base(&i, 10);
    for key in ["source", "target"] {
        assert_eq!(p[key]["version"], "4");
        assert_eq!(p[key]["content"]["deleted"], false);
    }
    assert_eq!(
        i.read_card_payments(&id(1))
            .unwrap()
            .movements
            .history
            .len(),
        8
    );
}
#[test]
fn fail_after_first_side_and_before_commit_roll_back_group_members_and_audit() {
    let (_root, _keys, i) = setup();
    card_payment_probe::fail_after_first();
    assert!(matches!(
        i.apply_card_payment(&id(1), command(input(&i, 10, "1")), || Ok(())),
        Err(LocalError::StorageUnavailable)
    ));
    let s = i.read_card_payments(&id(1)).unwrap();
    assert!(
        s.groups.is_empty()
            && s.movements.transactions.is_empty()
            && s.movements.history.is_empty()
    );
    assert!(matches!(
        i.apply_card_payment(&id(1), command(input(&i, 10, "1")), || Err(
            LocalError::LocalLocked
        )),
        Err(LocalError::LocalLocked)
    ));
    let s = i.read_card_payments(&id(1)).unwrap();
    assert!(
        s.groups.is_empty()
            && s.movements.transactions.is_empty()
            && s.movements.history.is_empty()
    );
}
#[test]
fn stale_one_side_forged_base_and_replay_never_produce_half_a_card_payment() {
    let (_root, _keys, i) = setup();
    let first = input(&i, 10, "1");
    apply(&i, first.clone());
    assert!(matches!(
        i.apply_card_payment(&id(1), command(first), || Ok(())),
        Err(LocalError::VersionConflict)
    ));
    let old = base(&i, 10);
    let mut forged = old.clone();
    forged["target"]["content"]["display_name"] = serde_json::json!("SYNTHETIC FORGED");
    assert!(matches!(
        i.apply_card_payment(
            &id(1),
            command(serde_json::json!({"kind":"DELETE","base":forged})),
            || Ok(())
        ),
        Err(LocalError::CardPaymentBaseConflict)
    ));
    apply(&i, serde_json::json!({"kind":"DELETE","base":old}));
    assert!(matches!(
        i.apply_card_payment(
            &id(1),
            command(serde_json::json!({"kind":"RESTORE","base":old})),
            || Ok(())
        ),
        Err(LocalError::VersionConflict)
    ));
    assert_eq!(
        i.read_card_payments(&id(1))
            .unwrap()
            .movements
            .history
            .len(),
        4
    );
}
#[test]
fn broken_groups_and_archived_live_accounts_are_read_only() {
    let (_root, keys, i) = setup();
    apply(&i, input(&i, 10, "1"));
    let b = base(&i, 10);
    let db = database(&i, &keys, 1);
    db.execute(
        "UPDATE transaction_group SET state='BROKEN' WHERE id=?",
        [id(10)],
    )
    .unwrap();
    drop(db);
    assert!(matches!(
        i.apply_card_payment(
            &id(1),
            command(serde_json::json!({"kind":"DELETE","base":b})),
            || Ok(())
        ),
        Err(LocalError::CompositeRequired)
    ));
    let db = database(&i, &keys, 1);
    db.execute(
        "UPDATE transaction_group SET state='ACTIVE' WHERE id=?",
        [id(10)],
    )
    .unwrap();
    db.execute(
        "UPDATE financial_account SET status='ARCHIVED' WHERE id=?",
        [id(3)],
    )
    .unwrap();
    drop(db);
    assert!(matches!(
        i.apply_card_payment(
            &id(1),
            command(serde_json::json!({"kind":"DELETE","base":b})),
            || Ok(())
        ),
        Err(LocalError::CardPaymentAccountArchived)
    ));
    assert_eq!(
        i.read_card_payments(&id(1))
            .unwrap()
            .movements
            .history
            .len(),
        2
    );
}
#[test]
fn allocations_notes_and_tags_survive_resize_failed_save_and_restore() {
    let (_root, keys, i) = setup();
    apply(&i, input(&i, 10, "500"));
    let mut db = database(&i, &keys, 1);
    let tx = db.transaction().unwrap();
    tx.execute("INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) VALUES(?,?,'SYNTHETIC','synthetic','BOTH',1,'ACTIVE',0)",[id(30),id(1)]).unwrap();
    tx.execute("INSERT INTO tag(id,workspace_id,name,normalized_name,status) VALUES(?,?,'SYNTHETIC','synthetic','ACTIVE')",[id(31),id(1)]).unwrap();
    tx.execute("INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor,note) VALUES(?,?,?,?,NULL,500,'SYNTHETIC NOTE')",[id(32),id(1),id(11),id(30)]).unwrap();
    tx.execute(
        "INSERT INTO transaction_tag(workspace_id,transaction_id,tag_id) VALUES(?,?,?)",
        [id(1), id(11), id(31)],
    )
    .unwrap();
    tx.commit().unwrap();
    drop(db);
    let a = i.read_accounts(&id(1)).unwrap().accounts;
    let edit = |b: serde_json::Value, amount: &str| {
        command(
            serde_json::json!({"kind":"EDIT","base":b,"source_account":AccountDescriptor::from(&a[0].account),"target_account":AccountDescriptor::from(&a[1].account),"financial_date":"2026-10-18","amount_minor":amount,"display_name":"SYNTHETIC CLASSIFIED"}),
        )
    };
    i.apply_card_payment(&id(1), edit(base(&i, 10), "250"), || Ok(()))
        .unwrap();
    let b = base(&i, 10);
    assert_eq!(
        b["source"]["content"]["allocations"][0]["amount_minor"],
        "250"
    );
    assert_eq!(
        b["source"]["content"]["allocations"][0]["note"],
        "SYNTHETIC NOTE"
    );
    card_payment_probe::fail_after_first();
    assert!(
        i.apply_card_payment(&id(1), edit(b.clone(), "300"), || Ok(()))
            .is_err()
    );
    assert_eq!(base(&i, 10), b);
    apply(&i, serde_json::json!({"kind":"DELETE","base":b}));
    apply(&i, serde_json::json!({"kind":"RESTORE","base":base(&i,10)}));
    assert_eq!(
        base(&i, 10)["source"]["content"]["tag_ids"],
        serde_json::json!([id(31)])
    );
}
#[test]
fn pin_lock_denies_reads_and_card_payments_without_fetching_financial_keys() {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let s = LocalState::with_policies(
        root.path().into(),
        keys.clone(),
        Arc::new(Policies::default()),
    );
    s.create(CreateWorkspace {
        workspace_id: id(1),
        display_name: "SYNTHETIC US043 LOCK".into(),
        purpose: Purpose::Personal,
    })
    .unwrap();
    for n in [2, 3] {
        s.apply_account_change(&id(1), create(n, "1")).unwrap();
    }
    let a = s.read_accounts(&id(1)).unwrap().accounts;
    let c = command(
        serde_json::json!({"kind":"CREATE","id":id(10),"source_entry_id":id(11),"target_entry_id":id(12),"source_account":AccountDescriptor::from(&a[0].account),"target_account":AccountDescriptor::from(&a[1].account),"financial_date":"2026-10-18","amount_minor":"1","display_name":"SYNTHETIC","original_description":null}),
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
        s.read_card_payments(&id(1)),
        Err(LocalError::LocalLocked)
    ));
    assert!(matches!(
        s.apply_card_payment(&id(1), c),
        Err(LocalError::LocalLocked)
    ));
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    s.unlock(PinInput {
        pin: "721947350682".into(),
    })
    .unwrap();
    assert!(s.read_card_payments(&id(1)).unwrap().groups.is_empty());
}
#[test]
fn oversized_command_fails_before_financial_key_and_history_is_never_truncated() {
    let (_root, keys, i) = setup();
    let mut c = input(&i, 10, "1");
    c["display_name"] = serde_json::json!("x".repeat(1024 * 1024));
    keys.reads.store(0, Ordering::SeqCst);
    assert!(matches!(
        i.apply_card_payment(&id(1), command(c), || Ok(())),
        Err(LocalError::MovementLimit)
    ));
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    apply(&i, input(&i, 10, "1"));
    let db = database(&i, &keys, 1);
    db.execute("INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,actor_id,device_id,change_source,created_at) SELECT ?,workspace_id,transaction_id,2,?,actor_type,actor_id,device_id,change_source,created_at FROM transaction_revision LIMIT 1",[id(990),serde_json::to_string(&serde_json::json!({"synthetic":"x".repeat(32*1024*1024+1)})).unwrap()]).unwrap();
    drop(db);
    assert!(matches!(
        i.read_card_payments(&id(1)),
        Err(LocalError::MovementLimit)
    ));
}
#[test]
fn competing_paired_base_writes_return_one_version_conflict() {
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
            display_name: "SYNTHETIC CONCURRENT".into(),
            purpose: Purpose::Personal,
        })
        .unwrap();
    for n in [2, 3] {
        state.apply_account_change(&id(1), create(n, "1")).unwrap();
    }
    let a = state.read_accounts(&id(1)).unwrap().accounts;
    state.apply_card_payment(&id(1),command(serde_json::json!({"kind":"CREATE","id":id(10),"source_entry_id":id(11),"target_entry_id":id(12),"source_account":AccountDescriptor::from(&a[0].account),"target_account":AccountDescriptor::from(&a[1].account),"financial_date":"2026-10-18","amount_minor":"1","display_name":"SYNTHETIC","original_description":null}))).unwrap();
    let snapshot = state.read_card_payments(&id(1)).unwrap();
    let b = serde_json::json!({"group_id":id(10),"source":snapshot.movements.transactions.iter().find(|s|s.id==id(11)).unwrap(),"target":snapshot.movements.transactions.iter().find(|s|s.id==id(12)).unwrap()});
    let workers = (0..2)
        .map(|_| {
            let state = state.clone();
            let b = b.clone();
            std::thread::spawn(move || {
                state.apply_card_payment(
                    &id(1),
                    command(serde_json::json!({"kind":"DELETE","base":b})),
                )
            })
        })
        .collect::<Vec<_>>();
    let results = workers
        .into_iter()
        .map(|w| w.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| matches!(r, Err(LocalError::VersionConflict)))
            .count(),
        1
    );
    assert_eq!(
        state
            .read_card_payments(&id(1))
            .unwrap()
            .movements
            .history
            .len(),
        4
    );
}
