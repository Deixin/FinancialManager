//! Only counterparty_id can change; financial state goes through the revision writer.
use crate::{
    LocalError, Result, identity,
    movement_model::{self, AccountDescriptor, Plan, State, integer},
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Selection {
    Keep {},
    Clear {},
    Set { counterparty_id: String },
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Command {
    pub base: State,
    pub counterparty: Selection,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reference {
    pub id: String,
    pub workspace_id: String,
    pub status: String,
}
impl Command {
    pub fn capture(mut self, w: &str) -> Result<Self> {
        let invalid = || LocalError::InvalidCounterpartyAssociation;
        identity::resource_id(w).map_err(|_| invalid())?;
        self.base = self.base.capture().map_err(|_| invalid())?;
        if self.base.workspace_id != w {
            return Err(invalid());
        }
        if self.base.content.deleted {
            return Err(LocalError::CounterpartyAssociationDeleted);
        }
        if let Selection::Set { counterparty_id } = &self.counterparty {
            identity::resource_id(counterparty_id).map_err(|_| invalid())?;
        }
        Ok(self)
    }
    pub fn content(&self) -> movement_model::Content {
        let mut c = self.base.content.clone();
        c.counterparty_id = match &self.counterparty {
            Selection::Keep {} => c.counterparty_id,
            Selection::Clear {} => None,
            Selection::Set { counterparty_id } => Some(counterparty_id.clone()),
        };
        c
    }
}
pub fn capture_batch(w: &str, input: Vec<Command>) -> Result<Vec<Command>> {
    let json =
        serde_json::to_string(&input).map_err(|_| LocalError::InvalidCounterpartyAssociation)?;
    if input.is_empty()
        || input.len() > 256
        || json.len() > 4 * 1024 * 1024
        || json.encode_utf16().count() > 4 * 1024 * 1024
    {
        return Err(LocalError::InvalidCounterpartyAssociation);
    }
    let mut commands = input
        .into_iter()
        .map(|c| c.capture(w))
        .collect::<Result<Vec<_>>>()?;
    commands.sort_by(|a, b| a.base.id.cmp(&b.base.id));
    if commands.windows(2).any(|p| p[0].base.id == p[1].base.id) {
        return Err(LocalError::InvalidCounterpartyAssociation);
    }
    Ok(commands)
}
pub fn plan(
    w: &str,
    command: Command,
    current: Option<State>,
    account: Option<&AccountDescriptor>,
    references: &[Reference],
    now: &str,
) -> Result<Plan> {
    let c = command.capture(w)?;
    let p = movement_model::revision(w, &c.base.id, current, c.content(), &c.base.version, now)?;
    let before = p.before.as_ref().ok_or(LocalError::NotFound)?;
    if before != &c.base {
        return Err(LocalError::CounterpartyAssociationBaseConflict);
    }
    let mut seen = BTreeSet::new();
    if references.len() > 256
        || references.iter().any(|r| {
            r.workspace_id != w
                || identity::resource_id(&r.id).is_err()
                || !matches!(r.status.as_str(), "ACTIVE" | "ARCHIVED")
                || !seen.insert(r.id.clone())
        })
    {
        return Err(LocalError::CounterpartyReferenceUnavailable);
    }
    if let Some(id) = &p.after.content.counterparty_id
        && !references.iter().any(|r| {
            &r.id == id
                && (before.content.counterparty_id.as_ref() == Some(id) || r.status == "ACTIVE")
        })
    {
        return Err(LocalError::CounterpartyReferenceUnavailable);
    }
    let account = account.ok_or(LocalError::NotFound)?;
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
