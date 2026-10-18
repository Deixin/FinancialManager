//! Read-only, complete classification coverage from a single authorized SQLCipher snapshot.
use crate::{
    LocalError, Result, local_movements, local_taxonomy, local_workspaces::Installation,
    movement_model::State, taxonomy_model::Item,
};
use rusqlite::TransactionBehavior;
use std::collections::{BTreeMap, BTreeSet};

pub(crate) fn validate(states: &[State], catalog: &local_taxonomy::TaxonomySnapshot) -> Result<()> {
    if states.len() > 10_000
        || serde_json::to_string(states)
            .map_err(|_| LocalError::IntegrityFailure)?
            .encode_utf16()
            .count()
            > 4 * 1024 * 1024
    {
        return Err(LocalError::MovementLimit);
    }
    let categories = catalog
        .categories
        .iter()
        .map(|r| r.id.as_str())
        .collect::<BTreeSet<_>>();
    let tags = catalog
        .items
        .iter()
        .filter(|r| matches!(r, Item::Tag { .. }))
        .map(Item::id)
        .collect::<BTreeSet<_>>();
    let subs = catalog
        .items
        .iter()
        .filter_map(|r| r.parent().map(|p| (r.id(), p)))
        .collect::<BTreeMap<_, _>>();
    for state in states {
        if state.workspace_id != catalog.workspace_id
            || state
                .content
                .tag_ids
                .iter()
                .any(|id| !tags.contains(id.as_str()))
            || state.content.allocations.iter().any(|a| {
                !categories.contains(a.category_id.as_str())
                    || a.subcategory_id.as_ref().is_some_and(|id| {
                        subs.get(id.as_str()).copied() != Some(a.category_id.as_str())
                    })
            })
        {
            return Err(LocalError::IntegrityFailure);
        }
    }
    Ok(())
}
impl Installation {
    pub fn read_movement_classifications(
        &self,
        w: &str,
    ) -> Result<local_movements::MovementsSnapshot> {
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        // Read all records or refuse; never present a filtered page as global coverage.
        let count: i64 = tx.query_row(
            "SELECT count(*) FROM financial_transaction WHERE workspace_id=?",
            [w],
            |r| r.get(0),
        )?;
        if count > 10_000 {
            return Err(LocalError::MovementLimit);
        }
        let mut value = local_movements::snapshot(&tx, w)?;
        let catalog = local_taxonomy::snapshot(&tx, w)?;
        validate(&value.transactions, &catalog)?;
        value.classification = Some(catalog);
        tx.commit()?;
        Ok(value)
    }
}
