#![cfg(feature = "taxonomy-smoke")]
use crate::{
    LocalError, Result, SecretKey,
    commands::LocalState,
    keys::KeyStore,
    local_classification_filters::validate,
    local_lock::{ConfigurePin, PinInput},
    local_workspaces::{CreateWorkspace, Installation, Purpose},
    lock_store::PolicyStore,
    vault_probe as vault,
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
pub(crate) struct Keys {
    values: Mutex<HashMap<(Uuid, Uuid), SecretKey>>,
    pub(crate) reads: AtomicUsize,
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
        if v.contains_key(&(i, w)) {
            return Err(LocalError::IntegrityFailure);
        }
        v.insert((i, w), k.clone());
        Ok(())
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
        self.values.lock().unwrap().remove(&(i, w));
        Ok(())
    }
}
#[derive(Default)]
pub(crate) struct Policies(Mutex<Option<Zeroizing<Vec<u8>>>>);
impl PolicyStore for Policies {
    fn read(&self, _: Uuid) -> Result<Option<Zeroizing<Vec<u8>>>> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn write(&self, _: Uuid, b: &[u8]) -> Result<()> {
        *self.0.lock().unwrap() = Some(Zeroizing::new(b.to_vec()));
        Ok(())
    }
}
pub(crate) fn setup() -> (tempfile::TempDir, Arc<Keys>, Installation, String) {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = vault::fixture(root.path(), keys.clone()).unwrap();
    let mut db = vault::open_fixture(root.path(), keys.as_ref()).unwrap();
    vault::migrate(&mut db).unwrap();
    (root, keys, i, vault::dataset_workspace().to_string())
}
#[test]
fn complete_read_preserves_ciphertext_financial_rows_and_audit_after_reopen() {
    let (root, keys, i, w) = setup();
    let before = std::fs::read(vault::vault_path(root.path())).unwrap();
    let s = i.read_movement_classifications(&w).unwrap();
    assert!(!s.transactions.is_empty());
    assert!(s.classification.is_some());
    let db = vault::open_fixture(root.path(), keys.as_ref()).unwrap();
    let graph = vault::snapshot(&db).unwrap();
    drop(db);
    drop(i);
    let reopened = Installation::open(root.path(), keys.clone()).unwrap();
    let again = reopened.read_movement_classifications(&w).unwrap();
    assert_eq!(
        serde_json::to_value(&s.transactions).unwrap(),
        serde_json::to_value(&again.transactions).unwrap()
    );
    assert_eq!(
        std::fs::read(vault::vault_path(root.path())).unwrap(),
        before
    );
    assert_eq!(
        vault::snapshot(&vault::open_fixture(root.path(), keys.as_ref()).unwrap()).unwrap(),
        graph
    );
}
#[test]
fn workspace_selection_has_complete_empty_coverage_and_cannot_cross_scope() {
    let (_root, _keys, i, w) = setup();
    let other = "0199d045-0000-7000-8000-000000000090";
    i.create(CreateWorkspace {
        workspace_id: other.into(),
        display_name: "SYNTHETIC FILTER EMPTY".into(),
        purpose: Purpose::Personal,
    })
    .unwrap();
    let s = i.read_movement_classifications(other).unwrap();
    assert!(s.transactions.is_empty());
    assert!(s.classification.unwrap().items.is_empty());
    assert!(
        !i.read_movement_classifications(&w)
            .unwrap()
            .transactions
            .is_empty()
    );
    assert_eq!(
        i.read_movement_classifications("0199d045-0000-7000-8000-000000000099")
            .err(),
        Some(LocalError::NotFound)
    );
}
#[test]
fn missing_references_or_wrong_subcategory_parent_are_refused() {
    let (_root, _keys, i, w) = setup();
    let s = i.read_movement_classifications(&w).unwrap();
    let catalog = s.classification.unwrap();
    let mut absent = catalog.clone();
    absent.items.retain(|r| r.kind() != "TAG");
    assert_eq!(
        validate(&s.transactions, &absent).err(),
        Some(LocalError::IntegrityFailure)
    );
    let mut wrong = catalog.clone();
    for item in &mut wrong.items {
        if let crate::taxonomy_model::Item::Subcategory { category_id, .. } = item {
            *category_id = "0199d045-0000-7000-8000-000000000099".into();
        }
    }
    assert_eq!(
        validate(&s.transactions, &wrong).err(),
        Some(LocalError::IntegrityFailure)
    );
    let mut foreign = catalog;
    foreign.workspace_id = "0199d045-0000-7000-8000-000000000090".into();
    assert_eq!(
        validate(&s.transactions, &foreign).err(),
        Some(LocalError::IntegrityFailure)
    );
}
#[test]
fn archived_used_references_remain_readable() {
    let (root, keys, i, w) = setup();
    let db = vault::open_fixture(root.path(), keys.as_ref()).unwrap();
    db.execute_batch("UPDATE category SET status='ARCHIVED'; UPDATE subcategory SET status='ARCHIVED'; UPDATE tag SET status='ARCHIVED';").unwrap();
    drop(db);
    let s = i.read_movement_classifications(&w).unwrap();
    assert!(
        s.transactions
            .iter()
            .any(|r| !r.content.allocations.is_empty() && !r.content.tag_ids.is_empty())
    );
    assert!(
        s.classification
            .unwrap()
            .items
            .iter()
            .all(|r| r.status() == "ARCHIVED")
    );
}
#[test]
fn record_and_utf16_limits_refuse_without_truncation() {
    let (root, keys, i, w) = setup();
    let s = i.read_movement_classifications(&w).unwrap();
    let catalog = s.classification.unwrap();
    assert_eq!(
        validate(&vec![s.transactions[0].clone(); 10_001], &catalog).err(),
        Some(LocalError::MovementLimit)
    );
    let mut huge = s.transactions;
    huge[0].content.display_name = "😀".repeat(2_100_000);
    assert_eq!(
        validate(&huge, &catalog).err(),
        Some(LocalError::MovementLimit)
    );
    let db = vault::open_fixture(root.path(), keys.as_ref()).unwrap();
    db.execute_batch("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10001) INSERT INTO financial_transaction(id,workspace_id,account_id,group_id,counterparty_id,financial_date,account_amount_minor,economic_kind,original_description,display_name,origin_kind,version,deleted_at,created_at,updated_at) SELECT printf('0199d045-0000-7000-8000-%012d',x),t.workspace_id,t.account_id,NULL,t.counterparty_id,t.financial_date,t.account_amount_minor,t.economic_kind,t.original_description,'SYNTHETIC LIMIT',t.origin_kind,1,NULL,t.created_at,t.updated_at FROM n CROSS JOIN (SELECT * FROM financial_transaction LIMIT 1) t;").unwrap();
    drop(db);
    assert_eq!(
        i.read_movement_classifications(&w).err(),
        Some(LocalError::MovementLimit)
    );
}
#[test]
fn pin_lock_refuses_read_before_key_access_and_unlock_restores_coverage() {
    let (root, keys, i, w) = setup();
    drop(i);
    let state = LocalState::with_policies(
        root.path().to_path_buf(),
        keys.clone(),
        Arc::new(Policies::default()),
    );
    state
        .configure(ConfigurePin {
            current_pin: None,
            new_pin: "721947350682".into(),
            confirm_pin: "721947350682".into(),
        })
        .unwrap();
    state.force_lock();
    keys.reads.store(0, Ordering::SeqCst);
    assert_eq!(
        state.read_movement_classifications(&w).err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    state
        .unlock(PinInput {
            pin: "721947350682".into(),
        })
        .unwrap();
    assert!(
        !state
            .read_movement_classifications(&w)
            .unwrap()
            .transactions
            .is_empty()
    );
}
