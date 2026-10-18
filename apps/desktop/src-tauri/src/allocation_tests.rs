#![cfg(feature = "allocations-smoke")]
use crate::{
    LocalError,
    allocation_model::{Command, Selection},
    allocation_probe,
    category_model::Command as Category,
    classification_filter_tests::{Policies, setup},
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
        base,
        allocation: Selection::Keep {},
    }
}
fn set(base: State) -> Command {
    let a = crate::movement_model::Allocation {
        id: base
            .content
            .allocations
            .first()
            .map_or_else(|| id(703), |a| a.id.clone()),
        category_id: id(700),
        subcategory_id: Some(id(702)),
        amount_minor: base
            .content
            .account_amount_minor
            .parse::<i64>()
            .unwrap()
            .abs()
            .to_string(),
        note: base
            .content
            .allocations
            .first()
            .and_then(|a| a.note.clone()),
    };
    Command {
        base,
        allocation: Selection::Replace {
            allocations: vec![a],
        },
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
        o.get_mut("content")
            .unwrap()
            .as_object_mut()
            .unwrap()
            .remove("allocations");
    }
    s
}
#[test]
fn shared_classification_and_revision_vectors_match() {
    assert_eq!(allocation_probe::verify_vectors().unwrap(), 47);
}
#[test]
fn encrypted_import_classification_history_noop_and_reopen() {
    let (root, keys, i, w) = setup();
    seed(&i, &w);
    let b = base(&i, &w);
    let before = snapshot(&i, &w);
    let c = set(b.clone());
    let r = i.apply_allocations(&w, vec![c], || Ok(())).unwrap();
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
        .apply_allocations(&w, vec![keep(state.clone())], || Ok(()))
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
    i.apply_allocations(&w, vec![c.clone()], || Ok(())).unwrap();
    let expected = snapshot(&i, &w);
    assert_eq!(
        i.apply_allocations(&w, vec![c], || Ok(())).err(),
        Some(LocalError::VersionConflict)
    );
    let mut forged = keep(base(&i, &w));
    forged.base.content.display_name = "SYNTHETIC FORGED".into();
    assert_eq!(
        i.apply_allocations(&w, vec![forged], || Ok(())).err(),
        Some(LocalError::AllocationBaseConflict)
    );
    assert_eq!(snapshot(&i, &w), expected);
}
#[test]
fn first_write_and_precommit_failures_roll_back_classification_and_audit() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let c = set(base(&i, &w));
    let expected = snapshot(&i, &w);
    allocation_probe::fail_at(1);
    assert_eq!(
        i.apply_allocations(&w, vec![c.clone()], || Ok(())).err(),
        Some(LocalError::StorageUnavailable)
    );
    assert_eq!(snapshot(&i, &w), expected);
    assert_eq!(
        i.apply_allocations(&w, vec![c], || Err(LocalError::LocalLocked))
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
    i.apply_allocations(&w, vec![c], || Ok(())).unwrap();
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
        !i.apply_allocations(&w, vec![keep(b.clone())], || Ok(()))
            .unwrap()
            .entries[0]
            .changed
    );
    let c = Command {
        base: b,
        allocation: Selection::Clear {},
    };
    assert!(i.apply_allocations(&w, vec![c], || Ok(())).unwrap().entries[0].changed);
    assert_eq!(
        i.apply_allocations(&w, vec![set(base(&i, &w))], || Ok(()))
            .err(),
        Some(LocalError::AllocationReferenceUnavailable)
    );
}
#[test]
fn split_edits_multiple_categories_and_notes_then_explicitly_clears() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let s = i
        .read_movements(&w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|s| {
            !s.content.deleted && s.content.group_id.is_none() && s.content.allocations.len() > 1
        })
        .unwrap();
    let value = s.content.account_amount_minor.parse::<i64>().unwrap().abs();
    let mut rows = s.content.allocations.clone();
    rows.truncate(2);
    rows[0].amount_minor = (value - 1).to_string();
    rows[1].amount_minor = "1".into();
    rows[0].note = Some("SYNTHETIC EDITED PARCEL".into());
    let result = i
        .apply_allocations(
            &w,
            vec![Command {
                base: s.clone(),
                allocation: Selection::Replace {
                    allocations: rows.clone(),
                },
            }],
            || Ok(()),
        )
        .unwrap();
    assert!(result.entries[0].changed);
    let current = i
        .read_movements(&w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|r| r.id == s.id)
        .unwrap();
    assert_eq!(
        serde_json::to_value(&current.content.allocations).unwrap(),
        serde_json::to_value(rows).unwrap()
    );
    assert_eq!(current.content.tag_ids, s.content.tag_ids);
    i.apply_allocations(
        &w,
        vec![Command {
            base: current,
            allocation: Selection::Clear {},
        }],
        || Ok(()),
    )
    .unwrap();
    assert!(
        i.read_movements(&w)
            .unwrap()
            .transactions
            .into_iter()
            .find(|r| r.id == s.id)
            .unwrap()
            .content
            .allocations
            .is_empty()
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
        i.apply_allocations(&w, vec![c.clone()], || Ok(())).err(),
        Some(LocalError::CompositeRequired)
    );
    let result = i
        .apply_allocations(&w, vec![c, keep(t.clone())], || Ok(()))
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
        state.apply_allocations(&w, vec![c.clone()]).err(),
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
            std::thread::spawn(move || state.apply_allocations(&w, vec![c]))
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
    let mut bad = set(t.clone());
    if let Selection::Replace { allocations } = &mut bad.allocation {
        allocations[0].category_id = id(999);
    }
    let before = snapshot(&i, &w);
    assert_eq!(
        i.apply_allocations(&w, vec![set(s.clone()), bad], || Ok(()))
            .err(),
        Some(LocalError::AllocationReferenceUnavailable)
    );
    assert_eq!(snapshot(&i, &w), before);
    let mut c = keep(s.clone());
    c.base.workspace_id = id(999);
    assert_eq!(
        i.apply_allocations(&w, vec![c], || Ok(())).err(),
        Some(LocalError::InvalidAllocationChange)
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
            i.apply_allocations(&w, commands, || Ok(())).err(),
            Some(LocalError::InvalidAllocationChange)
        );
    }
    let mut huge = c;
    huge.base.content.display_name = "x".repeat(4 * 1024 * 1024);
    assert_eq!(
        i.apply_allocations(&w, vec![huge], || Ok(())).err(),
        Some(LocalError::InvalidAllocationChange)
    );
    let db = vault::open_fixture(root.path(), keys.as_ref()).unwrap();
    vault::integrity(&db).unwrap();
}

