#![cfg(feature = "categories-smoke")]
use crate::{
    LocalError, Result, SecretKey,
    category_model::{Category, Command},
    category_probe,
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
    format!("0199d244-0000-7000-8000-{n:012}")
}
fn setup() -> (tempfile::TempDir, Arc<Keys>, Installation) {
    let root = tempfile::tempdir().unwrap();
    let keys = Arc::new(Keys::default());
    let i = Installation::open(root.path(), keys.clone()).unwrap();
    for n in [1, 2] {
        i.create(CreateWorkspace {
            workspace_id: id(n),
            display_name: "SYNTHETIC US044".into(),
            purpose: Purpose::Personal,
        })
        .unwrap();
    }
    (root, keys, i)
}
fn seed() -> Command {
    Command::Seed {
        profile_version: 1,
        purpose: "PERSONAL".into(),
        ids: (100..109).map(id).collect(),
    }
}
fn update(r: Category, name: &str, status: &str) -> Command {
    Command::Update {
        sort_order: r.sort_order,
        base: r,
        name: name.into(),
        status: status.into(),
    }
}
#[test]
fn shared_vectors_match_native_policy() {
    assert!(category_probe::verify_vectors().unwrap() >= 45);
}
#[test]
fn seed_is_atomic_and_reopens_encrypted() {
    let (root, keys, i) = setup();
    category_probe::fail_after_first();
    assert_eq!(
        i.apply_category_change(&id(1), seed(), || Ok(())).err(),
        Some(LocalError::StorageUnavailable)
    );
    assert!(i.read_categories(&id(1)).unwrap().categories.is_empty());
    assert_eq!(
        i.apply_category_change(&id(1), seed(), || Err(LocalError::LocalLocked))
            .err(),
        Some(LocalError::LocalLocked)
    );
    assert!(i.read_categories(&id(1)).unwrap().categories.is_empty());
    i.apply_category_change(&id(1), seed(), || Ok(())).unwrap();
    drop(i);
    let reopened = Installation::open(root.path(), keys).unwrap();
    assert_eq!(
        reopened.read_categories(&id(1)).unwrap().categories.len(),
        9
    );
    let bytes = std::fs::read(root.path().join("workspaces").join(id(1)).join("vault.db")).unwrap();
    let label = "Salário".as_bytes();
    assert!(!bytes.windows(label.len()).any(|w| w == label));
    assert!(!bytes.starts_with(b"SQLite format 3"));
}
#[test]
fn metadata_edits_archive_reorder_and_workspace_isolation() {
    let (_root, _keys, i) = setup();
    let rows = i
        .apply_category_change(&id(1), seed(), || Ok(()))
        .unwrap()
        .categories;
    let archived = i
        .apply_category_change(
            &id(1),
            update(rows[0].clone(), "SYNTHETIC ARCHIVED", "ARCHIVED"),
            || Ok(()),
        )
        .unwrap()
        .categories;
    assert!(archived[0].is_seeded);
    let active = archived
        .iter()
        .filter(|r| r.status == "ACTIVE")
        .cloned()
        .collect::<Vec<_>>();
    let ordered = active
        .iter()
        .rev()
        .map(|r| r.id.clone())
        .collect::<Vec<_>>();
    category_probe::fail_after_first();
    assert_eq!(
        i.apply_category_change(
            &id(1),
            Command::Reorder {
                bases: active.clone(),
                ids: ordered.clone()
            },
            || Ok(())
        )
        .err(),
        Some(LocalError::StorageUnavailable)
    );
    assert_eq!(i.read_categories(&id(1)).unwrap().categories, archived);
    let after = i
        .apply_category_change(
            &id(1),
            Command::Reorder {
                bases: active,
                ids: ordered.clone(),
            },
            || Ok(()),
        )
        .unwrap()
        .categories;
    assert_eq!(after[0], archived[0]);
    for r in after.iter().filter(|r| r.status == "ACTIVE") {
        assert_eq!(
            r.sort_order as usize,
            ordered.iter().position(|id| id == &r.id).unwrap()
        );
    }
    assert!(i.read_categories(&id(2)).unwrap().categories.is_empty());
}
#[test]
fn replay_does_not_duplicate_or_reset_user_edits() {
    let (_root, _keys, i) = setup();
    let first = i.apply_category_change(&id(1), seed(), || Ok(())).unwrap();
    assert!(
        !i.apply_category_change(&id(1), seed(), || Ok(()))
            .unwrap()
            .changed
    );
    i.apply_category_change(
        &id(1),
        update(first.categories[0].clone(), "SYNTHETIC RENAMED", "ACTIVE"),
        || Ok(()),
    )
    .unwrap();
    assert_eq!(
        i.apply_category_change(&id(1), seed(), || Ok(())).err(),
        Some(LocalError::CategorySeedConflict)
    );
    assert_eq!(
        i.apply_category_change(
            &id(1),
            update(first.categories[0].clone(), "SYNTHETIC STALE", "ACTIVE"),
            || Ok(())
        )
        .err(),
        Some(LocalError::CategoryBaseConflict)
    );
}
#[test]
fn concurrent_full_base_updates_choose_one_winner() {
    let root = tempfile::tempdir().unwrap();
    let i = Arc::new(LocalState::with_policies(
        root.path().into(),
        Arc::new(Keys::default()),
        Arc::new(Policies::default()),
    ));
    i.create(CreateWorkspace {
        workspace_id: id(1),
        display_name: "SYNTHETIC CONCURRENT".into(),
        purpose: Purpose::Personal,
    })
    .unwrap();
    let base = i
        .apply_category_change(&id(1), seed())
        .unwrap()
        .categories
        .remove(0);
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let workers = (0..2)
        .map(|n| {
            let i = i.clone();
            let base = base.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                i.apply_category_change(
                    &id(1),
                    update(base, &format!("SYNTHETIC CONCURRENT {n}"), "ACTIVE"),
                )
                .map(|_| ())
                .err()
            })
        })
        .collect::<Vec<_>>();
    let results = workers
        .into_iter()
        .map(|w| w.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|r| r.is_none()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| **r == Some(LocalError::CategoryBaseConflict))
            .count(),
        1
    );
}
#[test]
fn normalized_names_are_unique_only_while_active() {
    let (_root, _keys, i) = setup();
    let rows = i
        .apply_category_change(&id(1), seed(), || Ok(()))
        .unwrap()
        .categories;
    let salary = rows.iter().find(|r| r.name == "Salário").unwrap().clone();
    let create = || Command::Create {
        id: id(500),
        name: " ＳＡＬÁＲＩＯ ".into(),
        category_scope: "EXPENSE".into(),
        sort_order: 20,
    };
    assert_eq!(
        i.apply_category_change(&id(1), create(), || Ok(())).err(),
        Some(LocalError::CategoryNameConflict)
    );
    let after = i
        .apply_category_change(
            &id(1),
            update(salary.clone(), &salary.name, "ARCHIVED"),
            || Ok(()),
        )
        .unwrap();
    i.apply_category_change(&id(1), create(), || Ok(()))
        .unwrap();
    let archived = after
        .categories
        .into_iter()
        .find(|r| r.id == salary.id)
        .unwrap();
    assert_eq!(
        i.apply_category_change(&id(1), update(archived, &salary.name, "ACTIVE"), || Ok(()))
            .err(),
        Some(LocalError::CategoryNameConflict)
    );
}
#[test]
fn pin_blocks_categories_before_financial_key_access() {
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
        state.read_categories(&id(1)).err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(
        state.apply_category_change(&id(1), seed()).err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    state
        .unlock(PinInput {
            pin: "721947350682".into(),
        })
        .unwrap();
    assert!(state.apply_category_change(&id(1), seed()).unwrap().changed);
}
#[test]
fn oversized_category_command_fails_before_financial_key_access() {
    let (_root, keys, i) = setup();
    keys.reads.store(0, Ordering::SeqCst);
    let input = Command::Update {
        base: Category {
            id: id(100),
            workspace_id: id(1),
            name: "x".repeat(4 * 1024 * 1024),
            category_scope: "BOTH".into(),
            sort_order: 0,
            status: "ACTIVE".into(),
            is_seeded: false,
        },
        name: "x".repeat(4 * 1024 * 1024),
        sort_order: 0,
        status: "ARCHIVED".into(),
    };
    assert_eq!(
        i.apply_category_change(&id(1), input, || Ok(())).err(),
        Some(LocalError::CategoryLimit)
    );
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
}
#[test]
fn oversized_catalog_is_rejected_without_truncation() {
    let (_root, keys, i) = setup();
    let (install, path) = i.probe_details();
    let key = keys
        .get(install, identity::resource_id(&id(1)).unwrap())
        .unwrap();
    let db = open_database(&path.join("workspaces").join(id(1)).join("vault.db"), &key).unwrap();
    db.execute("WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<10001) INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) SELECT printf('0199d244-0000-7000-8000-%012d',x+1000),?,printf('SYNTHETIC %d',x),printf('synthetic %d',x),'BOTH',x,'ACTIVE',0 FROM n",[id(1)]).unwrap();
    drop(db);
    assert_eq!(
        i.read_categories(&id(1)).err(),
        Some(LocalError::CategoryLimit)
    );
}
