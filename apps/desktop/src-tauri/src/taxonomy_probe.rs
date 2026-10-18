//! SYNTHETIC_US045_DESKTOP_ONLY. Excluded from the production feature set.
use crate::{
    LocalError, Result,
    taxonomy_model::{self, Catalog, Command},
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
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/us045-taxonomy.json"))
            .map_err(|_| LocalError::IntegrityFailure)?;
    if fixture["synthetic_only"] != true {
        return Err(LocalError::IntegrityFailure);
    }
    let vectors = fixture["vectors"]
        .as_array()
        .ok_or(LocalError::IntegrityFailure)?;
    for (index, v) in vectors.iter().enumerate() {
        let w = v["workspace_id"]
            .as_str()
            .ok_or(LocalError::IntegrityFailure)?;
        let actual = match serde_json::from_value::<Command>(v["command"].clone()) {
            Err(_) => serde_json::json!({"error":LocalError::InvalidTaxonomyChange}),
            Ok(c) => {
                let current: Catalog = serde_json::from_value(v["current"].clone())
                    .map_err(|_| LocalError::IntegrityFailure)?;
                match taxonomy_model::plan(w, current, c) {
                    Ok(plans) => serde_json::json!({"plans":plans}),
                    Err(e) => serde_json::json!({"error":e}),
                }
            }
        };
        if actual != v["expected"] {
            eprintln!("US045_CATEGORY_VECTOR_MISMATCH_{index}");
            return Err(LocalError::IntegrityFailure);
        }
    }
    Ok(vectors.len())
}
