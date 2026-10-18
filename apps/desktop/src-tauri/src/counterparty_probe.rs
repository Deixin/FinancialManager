//! SYNTHETIC_US047_COUNTERPARTIES_ONLY. Process faults are absent from production.
use crate::{LocalError, Result};
use std::{
    cell::Cell,
    sync::atomic::{AtomicU8, Ordering},
};
static CRASH: AtomicU8 = AtomicU8::new(0);
thread_local! {static FAIL:Cell<u8>=const{Cell::new(0)};}
pub fn fail_at(phase: u8) {
    FAIL.set(phase);
}
pub fn crash_at(phase: u8) {
    CRASH.store(phase, Ordering::SeqCst);
}
pub fn checkpoint(db: &rusqlite::Connection, phase: u8) -> Result<()> {
    if FAIL.get() == phase {
        FAIL.set(0);
        return Err(LocalError::StorageUnavailable);
    }
    if CRASH.load(Ordering::SeqCst) == phase {
        if phase != 3 {
            db.cache_flush()?;
        }
        std::process::exit(77 + i32::from(phase));
    }
    Ok(())
}

pub fn verify_vectors() -> Result<usize> {
    use crate::{
        counterparty_association_model as association, counterparty_model as catalog,
        movement_model::{AccountDescriptor, State},
        transfer_model::Group,
    };
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/us047-counterparties.json"))
            .map_err(|_| LocalError::IntegrityFailure)?;
    if fixture["synthetic_only"] != true {
        return Err(LocalError::IntegrityFailure);
    }
    let mut count = 0;
    for v in fixture["catalog_vectors"]
        .as_array()
        .ok_or(LocalError::IntegrityFailure)?
    {
        let run = || -> Result<Option<catalog::Plan>> {
            let w = v["workspace_id"]
                .as_str()
                .ok_or(LocalError::InvalidCounterpartyChange)?;
            let c = serde_json::from_value(v["command"].clone())
                .map_err(|_| LocalError::InvalidCounterpartyChange)?;
            let rows = serde_json::from_value(v["rows"].clone())
                .map_err(|_| LocalError::InvalidCounterpartyState)?;
            catalog::plan(w, rows, c)
        };
        let actual = match run() {
            Ok(p) => serde_json::json!({"plan":p}),
            Err(e) => serde_json::json!({"error":e}),
        };
        if actual != v["expected"] {
            eprintln!("US047_CATALOG_VECTOR_MISMATCH_{count}");
            return Err(LocalError::IntegrityFailure);
        }
        count += 1;
    }
    for v in fixture["association_vectors"]
        .as_array()
        .ok_or(LocalError::IntegrityFailure)?
    {
        let run = || -> Result<Vec<crate::movement_model::Plan>> {
            let w = v["workspace_id"]
                .as_str()
                .ok_or(LocalError::InvalidCounterpartyAssociation)?;
            let commands = serde_json::from_value(v["commands"].clone())
                .map_err(|_| LocalError::InvalidCounterpartyAssociation)?;
            let commands = association::capture_batch(w, commands)?;
            let current: Vec<State> = serde_json::from_value(v["current"].clone())
                .map_err(|_| LocalError::IntegrityFailure)?;
            let accounts: Vec<AccountDescriptor> = serde_json::from_value(v["accounts"].clone())
                .map_err(|_| LocalError::IntegrityFailure)?;
            let references: Vec<association::Reference> =
                serde_json::from_value(v["catalog"].clone())
                    .map_err(|_| LocalError::IntegrityFailure)?;
            let groups: Vec<Group> = serde_json::from_value(v["groups"].clone())
                .map_err(|_| LocalError::IntegrityFailure)?;
            let now = v["now"].as_str().ok_or(LocalError::IntegrityFailure)?;
            let mut plans = vec![];
            for c in commands {
                let row = current.iter().find(|r| r.id == c.base.id).cloned();
                let account = accounts.iter().find(|a| a.id == c.base.content.account_id);
                plans.push(association::plan(w, c, row, account, &references, now)?);
            }
            crate::classification_model::validate_groups(w, &plans, &accounts, &groups)?;
            Ok(plans)
        };
        let actual = match run() {
            Err(e) => serde_json::json!({"error":e}),
            Ok(plans) => {
                serde_json::json!({"plans":plans.into_iter().map(|p|serde_json::json!({"changed":p.changed,"before":p.before,"after":p.after,"snapshot":p.snapshot})).collect::<Vec<_>>()})
            }
        };
        if actual != v["expected"] {
            eprintln!("US047_ASSOCIATION_VECTOR_MISMATCH_{count}");
            return Err(LocalError::IntegrityFailure);
        }
        count += 1;
    }
    Ok(count)
}
