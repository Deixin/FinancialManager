//! SYNTHETIC_US041_DESKTOP_ONLY. Excluded from default builds.
use crate::{
    LocalError, Result,
    movement_model::{self, AccountDescriptor, ManualCommand, State},
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
            std::process::exit(76);
        }
        std::process::exit(77);
    }
    Ok(())
}
pub fn verify_vectors() -> Result<usize> {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/us041-movements.json"))
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
        let current: Option<State> = serde_json::from_value(v["current"].clone())
            .map_err(|_| LocalError::IntegrityFailure)?;
        let target: Option<AccountDescriptor> = serde_json::from_value(v["account"].clone())
            .map_err(|_| LocalError::IntegrityFailure)?;
        let previous: Option<AccountDescriptor> =
            serde_json::from_value(v["previous_account"].clone())
                .map_err(|_| LocalError::IntegrityFailure)?;
        let actual = match serde_json::from_value::<ManualCommand>(v["command"].clone()) {
            Err(_) => serde_json::json!({"error":LocalError::InvalidManualMovement}),
            Ok(command) => {
                let result = command
                    .capture(workspace)
                    .and_then(|command| match target.as_ref() {
                        Some(account) => movement_model::plan(
                            workspace,
                            current,
                            command,
                            account,
                            previous.as_ref(),
                            now,
                        ),
                        None => Err(LocalError::NotFound),
                    });
                match result {
                    Ok(p) => {
                        serde_json::json!({"plan":{"changed":p.changed,"state":p.after,"snapshot":p.snapshot}})
                    }
                    Err(error) => serde_json::json!({"error":error}),
                }
            }
        };
        if actual != v["expected"] {
            eprintln!("US041_VECTOR_MISMATCH_{index}");
            return Err(LocalError::IntegrityFailure);
        }
    }
    Ok(vectors.len())
}
