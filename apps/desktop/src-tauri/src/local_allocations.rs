//! Allocation intentions reuse the financial revision writer in one immediate transaction.
use crate::{
    LocalError, Result,
    allocation_model::{self, Command},
    identity, local_accounts,
    local_movements::{self, MovementResult},
    local_taxonomy, local_transfers,
    local_workspaces::Installation,
    movement_model::AccountDescriptor,
};
use rusqlite::TransactionBehavior;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AllocationResult {
    pub entries: Vec<MovementResult>,
}
impl Installation {
    pub fn apply_allocations(
        &self,
        w: &str,
        input: Vec<Command>,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<AllocationResult> {
        if serde_json::to_vec(&input)
            .map_err(|_| LocalError::InvalidAllocationChange)?
            .len()
            > 4 * 1024 * 1024
        {
            return Err(LocalError::InvalidAllocationChange);
        }
        let commands = allocation_model::capture_batch(w, input)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let mut catalog = None;
        let now = identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?;
        let mut plans = Vec::with_capacity(commands.len());
        let mut accounts = Vec::new();
        for c in commands {
            let current = local_movements::load(&tx, w, &c.base.id)?.ok_or(LocalError::NotFound)?;
            let descriptor = local_accounts::read_account(&tx, w, &c.base.content.account_id)?
                .as_ref()
                .map(AccountDescriptor::from);
            let p = allocation_model::plan(
                w,
                c,
                Some(current),
                descriptor.as_ref(),
                || {
                    if catalog.is_none() {
                        catalog = Some(local_taxonomy::snapshot(&tx, w)?.catalog());
                    }
                    catalog.clone().ok_or(LocalError::IntegrityFailure)
                },
                &now,
            )?;
            accounts.push(descriptor.ok_or(LocalError::NotFound)?);
            plans.push(p);
        }
        let ids = plans
            .iter()
            .filter_map(|p| p.after.content.group_id.as_deref())
            .collect::<BTreeSet<_>>();
        let groups = ids
            .into_iter()
            .map(|id| local_transfers::group(&tx, w, id)?.ok_or(LocalError::CompositeRequired))
            .collect::<Result<Vec<_>>>()?;
        allocation_model::validate_groups(w, &plans, &accounts, &groups)?;
        let mut entries = Vec::with_capacity(plans.len());
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
            #[cfg(feature = "allocations-smoke")]
            if index == 0 {
                crate::allocation_probe::checkpoint(&tx, 1)?;
            }
            #[cfg(not(feature = "allocations-smoke"))]
            let _ = index;
            entries.push(MovementResult {
                changed: p.changed,
                id: p.after.id,
                base_revision: p.before.ok_or(LocalError::IntegrityFailure)?.version,
                version: p.after.version,
                revision_id: revision,
            });
        }
        before_commit()?;
        #[cfg(feature = "allocations-smoke")]
        crate::allocation_probe::checkpoint(&tx, 2)?;
        tx.commit()?;
        #[cfg(feature = "allocations-smoke")]
        crate::allocation_probe::checkpoint(&db, 3)?;
        Ok(AllocationResult { entries })
    }
}
