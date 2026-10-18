#![cfg(feature = "classification-smoke")]
use crate::{
    LocalError,
    category_model::Command as Category,
    classification_filter_tests::{Policies, setup},
    classification_model::{Command, Selection},
    classification_probe,
    commands::LocalState,
    local_lock::{ConfigurePin, PinInput},
    local_workspaces::Installation,
    movement_model::State,
    taxonomy_model::{Command as Taxonomy, Item},
    vault_probe as vault,
};
use std::sync::{Arc, atomic::Ordering};
fn id(n: u64) -> String {
    format!("0199d345-0000-7000-8000-{n:012}")
}
fn seed(i: &Installation, w: &str) {
    i.apply_category_change(
        w,
        Category::Create {
            id: id(700),
            name: "SYNTHETIC CLASSIFY".into(),
            category_scope: "BOTH".into(),
            sort_order: 100,
        },
        || Ok(()),
    )
    .unwrap();
    for item in [
        Item::Tag {
            id: id(701),
            workspace_id: w.into(),
            name: "SYNTHETIC CLASSIFY TAG".into(),
            status: "ACTIVE".into(),
        },
        Item::Subcategory {
            id: id(702),
            workspace_id: w.into(),
            name: "SYNTHETIC CLASSIFY SUB".into(),
            status: "ACTIVE".into(),
            category_id: id(700),
            sort_order: 0,
        },
    ] {
        i.apply_taxonomy_change(w, Taxonomy::Create { item }, || Ok(()))
            .unwrap();
    }
    // Synthetic imported record: the product import pipeline is a separate story.
    let mut imported = i
        .read_movements(w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|s| {
            !s.content.deleted
                && s.content.group_id.is_none()
                && s.content.allocations.len() <= 1
                && s.content.account_amount_minor != "0"
                && s.content.account_amount_minor != "-9223372036854775808"
        })
        .unwrap();
    imported.id = id(760);
    imported.version = "1".into();
    imported.content.origin_kind = "IMPORT".into();
    imported.content.original_description = Some("SYNTHETIC IMPORT ORIGINAL".into());
    if let Some(a) = imported.content.allocations.first_mut() {
        a.id = id(761);
    }
    classification_probe::seed_import_state(i, imported).unwrap();
}
fn base(i: &Installation, w: &str) -> State {
    i.read_movements(w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|s| {
            !s.content.deleted
                && s.content.group_id.is_none()
                && s.content.allocations.len() <= 1
                && s.content.origin_kind == "IMPORT"
                && s.content.account_amount_minor != "0"
                && s.content.account_amount_minor != "-9223372036854775808"
        })
        .expect("SYNTHETIC_IMPORT_REQUIRED")
}
fn keep(base: State) -> Command {
    Command {
        tag_ids: base.content.tag_ids.clone(),
        base,
        classification: Selection::Keep {},
    }
}
fn set(base: State) -> Command {
    Command {
        classification: Selection::Set {
            allocation_id: base
                .content
                .allocations
                .first()
                .map_or_else(|| id(703), |a| a.id.clone()),
            category_id: id(700),
            subcategory_id: Some(id(702)),
        },
        tag_ids: vec![id(701)],
        base,
    }
}
fn snapshot(i: &Installation, w: &str) -> serde_json::Value {
    let mut s = serde_json::to_value(i.read_movements(w).unwrap()).unwrap();
    s["balance"].as_object_mut().unwrap().remove("read_at");
    s
}
fn financial(mut s: serde_json::Value) -> serde_json::Value {
    s.as_object_mut().unwrap().remove("history");
    for t in s["transactions"].as_array_mut().unwrap() {
        let o = t.as_object_mut().unwrap();
        o.remove("version");
        o.remove("updated_at");
        for k in ["allocations", "tag_ids"] {
            o.get_mut("content")
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(k);
        }
    }
    s
}
#[test]
fn shared_classification_and_revision_vectors_match() {
    assert_eq!(classification_probe::verify_vectors().unwrap(), 58);
}
#[test]
fn encrypted_import_classification_history_noop_and_reopen() {
    let (root, keys, i, w) = setup();
    seed(&i, &w);
    let b = base(&i, &w);
    let before = snapshot(&i, &w);
    let c = set(b.clone());
    let r = i.apply_classification(&w, vec![c], || Ok(())).unwrap();
    assert_eq!(r.entries.len(), 1);
    assert!(r.entries[0].changed);
    let after = snapshot(&i, &w);
    assert_eq!(financial(after.clone()), financial(before));
    let state = i
        .read_movements(&w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|s| s.id == b.id)
        .unwrap();
    assert_eq!(state.content.origin_kind, b.content.origin_kind);
    assert_eq!(
        state.content.original_description,
        b.content.original_description
    );
    assert_eq!(
        state.content.allocations[0].note,
        b.content.allocations.first().and_then(|a| a.note.clone())
    );
    let noop = i
        .apply_classification(&w, vec![keep(state.clone())], || Ok(()))
        .unwrap();
    assert!(!noop.entries[0].changed);
    assert!(noop.entries[0].revision_id.is_none());
    assert_eq!(snapshot(&i, &w), after);
    drop(i);
    let reopened = Installation::open(root.path(), keys).unwrap();
    assert_eq!(snapshot(&reopened, &w), after);
}
#[test]
fn stale_forged_and_ack_replay_never_overwrite() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let c = set(base(&i, &w));
    i.apply_classification(&w, vec![c.clone()], || Ok(()))
        .unwrap();
    let expected = snapshot(&i, &w);
    assert_eq!(
        i.apply_classification(&w, vec![c], || Ok(())).err(),
        Some(LocalError::VersionConflict)
    );
    let mut forged = keep(base(&i, &w));
    forged.base.content.display_name = "SYNTHETIC FORGED".into();
    assert_eq!(
        i.apply_classification(&w, vec![forged], || Ok(())).err(),
        Some(LocalError::ClassificationBaseConflict)
    );
    assert_eq!(snapshot(&i, &w), expected);
}
#[test]
fn first_write_and_precommit_failures_roll_back_classification_and_audit() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let c = set(base(&i, &w));
    let expected = snapshot(&i, &w);
    classification_probe::fail_at(1);
    assert_eq!(
        i.apply_classification(&w, vec![c.clone()], || Ok(())).err(),
        Some(LocalError::StorageUnavailable)
    );
    assert_eq!(snapshot(&i, &w), expected);
    assert_eq!(
        i.apply_classification(&w, vec![c], || Err(LocalError::LocalLocked))
            .err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(snapshot(&i, &w), expected);
}
#[test]
fn archive_retained_reference_and_explicit_removal() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let c = set(base(&i, &w));
    let tid = c.base.id.clone();
    i.apply_classification(&w, vec![c], || Ok(())).unwrap();
    let catalog = i.read_taxonomy(&w).unwrap();
    for item in catalog
        .items
        .into_iter()
        .filter(|r| r.id() == id(701) || r.id() == id(702))
    {
        let mut value = serde_json::to_value(&item).unwrap();
        value["status"] = "ARCHIVED".into();
        i.apply_taxonomy_change(
            &w,
            Taxonomy::Update {
                base: item,
                item: serde_json::from_value(value).unwrap(),
            },
            || Ok(()),
        )
        .unwrap();
    }
    let cat = i
        .read_categories(&w)
        .unwrap()
        .categories
        .into_iter()
        .find(|r| r.id == id(700))
        .unwrap();
    i.apply_category_change(
        &w,
        Category::Update {
            base: cat.clone(),
            name: cat.name,
            sort_order: cat.sort_order,
            status: "ARCHIVED".into(),
        },
        || Ok(()),
    )
    .unwrap();
    let b = i
        .read_movements(&w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|r| r.id == tid)
        .unwrap();
    assert!(
        !i.apply_classification(&w, vec![keep(b.clone())], || Ok(()))
            .unwrap()
            .entries[0]
            .changed
    );
    let c = Command {
        base: b,
        classification: Selection::Clear {},
        tag_ids: vec![],
    };
    assert!(
        i.apply_classification(&w, vec![c], || Ok(()))
            .unwrap()
            .entries[0]
            .changed
    );
    assert_eq!(
        i.apply_classification(&w, vec![set(base(&i, &w))], || Ok(()))
            .err(),
        Some(LocalError::ClassificationReferenceUnavailable)
    );
}
#[test]
fn split_accepts_tags_but_refuses_automatic_resize() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let s = i
        .read_movements(&w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|r| {
            !r.content.deleted && r.content.group_id.is_none() && r.content.allocations.len() > 1
        })
        .expect("SYNTHETIC_SPLIT_REQUIRED");
    let mut c = keep(s.clone());
    c.tag_ids = vec![id(701)];
    i.apply_classification(&w, vec![c], || Ok(())).unwrap();
    let after = i
        .read_movements(&w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|r| r.id == s.id)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&after.content.allocations).unwrap(),
        serde_json::to_value(&s.content.allocations).unwrap()
    );
    let c = Command {
        base: after,
        classification: Selection::Clear {},
        tag_ids: vec![],
    };
    assert_eq!(
        i.apply_classification(&w, vec![c], || Ok(())).err(),
        Some(LocalError::ClassificationSplitReviewRequired)
    );
}
#[test]
fn groups_require_complete_bases_and_only_changed_member_gets_audit() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let rows = i.read_movements(&w).unwrap().transactions;
    let s = rows
        .iter()
        .find(|r| {
            !r.content.deleted
                && r.content.economic_kind == "TRANSFER"
                && r.content.group_id.is_some()
        })
        .unwrap();
    let t = rows
        .iter()
        .find(|r| r.id != s.id && r.content.group_id == s.content.group_id)
        .unwrap();
    let c = set(s.clone());
    assert_eq!(
        i.apply_classification(&w, vec![c.clone()], || Ok(())).err(),
        Some(LocalError::CompositeRequired)
    );
    let result = i
        .apply_classification(&w, vec![c, keep(t.clone())], || Ok(()))
        .unwrap();
    assert_eq!(result.entries.iter().filter(|r| r.changed).count(), 1);
    let partner = result.entries.iter().find(|r| r.id == t.id).unwrap();
    assert!(!partner.changed);
    assert_eq!(partner.version, t.version);
    assert!(partner.revision_id.is_none());
}
#[test]
fn pin_refuses_before_key_and_owner_serializes_competing_bases() {
    let (root, keys, i, w) = setup();
    seed(&i, &w);
    let c = set(base(&i, &w));
    drop(i);
    let state = Arc::new(LocalState::with_policies(
        root.path().to_path_buf(),
        keys.clone(),
        Arc::new(Policies::default()),
    ));
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
        state.apply_classification(&w, vec![c.clone()]).err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(keys.reads.load(Ordering::SeqCst), 0);
    state
        .unlock(PinInput {
            pin: "721947350682".into(),
        })
        .unwrap();
    let handles = (0..2)
        .map(|_| {
            let state = state.clone();
            let w = w.clone();
            let c = c.clone();
            std::thread::spawn(move || state.apply_classification(&w, vec![c]))
        })
        .collect::<Vec<_>>();
    let results = handles
        .into_iter()
        .map(|h| h.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| matches!(r, Err(LocalError::VersionConflict)))
            .count(),
        1
    );
}
#[test]
fn second_plan_failure_writes_nothing_and_scope_isolated() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let rows = i.read_movements(&w).unwrap().transactions;
    let s = rows
        .iter()
        .find(|r| {
            !r.content.deleted
                && r.content.economic_kind == "TRANSFER"
                && r.content.group_id.is_some()
        })
        .unwrap();
    let t = rows
        .iter()
        .find(|r| r.id != s.id && r.content.group_id == s.content.group_id)
        .unwrap();
    let mut bad = keep(t.clone());
    bad.tag_ids = vec![id(999)];
    let before = snapshot(&i, &w);
    assert_eq!(
        i.apply_classification(&w, vec![set(s.clone()), bad], || Ok(()))
            .err(),
        Some(LocalError::ClassificationReferenceUnavailable)
    );
    assert_eq!(snapshot(&i, &w), before);
    let mut c = keep(s.clone());
    c.base.workspace_id = id(999);
    assert_eq!(
        i.apply_classification(&w, vec![c], || Ok(())).err(),
        Some(LocalError::InvalidClassification)
    );
    assert_eq!(snapshot(&i, &w), before);
}
#[test]
fn batch_bounds_duplicate_ids_and_oversize_are_refused() {
    let (root, keys, i, w) = setup();
    seed(&i, &w);
    let c = set(base(&i, &w));
    for commands in [vec![], vec![c.clone(); 257], vec![c.clone(), c.clone()]] {
        assert_eq!(
            i.apply_classification(&w, commands, || Ok(())).err(),
            Some(LocalError::InvalidClassification)
        );
    }
    let mut huge = c;
    huge.base.content.display_name = "x".repeat(4 * 1024 * 1024);
    assert_eq!(
        i.apply_classification(&w, vec![huge], || Ok(())).err(),
        Some(LocalError::InvalidClassification)
    );
    let db = vault::open_fixture(root.path(), keys.as_ref()).unwrap();
    vault::integrity(&db).unwrap();
}
