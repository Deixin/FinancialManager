//! Narrow classification policy composed over the native revision planner.
use crate::{
    LocalError, Result, identity,
    movement_model::{self, AccountDescriptor, Allocation, Plan, State, integer},
    taxonomy_model::{Catalog, Item},
    transfer_model::Group,
};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Selection {
    Keep {},
    Clear {},
    Set {
        allocation_id: String,
        category_id: String,
        #[serde(deserialize_with = "nullable")]
        subcategory_id: Option<String>,
    },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub base: State,
    pub classification: Selection,
    pub tag_ids: Vec<String>,
}
impl Command {
    pub fn capture(mut self, w: &str) -> Result<Self> {
        let invalid = || LocalError::InvalidClassification;
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
            return Err(LocalError::ClassificationDeleted);
        }
        if !matches!(self.classification, Selection::Keep { .. })
            && self.base.content.allocations.len() > 1
        {
            return Err(LocalError::ClassificationSplitReviewRequired);
        }
        if let Selection::Set {
            allocation_id,
            category_id,
            subcategory_id,
        } = &self.classification
        {
            let id = identity::resource_id(allocation_id).map_err(|_| invalid())?;
            identity::resource_id(category_id).map_err(|_| invalid())?;
            if let Some(s) = subcategory_id {
                identity::resource_id(s).map_err(|_| invalid())?;
            }
            if let Some(previous) = self.base.content.allocations.first() {
                if previous.id != *allocation_id {
                    return Err(invalid());
                }
            } else if id.get_version_num() != 7 {
                return Err(invalid());
            }
        }
        if self.tag_ids.len() > 10_000 {
            return Err(invalid());
        }
        for id in &self.tag_ids {
            identity::resource_id(id).map_err(|_| invalid())?;
        }
        self.tag_ids.sort();
        if self.tag_ids.windows(2).any(|p| p[0] == p[1]) {
            return Err(invalid());
        }
        Ok(self)
    }
    pub fn content(&self) -> Result<movement_model::Content> {
        let mut c = self.base.content.clone();
        c.tag_ids = self.tag_ids.clone();
        match &self.classification {
            Selection::Keep { .. } => {}
            Selection::Clear { .. } => c.allocations.clear(),
            Selection::Set {
                allocation_id,
                category_id,
                subcategory_id,
            } => {
                let value = integer(&c.account_amount_minor)?
                    .checked_abs()
                    .filter(|n| *n > 0)
                    .ok_or(LocalError::ClassificationAmountUnsupported)?;
                c.allocations = vec![Allocation {
                    id: allocation_id.clone(),
                    category_id: category_id.clone(),
                    subcategory_id: subcategory_id.clone(),
                    amount_minor: value.to_string(),
                    note: c.allocations.first().and_then(|a| a.note.clone()),
                }];
            }
        }
        c.capture()
    }
}
pub fn capture_batch(w: &str, input: Vec<Command>) -> Result<Vec<Command>> {
    if input.is_empty()
        || input.len() > 256
        || serde_json::to_string(&input)
            .map_err(|_| LocalError::InvalidClassification)?
            .encode_utf16()
            .count()
            > 4 * 1024 * 1024
    {
        return Err(LocalError::InvalidClassification);
    }
    let mut commands = input
        .into_iter()
        .map(|c| c.capture(w))
        .collect::<Result<Vec<_>>>()?;
    commands.sort_by(|a, b| a.base.id.cmp(&b.base.id));
    if commands.windows(2).any(|c| c[0].base.id == c[1].base.id) {
        return Err(LocalError::InvalidClassification);
    }
    for c in &commands {
        c.content()?;
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
        return Err(LocalError::ClassificationBaseConflict);
    }
    let catalog = raw_catalog.capture(w)?;
    let unavailable = || LocalError::ClassificationReferenceUnavailable;
    for id in &p.after.content.tag_ids {
        if !catalog.items.iter().any(|t|matches!(t,Item::Tag{id:tag,status,..} if tag==id&&(before.content.tag_ids.contains(id)||status=="ACTIVE"))){return Err(unavailable())}
    }
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
                return Err(LocalError::ClassificationScopeMismatch);
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
pub fn validate_groups(
    w: &str,
    plans: &[Plan],
    accounts: &[AccountDescriptor],
    groups: &[Group],
) -> Result<()> {
    let ids = plans
        .iter()
        .filter_map(|p| p.after.content.group_id.as_deref())
        .collect::<BTreeSet<_>>();
    for id in ids {
        let g = groups
            .iter()
            .find(|g| g.id == id && g.workspace_id == w)
            .ok_or(LocalError::CompositeRequired)?;
        let mut members = plans
            .iter()
            .filter(|p| p.after.content.group_id.as_deref() == Some(id))
            .collect::<Vec<_>>();
        let actual = members
            .iter()
            .map(|p| p.after.id.as_str())
            .collect::<BTreeSet<_>>();
        if g.state != "ACTIVE"
            || !matches!(g.group_type.as_str(), "TRANSFER" | "CARD_PAYMENT")
            || members.len() != 2
            || g.member_ids
                .iter()
                .map(String::as_str)
                .collect::<BTreeSet<_>>()
                != actual
        {
            return Err(LocalError::CompositeRequired);
        }
        members.sort_by_key(|p| {
            if g.group_type == "TRANSFER" {
                integer(&p.after.content.account_amount_minor).is_ok_and(|n| n >= 0)
            } else {
                accounts
                    .iter()
                    .find(|a| a.id == p.after.content.account_id)
                    .is_none_or(|a| a.balance_nature != "ASSET")
            }
        });
        let s = &members[0].after.content;
        let t = &members[1].after.content;
        let a = accounts
            .iter()
            .find(|a| a.id == s.account_id)
            .ok_or(LocalError::NotFound)?;
        let b = accounts
            .iter()
            .find(|a| a.id == t.account_id)
            .ok_or(LocalError::NotFound)?;
        if a.status != "ACTIVE"
            || b.status != "ACTIVE"
            || a.balance_nature != "ASSET"
            || a.id == b.id
            || s.financial_date != t.financial_date
            || s.deleted != t.deleted
            || integer(&s.account_amount_minor)? >= 0
        {
            return Err(LocalError::CompositeRequired);
        }
        let valid = if g.group_type == "TRANSFER" {
            b.balance_nature == "ASSET"
                && s.economic_kind == "TRANSFER"
                && t.economic_kind == "TRANSFER"
                && i128::from(integer(&s.account_amount_minor)?)
                    + i128::from(integer(&t.account_amount_minor)?)
                    == 0
        } else {
            b.balance_nature == "LIABILITY"
                && b.account_kind == "CREDIT_CARD"
                && s.economic_kind == "DEBT_SETTLEMENT"
                && t.economic_kind == "DEBT_SETTLEMENT"
                && s.account_amount_minor == t.account_amount_minor
        };
        if !valid {
            return Err(LocalError::CompositeRequired);
        }
    }
    Ok(())
}