#[test]
fn i64_minimum_splits_exactly_without_overflow() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let mut s = base(&i, &w);
    s.id = id(780);
    s.version = "1".into();
    s.content.account_amount_minor = i64::MIN.to_string();
    s.content.allocations.clear();
    classification_probe::seed_import_state(&i, s.clone()).unwrap();
    let rows = [(781, i64::MAX), (782, 1)]
        .into_iter()
        .map(|(n, a)| crate::movement_model::Allocation {
            id: id(n),
            category_id: id(700),
            subcategory_id: None,
            amount_minor: a.to_string(),
            note: None,
        })
        .collect();
    let result = i
        .apply_allocations(
            &w,
            vec![Command {
                base: s.clone(),
                allocation: Selection::Replace { allocations: rows },
            }],
            || Ok(()),
        )
        .unwrap();
    assert!(result.entries[0].changed);
    let c = i
        .read_movements(&w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|r| r.id == s.id)
        .unwrap();
    assert_eq!(
        c.content
            .allocations
            .iter()
            .map(|a| a.amount_minor.parse::<i128>().unwrap())
            .sum::<i128>(),
        9223372036854775808i128
    );
}
#[test]
fn collision_with_another_transactions_allocation_rolls_back() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let c = set(base(&i, &w));
    i.apply_allocations(&w, vec![c], || Ok(())).unwrap();
    let source = base(&i, &w);
    let mut target = source.clone();
    target.id = id(790);
    target.version = "1".into();
    target.content.allocations.clear();
    classification_probe::seed_import_state(&i, target.clone()).unwrap();
    let before = snapshot(&i, &w);
    assert!(
        i.apply_allocations(
            &w,
            vec![Command {
                base: target,
                allocation: Selection::Replace {
                    allocations: source.content.allocations
                }
            }],
            || Ok(())
        )
        .is_err()
    );
    assert_eq!(snapshot(&i, &w), before);
}
