#![cfg(feature = "taxonomy-smoke")]
use crate::{
    LocalError, Result, SecretKey,
    commands::LocalState,
    identity,
    keys::KeyStore,
    local_lock::{ConfigurePin, PinInput},
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
    lock_store::PolicyStore,
    taxonomy_model::{Command, Item},
    taxonomy_probe,
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
    format!("0199d245-0000-7000-8000-{n:012}")
}
fn setup() -> (tempfile::TempDir, Arc<Keys>, Installation) {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys.clone()).unwrap();
    for n in [1, 2] {
        i.create(CreateWorkspace {
            workspace_id: id(n),
            display_name: "SYNTHETIC US045".into(),
            purpose: Purpose::Personal,
        })
        .unwrap();
    }
    (root, keys, i)
}
fn seed(i: &Installation, w: &str) {
    i.apply_category_change(
        w,
        crate::category_model::Command::Seed {
            profile_version: 1,
            purpose: "PERSONAL".into(),
            ids: (100..109).map(id).collect(),
        },
        || Ok(()),
    )
    .unwrap();
}
fn tag(n: u64) -> Item {
    Item::Tag {
        id: id(n),
        workspace_id: id(1),
        name: format!("SYNTHETIC TAG {n}"),
        status: "ACTIVE".into(),
    }
}
fn sub(n: u64, parent: u64) -> Item {
    Item::Subcategory {
        id: id(n),
        workspace_id: id(1),
        name: format!("SYNTHETIC SUB {n}"),
        status: "ACTIVE".into(),
        category_id: id(parent),
        sort_order: 10,
    }
}
fn update(base: Item, name: &str, status: &str) -> Command {
    let mut json = serde_json::to_value(&base).unwrap();
    json["name"] = name.into();
    json["status"] = status.into();
    Command::Update {
        base,
        item: serde_json::from_value(json).unwrap(),
    }
}
#[test]
fn shared_vectors_match_native_policy() {
    assert!(taxonomy_probe::verify_vectors().unwrap() >= 77);
}
#[test]
fn create_replay_rollback_and_encrypted_reopen() {
    let (root, keys, i) = setup();
    seed(&i, &id(1));
    taxonomy_probe::fail_after_first();
    assert_eq!(
        i.apply_taxonomy_change(&id(1), Command::Create { item: tag(500) }, || Ok(()))
            .err(),
        Some(LocalError::StorageUnavailable)
    );
    assert!(i.read_taxonomy(&id(1)).unwrap().items.is_empty());
    assert_eq!(
        i.apply_taxonomy_change(&id(1), Command::Create { item: tag(500) }, || Err(
            LocalError::LocalLocked
        ))
        .err(),
        Some(LocalError::LocalLocked)
    );
    assert!(i.read_taxonomy(&id(1)).unwrap().items.is_empty());
    assert!(
        i.apply_taxonomy_change(&id(1), Command::Create { item: tag(500) }, || Ok(()))
            .unwrap()
            .changed
    );
    assert!(
        !i.apply_taxonomy_change(&id(1), Command::Create { item: tag(500) }, || Ok(()))
            .unwrap()
            .changed
    );
    drop(i);
    let reopened = Installation::open(root.path(), keys).unwrap();
    assert_eq!(
        reopened.read_taxonomy(&id(1)).unwrap().items,
        vec![tag(500)]
    );
    let bytes = std::fs::read(root.path().join("workspaces").join(id(1)).join("vault.db")).unwrap();
    assert!(!bytes.starts_with(b"SQLite format 3"));
    assert!(!bytes.windows(17).any(|b| b == b"SYNTHETIC TAG 500"));
}
#[test]
fn metadata_order_is_atomic_and_workspace_scoped() {
    let (_root, _keys, i) = setup();
    seed(&i, &id(1));
    for item in [sub(501, 100), sub(502, 100), sub(503, 101), tag(504)] {
        i.apply_taxonomy_change(&id(1), Command::Create { item }, || Ok(()))
            .unwrap();
    }
    let before = i.read_taxonomy(&id(1)).unwrap();
    let bases = before
        .items
        .iter()
        .filter(|r| r.parent() == Some(id(100).as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let command = Command::ReorderSubcategories {
        category_id: id(100),
        ids: bases.iter().rev().map(|r| r.id().into()).collect(),
        bases,
    };
    taxonomy_probe::fail_after_first();
    assert_eq!(
        i.apply_taxonomy_change(&id(1), command.clone(), || Ok(()))
            .err(),
        Some(LocalError::StorageUnavailable)
    );
    assert_eq!(i.read_taxonomy(&id(1)).unwrap().items, before.items);
    let after = i
        .apply_taxonomy_change(&id(1), command.clone(), || Ok(()))
        .unwrap();
    assert!(after.changed);
    assert_eq!(
        i.apply_taxonomy_change(&id(1), command, || Ok(())).err(),
        Some(LocalError::TaxonomyBaseConflict)
    );
    assert_eq!(
        after.items.iter().find(|r| r.id() == id(503)).unwrap(),
        &sub(503, 101)
    );
    assert!(i.read_taxonomy(&id(2)).unwrap().items.is_empty());
}
#[test]
fn archive_names_parent_and_legacy_duplicates() {
    let (_root, _keys, i) = setup();
    seed(&i, &id(1));
    let first = i
        .apply_taxonomy_change(&id(1), Command::Create { item: tag(500) }, || Ok(()))
        .unwrap()
        .items[0]
        .clone();
    let changed = i
        .apply_taxonomy_change(
            &id(1),
            update(first.clone(), "Ｆéｒｉａｓ", "ACTIVE"),
            || Ok(()),
        )
        .unwrap()
        .items[0]
        .clone();
    let alias = match tag(501) {
        Item::Tag {
            id, workspace_id, ..
        } => Item::Tag {
            id,
            workspace_id,
            name: " férias ".into(),
            status: "ACTIVE".into(),
        },
        _ => unreachable!(),
    };
    assert_eq!(
        i.apply_taxonomy_change(
            &id(1),
            Command::Create {
                item: alias.clone()
            },
            || Ok(())
        )
        .err(),
        Some(LocalError::TaxonomyNameConflict)
    );
    assert_eq!(
        i.apply_taxonomy_change(&id(1), update(first, "SYNTHETIC STALE", "ARCHIVED"), || Ok(
            ()
        ))
        .err(),
        Some(LocalError::TaxonomyBaseConflict)
    );
    let archived = i
        .apply_taxonomy_change(
            &id(1),
            update(changed, "Ｆéｒｉａｓ", "ARCHIVED"),
            || Ok(()),
        )
        .unwrap()
        .items[0]
        .clone();
    i.apply_taxonomy_change(&id(1), Command::Create { item: alias }, || Ok(()))
        .unwrap();
    assert_eq!(
        i.apply_taxonomy_change(&id(1), update(archived, "Ｆéｒｉａｓ", "ACTIVE"), || Ok(()))
            .err(),
        Some(LocalError::TaxonomyNameConflict)
    );
}
#[test]
fn unavailable_parent_and_immutable_parent() {
    let (_root, _keys, i) = setup();
    seed(&i, &id(1));
    let created = i
        .apply_taxonomy_change(
            &id(1),
            Command::Create {
                item: sub(501, 100),
            },
            || Ok(()),
        )
        .unwrap()
        .items[0]
        .clone();
    let mut value = serde_json::to_value(&created).unwrap();
    value["category_id"] = id(101).into();
    assert_eq!(
        i.apply_taxonomy_change(
            &id(1),
            Command::Update {
                base: created.clone(),
                item: serde_json::from_value(value).unwrap()
            },
            || Ok(())
        )
        .err(),
        Some(LocalError::InvalidTaxonomyChange)
    );
    let parent = i.read_categories(&id(1)).unwrap().categories[0].clone();
    i.apply_category_change(
        &id(1),
        crate::category_model::Command::Update {
            base: parent.clone(),
            name: parent.name,
            sort_order: parent.sort_order,
            status: "ARCHIVED".into(),
        },
        || Ok(()),
    )
    .unwrap();
    assert_eq!(
        i.apply_taxonomy_change(
            &id(1),
            Command::Create {
                item: sub(502, 100)
            },
            || Ok(())
        )
        .err(),
        Some(LocalError::TaxonomyParentUnavailable)
    );
    let archived = i
        .apply_taxonomy_change(
            &id(1),
            update(created, "SYNTHETIC EXISTING", "ARCHIVED"),
            || Ok(()),
        )
        .unwrap()
        .items[0]
        .clone();
    assert_eq!(
        i.apply_taxonomy_change(
            &id(1),
            update(archived, "SYNTHETIC EXISTING", "ACTIVE"),
            || Ok(())
        )
        .err(),
        Some(LocalError::TaxonomyParentUnavailable)
    );
}
#[test]
fn concurrent_full_bases_use_one_owner_and_one_winner() {
    let (root, keys, i) = setup();
    seed(&i, &id(1));
    i.apply_taxonomy_change(&id(1), Command::Create { item: tag(500) }, || Ok(()))
        .unwrap();
    drop(i);
    let state = Arc::new(LocalState::with_policies(
        root.path().into(),
        keys,
        Arc::new(Policies::default()),
    ));
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let threads = ["SYNTHETIC A", "SYNTHETIC B"].map(|name| {
        let state = state.clone();
        let barrier = barrier.clone();
        std::thread::spawn(move || {
            barrier.wait();
            state.apply_taxonomy_change(&id(1), update(tag(500), name, "ACTIVE"))
        })
    });
    let results = threads.map(|t| t.join().unwrap());
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| matches!(r, Err(LocalError::TaxonomyBaseConflict)))
            .count(),
        1
    );
}
#[test]
fn pin_refuses_catalog_before_financial_key_access() {
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
            display_name: "SYNTHETIC PIN".into(),
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
    assert_eq!(
        state.read_taxonomy(&id(1)).err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(
        state
            .apply_taxonomy_change(&id(1), Command::Create { item: tag(500) })
            .err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    state
        .unlock(PinInput {
            pin: "721947350682".into(),
        })
        .unwrap();
    assert!(
        state
            .apply_taxonomy_change(&id(1), Command::Create { item: tag(500) })
            .unwrap()
            .changed
    );
}
#[test]
fn oversized_intention_refused_before_key_release() {
    let (_root, keys, i) = setup();
    keys.reads.store(0, Ordering::SeqCst);
    let mut value = serde_json::to_value(tag(500)).unwrap();
    value["name"] = "x".repeat(4 * 1024 * 1024).into();
    let base: Item = serde_json::from_value(value).unwrap();
    assert_eq!(
        i.apply_taxonomy_change(
            &id(1),
            Command::Update {
                base: base.clone(),
                item: base
            },
            || Ok(())
        )
        .err(),
        Some(LocalError::TaxonomyLimit)
    );
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
}
#[test]
fn oversized_catalog_refused_without_truncation() {
    let (_root, keys, i) = setup();
    let (install, path) = i.probe_details();
    let key = keys
        .get(install, identity::resource_id(&id(1)).unwrap())
        .unwrap();
    let db = open_database(&path.join("workspaces").join(id(1)).join("vault.db"), &key).unwrap();
    db.execute("WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10001) INSERT INTO tag(id,workspace_id,name,normalized_name,status) SELECT printf('0199d245-0000-7000-8000-%012d',x+1000),?,printf('SYNTHETIC %d',x),printf('synthetic %d',x),'ACTIVE' FROM n",[id(1)]).unwrap();
    drop(db);
    assert_eq!(
        i.read_taxonomy(&id(1)).err(),
        Some(LocalError::TaxonomyLimit)
    );
}
