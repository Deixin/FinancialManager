//! SQLCipher adapter for the pure account model. Never accepts SQL or filesystem paths.
use crate::{
    LocalError, Result,
    account_model::{self, Account, AccountChange, AccountPlan, AccountState, Action, Reference},
    identity,
    local_workspaces::Installation,
};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
pub const MAX_SNAPSHOT_RECORDS: i64 = 200_000;
pub const MAX_SNAPSHOT_BYTES: usize = 32 * 1024 * 1024;
pub const MAX_COMMAND_BYTES: usize = 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Movement {
    pub id: String,
    pub workspace_id: String,
    pub account_id: String,
    pub group_id: Option<String>,
    pub financial_date: String,
    pub account_amount_minor: String,
    pub economic_kind: String,
    pub posting_state: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountsSnapshot {
    pub workspace_id: String,
    pub read_at: String,
    pub accounts: Vec<AccountState>,
    pub movements: Vec<Movement>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountResult {
    pub changed: bool,
    pub account_id: String,
    pub reference_id: Option<String>,
}
fn account_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Account> {
    Ok(Account {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        name: row.get(2)?,
        institution_name: row.get(3)?,
        account_kind: row.get(4)?,
        balance_nature: row.get(5)?,
        currency_code: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
    })
}
fn reference_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Reference> {
    Ok(Reference {
        id: row.get(0)?,
        workspace_id: row.get(1)?,
        account_id: row.get(2)?,
        amount_minor: row.get::<_, i64>(3)?.to_string(),
        reference_date: row.get(4)?,
        day_position: row.get(5)?,
        source: row.get(6)?,
        status: row.get(7)?,
        created_at: row.get(8)?,
    })
}
pub(crate) fn read_account(db: &Connection, workspace: &str, id: &str) -> Result<Option<Account>> {
    use rusqlite::OptionalExtension;
    Ok(db.query_row("SELECT id,workspace_id,name,institution_name,account_kind,balance_nature,currency_code,status,created_at FROM financial_account WHERE workspace_id=? AND id=?",params![workspace,id],account_row).optional()?)
}
fn load(db: &Connection, workspace: &str, id: &str) -> Result<Option<AccountState>> {
    let account = read_account(db, workspace, id)?;
    let Some(account) = account else {
        return Ok(None);
    };
    let count: i64 = db.query_row(
        "SELECT count(*) FROM balance_reference WHERE workspace_id=? AND account_id=?",
        params![workspace, id],
        |r| r.get(0),
    )?;
    if count > MAX_SNAPSHOT_RECORDS {
        return Err(LocalError::AccountLimit);
    }
    let references=db.prepare("SELECT id,workspace_id,account_id,amount_minor,reference_date,day_position,source,status,created_at FROM balance_reference WHERE workspace_id=? AND account_id=? ORDER BY id")?.query_map(params![workspace,id],reference_row)?.collect::<std::result::Result<Vec<_>,_>>()?;
    let state = AccountState {
        account,
        references,
    };
    state
        .validate(workspace)
        .map_err(|_| LocalError::IntegrityFailure)?;
    Ok(Some(state))
}
fn one(rows: usize) -> Result<()> {
    if rows == 1 {
        Ok(())
    } else {
        Err(LocalError::IntegrityFailure)
    }
}
fn save(db: &Connection, plan: &AccountPlan) -> Result<()> {
    let a = &plan.state.account;
    match plan.action {
        Action::Create=>one(db.execute("INSERT INTO financial_account(id,workspace_id,name,institution_name,account_kind,balance_nature,currency_code,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",params![a.id,a.workspace_id,a.name,a.institution_name,a.account_kind,a.balance_nature,a.currency_code,a.status,a.created_at])?)?,
        Action::Update=>one(db.execute("UPDATE financial_account SET name=?,institution_name=?,status=? WHERE workspace_id=? AND id=?",params![a.name,a.institution_name,a.status,a.workspace_id,a.id])?)?,
        Action::Reference=>{}
    }
    if let Some(id) = &plan.replaces_id {
        one(db.execute("UPDATE balance_reference SET status='SUPERSEDED' WHERE workspace_id=? AND account_id=? AND id=? AND status='ACTIVE'",params![a.workspace_id,a.id,id])?)?;
    }
    if let Some(id) = &plan.reference_id {
        let r = plan
            .state
            .references
            .iter()
            .find(|r| r.id == *id)
            .ok_or(LocalError::IntegrityFailure)?;
        one(db.execute("INSERT INTO balance_reference(id,workspace_id,account_id,amount_minor,reference_date,day_position,source,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)",params![r.id,r.workspace_id,r.account_id,account_model::money(&r.amount_minor)?,r.reference_date,r.day_position,r.source,r.status,r.created_at])?)?;
    }
    Ok(())
}
pub(crate) fn snapshot(db: &Connection, workspace: &str) -> Result<AccountsSnapshot> {
    let count:i64=db.query_row("SELECT (SELECT count(*) FROM financial_account WHERE workspace_id=?1)+(SELECT count(*) FROM balance_reference WHERE workspace_id=?1)+(SELECT count(*) FROM financial_transaction WHERE workspace_id=?1 AND deleted_at IS NULL)",[workspace],|r|r.get(0))?;
    if count > MAX_SNAPSHOT_RECORDS {
        return Err(LocalError::AccountLimit);
    }
    let ids = db
        .prepare("SELECT id FROM financial_account WHERE workspace_id=? ORDER BY id")?
        .query_map([workspace], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut accounts = Vec::with_capacity(ids.len());
    for id in ids {
        accounts.push(load(db, workspace, &id)?.ok_or(LocalError::IntegrityFailure)?);
    }
    let movements=db.prepare("SELECT id,workspace_id,account_id,group_id,financial_date,account_amount_minor,economic_kind FROM financial_transaction WHERE workspace_id=? AND deleted_at IS NULL ORDER BY financial_date,id")?.query_map([workspace],|r|Ok(Movement{id:r.get(0)?,workspace_id:r.get(1)?,account_id:r.get(2)?,group_id:r.get(3)?,financial_date:r.get(4)?,account_amount_minor:r.get::<_,i64>(5)?.to_string(),economic_kind:r.get(6)?,posting_state:"CONFIRMED".into()}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let snapshot = AccountsSnapshot {
        workspace_id: workspace.into(),
        read_at: identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?,
        accounts,
        movements,
    };
    if serde_json::to_vec(&snapshot)
        .map_err(|_| LocalError::IntegrityFailure)?
        .len()
        > MAX_SNAPSHOT_BYTES
    {
        return Err(LocalError::AccountLimit);
    }
    Ok(snapshot)
}
impl Installation {
    pub fn read_accounts(&self, workspace: &str) -> Result<AccountsSnapshot> {
        let mut db = self.financial_database(workspace)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let value = snapshot(&tx, workspace)?;
        tx.commit()?;
        Ok(value)
    }
    pub fn apply_account_change(
        &self,
        workspace: &str,
        input: AccountChange,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<AccountResult> {
        if serde_json::to_vec(&input)
            .map_err(|_| LocalError::InvalidAccountChange)?
            .len()
            > MAX_COMMAND_BYTES
        {
            return Err(LocalError::AccountLimit);
        }
        let input = input.capture(workspace)?;
        let mut db = self.financial_database(workspace)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = load(&tx, workspace, input.account_id())?;
        let now = identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?;
        let plan = account_model::plan(workspace, current, input, &now)?;
        if plan.changed {
            save(&tx, &plan)?;
        }
        before_commit()?;
        #[cfg(feature = "accounts-smoke")]
        crate::account_probe::checkpoint(&tx, 1)?;
        tx.commit()?;
        #[cfg(feature = "accounts-smoke")]
        crate::account_probe::checkpoint(&db, 2)?;
        Ok(AccountResult {
            changed: plan.changed,
            account_id: plan.state.account.id,
            reference_id: plan.reference_id,
        })
    }
}
