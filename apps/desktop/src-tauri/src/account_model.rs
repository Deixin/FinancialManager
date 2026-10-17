//! Pure account command model. No database, host, UI or key access.
//! Its serialized plans are compared with the shared TypeScript Domain in US-040.
use crate::{LocalError, Result, identity};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;

fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub id: String,
    pub workspace_id: String,
    pub name: String,
    #[serde(deserialize_with = "nullable")]
    pub institution_name: Option<String>,
    pub account_kind: String,
    pub balance_nature: String,
    pub currency_code: String,
    pub status: String,
    pub created_at: String,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewAccount {
    pub id: String,
    pub name: String,
    #[serde(deserialize_with = "nullable")]
    pub institution_name: Option<String>,
    pub account_kind: String,
    pub balance_nature: String,
    pub currency_code: String,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ReferenceInput {
    pub id: String,
    pub amount_minor: String,
    pub reference_date: String,
    pub day_position: String,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Reference {
    pub id: String,
    pub workspace_id: String,
    pub account_id: String,
    pub amount_minor: String,
    pub reference_date: String,
    pub day_position: String,
    pub source: String,
    pub status: String,
    pub created_at: String,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountState {
    pub account: Account,
    pub references: Vec<Reference>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum AccountChange {
    Create {
        account: NewAccount,
        #[serde(deserialize_with = "nullable")]
        reference: Option<ReferenceInput>,
    },
    Update {
        base: Account,
        name: String,
        #[serde(deserialize_with = "nullable")]
        institution_name: Option<String>,
        status: String,
    },
    Reference {
        account_id: String,
        reference: ReferenceInput,
        #[serde(deserialize_with = "nullable")]
        replaces_id: Option<String>,
    },
}
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Create,
    Update,
    Reference,
}
pub struct AccountPlan {
    pub action: Action,
    pub changed: bool,
    pub state: AccountState,
    pub reference_id: Option<String>,
    pub replaces_id: Option<String>,
}
fn invalid<T>() -> Result<T> {
    Err(LocalError::InvalidAccountChange)
}
fn id(value: &str, new: bool) -> Result<()> {
    let parsed = identity::resource_id(value).map_err(|_| LocalError::InvalidAccountChange)?;
    if new && parsed.get_version_num() != 7 {
        return invalid();
    }
    Ok(())
}
pub fn money(value: &str) -> Result<i64> {
    let amount = value
        .parse::<i64>()
        .map_err(|_| LocalError::InvalidAccountChange)?;
    if amount.to_string() != value {
        return invalid();
    }
    Ok(amount)
}
fn label(value: &str) -> Result<String> {
    let result = value.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if result.is_empty()
        || result.encode_utf16().count() > 120
        || value.chars().any(char::is_control)
    {
        return invalid();
    }
    Ok(result.into())
}
fn optional_label(value: &Option<String>) -> Result<Option<String>> {
    value.as_deref().map(label).transpose()
}
fn valid_kind(value: &str) -> bool {
    [
        "CHECKING",
        "SAVINGS",
        "DIGITAL",
        "CASH",
        "CREDIT_CARD",
        "INVESTMENT_SIMPLE",
        "LOAN_SIMPLE",
        "OTHER",
    ]
    .contains(&value)
}
impl Account {
    pub fn validate(&self, workspace: &str) -> Result<()> {
        id(&self.id, false)?;
        id(&self.workspace_id, false)?;
        if self.workspace_id != workspace
            || self.currency_code != "BRL"
            || !valid_kind(&self.account_kind)
            || !["ASSET", "LIABILITY"].contains(&self.balance_nature.as_str())
            || !["ACTIVE", "ARCHIVED"].contains(&self.status.as_str())
            || self.name.is_empty()
        {
            return invalid();
        }
        identity::utc_instant(&self.created_at).map_err(|_| LocalError::InvalidAccountChange)?;
        Ok(())
    }
}
impl ReferenceInput {
    fn validate(&self, new: bool) -> Result<()> {
        id(&self.id, new)?;
        money(&self.amount_minor)?;
        identity::financial_date(&self.reference_date)
            .map_err(|_| LocalError::InvalidAccountChange)?;
        if !["START_OF_DAY", "END_OF_DAY"].contains(&self.day_position.as_str()) {
            return invalid();
        }
        Ok(())
    }
    fn stored(&self, workspace: &str, account: &str, now: &str) -> Reference {
        Reference {
            id: self.id.clone(),
            workspace_id: workspace.into(),
            account_id: account.into(),
            amount_minor: self.amount_minor.clone(),
            reference_date: self.reference_date.clone(),
            day_position: self.day_position.clone(),
            source: "MANUAL".into(),
            status: "ACTIVE".into(),
            created_at: now.into(),
        }
    }
    fn matches(&self, r: &Reference) -> bool {
        self.id == r.id
            && self.amount_minor == r.amount_minor
            && self.reference_date == r.reference_date
            && self.day_position == r.day_position
            && r.source == "MANUAL"
    }
}
impl AccountState {
    pub fn validate(&self, workspace: &str) -> Result<()> {
        self.account.validate(workspace)?;
        let mut ids = BTreeSet::new();
        let mut points = BTreeSet::new();
        for r in &self.references {
            ReferenceInput {
                id: r.id.clone(),
                amount_minor: r.amount_minor.clone(),
                reference_date: r.reference_date.clone(),
                day_position: r.day_position.clone(),
            }
            .validate(false)?;
            if r.workspace_id != workspace
                || r.account_id != self.account.id
                || !["MANUAL", "STATEMENT", "IMPORT"].contains(&r.source.as_str())
                || !["ACTIVE", "SUPERSEDED"].contains(&r.status.as_str())
                || !ids.insert(&r.id)
            {
                return invalid();
            }
            identity::utc_instant(&r.created_at).map_err(|_| LocalError::InvalidAccountChange)?;
            if r.status == "ACTIVE" && !points.insert((&r.reference_date, &r.day_position)) {
                return invalid();
            }
        }
        Ok(())
    }
}
impl AccountChange {
    pub fn account_id(&self) -> &str {
        match self {
            Self::Create { account, .. } => &account.id,
            Self::Update { base, .. } => &base.id,
            Self::Reference { account_id, .. } => account_id,
        }
    }
    pub fn capture(mut self, workspace: &str) -> Result<Self> {
        id(workspace, false)?;
        match &mut self {
            Self::Create { account, reference } => {
                id(&account.id, true)?;
                account.name = label(&account.name)?;
                account.institution_name = optional_label(&account.institution_name)?;
                if !valid_kind(&account.account_kind)
                    || account.currency_code != "BRL"
                    || !["ASSET", "LIABILITY"].contains(&account.balance_nature.as_str())
                {
                    return invalid();
                }
                let liability =
                    ["CREDIT_CARD", "LOAN_SIMPLE"].contains(&account.account_kind.as_str());
                if (liability && account.balance_nature != "LIABILITY")
                    || (!liability
                        && account.account_kind != "OTHER"
                        && account.balance_nature != "ASSET")
                {
                    return invalid();
                }
                if let Some(r) = reference {
                    r.validate(true)?;
                    if r.id == account.id {
                        return invalid();
                    }
                }
            }
            Self::Update {
                base,
                name,
                institution_name,
                status,
            } => {
                base.validate(workspace)?;
                if *name != base.name {
                    *name = label(name)?;
                }
                if *institution_name != base.institution_name {
                    *institution_name = optional_label(institution_name)?;
                }
                if !["ACTIVE", "ARCHIVED"].contains(&status.as_str()) {
                    return invalid();
                }
            }
            Self::Reference {
                account_id,
                reference,
                replaces_id,
            } => {
                id(account_id, false)?;
                reference.validate(true)?;
                if let Some(old) = replaces_id {
                    id(old, false)?;
                    if *old == reference.id {
                        return invalid();
                    }
                }
                if *account_id == reference.id {
                    return invalid();
                }
            }
        }
        Ok(self)
    }
}
pub fn plan(
    workspace: &str,
    current: Option<AccountState>,
    change: AccountChange,
    now: &str,
) -> Result<AccountPlan> {
    let change = change.capture(workspace)?;
    identity::utc_instant(now).map_err(|_| LocalError::StorageUnavailable)?;
    if let Some(s) = &current {
        s.validate(workspace)?;
        if s.account.id != change.account_id() {
            return invalid();
        }
    }
    let result = |action,
                  changed,
                  mut state: AccountState,
                  reference_id,
                  replaces_id|
     -> Result<AccountPlan> {
        state.references.sort_by(|a, b| a.id.cmp(&b.id));
        state.validate(workspace)?;
        Ok(AccountPlan {
            action,
            changed,
            state,
            reference_id,
            replaces_id,
        })
    };
    match change {
        AccountChange::Create { account, reference } => {
            let expected = Account {
                id: account.id,
                name: account.name,
                institution_name: account.institution_name,
                workspace_id: workspace.into(),
                account_kind: account.account_kind,
                balance_nature: account.balance_nature,
                currency_code: account.currency_code,
                status: "ACTIVE".into(),
                created_at: current
                    .as_ref()
                    .map_or(now, |s| s.account.created_at.as_str())
                    .into(),
            };
            let ref_id = reference.as_ref().map(|r| r.id.clone());
            if let Some(state) = current {
                let matches = match &reference {
                    None => state.references.is_empty(),
                    Some(r) => state.references.len() == 1 && r.matches(&state.references[0]),
                };
                if state.account != expected || !matches {
                    return Err(LocalError::StaleAccount);
                }
                return result(Action::Create, false, state, ref_id, None);
            }
            let refs = reference
                .map(|r| r.stored(workspace, &expected.id, now))
                .into_iter()
                .collect();
            result(
                Action::Create,
                true,
                AccountState {
                    account: expected,
                    references: refs,
                },
                ref_id,
                None,
            )
        }
        AccountChange::Update {
            base,
            name,
            institution_name,
            status,
        } => {
            let mut state = current.ok_or(LocalError::AccountNotFound)?;
            let desired = Account {
                name,
                institution_name,
                status,
                ..base.clone()
            };
            if state.account == desired {
                return result(Action::Update, false, state, None, None);
            }
            if state.account != base {
                return Err(LocalError::StaleAccount);
            }
            state.account = desired;
            result(Action::Update, true, state, None, None)
        }
        AccountChange::Reference {
            account_id,
            reference,
            replaces_id,
        } => {
            let mut state = current.ok_or(LocalError::AccountNotFound)?;
            let previous = replaces_id
                .as_ref()
                .and_then(|id| state.references.iter().find(|r| r.id == *id));
            if let Some(existing) = state.references.iter().find(|r| r.id == reference.id) {
                if !reference.matches(existing)
                    || (replaces_id.is_some()
                        && !previous.is_some_and(|r| r.status == "SUPERSEDED"))
                {
                    return Err(LocalError::ReferenceConflict);
                }
                return result(
                    Action::Reference,
                    false,
                    state,
                    Some(reference.id),
                    replaces_id,
                );
            }
            if state.account.status != "ACTIVE" {
                return Err(LocalError::AccountArchived);
            }
            if replaces_id.is_some() && !previous.is_some_and(|r| r.status == "ACTIVE") {
                return Err(LocalError::StaleAccount);
            }
            if state.references.iter().any(|r| {
                r.status == "ACTIVE"
                    && Some(&r.id) != replaces_id.as_ref()
                    && r.reference_date == reference.reference_date
                    && r.day_position == reference.day_position
            }) {
                return Err(LocalError::ReferenceConflict);
            }
            for r in &mut state.references {
                if Some(&r.id) == replaces_id.as_ref() {
                    r.status = "SUPERSEDED".into();
                }
            }
            state
                .references
                .push(reference.stored(workspace, &account_id, now));
            result(
                Action::Reference,
                true,
                state,
                Some(reference.id),
                replaces_id,
            )
        }
    }
}
