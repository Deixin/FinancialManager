//! Narrow SQLCipher adapter. No SQL, paths, actor or snapshots supplied for writing.
use crate::{
    LocalError, Result, identity,
    local_accounts::{self, AccountsSnapshot},
    local_workspaces::Installation,
    movement_model::{
        self, AccountDescriptor, Allocation, Content, ManualCommand, Plan, Snapshot, State,
    },
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
const MAX_RECORDS: i64 = 200_000;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_COMMAND: usize = 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovementResult {
    pub changed: bool,
    pub id: String,
    pub base_revision: String,
    pub version: String,
    pub revision_id: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct History {
    pub id: String,
    pub transaction_id: String,
    pub version: String,
    pub created_at: String,
    pub change_source: String,
    pub compatible: bool,
    pub snapshot: Option<Snapshot>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MovementsSnapshot {
    pub balance: AccountsSnapshot,
    pub transactions: Vec<State>,
    pub history: Vec<History>,
}
pub(crate) fn load(db: &Connection, w: &str, id: &str) -> Result<Option<State>> {
    let state=db.query_row("SELECT workspace_id,id,version,created_at,updated_at,deleted_at,account_id,group_id,counterparty_id,financial_date,account_amount_minor,economic_kind,original_description,display_name,origin_kind FROM financial_transaction WHERE workspace_id=? AND id=?",params![w,id],|r|Ok(State{workspace_id:r.get(0)?,id:r.get(1)?,version:r.get::<_,i64>(2)?.to_string(),created_at:r.get(3)?,updated_at:r.get(4)?,deleted_at:r.get(5)?,content:Content{account_id:r.get(6)?,group_id:r.get(7)?,counterparty_id:r.get(8)?,financial_date:r.get(9)?,account_amount_minor:r.get::<_,i64>(10)?.to_string(),economic_kind:r.get(11)?,original_description:r.get(12)?,display_name:r.get(13)?,origin_kind:r.get(14)?,deleted:r.get::<_,Option<String>>(5)?.is_some(),allocations:vec![],tag_ids:vec![]}})).optional()?;
    let Some(mut state) = state else {
        return Ok(None);
    };
    let count:i64=db.query_row("SELECT (SELECT count(*) FROM transaction_allocation WHERE workspace_id=?1 AND transaction_id=?2)+(SELECT count(*) FROM transaction_tag WHERE workspace_id=?1 AND transaction_id=?2)",params![w,id],|r|r.get(0))?;
    if count > MAX_RECORDS {
        return Err(LocalError::MovementLimit);
    }
    state.content.allocations=db.prepare("SELECT id,category_id,subcategory_id,amount_minor,note FROM transaction_allocation WHERE workspace_id=? AND transaction_id=? ORDER BY id")?.query_map(params![w,id],|r|Ok(Allocation{id:r.get(0)?,category_id:r.get(1)?,subcategory_id:r.get(2)?,amount_minor:r.get::<_,i64>(3)?.to_string(),note:r.get(4)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    state.content.tag_ids=db.prepare("SELECT tag_id FROM transaction_tag WHERE workspace_id=? AND transaction_id=? ORDER BY tag_id")?.query_map(params![w,id],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    state
        .capture()
        .map(Some)
        .map_err(|_| LocalError::IntegrityFailure)
}
fn save(db: &Connection, plan: &Plan, revision: &str, at: &str) -> Result<()> {
    let a = &plan.after;
    let c = &a.content;
    let rows = if let Some(before) = &plan.before {
        db.execute("UPDATE financial_transaction SET account_id=?,group_id=?,counterparty_id=?,financial_date=?,account_amount_minor=?,economic_kind=?,original_description=?,display_name=?,origin_kind=?,version=?,deleted_at=?,updated_at=? WHERE workspace_id=? AND id=? AND version=?",params![c.account_id,c.group_id,c.counterparty_id,c.financial_date,movement_model::integer(&c.account_amount_minor)?,c.economic_kind,c.original_description,c.display_name,c.origin_kind,movement_model::version(&a.version,false)?,a.deleted_at,a.updated_at,a.workspace_id,a.id,movement_model::version(&before.version,false)?])?
    } else {
        db.execute("INSERT INTO financial_transaction(id,workspace_id,account_id,group_id,counterparty_id,financial_date,account_amount_minor,economic_kind,original_description,display_name,origin_kind,version,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",params![a.id,a.workspace_id,c.account_id,c.group_id,c.counterparty_id,c.financial_date,movement_model::integer(&c.account_amount_minor)?,c.economic_kind,c.original_description,c.display_name,c.origin_kind,movement_model::version(&a.version,false)?,a.deleted_at,a.created_at,a.updated_at])?
    };
    if rows != 1 {
        return Err(LocalError::VersionConflict);
    }
    db.execute(
        "DELETE FROM transaction_allocation WHERE workspace_id=? AND transaction_id=?",
        params![a.workspace_id, a.id],
    )?;
    for allocation in &c.allocations {
        db.execute("INSERT INTO transaction_allocation(id,workspace_id,transaction_id,category_id,subcategory_id,amount_minor,note) VALUES(?,?,?,?,?,?,?)",params![allocation.id,a.workspace_id,a.id,allocation.category_id,allocation.subcategory_id,movement_model::integer(&allocation.amount_minor)?,allocation.note])?;
    }
    db.execute(
        "DELETE FROM transaction_tag WHERE workspace_id=? AND transaction_id=?",
        params![a.workspace_id, a.id],
    )?;
    for tag in &c.tag_ids {
        db.execute(
            "INSERT INTO transaction_tag(workspace_id,transaction_id,tag_id) VALUES(?,?,?)",
            params![a.workspace_id, a.id, tag],
        )?;
    }
    db.execute("INSERT INTO transaction_revision(id,workspace_id,transaction_id,version,snapshot,actor_type,actor_id,device_id,change_source,created_at) VALUES(?,?,?,?,?,'LOCAL_USER',NULL,NULL,'MANUAL',?)",params![revision,a.workspace_id,a.id,movement_model::version(&a.version,false)?,serde_json::to_string(plan.snapshot.as_ref().ok_or(LocalError::IntegrityFailure)?).map_err(|_|LocalError::IntegrityFailure)?,at])?;
    Ok(())
}
impl Installation {
    pub fn read_movements(&self, w: &str) -> Result<MovementsSnapshot> {
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let (count,history_bytes):(i64,i64)=tx.query_row("SELECT (SELECT count(*) FROM financial_account WHERE workspace_id=?1)+(SELECT count(*) FROM balance_reference WHERE workspace_id=?1)+(SELECT count(*) FROM financial_transaction WHERE workspace_id=?1)+(SELECT count(*) FROM transaction_allocation WHERE workspace_id=?1)+(SELECT count(*) FROM transaction_tag WHERE workspace_id=?1)+(SELECT count(*) FROM transaction_revision WHERE workspace_id=?1),coalesce((SELECT sum(length(snapshot)) FROM transaction_revision WHERE workspace_id=?1),0)",[w],|r|Ok((r.get(0)?,r.get(1)?)))?;
        if count > MAX_RECORDS || history_bytes > MAX_BYTES as i64 {
            return Err(LocalError::MovementLimit);
        }
        let balance = local_accounts::snapshot(&tx, w)?;
        let ids=tx.prepare("SELECT id FROM financial_transaction WHERE workspace_id=? ORDER BY financial_date,id")?.query_map([w],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let mut transactions = Vec::with_capacity(ids.len());
        for id in ids {
            transactions.push(load(&tx, w, &id)?.ok_or(LocalError::IntegrityFailure)?);
        }
        let raw=tx.prepare("SELECT id,transaction_id,version,created_at,change_source,snapshot FROM transaction_revision WHERE workspace_id=? ORDER BY transaction_id,version")?.query_map([w],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,i64>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?)))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let mut history = Vec::with_capacity(raw.len());
        for (id, transaction_id, version, created_at, change_source, text) in raw {
            identity::resource_id(&id).map_err(|_| LocalError::IntegrityFailure)?;
            identity::resource_id(&transaction_id).map_err(|_| LocalError::IntegrityFailure)?;
            identity::utc_instant(&created_at).map_err(|_| LocalError::IntegrityFailure)?;
            if version < 1
                || ![
                    "MANUAL",
                    "IMPORT",
                    "SYNC_RESOLUTION",
                    "REVERSAL",
                    "MIGRATION",
                    "SYSTEM",
                ]
                .contains(&change_source.as_str())
            {
                return Err(LocalError::IntegrityFailure);
            }
            let snapshot = serde_json::from_str::<Snapshot>(&text)
                .ok()
                .and_then(|s| s.capture().ok())
                .filter(|s| {
                    s.after.workspace_id == w
                        && s.after.id == transaction_id
                        && s.after.version == version.to_string()
                });
            history.push(History {
                id,
                transaction_id,
                version: version.to_string(),
                created_at,
                change_source,
                compatible: snapshot.is_some(),
                snapshot,
            });
        }
        let value = MovementsSnapshot {
            balance,
            transactions,
            history,
        };
        if serde_json::to_vec(&value)
            .map_err(|_| LocalError::IntegrityFailure)?
            .len()
            > MAX_BYTES
        {
            return Err(LocalError::MovementLimit);
        }
        tx.commit()?;
        Ok(value)
    }
    pub fn apply_manual_movement(
        &self,
        w: &str,
        input: ManualCommand,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<MovementResult> {
        if serde_json::to_vec(&input)
            .map_err(|_| LocalError::InvalidManualMovement)?
            .len()
            > MAX_COMMAND
        {
            return Err(LocalError::MovementLimit);
        }
        let command = input.capture(w)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load(&tx, w, command.transaction_id())?;
        let target = local_accounts::read_account(&tx, w, command.account_id())?
            .map(|a| AccountDescriptor::from(&a))
            .ok_or(LocalError::NotFound)?;
        let previous = current
            .as_ref()
            .map(|s| local_accounts::read_account(&tx, w, &s.content.account_id))
            .transpose()?
            .flatten()
            .map(|a| AccountDescriptor::from(&a));
        let now = identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?;
        let plan = movement_model::plan(w, current, command, &target, previous.as_ref(), &now)?;
        let revision = if plan.changed {
            Some(
                identity::new_id()
                    .map_err(|_| LocalError::StorageUnavailable)?
                    .to_string(),
            )
        } else {
            None
        };
        if let Some(id) = &revision {
            save(&tx, &plan, id, &now)?;
        }
        before_commit()?;
        #[cfg(feature = "movements-smoke")]
        crate::movement_probe::checkpoint(&tx, 1)?;
        tx.commit()?;
        #[cfg(feature = "movements-smoke")]
        crate::movement_probe::checkpoint(&db, 2)?;
        Ok(MovementResult {
            changed: plan.changed,
            id: plan.after.id,
            base_revision: plan.before.map_or_else(|| "0".into(), |s| s.version),
            version: plan.after.version,
            revision_id: revision,
        })
    }
}
