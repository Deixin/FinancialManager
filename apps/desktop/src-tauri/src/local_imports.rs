//! Local authority has all accounts. Every projection and preparation uses one SQLCipher transaction.
use crate::{LocalError, Result, identity, import_model as model, local_workspaces::Installation};
use rusqlite::{Connection, TransactionBehavior, params, types::ValueRef};
use serde_json::{Value, json};
fn rows(db: &Connection, sql: &str, args: impl rusqlite::Params) -> Result<Vec<Value>> {
    let mut q = db.prepare(sql)?;
    let names = q
        .column_names()
        .iter()
        .map(|s| s.to_string())
        .collect::<Vec<_>>();
    let mut cursor = q.query(args)?;
    let mut out = vec![];
    while let Some(r) = cursor.next()? {
        let mut m = serde_json::Map::new();
        for (i, k) in names.iter().enumerate() {
            let v = match r.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Text(s) => Value::String(
                    std::str::from_utf8(s)
                        .map_err(|_| LocalError::InvalidImportState)?
                        .into(),
                ),
                ValueRef::Integer(n) => Value::String(n.to_string()),
                _ => return Err(LocalError::InvalidImportState),
            };
            m.insert(k.clone(), v);
        }
        out.push(Value::Object(m));
    }
    Ok(out)
}
const BATCH: &str = "SELECT id,workspace_id,target_account_id,batch_kind,status,reverses_batch_id,created_by_member_id,created_at,committed_at,version,failure_code FROM import_batch";
fn batch(db: &Connection, w: &str, id: &str) -> Result<Option<Value>> {
    let r = rows(
        db,
        &format!("{BATCH} WHERE workspace_id=? AND id=?"),
        params![w, id],
    )?
    .pop();
    if let Some(b) = &r {
        model::batch(b, w)?;
    }
    Ok(r)
}
fn counts(
    db: &Connection,
    w: &str,
    b: &str,
    table: &str,
    column: &str,
    keys: &[&str],
    limit: i64,
) -> Result<(Value, String)> {
    let sql = format!(
        "SELECT {column},count(*) AS n FROM {table} WHERE workspace_id=? AND batch_id=? GROUP BY {column}"
    );
    let mut out = keys
        .iter()
        .map(|k| (k.to_string(), json!("0")))
        .collect::<serde_json::Map<_, _>>();
    let mut total = 0i64;
    for r in rows(db, &sql, params![w, b])? {
        let k = model::text(&r, column)?;
        if !keys.contains(&k) {
            return Err(LocalError::InvalidImportState);
        }
        let n = model::count(&r["n"])?;
        total = total.checked_add(n).ok_or(LocalError::ImportLimit)?;
        out.insert(k.into(), json!(n.to_string()));
    }
    if total > limit {
        return Err(LocalError::ImportLimit);
    }
    Ok((Value::Object(out), total.to_string()))
}
fn summary(db: &Connection, w: &str, b: Value) -> Result<Value> {
    let id = model::text(&b, "id")?;
    let sources = rows(
        db,
        "SELECT * FROM import_source WHERE workspace_id=? AND batch_id=? ORDER BY id LIMIT 17",
        params![w, id],
    )?;
    if sources.len() > 16 {
        return Err(LocalError::ImportLimit);
    }
    for s in &sources {
        model::source(s, w, id)?;
    }
    let (items, total_items) = counts(
        db,
        w,
        id,
        "import_item",
        "disposition",
        &model::ITEMS,
        200000,
    )?;
    let (effects, total_effects) = counts(
        db,
        w,
        id,
        "import_effect",
        "action",
        &model::ACTIONS,
        400000,
    )?;
    Ok(
        json!({"batch":b,"sources":sources,"counts":{"items":items,"effects":effects,"total_items":total_items,"total_effects":total_effects}}),
    )
}
fn detail(db: &Connection, w: &str, input: &Value) -> Result<Value> {
    let id = model::text(input, "id")?;
    let b = batch(db, w, id)?.ok_or(LocalError::ImportNotFound)?;
    let mut out = summary(db, w, b)?;
    let limit = input["effect_limit"]
        .as_i64()
        .ok_or(LocalError::InvalidImportRequest)?;
    let mut effects = rows(
        db,
        "SELECT * FROM import_effect WHERE workspace_id=? AND batch_id=? AND (? IS NULL OR id>?) ORDER BY id LIMIT ?",
        params![
            w,
            id,
            input["effect_after"].as_str(),
            input["effect_after"].as_str(),
            limit + 1
        ],
    )?;
    for e in &effects {
        model::effect(e, w, id)?;
    }
    let cursor = if effects.len() > limit as usize {
        effects.truncate(limit as usize);
        effects
            .last()
            .map(|e| e["id"].clone())
            .unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    out["effects"] = json!(effects);
    out["next_effect_cursor"] = cursor;
    Ok(out)
}
/// Also used before publishing backup/restore, so valid SQL cannot hide malformed metadata.
pub(crate) fn validate_ledger(db: &Connection, w: &str) -> Result<()> {
    let mut last = String::new();
    loop {
        let batches = rows(
            db,
            &format!("{BATCH} WHERE workspace_id=? AND id>? ORDER BY id LIMIT 100"),
            params![w, last],
        )?;
        if batches.is_empty() {
            break;
        }
        for b in batches {
            model::batch(&b, w)?;
            let id = model::text(&b, "id")?.to_owned();
            summary(db, w, b)?;
            let mut after = String::new();
            loop {
                let effects = rows(
                    db,
                    "SELECT * FROM import_effect WHERE workspace_id=? AND batch_id=? AND id>? ORDER BY id LIMIT 100",
                    params![w, id, after],
                )?;
                if effects.is_empty() {
                    break;
                }
                for e in effects {
                    model::effect(&e, w, &id)?;
                    after = model::text(&e, "id")?.into();
                }
            }
            last = id;
        }
    }
    Ok(())
}
impl Installation {
    pub fn list_imports(&self, w: &str, input: Value) -> Result<Value> {
        model::query(&input)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let ss = serde_json::to_string(&input["statuses"])
            .map_err(|_| LocalError::InvalidImportRequest)?;
        let limit = input["limit"]
            .as_i64()
            .ok_or(LocalError::InvalidImportRequest)?;
        let candidates = rows(
            &tx,
            &format!(
                "{BATCH} WHERE workspace_id=? AND (json_array_length(?)=0 OR status IN (SELECT value FROM json_each(?))) AND (? IS NULL OR target_account_id=?) AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT ?"
            ),
            params![
                w,
                ss,
                ss,
                input["account_id"].as_str(),
                input["account_id"].as_str(),
                input["cursor"]["created_at"].as_str(),
                input["cursor"]["created_at"].as_str(),
                input["cursor"]["created_at"].as_str(),
                input["cursor"]["id"].as_str(),
                limit + 1
            ],
        )?;
        for b in &candidates {
            model::batch(b, w)?;
        }
        let has_next = candidates.len() > limit as usize;
        let mut items = vec![];
        let mut cursor = Value::Null;
        for b in candidates.into_iter().take(limit as usize) {
            cursor = json!({"id":b["id"],"created_at":b["created_at"]});
            items.push(summary(&tx, w, b)?);
        }
        tx.commit()?;
        Ok(json!({"items":items,"next_cursor":if has_next {cursor}else{Value::Null}}))
    }
    pub fn read_import(&self, w: &str, input: Value) -> Result<Value> {
        model::detail(&input)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let out = detail(&tx, w, &input)?;
        tx.commit()?;
        Ok(out)
    }
    pub fn prepare_import(
        &self,
        w: &str,
        input: Value,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<Value> {
        model::prepare(&input)?;
        let id = model::text(&input, "id")?;
        let account = model::text(&input, "target_account_id")?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = batch(&tx, w, id)?;
        let created = existing.is_none();
        let b = if let Some(b) = existing {
            if b["batch_kind"] != "IMPORT"
                || b["target_account_id"] != account
                || !b["created_by_member_id"].is_null()
            {
                return Err(LocalError::ImportBaseConflict);
            }
            b
        } else {
            let a = crate::local_accounts::read_account(&tx, w, account)?
                .ok_or(LocalError::ImportAccountUnavailable)?;
            if a.status != "ACTIVE" {
                return Err(LocalError::ImportAccountUnavailable);
            }
            let now = identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?;
            tx.execute("INSERT INTO import_batch(id,workspace_id,target_account_id,batch_kind,status,created_at,version) VALUES(?,?,?,'IMPORT','PREPARING',?,1)",params![id,w,account,now])?;
            batch(&tx, w, id)?.ok_or(LocalError::InvalidImportState)?
        };
        let mut out = summary(&tx, w, b)?;
        out["created"] = json!(created);
        before_commit()?;
        tx.commit()?;
        Ok(out)
    }
}
