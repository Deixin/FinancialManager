//! Explicitly synthetic FIN-002 ledger. Excluded from production builds.
use crate::{
    LocalError, Result, import_model,
    keys::{KeyStore, WindowsKeyStore},
    local_backup::{CreateBackup, read_verified},
    local_restore,
    local_workspaces::Installation,
    vault_probe,
};
use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::{path::Path, sync::Arc};
pub const PASSWORD: &str = "SYNTHETIC US050 portable backup password";
pub fn id(n: u32) -> String {
    format!("0199d050-0000-7000-8000-{n:012}")
}
pub fn seed(db: &Connection, w: &str) -> Result<()> {
    let account:String=db.query_row("SELECT id FROM financial_account WHERE workspace_id=? AND status='ACTIVE' ORDER BY id LIMIT 1",[w],|r|r.get(0))?;
    let (transaction,revision):(String,String)=db.query_row("SELECT transaction_id,id FROM transaction_revision WHERE workspace_id=? ORDER BY transaction_id,version DESC LIMIT 1",[w],|r|Ok((r.get(0)?,r.get(1)?)))?;
    db.execute("INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,actor_id,device_id,change_source,created_at) SELECT ?,workspace_id,transaction_id,version+1,'{}',actor_type,actor_id,device_id,change_source,created_at FROM transaction_revision WHERE id=?",params![id(990),revision])?;
    db.execute(
        "UPDATE financial_transaction SET version=version+1 WHERE workspace_id=? AND id=?",
        params![w, transaction],
    )?;
    db.execute_batch("BEGIN IMMEDIATE")?;
    for (n, status) in import_model::STATUSES.iter().enumerate() {
        let b = id(100 + n as u32);
        let committed = ["COMMITTED", "REVERSED", "PARTIALLY_REVERSED"]
            .contains(status)
            .then_some("2026-10-20T12:00:00.000Z");
        let failure = (*status == "FAILED").then_some("SYNTHETIC_FAILURE");
        db.execute("INSERT INTO import_batch(id,workspace_id,target_account_id,batch_kind,status,created_at,committed_at,version,failure_code) VALUES(?,?,?,'IMPORT',?,'2026-10-20T11:00:00.000Z',?,2,?)",params![b,w,account,status,committed,failure])?;
    }
    // Insert reversal before its parent in rowid order to exercise deferred FK restoration.
    db.execute_batch("PRAGMA defer_foreign_keys=ON")?;
    db.execute("INSERT INTO import_batch(id,workspace_id,target_account_id,batch_kind,status,reverses_batch_id,created_at) VALUES(?,?,?,'REVERSAL','PREPARING',?,'2026-10-20T11:00:00.000Z')",params![id(108),w,account,id(109)])?;
    db.execute("INSERT INTO import_batch(id,workspace_id,target_account_id,batch_kind,status,created_at) VALUES(?,?,?,'IMPORT','PREPARING','2026-10-20T11:00:00.000Z')",params![id(109),w,account])?;
    db.execute("INSERT INTO import_source(id,workspace_id,batch_id,file_name,file_hash,format,parser_name,parser_version,detected_currency,period_start,period_end,imported_at) VALUES(?,?,?,'SYNTHETIC-extrato.ofx',?,'OFX','SYNTHETIC','1','BRL','2026-01-01','2026-01-31','2026-10-20T11:00:00.000Z')",params![id(200),w,id(103),"a".repeat(64)])?;
    for (n, d) in import_model::ITEMS.iter().enumerate() {
        db.execute("INSERT INTO import_item(id,workspace_id,batch_id,source_id,row_no,source_external_id,normalized_date,normalized_amount_minor,original_description,disposition,provenance) VALUES(?,?,?,?,?,'SYNTHETIC-EXTERNAL-ID','2026-01-01',9007199254740993,'SYNTHETIC ORIGINAL',?,'{\"synthetic\":true}')",params![id(300+n as u32),w,id(103),id(200),n as i64+1,d])?;
    }
    for (n, a) in import_model::ACTIONS.iter().enumerate() {
        db.execute("INSERT INTO import_effect(id,workspace_id,batch_id,import_item_id,transaction_id,action,before_revision_id,after_revision_id,created_at) VALUES(?,?,?,?,?,?,?,?, '2026-10-20T12:00:00.000Z')",params![id(400+n as u32),w,id(103),id(300),transaction,a,if *a=="CREATE"{None}else{Some(revision.as_str())},if *a=="CREATE"{revision.clone()}else{id(990)}])?;
    }
    db.execute_batch("COMMIT")?;
    Ok(())
}
pub fn create(root: &Path) -> Result<()> {
    let keys = Arc::new(WindowsKeyStore);
    let i = vault_probe::fixture(root, keys)?;
    i.open_workspace(&vault_probe::dataset_workspace().to_string())?;
    let db = vault_probe::open_fixture(root, &WindowsKeyStore)?;
    seed(&db, &vault_probe::dataset_workspace().to_string())?;
    drop(db);
    i.create(crate::workspace_model::CreateWorkspace {
        workspace_id: id(9999),
        display_name: "SYNTHETIC EMPTY US050".into(),
        purpose: crate::workspace_model::Purpose::Other,
    })?;
    drop(i);
    let state = crate::commands::LocalState::new(root.to_path_buf(), Arc::new(WindowsKeyStore));
    state.configure(crate::local_lock::ConfigurePin {
        current_pin: None,
        new_pin: "721947350682".into(),
        confirm_pin: "721947350682".into(),
    })?;
    Ok(())
}
pub fn run(mode: &str, root: &Path) -> Result<Value> {
    let w = vault_probe::dataset_workspace().to_string();
    if mode == "prepare" {
        create(root)?;
        return Ok(json!({"passed":true}));
    }
    let i = Installation::open(root, Arc::new(WindowsKeyStore))?;
    if mode == "read" {
        return Ok(
            json!({"passed":true,"page":i.list_imports(&w,json!({"statuses":[],"account_id":null,"cursor":null,"limit":100}))?,"detail":i.read_import(&w,json!({"id":id(103),"effect_after":null,"effect_limit":100}))?}),
        );
    }
    if mode == "movements" {
        return Ok(json!({"passed":true,"snapshot":i.read_movements(&w)?}));
    }
    if mode == "parity" {
        let account = i.list_imports(
            &w,
            json!({"statuses":[],"account_id":null,"cursor":null,"limit":1}),
        )?["items"][0]["batch"]["target_account_id"]
            .clone();
        let mut lists = vec![];
        let mut input = json!({"statuses":[],"account_id":null,"cursor":null,"limit":2});
        loop {
            let result = i.list_imports(&w, input.clone())?;
            let cursor = result["next_cursor"].clone();
            lists.push(json!({"input":input,"result":result}));
            if cursor.is_null() {
                break;
            }
            input["cursor"] = cursor;
        }
        for status in import_model::STATUSES {
            let input = json!({"statuses":[status],"account_id":account,"cursor":null,"limit":100});
            let result = i.list_imports(&w, input.clone())?;
            lists.push(json!({"input":input,"result":result}));
        }
        let mut details = vec![];
        let mut input = json!({"id":id(103),"effect_after":null,"effect_limit":2});
        loop {
            let result = i.read_import(&w, input.clone())?;
            let cursor = result["next_effect_cursor"].clone();
            details.push(json!({"input":input,"result":result}));
            if cursor.is_null() {
                break;
            }
            input["effect_after"] = cursor;
        }
        return Ok(json!({"passed":true,"lists":lists,"details":details}));
    }
    if mode == "prepare-header" {
        let account = i.list_imports(
            &w,
            json!({"statuses":[],"account_id":null,"cursor":null,"limit":1}),
        )?["items"][0]["batch"]["target_account_id"]
            .clone();
        let input = json!({"id":id(950),"target_account_id":account});
        let first = i.prepare_import(&w, input.clone(), || Ok(()))?;
        let replay = i.prepare_import(&w, input, || Ok(()))?;
        let conflicting_account = id(999);
        let conflict = i
            .prepare_import(
                &w,
                json!({"id":id(950),"target_account_id":conflicting_account}),
                || Ok(()),
            )
            .err()
            .ok_or(LocalError::IntegrityFailure)?;
        return Ok(
            json!({"passed":true,"first":first,"replay":replay,"conflicting_account":conflicting_account,"conflict":conflict}),
        );
    }
    if mode == "backup" {
        i.prepare_backup(&CreateBackup {
            workspace_id: w,
            password: PASSWORD.into(),
            confirmation: PASSWORD.into(),
        })?
        .publish(&root.with_extension("fmbackup"), root, || true)?;
        return Ok(json!({"passed":true}));
    }
    if mode == "restore" {
        let b = read_verified(&root.with_extension("fmbackup"), PASSWORD)?;
        let destination = root.with_extension("restored");
        let target = Installation::open(&destination, Arc::new(WindowsKeyStore))?;
        let p = local_restore::prepare(&target, b)?;
        let result = local_restore::confirm(&target, &p, || true)?;
        let detail=target.read_import(&result.id,json!({"id":target.list_imports(&result.id,json!({"statuses":["COMMITTED"],"account_id":null,"cursor":null,"limit":1}))?["items"][0]["batch"]["id"],"effect_after":null,"effect_limit":100}))?;
        return Ok(json!({"passed":true,"workspace":result,"preview":p.preview,"detail":detail}));
    }
    if mode == "cleanup" {
        let (installation, _) = i.probe_details();
        for row in i.list()? {
            let id =
                crate::identity::resource_id(&row.id).map_err(|_| LocalError::InvalidWorkspace)?;
            WindowsKeyStore.delete(installation, id)?;
        }
        return Ok(json!({"passed":true}));
    }
    Err(LocalError::InvalidImportRequest)
}
