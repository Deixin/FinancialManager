//! SYNTHETIC_US040_ACCOUNTS_ONLY. Optional test instrumentation, absent from default builds.
use crate::{
    LocalError, Result,
    account_model::{self, AccountChange, AccountState, Action},
};
use std::sync::atomic::{AtomicU8, Ordering};
static CRASH: AtomicU8 = AtomicU8::new(0);
pub fn crash_at(phase: u8) {
    CRASH.store(phase, Ordering::SeqCst);
}
pub fn checkpoint(db: &rusqlite::Connection, phase: u8) -> Result<()> {
    if CRASH.load(Ordering::SeqCst) == phase {
        if phase == 1 {
            db.cache_flush()?;
            std::process::exit(74);
        }
        std::process::exit(75);
    }
    Ok(())
}
pub fn verify_vectors() -> Result<usize> {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/us040-accounts.json"))
            .map_err(|_| LocalError::IntegrityFailure)?;
    if fixture["synthetic_only"] != true {
        return Err(LocalError::IntegrityFailure);
    }
    let vectors = fixture["vectors"]
        .as_array()
        .ok_or(LocalError::IntegrityFailure)?;
    for (index, v) in vectors.iter().enumerate() {
        let workspace = v["workspace_id"]
            .as_str()
            .ok_or(LocalError::IntegrityFailure)?;
        let now = v["now"].as_str().ok_or(LocalError::IntegrityFailure)?;
        let current: Option<AccountState> = serde_json::from_value(v["current"].clone())
            .map_err(|_| LocalError::IntegrityFailure)?;
        let change = serde_json::from_value::<AccountChange>(v["change"].clone());
        let result = match change {
            Ok(c) => account_model::plan(workspace, current, c, now),
            Err(_) => Err(LocalError::InvalidAccountChange),
        };
        let actual = match result {
            Ok(p) => {
                serde_json::json!({"plan":{"kind":match p.action{Action::Create=>"CREATE",Action::Update=>"UPDATE",Action::Reference=>"REFERENCE"},"changed":p.changed,"state":p.state,"reference_id":p.reference_id,"replaces_id":p.replaces_id}})
            }
            Err(error) => serde_json::json!({"error":error}),
        };
        if actual != v["expected"] {
            eprintln!("US040_VECTOR_MISMATCH_{index}");
            return Err(LocalError::IntegrityFailure);
        }
    }
    Ok(vectors.len())
}
