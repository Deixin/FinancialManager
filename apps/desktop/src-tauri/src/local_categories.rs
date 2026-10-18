//! Categories are owned by a single authorized SQLCipher transaction.
use crate::{
    LocalError, Result,
    category_model::{self, Category, Command},
    local_workspaces::Installation,
};
use rusqlite::{Connection, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CategoriesSnapshot {
    pub workspace_id: String,
    pub purpose: String,
    pub categories: Vec<Category>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CategoryResult {
    pub changed: bool,
    pub category_ids: Vec<String>,
    pub categories: Vec<Category>,
}
pub(crate) fn snapshot(db: &Connection, w: &str) -> Result<CategoriesSnapshot> {
    let (mode, purpose): (String, String) = db.query_row(
        "SELECT storage_mode,purpose FROM workspace WHERE id=?",
        [w],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    if mode != "LOCAL" {
        return Err(LocalError::InvalidWorkspace);
    }
    category_model::defaults(&purpose).map_err(|_| LocalError::InvalidCategoryState)?;
    let count: i64 = db.query_row(
        "SELECT count(*) FROM category WHERE workspace_id=?",
        [w],
        |r| r.get(0),
    )?;
    if count > 10000 {
        return Err(LocalError::CategoryLimit);
    }
    let rows=db.prepare("SELECT id,workspace_id,name,category_scope,sort_order,status,is_seeded FROM category WHERE workspace_id=? ORDER BY id LIMIT 10001")?.query_map([w],|r|Ok(Category{id:r.get(0)?,workspace_id:r.get(1)?,name:r.get(2)?,category_scope:r.get(3)?,sort_order:r.get(4)?,status:r.get(5)?,is_seeded:r.get(6)?}))?.collect::<std::result::Result<Vec<_>,_>>()?;
    Ok(CategoriesSnapshot {
        workspace_id: w.into(),
        purpose,
        categories: category_model::capture_rows(rows, w)?,
    })
}
impl Installation {
    pub fn read_categories(&self, w: &str) -> Result<CategoriesSnapshot> {
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Deferred)?;
        let value = snapshot(&tx, w)?;
        tx.commit()?;
        Ok(value)
    }
    pub fn apply_category_change(
        &self,
        w: &str,
        input: Command,
        before_commit: impl FnOnce() -> Result<()>,
    ) -> Result<CategoryResult> {
        if serde_json::to_vec(&input)
            .map_err(|_| LocalError::InvalidCategoryChange)?
            .len()
            > 4 * 1024 * 1024
        {
            return Err(LocalError::CategoryLimit);
        }
        let command = input.capture(w)?;
        let mut db = self.financial_database(w)?;
        let tx = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let current = snapshot(&tx, w)?;
        let plans = category_model::plan(w, &current.purpose, current.categories, command)?;
        for (index, p) in plans.iter().enumerate() {
            let a = &p.after;
            let key = category_model::name_key(&a.name);
            let changed = if p.before.is_none() {
                tx.execute("INSERT INTO category(id,workspace_id,name,normalized_name,category_scope,sort_order,status,is_seeded) VALUES(?,?,?,?,?,?,?,?)",params![a.id,w,a.name,key,a.category_scope,a.sort_order,a.status,a.is_seeded])?
            } else {
                tx.execute("UPDATE category SET name=?,normalized_name=?,sort_order=?,status=? WHERE workspace_id=? AND id=?",params![a.name,key,a.sort_order,a.status,w,a.id])?
            };
            if changed != 1 {
                return Err(LocalError::IntegrityFailure);
            }
            #[cfg(feature = "categories-smoke")]
            if index == 0 {
                crate::category_probe::after_first(&tx)?;
            }
            #[cfg(not(feature = "categories-smoke"))]
            let _ = index;
        }
        let categories = snapshot(&tx, w)?.categories;
        before_commit()?;
        #[cfg(feature = "categories-smoke")]
        crate::category_probe::checkpoint(&tx, 2)?;
        tx.commit()?;
        #[cfg(feature = "categories-smoke")]
        crate::category_probe::checkpoint(&db, 3)?;
        Ok(CategoryResult {
            changed: !plans.is_empty(),
            category_ids: plans.into_iter().map(|p| p.after.id).collect(),
            categories,
        })
    }
}
