//! SYNTHETIC_US043_DESKTOP_ONLY. Excluded from default builds.
use crate::{
    LocalError, Result,
    card_payment_model::{Command, Group},
    movement_model::{AccountDescriptor, State},
};
use std::{
    cell::Cell,
    sync::atomic::{AtomicU8, Ordering},
};
static CRASH: AtomicU8 = AtomicU8::new(0);
thread_local! {static FAIL_FIRST:Cell<bool>=const{Cell::new(false)};}
pub fn fail_after_first() {
    FAIL_FIRST.set(true);
}
pub fn crash_at(phase: u8) {
    CRASH.store(phase, Ordering::SeqCst);
}
pub fn after_first(db: &rusqlite::Connection) -> Result<()> {
    if FAIL_FIRST.replace(false) {
        return Err(LocalError::StorageUnavailable);
    }
    checkpoint(db, 1)
}
pub fn checkpoint(db: &rusqlite::Connection, phase: u8) -> Result<()> {
    if CRASH.load(Ordering::SeqCst) == phase {
        if phase != 3 {
            db.cache_flush()?;
        }
        std::process::exit(77 + i32::from(phase));
    }
    Ok(())
}
pub fn verify_vectors() -> Result<usize> {
    let root: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/us043-card-payments.json"))
            .map_err(|_| LocalError::IntegrityFailure)?;
    if root["synthetic_only"] != true {
        return Err(LocalError::IntegrityFailure);
    }
    let vectors = root["vectors"]
        .as_array()
        .ok_or(LocalError::IntegrityFailure)?;
    for (index, v) in vectors.iter().enumerate() {
        let w = v["workspace_id"]
            .as_str()
            .ok_or(LocalError::IntegrityFailure)?;
        let now = v["now"].as_str().ok_or(LocalError::IntegrityFailure)?;
        let current: [Option<State>; 2] = serde_json::from_value(v["current"].clone())
            .map_err(|_| LocalError::IntegrityFailure)?;
        let group: Option<Group> =
            serde_json::from_value(v["group"].clone()).map_err(|_| LocalError::IntegrityFailure)?;
        let accounts: Vec<AccountDescriptor> = serde_json::from_value(v["accounts"].clone())
            .map_err(|_| LocalError::IntegrityFailure)?;
        let actual = match serde_json::from_value::<Command>(v["command"].clone()) {
            Err(_) => serde_json::json!({"error":LocalError::InvalidCardPayment}),
            Ok(c) => {
                match crate::card_payment_model::plan(w, c, current, &accounts, group.as_ref(), now)
                {
                    Ok(p) => {
                        serde_json::json!({"plan":{"creation":p.creation,"plans":p.plans.into_iter().map(|p|serde_json::json!({"changed":p.changed,"state":p.after,"snapshot":p.snapshot})).collect::<Vec<_>>()}})
                    }
                    Err(e) => serde_json::json!({"error":e}),
                }
            }
        };
        if actual != v["expected"] {
            eprintln!("US043_CARD_PAYMENT_VECTOR_MISMATCH_{index}");
            return Err(LocalError::IntegrityFailure);
        }
    }
    Ok(vectors.len())
}
