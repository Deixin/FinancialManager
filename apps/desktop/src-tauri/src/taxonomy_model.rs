//! Pure catalog policy; every plan is compared against the shared US-045 policy.
use crate::{
    LocalError, Result,
    category_model::{self, Category},
    identity,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Item {
    Tag {
        id: String,
        workspace_id: String,
        name: String,
        status: String,
    },
    Subcategory {
        id: String,
        workspace_id: String,
        name: String,
        status: String,
        category_id: String,
        sort_order: i32,
    },
}
impl Item {
    pub fn id(&self) -> &str {
        match self {
            Self::Tag { id, .. } | Self::Subcategory { id, .. } => id,
        }
    }
    pub fn workspace(&self) -> &str {
        match self {
            Self::Tag { workspace_id, .. } | Self::Subcategory { workspace_id, .. } => workspace_id,
        }
    }
    pub fn name(&self) -> &str {
        match self {
            Self::Tag { name, .. } | Self::Subcategory { name, .. } => name,
        }
    }
    pub fn status(&self) -> &str {
        match self {
            Self::Tag { status, .. } | Self::Subcategory { status, .. } => status,
        }
    }
    pub fn parent(&self) -> Option<&str> {
        match self {
            Self::Subcategory { category_id, .. } => Some(category_id),
            _ => None,
        }
    }
    pub fn kind(&self) -> &str {
        match self {
            Self::Tag { .. } => "TAG",
            Self::Subcategory { .. } => "SUBCATEGORY",
        }
    }
    fn key(&self) -> (String, String) {
        (self.kind().into(), self.id().into())
    }
    fn name_key(&self) -> (String, Option<String>, String) {
        (
            self.kind().into(),
            self.parent().map(String::from),
            category_model::name_key(self.name()),
        )
    }
    fn validate(&self, w: &str) -> Result<()> {
        if identity::resource_id(w).is_err()
            || identity::resource_id(self.id()).is_err()
            || self.workspace() != w
            || category_model::name_key(self.name()).is_empty()
            || !matches!(self.status(), "ACTIVE" | "ARCHIVED")
            || self
                .parent()
                .is_some_and(|p| identity::resource_id(p).is_err())
        {
            return Err(LocalError::InvalidTaxonomyState);
        }
        Ok(())
    }
    fn label(mut self, base: Option<&Self>) -> Result<Self> {
        if base.is_none_or(|b| b.name() != self.name()) {
            let label = category_model::label(self.name().into())
                .map_err(|_| LocalError::InvalidTaxonomyChange)?;
            match &mut self {
                Self::Tag { name, .. } | Self::Subcategory { name, .. } => *name = label,
            }
        }
        Ok(self)
    }
    fn ordered(mut self, order: i32) -> Result<Self> {
        if let Self::Subcategory { sort_order, .. } = &mut self {
            *sort_order = order;
            Ok(self)
        } else {
            Err(LocalError::InvalidTaxonomyChange)
        }
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Catalog {
    pub categories: Vec<Category>,
    pub items: Vec<Item>,
}
impl Catalog {
    pub fn capture(self, w: &str) -> Result<Self> {
        if self.items.len() > 10000
            || serde_json::to_string(&self)
                .map_err(|_| LocalError::InvalidTaxonomyState)?
                .encode_utf16()
                .count()
                > 4 * 1024 * 1024
        {
            return Err(LocalError::TaxonomyLimit);
        }
        let categories = category_model::capture_rows(self.categories, w).map_err(|e| {
            if e == LocalError::CategoryLimit {
                LocalError::TaxonomyLimit
            } else {
                LocalError::InvalidTaxonomyState
            }
        })?;
        let mut items = self.items;
        let mut seen = BTreeSet::new();
        for r in &items {
            r.validate(w)?;
            if !seen.insert(r.key())
                || r.parent()
                    .is_some_and(|p| !categories.iter().any(|c| c.id == p))
            {
                return Err(LocalError::InvalidTaxonomyState);
            }
        }
        items.sort_by_key(Item::key);
        Ok(Self { categories, items })
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Command {
    Create {
        item: Item,
    },
    Update {
        base: Item,
        item: Item,
    },
    ReorderSubcategories {
        category_id: String,
        bases: Vec<Item>,
        ids: Vec<String>,
    },
}
impl Command {
    pub fn capture(self, w: &str) -> Result<Self> {
        let invalid = || LocalError::InvalidTaxonomyChange;
        identity::resource_id(w).map_err(|_| invalid())?;
        if serde_json::to_string(&self)
            .map_err(|_| invalid())?
            .encode_utf16()
            .count()
            > 4 * 1024 * 1024
        {
            return Err(invalid());
        }
        Ok(match self {
            Self::Create { item } => {
                item.validate(w).map_err(|_| invalid())?;
                if item.status() != "ACTIVE"
                    || identity::resource_id(item.id())
                        .map_err(|_| invalid())?
                        .get_version_num()
                        != 7
                {
                    return Err(invalid());
                }
                Self::Create {
                    item: item.label(None)?,
                }
            }
            Self::Update { base, item } => {
                base.validate(w).map_err(|_| invalid())?;
                item.validate(w).map_err(|_| invalid())?;
                if base.key() != item.key() || base.parent() != item.parent() {
                    return Err(invalid());
                }
                let item = item.label(Some(&base))?;
                Self::Update { base, item }
            }
            Self::ReorderSubcategories {
                category_id,
                bases,
                ids,
            } => {
                identity::resource_id(&category_id).map_err(|_| invalid())?;
                if bases.len() > 10000 || ids.len() > 10000 {
                    return Err(invalid());
                }
                let mut seen = BTreeSet::new();
                for b in &bases {
                    b.validate(w).map_err(|_| invalid())?;
                    if b.parent() != Some(category_id.as_str())
                        || b.status() != "ACTIVE"
                        || !seen.insert(b.id().to_string())
                    {
                        return Err(invalid());
                    }
                }
                let mut selected = BTreeSet::new();
                for id in &ids {
                    identity::resource_id(id).map_err(|_| invalid())?;
                    if !selected.insert(id.clone()) {
                        return Err(invalid());
                    }
                }
                if seen != selected {
                    return Err(invalid());
                }
                Self::ReorderSubcategories {
                    category_id,
                    bases,
                    ids,
                }
            }
        })
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub before: Option<Item>,
    pub after: Item,
}
pub fn plan(w: &str, raw: Catalog, input: Command) -> Result<Vec<Plan>> {
    let current = raw.capture(w)?;
    let command = input.capture(w)?;
    let mut plans = Vec::new();
    match command {
        Command::Create { item } => {
            if let Some(before) = current.items.iter().find(|r| r.key() == item.key()) {
                return if before == &item {
                    Ok(vec![])
                } else {
                    Err(LocalError::TaxonomyBaseConflict)
                };
            }
            parent_available(&current, &item)?;
            plans.push(Plan {
                before: None,
                after: item,
            });
        }
        Command::Update { base, item } => {
            let before = current
                .items
                .iter()
                .find(|r| r.key() == base.key())
                .ok_or(LocalError::TaxonomyNotFound)?;
            if before != &base {
                return Err(LocalError::TaxonomyBaseConflict);
            }
            if before.status() == "ARCHIVED" && item.status() == "ACTIVE" {
                parent_available(&current, &item)?
            }
            if before != &item {
                plans.push(Plan {
                    before: Some(before.clone()),
                    after: item,
                })
            }
        }
        Command::ReorderSubcategories {
            category_id,
            bases,
            ids,
        } => {
            if !current.categories.iter().any(|c| c.id == category_id) {
                return Err(LocalError::TaxonomyParentUnavailable);
            }
            let active: Vec<_> = current
                .items
                .iter()
                .filter(|r| r.parent() == Some(category_id.as_str()) && r.status() == "ACTIVE")
                .collect();
            if active.len() != bases.len() || bases.iter().any(|b| !active.contains(&b)) {
                return Err(LocalError::TaxonomyBaseConflict);
            }
            for (order, id) in ids.iter().enumerate() {
                let before = active
                    .iter()
                    .find(|r| r.id() == id)
                    .ok_or(LocalError::InvalidTaxonomyChange)?;
                let after = (*before).clone().ordered(order as i32)?;
                if before != &&after {
                    plans.push(Plan {
                        before: Some((*before).clone()),
                        after,
                    })
                }
            }
        }
    }
    let mut next = current.items.clone();
    next.retain(|r| !plans.iter().any(|p| p.after.key() == r.key()));
    next.extend(plans.iter().map(|p| p.after.clone()));
    let catalog = Catalog {
        categories: current.categories,
        items: next,
    }
    .capture(w)?;
    for p in &plans {
        if p.after.status() == "ACTIVE"
            && p.before
                .as_ref()
                .is_none_or(|b| b.status() == "ARCHIVED" || b.name_key() != p.after.name_key())
            && catalog.items.iter().any(|r| {
                r.status() == "ACTIVE"
                    && r.key() != p.after.key()
                    && r.name_key() == p.after.name_key()
            })
        {
            return Err(LocalError::TaxonomyNameConflict);
        }
    }
    Ok(plans)
}
fn parent_available(catalog: &Catalog, item: &Item) -> Result<()> {
    if item.parent().is_some_and(|p| {
        !catalog
            .categories
            .iter()
            .any(|c| c.id == p && c.status == "ACTIVE")
    }) {
        return Err(LocalError::TaxonomyParentUnavailable);
    }
    Ok(())
}
