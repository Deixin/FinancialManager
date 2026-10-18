//! SQLCipher owner for a card_payment group, its paired entries and revisions.
use crate::{
    LocalError, Result,
    card_payment_model::{self, Command, Group},
    identity, local_accounts,
    local_movements::{self, MovementResult, MovementsSnapshot},
    local_workspaces::Installation,
    movement_model::AccountDescriptor,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
const MAX_RECORDS: i64 = 200_000;
const MAX_BYTES: usize = 32 * 1024 * 1024;
const MAX_COMMAND: usize = 1024 * 1024;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardPaymentsSnapshot {
    pub movements: MovementsSnapshot,
    pub groups: Vec<Group>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CardPaymentResult {
    pub group_id: String,
    pub entries: Vec<MovementResult>,
}
pub(crate) fn group(db: &Connection, w: &str, id: &str) -> Result<Option<Group>> {
    let row=db.query_row("SELECT id,workspace_id,group_type,state FROM transaction_group WHERE workspace_id=? AND id=?",params![w,id],|r|Ok(Group{id:r.get(0)?,workspace_id:r.get(1)?,group_type:r.get(2)?,state:r.get(3)?,member_ids:vec![]})).optional()?;
    let Some(mut g) = row else { return Ok(None) };
    g.member_ids = db
        .prepare(
            "SELECT id FROM financial_transaction WHERE workspace_id=? AND group_id=? ORDER BY id",
        )?
        .query_map(params![w, id], |r| r.get::<_, String>(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    g.validate(w)?;
    Ok(Some(g))
}
impl Installation {
    pub fn read_card_payments(&self, w: &str) -> Result<CardPaymentsSnapshot> {
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let count:i64=tx.query_row("SELECT (SELECT count(*) FROM transaction_group WHERE workspace_id=?1)+(SELECT count(*) FROM financial_account WHERE workspace_id=?1)+(SELECT count(*) FROM balance_reference WHERE workspace_id=?1)+(SELECT count(*) FROM financial_transaction WHERE workspace_id=?1)+(SELECT count(*) FROM transaction_allocation WHERE workspace_id=?1)+(SELECT count(*) FROM transaction_tag WHERE workspace_id=?1)+(SELECT count(*) FROM transaction_revision WHERE workspace_id=?1)",[w],|r|r.get(0))?;
        if count > MAX_RECORDS {
            return Err(LocalError::MovementLimit);
        }
        let movements = local_movements::snapshot(&tx, w)?;
        let ids = tx
            .prepare("SELECT id FROM transaction_group WHERE workspace_id=? ORDER BY id")?
            .query_map([w], |r| r.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let groups = ids
            .iter()
            .map(|id| group(&tx, w, id)?.ok_or(LocalError::IntegrityFailure))
            .collect::<Result<Vec<_>>>()?;
        let value = CardPaymentsSnapshot { movements, groups };
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
    pub fn apply_card_payment(
        &self,
        w: &str,
        input: Command,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<CardPaymentResult> {
        if serde_json::to_vec(&input)
            .map_err(|_| LocalError::InvalidCardPayment)?
            .len()
            > MAX_COMMAND
        {
            return Err(LocalError::MovementLimit);
        }
        let command = input.capture(w)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let ids = command.ids();
        let current = [
            local_movements::load(&tx, w, ids[0])?,
            local_movements::load(&tx, w, ids[1])?,
        ];
        let contents = command.contents()?;
        let mut account_ids = contents
            .iter()
            .map(|c| c.account_id.clone())
            .chain(
                current
                    .iter()
                    .flatten()
                    .map(|s| s.content.account_id.clone()),
            )
            .collect::<Vec<_>>();
        account_ids.sort();
        account_ids.dedup();
        let live = account_ids
            .iter()
            .map(|id| {
                local_accounts::read_account(&tx, w, id)
                    .map(|a| a.as_ref().map(AccountDescriptor::from))
            })
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .flatten()
            .collect::<Vec<_>>();
        let g = group(&tx, w, command.group_id())?;
        let now = identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?;
        let group_id = command.group_id().to_string();
        let p = card_payment_model::plan(w, command, current, &live, g.as_ref(), &now)?;
        if p.creation {
            tx.execute("INSERT INTO transaction_group(id,workspace_id,group_type,state,created_at) VALUES(?,?,'CARD_PAYMENT','ACTIVE',?)",params![group_id,w,now])?;
        }
        let mut entries = Vec::with_capacity(2);
        for (index, plan) in p.plans.into_iter().enumerate() {
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
                local_movements::save(&tx, &plan, id, &now)?;
            }
            #[cfg(feature = "card-payments-smoke")]
            if index == 0 {
                crate::card_payment_probe::after_first(&tx)?;
            }
            #[cfg(not(feature = "card-payments-smoke"))]
            let _ = index;
            entries.push(MovementResult {
                changed: plan.changed,
                id: plan.after.id,
                base_revision: plan.before.map_or_else(|| "0".into(), |s| s.version),
                version: plan.after.version,
                revision_id: revision,
            });
        }
        before_commit()?;
        #[cfg(feature = "card-payments-smoke")]
        crate::card_payment_probe::checkpoint(&tx, 2)?;
        tx.commit()?;
        #[cfg(feature = "card-payments-smoke")]
        crate::card_payment_probe::checkpoint(&db, 3)?;
        Ok(CardPaymentResult { group_id, entries })
    }
}
