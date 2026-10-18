//! Exact allocation policy composed over the existing financial revision planner.
pub use crate::classification_model::validate_groups;
use crate::{
    LocalError, Result, identity,
    movement_model::{self, AccountDescriptor, Allocation, Plan, State, integer},
    taxonomy_model::{Catalog, Item},
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Selection {
    Keep {},
    Clear {},
    Replace { allocations: Vec<Allocation> },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub base: State,
    pub allocation: Selection,
}
impl Command {
    pub fn capture(mut self, w: &str) -> Result<Self> {
        let invalid = || LocalError::InvalidAllocationChange;
        identity::resource_id(w).map_err(|_| invalid())?;
        if serde_json::to_string(&self)
            .map_err(|_| invalid())?
            .encode_utf16()
            .count()
            > 4 * 1024 * 1024
        {
            return Err(invalid());
        }
        self.base = self.base.capture().map_err(|_| invalid())?;
        if self.base.workspace_id != w {
            return Err(invalid());
        }
        if self.base.content.deleted {
            return Err(LocalError::AllocationDeleted);
        }
        if let Selection::Replace { allocations } = &self.allocation {
            if allocations.is_empty() || allocations.len() > 1000 {
                return Err(invalid());
            }
            let mut sum = 0i128;
            for a in allocations {
                let amount = integer(&a.amount_minor).map_err(|_| invalid())?;
                if amount <= 0 {
                    return Err(invalid());
                }
                sum += i128::from(amount);
                let id = identity::resource_id(&a.id).map_err(|_| invalid())?;
                if !self
                    .base
                    .content
                    .allocations
                    .iter()
                    .any(|old| old.id == a.id)
                    && id.get_version_num() != 7
                {
                    return Err(invalid());
                }
            }
            if sum
                != i128::from(
                    integer(&self.base.content.account_amount_minor).map_err(|_| invalid())?,
                )
                .abs()
            {
                return Err(LocalError::AllocationTotalMismatch);
            }
            let content = self.content()?;
            self.allocation = Selection::Replace {
                allocations: content.allocations,
            };
        }
        Ok(self)
    }
    pub fn content(&self) -> Result<movement_model::Content> {
        let mut c = self.base.content.clone();
        match &self.allocation {
            Selection::Keep {} => {}
            Selection::Clear {} => c.allocations.clear(),
            Selection::Replace { allocations } => c.allocations = allocations.clone(),
        }
        c.capture().map_err(|_| LocalError::InvalidAllocationChange)
    }
}
pub fn capture_batch(w: &str, input: Vec<Command>) -> Result<Vec<Command>> {
    if input.is_empty()
        || input.len() > 256
        || serde_json::to_string(&input)
            .map_err(|_| LocalError::InvalidAllocationChange)?
            .encode_utf16()
            .count()
            > 4 * 1024 * 1024
    {
        return Err(LocalError::InvalidAllocationChange);
    }
    let mut commands = input
        .into_iter()
        .map(|c| c.capture(w))
        .collect::<Result<Vec<_>>>()?;
    commands.sort_by(|a, b| a.base.id.cmp(&b.base.id));
    if commands.windows(2).any(|p| p[0].base.id == p[1].base.id) {
        return Err(LocalError::InvalidAllocationChange);
    }
    Ok(commands)
}
pub fn plan(
    w: &str,
    command: Command,
    current: Option<State>,
    account: Option<&AccountDescriptor>,
    catalog: impl FnOnce() -> Result<Catalog>,
    now: &str,
) -> Result<Plan> {
    let c = command.capture(w)?;
    let p = movement_model::revision(w, &c.base.id, current, c.content()?, &c.base.version, now)?;
    let account = account.ok_or(LocalError::NotFound)?;
    let raw_catalog = catalog()?;
    let before = p.before.as_ref().ok_or(LocalError::NotFound)?;
    if before != &c.base {
        return Err(LocalError::AllocationBaseConflict);
    }
    let catalog = raw_catalog.capture(w)?;
    let unavailable = || LocalError::AllocationReferenceUnavailable;
    for a in &p.after.content.allocations {
        let previous = before.content.allocations.iter().find(|r| r.id == a.id);
        let category = catalog
            .categories
            .iter()
            .find(|r| r.id == a.category_id)
            .ok_or_else(unavailable)?;
        let changed = previous
            .is_none_or(|r| r.category_id != a.category_id || r.subcategory_id != a.subcategory_id);
        if changed {
            if category.status != "ACTIVE" {
                return Err(unavailable());
            }
            let allowed = match before.content.economic_kind.as_str() {
                "INCOME" => "INCOME",
                "EXPENSE" | "EXPENSE_REVERSAL" => "EXPENSE",
                _ => "BOTH",
            };
            if category.category_scope != "BOTH" && category.category_scope != allowed {
                return Err(LocalError::AllocationScopeMismatch);
            }
        }
        if let Some(id) = &a.subcategory_id
            && !catalog.items.iter().any(|t|matches!(t,Item::Subcategory{id:sub,category_id,status,..} if sub==id&&category_id==&a.category_id&&(!changed||status=="ACTIVE"))){return Err(unavailable())}
    }
    account.validate(w)?;
    if account.id != p.after.content.account_id {
        return Err(LocalError::InvalidRevision);
    }
    let value = i128::from(integer(&p.after.content.account_amount_minor)?)
        * if account.balance_nature == "ASSET" {
            1
        } else {
            -1
        };
    match p.after.content.economic_kind.as_str() {
        "INCOME" | "EXPENSE_REVERSAL" if value <= 0 => return Err(LocalError::InvalidRevision),
        "EXPENSE" if value >= 0 => return Err(LocalError::InvalidRevision),
        "TRANSFER" | "DEBT_SETTLEMENT" if p.after.content.group_id.is_none() => {
            return Err(LocalError::CompositeRequired);
        }
        _ => {}
    }
    Ok(p)
}
