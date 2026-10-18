//! Workspace-local catalog policy. Homonyms and identifiers never imply a merge.
use crate::{LocalError, Result, category_model::js_space, identity};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
fn nullable<'de, D: Deserializer<'de>>(d: D) -> std::result::Result<Option<String>, D::Error> {
    Option::deserialize(d)
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Counterparty {
    pub id: String,
    pub workspace_id: String,
    pub display_name: String,
    #[serde(deserialize_with = "nullable")]
    pub identifier_type: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub identifier_value: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub relationship_hint: Option<String>,
    pub status: String,
}
fn text(s: &str) -> bool {
    !s.is_empty()
        && s.trim_matches(js_space) == s
        && s.encode_utf16().count() <= 120
        && !s.chars().any(char::is_control)
}
impl Counterparty {
    pub fn validate(&self, w: &str) -> Result<()> {
        let identifier = match (&self.identifier_type, &self.identifier_value) {
            (None, None) => true,
            (Some(t), Some(v)) if text(v) => match t.as_str() {
                "CPF" => v.len() == 11 && v.bytes().all(|c| c.is_ascii_digit()),
                "CNPJ" => v.len() == 14 && v.bytes().all(|c| c.is_ascii_digit()),
                "OTHER" => true,
                _ => false,
            },
            _ => false,
        };
        if identity::resource_id(w).is_err()
            || identity::resource_id(&self.id).is_err()
            || self.workspace_id != w
            || !text(&self.display_name)
            || !identifier
            || !matches!(self.status.as_str(), "ACTIVE" | "ARCHIVED")
            || self
                .relationship_hint
                .as_ref()
                .is_some_and(|r| !matches!(r.as_str(), "CUSTOMER" | "SUPPLIER" | "OTHER"))
        {
            return Err(LocalError::InvalidCounterpartyState);
        }
        Ok(())
    }
}
pub fn capture_rows(mut rows: Vec<Counterparty>, w: &str) -> Result<Vec<Counterparty>> {
    if rows.len() > 10000
        || serde_json::to_string(&rows)
            .map_err(|_| LocalError::InvalidCounterpartyState)?
            .encode_utf16()
            .count()
            > 4 * 1024 * 1024
    {
        return Err(LocalError::CounterpartyLimit);
    }
    let mut seen = BTreeSet::new();
    for r in &rows {
        r.validate(w)?;
        if !seen.insert(r.id.clone()) {
            return Err(LocalError::InvalidCounterpartyState);
        }
    }
    rows.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(rows)
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Command {
    Create {
        item: Counterparty,
    },
    Update {
        base: Counterparty,
        item: Counterparty,
    },
}
impl Command {
    pub fn capture(self, w: &str) -> Result<Self> {
        let valid = match &self {
            Self::Create { item } => {
                item.validate(w).is_ok()
                    && item.status == "ACTIVE"
                    && identity::resource_id(&item.id).is_ok_and(|id| id.get_version_num() == 7)
            }
            Self::Update { base, item } => {
                base.validate(w).is_ok() && item.validate(w).is_ok() && base.id == item.id
            }
        };
        if !valid {
            return Err(LocalError::InvalidCounterpartyChange);
        }
        Ok(self)
    }
}
#[derive(Serialize)]
pub struct Plan {
    pub before: Option<Counterparty>,
    pub after: Counterparty,
}
pub fn plan(w: &str, rows: Vec<Counterparty>, command: Command) -> Result<Option<Plan>> {
    let rows = capture_rows(rows, w)?;
    let command = command.capture(w)?;
    let (item, base) = match command {
        Command::Create { item } => (item, None),
        Command::Update { base, item } => (item, Some(base)),
    };
    let before = rows.iter().find(|r| r.id == item.id).cloned();
    if let Some(base) = base {
        if before.is_none() {
            return Err(LocalError::CounterpartyNotFound);
        }
        if before.as_ref() != Some(&base) {
            return Err(LocalError::CounterpartyBaseConflict);
        }
    } else if let Some(old) = &before {
        if old != &item {
            return Err(LocalError::CounterpartyBaseConflict);
        }
    } else if rows.len() >= 10000 {
        return Err(LocalError::CounterpartyLimit);
    }
    if before.as_ref() == Some(&item) {
        return Ok(None);
    }
    Ok(Some(Plan {
        before,
        after: item,
    }))
}
