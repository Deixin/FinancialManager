//! SQLCipher operations use the same workspace/key/lock guards as other local features.
use crate::{
    LocalError, Result,
    counterparty_association_model::{self as association, Reference},
    counterparty_model::{self, Command, Counterparty},
    identity, local_accounts,
    local_movements::{self, MovementsSnapshot},
    local_transfers,
    local_workspaces::Installation,
    movement_model::AccountDescriptor,
};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::Serialize;
use std::collections::BTreeSet;
#[derive(Serialize)]
pub struct CounterpartySnapshot {
    pub workspace_id: String,
    pub items: Vec<Counterparty>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub movements: Option<MovementsSnapshot>,
}
#[derive(Serialize)]
pub struct AssociationResult {
    pub entries: Vec<local_movements::MovementResult>,
}
#[derive(Serialize)]
pub struct CounterpartyResult {
    pub changed: bool,
    pub items: Vec<Counterparty>,
}
pub(crate) fn rows(db: &Connection, w: &str) -> Result<Vec<Counterparty>> {
    let items=db.prepare("SELECT id,workspace_id,display_name,identifier_type,identifier_value,relationship_hint,status FROM counterparty WHERE workspace_id=? ORDER BY id LIMIT 10001")?.query_map([w],|r|Ok(Counterparty{id:r.get(0)?,workspace_id:r.get(1)?,display_name:r.get(2)?,identifier_type:r.get(3)?,identifier_value:r.get(4)?,relationship_hint:r.get(5)?,status:r.get(6)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    counterparty_model::capture_rows(items, w)
}
impl Installation {
    pub fn read_counterparties(
        &self,
        w: &str,
        include_movements: bool,
    ) -> Result<CounterpartySnapshot> {
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let items = rows(&tx, w)?;
        let movements = if include_movements {
            let count: i64 = tx.query_row(
                "SELECT count(*) FROM financial_transaction WHERE workspace_id=?",
                [w],
                |r| r.get(0),
            )?;
            if count > 10000 {
                return Err(LocalError::MovementLimit);
            }
            let m = local_movements::snapshot(&tx, w)?;
            if m.transactions.iter().any(|r| {
                r.content
                    .counterparty_id
                    .as_ref()
                    .is_some_and(|id| !items.iter().any(|c| &c.id == id))
            }) {
                return Err(LocalError::IntegrityFailure);
            }
            Some(m)
        } else {
            None
        };
        tx.commit()?;
        Ok(CounterpartySnapshot {
            workspace_id: w.into(),
            items,
            movements,
        })
    }
    pub fn apply_counterparty_change(
        &self,
        w: &str,
        input: Command,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<CounterpartyResult> {
        if serde_json::to_vec(&input)
            .map_err(|_| LocalError::InvalidCounterpartyChange)?
            .len()
            > 4 * 1024 * 1024
        {
            return Err(LocalError::CounterpartyLimit);
        }
        let command = input.capture(w)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let plan = counterparty_model::plan(w, rows(&tx, w)?, command)?;
        if let Some(p) = &plan {
            let a = &p.after;
            let count = if p.before.is_none() {
                tx.execute("INSERT INTO counterparty(id,workspace_id,display_name,identifier_type,identifier_value,relationship_hint,status) VALUES(?,?,?,?,?,?,?)",params![a.id,w,a.display_name,a.identifier_type,a.identifier_value,a.relationship_hint,a.status])?
            } else {
                tx.execute("UPDATE counterparty SET display_name=?,identifier_type=?,identifier_value=?,relationship_hint=?,status=? WHERE workspace_id=? AND id=?",params![a.display_name,a.identifier_type,a.identifier_value,a.relationship_hint,a.status,w,a.id])?
            };
            if count != 1 {
                return Err(LocalError::IntegrityFailure);
            }
        }
        let items = rows(&tx, w)?;
        before_commit()?;
        tx.commit()?;
        Ok(CounterpartyResult {
            changed: plan.is_some(),
            items,
        })
    }
    pub fn apply_counterparty_association(
        &self,
        w: &str,
        input: Vec<association::Command>,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<AssociationResult> {
        let commands = association::capture_batch(w, input)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let ids = commands
            .iter()
            .filter_map(|c| c.content().counterparty_id)
            .collect::<BTreeSet<_>>();
        let json =
            serde_json::to_string(&ids).map_err(|_| LocalError::InvalidCounterpartyAssociation)?;
        // Minimal projection, never names or identifiers, in the write transaction.
        let references=tx.prepare("SELECT id,workspace_id,status FROM counterparty WHERE workspace_id=? AND id IN (SELECT value FROM json_each(?)) ORDER BY id")?.query_map(params![w,json],|r|Ok(Reference{id:r.get(0)?,workspace_id:r.get(1)?,status:r.get(2)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
        let now = identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?;
        let mut plans = vec![];
        let mut accounts = vec![];
        for c in commands {
            let current = local_movements::load(&tx, w, &c.base.id)?;
            let account = local_accounts::read_account(&tx, w, &c.base.content.account_id)?
                .as_ref()
                .map(AccountDescriptor::from);
            plans.push(association::plan(
                w,
                c,
                current,
                account.as_ref(),
                &references,
                &now,
            )?);
            accounts.push(account.ok_or(LocalError::NotFound)?);
        }
        let ids = plans
            .iter()
            .filter_map(|p| p.after.content.group_id.as_deref())
            .collect::<BTreeSet<_>>();
        let groups = ids
            .into_iter()
            .map(|id| local_transfers::group(&tx, w, id)?.ok_or(LocalError::CompositeRequired))
            .collect::<Result<Vec<_>>>()?;
        crate::classification_model::validate_groups(w, &plans, &accounts, &groups)?;
        let mut entries = vec![];
        for (index, p) in plans.into_iter().enumerate() {
            let revision = if p.changed {
                Some(
                    identity::new_id()
                        .map_err(|_| LocalError::StorageUnavailable)?
                        .to_string(),
                )
            } else {
                None
            };
            if let Some(id) = &revision {
                local_movements::save(&tx, &p, id, &now)?;
            }
            #[cfg(feature = "counterparties-smoke")]
            if index == 0 {
                crate::counterparty_probe::checkpoint(&tx, 1)?;
            }
            #[cfg(not(feature = "counterparties-smoke"))]
            let _ = index;
            entries.push(local_movements::MovementResult {
                changed: p.changed,
                id: p.after.id,
                base_revision: p.before.ok_or(LocalError::IntegrityFailure)?.version,
                version: p.after.version,
                revision_id: revision,
            });
        }
        before_commit()?;
        #[cfg(feature = "counterparties-smoke")]
        crate::counterparty_probe::checkpoint(&tx, 2)?;
        tx.commit()?;
        #[cfg(feature = "counterparties-smoke")]
        crate::counterparty_probe::checkpoint(&db, 3)?;
        Ok(AssociationResult { entries })
    }
}
