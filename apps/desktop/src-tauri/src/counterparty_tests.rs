//! Synthetic SQLCipher regressions; no personal identifiers or cloud principal.
use crate::{
    LocalError,
    classification_filter_tests::setup,
    counterparty_association_model::{Command, Selection},
    counterparty_model::{Command as Catalog, Counterparty},
    local_workspaces::Installation,
    movement_model::State,
};
fn id(n: u64) -> String {
    format!("0199d047-0000-7000-8000-{n:012}")
}
fn item(w: &str) -> Counterparty {
    Counterparty {
        id: id(900),
        workspace_id: w.into(),
        display_name: "SYNTHETIC COUNTERPARTY".into(),
        identifier_type: Some("CPF".into()),
        identifier_value: Some("00000000000".into()),
        relationship_hint: Some("SUPPLIER".into()),
        status: "ACTIVE".into(),
    }
}
fn seed(i: &Installation, w: &str) {
    i.apply_counterparty_change(w, Catalog::Create { item: item(w) }, || Ok(()))
        .unwrap();
}
fn base(i: &Installation, w: &str) -> State {
    i.read_movements(w)
        .unwrap()
        .transactions
        .into_iter()
        .find(|r| !r.content.deleted && r.content.group_id.is_none())
        .unwrap()
}
fn set(base: State) -> Command {
    Command {
        base,
        counterparty: Selection::Set {
            counterparty_id: id(900),
        },
    }
}
fn ledger(i: &Installation, w: &str) -> serde_json::Value {
    let mut s = serde_json::to_value(i.read_movements(w).unwrap()).unwrap();
    s["balance"].as_object_mut().unwrap().remove("read_at");
    s
}
#[test]
fn shared_catalog_and_association_vectors_match() {
    assert_eq!(crate::counterparty_probe::verify_vectors().unwrap(), 56);
}
#[test]
fn catalog_homonyms_replay_update_conflict_and_reopen() {
    let (root, keys, i, w) = setup();
    seed(&i, &w);
    assert!(
        !i.apply_counterparty_change(&w, Catalog::Create { item: item(&w) }, || Ok(()))
            .unwrap()
            .changed
    );
    let mut second = item(&w);
    second.id = id(901);
    i.apply_counterparty_change(&w, Catalog::Create { item: second }, || Ok(()))
        .unwrap();
    let mut changed = item(&w);
    changed.display_name = "SYNTHETIC NEW NAME".into();
    i.apply_counterparty_change(
        &w,
        Catalog::Update {
            base: item(&w),
            item: changed.clone(),
        },
        || Ok(()),
    )
    .unwrap();
    assert_eq!(
        i.apply_counterparty_change(
            &w,
            Catalog::Update {
                base: item(&w),
                item: changed
            },
            || Ok(())
        )
        .err(),
        Some(LocalError::CounterpartyBaseConflict)
    );
    drop(i);
    let reopened = Installation::open(root.path(), keys).unwrap();
    assert!(
        reopened
            .read_counterparties(&w, false)
            .unwrap()
            .items
            .iter()
            .any(|r| r.id == id(901))
    );
}
#[test]
fn association_preserves_every_other_content_field_and_history() {
    let (_root, _keys, i, w) = setup();
    seed(&i, &w);
    let b = base(&i, &w);
    let result = i
        .apply_counterparty_association(&w, vec![set(b.clone())], || Ok(()))
        .unwrap();
    assert!(result.entries[0].changed);
    let s = i.read_counterparties(&w, true).unwrap().movements.unwrap();
    let after = s.transactions.iter().find(|r| r.id == b.id).unwrap();
    let mut expected = b.content.clone();
    expected.counterparty_id = Some(id(900));
    assert!(after.content == expected);
    let h = s
        .history
        .iter()
        .find(|r| Some(&r.id) == result.entries[0].revision_id.as_ref())
        .unwrap();
    assert_eq!(h.change_source, "MANUAL");
    assert!(h.snapshot.as_ref().unwrap().before.as_ref() == Some(&b));
    assert!(&h.snapshot.as_ref().unwrap().after == after);
}
#[test]
fn noop_and_clear_do_not_create_spurious_revisions() {
    let (_r, _k, i, w) = setup();
    seed(&i, &w);
    i.apply_counterparty_association(&w, vec![set(base(&i, &w))], || Ok(()))
        .unwrap();
    let b = base(&i, &w);
    let before = ledger(&i, &w);
    assert!(
        !i.apply_counterparty_association(
            &w,
            vec![Command {
                base: b.clone(),
                counterparty: Selection::Keep {}
            }],
            || Ok(())
        )
        .unwrap()
        .entries[0]
            .changed
    );
    assert_eq!(ledger(&i, &w), before);
    assert!(
        i.apply_counterparty_association(
            &w,
            vec![Command {
                base: b,
                counterparty: Selection::Clear {}
            }],
            || Ok(())
        )
        .unwrap()
        .entries[0]
            .changed
    );
}
#[test]
fn archived_reference_retained_removed_and_cannot_be_reintroduced() {
    let (_r, _k, i, w) = setup();
    seed(&i, &w);
    i.apply_counterparty_association(&w, vec![set(base(&i, &w))], || Ok(()))
        .unwrap();
    let b = item(&w);
    let mut a = b.clone();
    a.status = "ARCHIVED".into();
    i.apply_counterparty_change(&w, Catalog::Update { base: b, item: a }, || Ok(()))
        .unwrap();
    assert!(
        !i.apply_counterparty_association(&w, vec![set(base(&i, &w))], || Ok(()))
            .unwrap()
            .entries[0]
            .changed
    );
    i.apply_counterparty_association(
        &w,
        vec![Command {
            base: base(&i, &w),
            counterparty: Selection::Clear {},
        }],
        || Ok(()),
    )
    .unwrap();
    assert_eq!(
        i.apply_counterparty_association(&w, vec![set(base(&i, &w))], || Ok(()))
            .err(),
        Some(LocalError::CounterpartyReferenceUnavailable)
    );
}
#[test]
fn missing_reference_and_full_base_forgery_leave_no_writes() {
    let (_r, _k, i, w) = setup();
    let before = ledger(&i, &w);
    assert_eq!(
        i.apply_counterparty_association(&w, vec![set(base(&i, &w))], || Ok(()))
            .err(),
        Some(LocalError::CounterpartyReferenceUnavailable)
    );
    assert_eq!(ledger(&i, &w), before);
    seed(&i, &w);
    let mut b = base(&i, &w);
    b.content.display_name = "SYNTHETIC FORGED".into();
    assert_eq!(
        i.apply_counterparty_association(&w, vec![set(b)], || Ok(()))
            .err(),
        Some(LocalError::CounterpartyAssociationBaseConflict)
    );
    assert_eq!(ledger(&i, &w), before);
}
#[test]
fn lost_ack_retry_is_stale_and_never_silently_rebased() {
    let (_r, _k, i, w) = setup();
    seed(&i, &w);
    let c = set(base(&i, &w));
    i.apply_counterparty_association(&w, vec![c.clone()], || Ok(()))
        .unwrap();
    let after = ledger(&i, &w);
    assert_eq!(
        i.apply_counterparty_association(&w, vec![c], || Ok(()))
            .err(),
        Some(LocalError::VersionConflict)
    );
    assert_eq!(ledger(&i, &w), after);
}
#[test]
fn failure_after_first_save_rolls_back_state_and_audit() {
    let (_r, _k, i, w) = setup();
    seed(&i, &w);
    let before = ledger(&i, &w);
    crate::counterparty_probe::fail_at(1);
    assert_eq!(
        i.apply_counterparty_association(&w, vec![set(base(&i, &w))], || Ok(()))
            .err(),
        Some(LocalError::StorageUnavailable)
    );
    assert_eq!(ledger(&i, &w), before);
}
#[test]
fn lock_before_commit_rolls_back_catalog_and_association() {
    let (_r, _k, i, w) = setup();
    assert_eq!(
        i.apply_counterparty_change(&w, Catalog::Create { item: item(&w) }, || Err(
            LocalError::LocalLocked
        ))
        .err(),
        Some(LocalError::LocalLocked)
    );
    assert!(
        !i.read_counterparties(&w, false)
            .unwrap()
            .items
            .iter()
            .any(|r| r.id == id(900))
    );
    seed(&i, &w);
    let before = ledger(&i, &w);
    assert_eq!(
        i.apply_counterparty_association(&w, vec![set(base(&i, &w))], || Err(
            LocalError::LocalLocked
        ))
        .err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(ledger(&i, &w), before);
}
#[test]
fn grouped_transfer_requires_partner_and_keeps_its_revision() {
    let (_r, _k, i, w) = setup();
    seed(&i, &w);
    let s = i.read_movements(&w).unwrap();
    let b = s
        .transactions
        .iter()
        .find(|r| r.content.economic_kind == "TRANSFER" && !r.content.deleted)
        .unwrap()
        .clone();
    assert_eq!(
        i.apply_counterparty_association(&w, vec![set(b.clone())], || Ok(()))
            .err(),
        Some(LocalError::CompositeRequired)
    );
    let partner = s
        .transactions
        .into_iter()
        .find(|r| r.id != b.id && r.content.group_id == b.content.group_id)
        .unwrap();
    let result = i
        .apply_counterparty_association(
            &w,
            vec![
                set(b),
                Command {
                    base: partner.clone(),
                    counterparty: Selection::Keep {},
                },
            ],
            || Ok(()),
        )
        .unwrap();
    let noop = result.entries.iter().find(|r| r.id == partner.id).unwrap();
    assert!(!noop.changed);
    assert_eq!(noop.version, partner.version);
}

#[test]
fn locked_facade_refuses_keys_and_concurrent_edits_use_one_base() {
    use crate::{
        classification_filter_tests::Policies,
        commands::LocalState,
        local_lock::{ConfigurePin, PinInput},
    };
    use std::sync::{Arc, atomic::Ordering};
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
        state.read_counterparties(&w, true).err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(
        state
            .apply_counterparty_change(&w, Catalog::Create { item: item(&w) })
            .err(),
        Some(LocalError::LocalLocked)
    );
    assert_eq!(
        state
            .apply_counterparty_association(&w, vec![c.clone()])
            .err(),
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
            std::thread::spawn(move || state.apply_counterparty_association(&w, vec![c]))
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
            .filter(|r| r.as_ref().err() == Some(&LocalError::VersionConflict))
            .count(),
        1
    );
}
