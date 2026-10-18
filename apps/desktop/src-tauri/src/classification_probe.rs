//! SYNTHETIC_US045_CLASSIFICATION_ONLY. Process faults are absent from production.
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
        classification_model::{self, Command},
        movement_model::{AccountDescriptor, State},
        taxonomy_model::Catalog,
        transfer_model::Group,
    };
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../fixtures/us045-classification.json"))
            .map_err(|_| LocalError::IntegrityFailure)?;
    if fixture["synthetic_only"] != true {
        return Err(LocalError::IntegrityFailure);
    }
    let vectors = fixture["vectors"]
        .as_array()
        .ok_or(LocalError::IntegrityFailure)?;
    for (index, v) in vectors.iter().enumerate() {
        let run = || -> Result<Vec<crate::movement_model::Plan>> {
            let w = v["workspace_id"]
                .as_str()
                .ok_or(LocalError::InvalidClassification)?;
            let commands: Vec<Command> = serde_json::from_value(v["commands"].clone())
                .map_err(|_| LocalError::InvalidClassification)?;
            let commands = classification_model::capture_batch(w, commands)?;
            let current: Vec<State> = serde_json::from_value(v["current"].clone())
                .map_err(|_| LocalError::IntegrityFailure)?;
            let accounts: Vec<AccountDescriptor> = serde_json::from_value(v["accounts"].clone())
                .map_err(|_| LocalError::IntegrityFailure)?;
            let catalog: Catalog = serde_json::from_value(v["catalog"].clone())
                .map_err(|_| LocalError::IntegrityFailure)?;
            let groups: Vec<Group> = serde_json::from_value(v["groups"].clone())
                .map_err(|_| LocalError::IntegrityFailure)?;
            let now = v["now"].as_str().ok_or(LocalError::IntegrityFailure)?;
            let mut plans = vec![];
            for c in commands {
                let row = current.iter().find(|r| r.id == c.base.id).cloned();
                let a = accounts.iter().find(|a| a.id == c.base.content.account_id);
                plans.push(classification_model::plan(
                    w,
                    c,
                    row,
                    a,
                    || Ok(catalog.clone()),
                    now,
                )?);
            }
            classification_model::validate_groups(w, &plans, &accounts, &groups)?;
            Ok(plans)
        };
        let actual = match run() {
            Err(e) => serde_json::json!({"error":e}),
            Ok(plans) => {
                serde_json::json!({"plans":plans.into_iter().map(|p|serde_json::json!({"changed":p.changed,"before":p.before,"after":p.after,"snapshot":p.snapshot})).collect::<Vec<_>>()})
            }
        };
        if actual != v["expected"] {
            eprintln!("US045_CLASSIFICATION_VECTOR_MISMATCH_{index}");
            return Err(LocalError::IntegrityFailure);
        }
    }
    Ok(vectors.len())
}
pub fn seed_import(
    i: &crate::local_workspaces::Installation,
    w: &str,
    account: &str,
    id: &str,
    split: bool,
) -> Result<()> {
    use crate::movement_model::{Allocation, Content, State};
    let at = "2026-10-18T12:00:00.000Z".to_string();
    let mut c = Content {
        account_id: account.into(),
        group_id: None,
        counterparty_id: None,
        financial_date: "2026-10-17".into(),
        account_amount_minor: "-1000".into(),
        economic_kind: "EXPENSE".into(),
        original_description: Some("SYNTHETIC IMPORT ORIGINAL".into()),
        display_name: if split {
            "SYNTHETIC CLASSIFICATION SPLIT"
        } else {
            "SYNTHETIC CLASSIFICATION IMPORT"
        }
        .into(),
        origin_kind: "IMPORT".into(),
        deleted: false,
        allocations: vec![],
        tag_ids: vec![],
    };
    if split {
        for (n, category, amount) in [(1812, 700, "400"), (1813, 704, "600")] {
            c.allocations.push(Allocation {
                id: format!("0199d345-0000-7000-8000-{n:012}"),
                category_id: format!("0199d345-0000-7000-8000-{category:012}"),
                subcategory_id: None,
                amount_minor: amount.into(),
                note: Some("SYNTHETIC SPLIT NOTE".into()),
            });
        }
    }
    let after = State {
        workspace_id: w.into(),
        id: id.into(),
        version: "1".into(),
        created_at: at.clone(),
        updated_at: at.clone(),
        deleted_at: None,
        content: c,
    }
    .capture()?;
    seed_import_state(i, after)
}
pub fn seed_import_state(
    i: &crate::local_workspaces::Installation,
    state: crate::movement_model::State,
) -> Result<()> {
    use crate::movement_model::{Snapshot, integer};
    use rusqlite::params;
    let s = state.capture()?;
    if s.version != "1" || s.content.origin_kind != "IMPORT" {
        return Err(LocalError::InvalidClassification);
    }
    let c = &s.content;
    let mut db = i.financial_database(&s.workspace_id)?;
    let tx = db.transaction()?;
    // Append-only synthetic fixture setup; no trigger or authorization is disabled.
    tx.execute("INSERT INTO financial_transaction(id,workspace_id,account_id,group_id,counterparty_id,financial_date,account_amount_minor,economic_kind,original_description,display_name,origin_kind,version,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)",params![s.id,s.workspace_id,c.account_id,c.group_id,c.counterparty_id,c.financial_date,integer(&c.account_amount_minor)?,c.economic_kind,c.original_description,c.display_name,c.origin_kind,s.deleted_at,s.created_at,s.updated_at])?;
    for a in &c.allocations {
        tx.execute("INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor,note) VALUES(?,?,?,?,?,?,?)",params![a.id,s.workspace_id,s.id,a.category_id,a.subcategory_id,integer(&a.amount_minor)?,a.note])?;
    }
    for tag in &c.tag_ids {
        tx.execute(
            "INSERT INTO transaction_tag(workspace_id,transaction_id,tag_id) VALUES(?,?,?)",
            params![s.workspace_id, s.id, tag],
        )?;
    }
    let audit = Snapshot {
        format_version: 1,
        base_revision: "0".into(),
        before: None,
        after: s.clone(),
    };
    tx.execute("INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,actor_id,device_id,change_source,created_at) VALUES(?,?,?,1,?,'LOCAL_USER',NULL,NULL,'IMPORT',?)",params![crate::identity::new_id().map_err(|_|LocalError::StorageUnavailable)?.to_string(),s.workspace_id,s.id,serde_json::to_string(&audit).map_err(|_|LocalError::IntegrityFailure)?,s.updated_at])?;
    tx.commit()?;
    Ok(())
}
pub fn financial_digest(i: &crate::local_workspaces::Installation, w: &str) -> Result<String> {
    use sha2::{Digest, Sha256};
    let mut s =
        serde_json::to_value(i.read_transfers(w)?).map_err(|_| LocalError::IntegrityFailure)?;
    let m = s["movements"]
        .as_object_mut()
        .ok_or(LocalError::IntegrityFailure)?;
    m.remove("history");
    m.get_mut("balance")
        .and_then(serde_json::Value::as_object_mut)
        .ok_or(LocalError::IntegrityFailure)?
        .remove("read_at");
    for state in m
        .get_mut("transactions")
        .and_then(serde_json::Value::as_array_mut)
        .ok_or(LocalError::IntegrityFailure)?
    {
        let t = state.as_object_mut().ok_or(LocalError::IntegrityFailure)?;
        t.remove("version");
        t.remove("updated_at");
        let c = t
            .get_mut("content")
            .and_then(serde_json::Value::as_object_mut)
            .ok_or(LocalError::IntegrityFailure)?;
        c.remove("allocations");
        c.remove("tag_ids");
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&s).map_err(|_| LocalError::IntegrityFailure)?)
    ))
}
