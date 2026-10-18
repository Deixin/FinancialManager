//! Workspace-owned metadata operations under the existing SQLCipher access guard.
use crate::{
    LocalError, Result, category_model, local_categories,
    local_workspaces::Installation,
    taxonomy_model::{self, Catalog, Command, Item},
};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxonomySnapshot {
    pub workspace_id: String,
    pub categories: Vec<category_model::Category>,
    pub items: Vec<Item>,
}
impl TaxonomySnapshot {
    pub fn catalog(&self) -> Catalog {
        Catalog {
            categories: self.categories.clone(),
            items: self.items.clone(),
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ItemId {
    pub kind: String,
    pub id: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaxonomyResult {
    pub changed: bool,
    pub item_ids: Vec<ItemId>,
    pub categories: Vec<category_model::Category>,
    pub items: Vec<Item>,
}
pub(crate) fn snapshot(db: &Connection, w: &str) -> Result<TaxonomySnapshot> {
    let categories = local_categories::snapshot(db, w)?.categories;
    let count:i64=db.query_row("SELECT (SELECT count(*) FROM tag WHERE workspace_id=?)+(SELECT count(*) FROM subcategory WHERE workspace_id=?)",params![w,w],|r|r.get(0))?;
    if count > 10000 {
        return Err(LocalError::TaxonomyLimit);
    }
    let mut items=db.prepare("SELECT id,workspace_id,name,status FROM tag WHERE workspace_id=? ORDER BY id LIMIT 10001")?.query_map([w],|r|Ok(Item::Tag{id:r.get(0)?,workspace_id:r.get(1)?,name:r.get(2)?,status:r.get(3)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    items.extend(db.prepare("SELECT id,workspace_id,name,status,category_id,sort_order FROM subcategory WHERE workspace_id=? ORDER BY id LIMIT 10001")?.query_map([w],|r|Ok(Item::Subcategory{id:r.get(0)?,workspace_id:r.get(1)?,name:r.get(2)?,status:r.get(3)?,category_id:r.get(4)?,sort_order:r.get(5)?}))?.collect::<std::result::Result<Vec<_>,_>>()?);
    let catalog = Catalog { categories, items }.capture(w)?;
    Ok(TaxonomySnapshot {
        workspace_id: w.into(),
        categories: catalog.categories,
        items: catalog.items,
    })
}
impl Installation {
    pub fn read_taxonomy(&self, w: &str) -> Result<TaxonomySnapshot> {
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let value = snapshot(&tx, w)?;
        tx.commit()?;
        Ok(value)
    }
    pub fn apply_taxonomy_change(
        &self,
        w: &str,
        input: Command,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<TaxonomyResult> {
        if serde_json::to_vec(&input)
            .map_err(|_| LocalError::InvalidTaxonomyChange)?
            .len()
            > 4 * 1024 * 1024
        {
            return Err(LocalError::TaxonomyLimit);
        }
        let command = input.capture(w)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = snapshot(&tx, w)?;
        let plans = taxonomy_model::plan(w, current.catalog(), command)?;
        for (index, p) in plans.iter().enumerate() {
            let a = &p.after;
            let changed = match a {
                Item::Tag {
                    id, name, status, ..
                } => {
                    if p.before.is_none() {
                        tx.execute("INSERT INTO tag(id,workspace_id,name,normalized_name,status) VALUES(?,?,?,?,?)",params![id,w,name,category_model::name_key(name),status])?
                    } else {
                        tx.execute("UPDATE tag SET name=?,normalized_name=?,status=? WHERE workspace_id=? AND id=?",params![name,category_model::name_key(name),status,w,id])?
                    }
                }
                Item::Subcategory {
                    id,
                    name,
                    status,
                    category_id,
                    sort_order,
                    ..
                } => {
                    if p.before.is_none() {
                        tx.execute("INSERT INTO subcategory(id,workspace_id,category_id,name,sort_order,status) VALUES(?,?,?,?,?,?)",params![id,w,category_id,name,sort_order,status])?
                    } else {
                        tx.execute("UPDATE subcategory SET name=?,sort_order=?,status=? WHERE workspace_id=? AND id=? AND category_id=?",params![name,sort_order,status,w,id,category_id])?
                    }
                }
            };
            if changed != 1 {
                return Err(LocalError::IntegrityFailure);
            }
            #[cfg(feature = "taxonomy-smoke")]
            if index == 0 {
                crate::taxonomy_probe::after_first(&tx)?;
            }
            #[cfg(not(feature = "taxonomy-smoke"))]
            let _ = index;
        }
        let next = snapshot(&tx, w)?;
        before_commit()?;
        #[cfg(feature = "taxonomy-smoke")]
        crate::taxonomy_probe::checkpoint(&tx, 2)?;
        tx.commit()?;
        #[cfg(feature = "taxonomy-smoke")]
        crate::taxonomy_probe::checkpoint(&db, 3)?;
        Ok(TaxonomyResult {
            changed: !plans.is_empty(),
            item_ids: plans
                .into_iter()
                .map(|p| ItemId {
                    kind: p.after.kind().into(),
                    id: p.after.id().into(),
                })
                .collect(),
            categories: next.categories,
            items: next.items,
        })
    }
}
