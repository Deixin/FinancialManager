//! Pure US-041 model. SQL, keys, framework and financial aggregation stay outside.
use crate::{LocalError, Result, account_model::Account, identity};
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::BTreeSet;
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
fn invalid<T>() -> Result<T> {
    Err(LocalError::InvalidManualMovement)
}
fn id(s: &str, new: bool) -> Result<()> {
    let v = identity::resource_id(s).map_err(|_| LocalError::InvalidRevision)?;
    if new && v.get_version_num() != 7 {
        return invalid();
    }
    Ok(())
}
pub fn integer(s: &str) -> Result<i64> {
    let n = s.parse::<i64>().map_err(|_| LocalError::InvalidRevision)?;
    if n.to_string() != s {
        return Err(LocalError::InvalidRevision);
    }
    Ok(n)
}
pub fn version(s: &str, zero: bool) -> Result<i64> {
    let n = integer(s)?;
    if n < 0 || (!zero && n == 0) {
        return Err(LocalError::InvalidRevision);
    }
    Ok(n)
}
pub(crate) fn label(s: &str) -> Result<String> {
    let value = s.trim_matches(js_whitespace);
    if value.is_empty() || value.encode_utf16().count() > 2000 || s.chars().any(char::is_control) {
        return invalid();
    }
    Ok(value.into())
}
// ECMAScript trim excludes NEL and includes BOM. Keep legacy text identical
// to the shared Domain; new labels still reject every control character.
fn js_whitespace(c: char) -> bool {
    (c.is_whitespace() && c != '\u{0085}') || c == '\u{feff}'
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountDescriptor {
    pub id: String,
    pub workspace_id: String,
    pub currency_code: String,
    pub account_kind: String,
    pub balance_nature: String,
    pub status: String,
}
impl From<&Account> for AccountDescriptor {
    fn from(a: &Account) -> Self {
        Self {
            id: a.id.clone(),
            workspace_id: a.workspace_id.clone(),
            currency_code: a.currency_code.clone(),
            account_kind: a.account_kind.clone(),
            balance_nature: a.balance_nature.clone(),
            status: a.status.clone(),
        }
    }
}
impl AccountDescriptor {
    pub fn validate(&self, w: &str) -> Result<()> {
        id(&self.id, false)?;
        id(&self.workspace_id, false)?;
        if self.workspace_id != w
            || self.currency_code != "BRL"
            || !["ASSET", "LIABILITY"].contains(&self.balance_nature.as_str())
            || !["ACTIVE", "ARCHIVED"].contains(&self.status.as_str())
            || ![
                "CHECKING",
                "SAVINGS",
                "DIGITAL",
                "CASH",
                "CREDIT_CARD",
                "INVESTMENT_SIMPLE",
                "LOAN_SIMPLE",
                "OTHER",
            ]
            .contains(&self.account_kind.as_str())
        {
            return Err(LocalError::InvalidRevision);
        }
        Ok(())
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Allocation {
    pub id: String,
    pub category_id: String,
    #[serde(deserialize_with = "nullable")]
    pub subcategory_id: Option<String>,
    pub amount_minor: String,
    #[serde(deserialize_with = "nullable")]
    pub note: Option<String>,
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Content {
    pub account_id: String,
    #[serde(deserialize_with = "nullable")]
    pub group_id: Option<String>,
    #[serde(deserialize_with = "nullable")]
    pub counterparty_id: Option<String>,
    pub financial_date: String,
    pub account_amount_minor: String,
    pub economic_kind: String,
    #[serde(deserialize_with = "nullable")]
    pub original_description: Option<String>,
    pub display_name: String,
    pub origin_kind: String,
    pub deleted: bool,
    pub allocations: Vec<Allocation>,
    pub tag_ids: Vec<String>,
}
impl Content {
    pub fn capture(mut self) -> Result<Self> {
        id(&self.account_id, false)?;
        for v in [&self.group_id, &self.counterparty_id]
            .into_iter()
            .flatten()
        {
            id(v, false)?;
        }
        identity::financial_date(&self.financial_date).map_err(|_| LocalError::InvalidRevision)?;
        let amount = integer(&self.account_amount_minor)?;
        if self.display_name.trim_matches(js_whitespace).is_empty()
            || ![
                "INCOME",
                "EXPENSE",
                "EXPENSE_REVERSAL",
                "TRANSFER",
                "DEBT_SETTLEMENT",
                "ADJUSTMENT",
                "OTHER",
            ]
            .contains(&self.economic_kind.as_str())
            || !["MANUAL", "IMPORT", "DOCUMENT", "SYSTEM"].contains(&self.origin_kind.as_str())
        {
            return Err(LocalError::InvalidRevision);
        }
        self.allocations.sort_by(|a, b| a.id.cmp(&b.id));
        self.tag_ids.sort();
        let mut seen = BTreeSet::new();
        let mut sum = 0_i128;
        for a in &self.allocations {
            id(&a.id, false)?;
            id(&a.category_id, false)?;
            if let Some(s) = &a.subcategory_id {
                id(s, false)?;
            }
            let value = integer(&a.amount_minor)?;
            if value <= 0 || !seen.insert(&a.id) {
                return Err(LocalError::InvalidRevision);
            }
            sum += i128::from(value);
        }
        if !self.allocations.is_empty() && sum != i128::from(amount).abs() {
            return Err(LocalError::InvalidRevision);
        }
        let mut seen = BTreeSet::new();
        for tag in &self.tag_ids {
            id(tag, false)?;
            if !seen.insert(tag) {
                return Err(LocalError::InvalidRevision);
            }
        }
        Ok(self)
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct State {
    pub workspace_id: String,
    pub id: String,
    pub version: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(deserialize_with = "nullable")]
    pub deleted_at: Option<String>,
    pub content: Content,
}
impl State {
    pub fn capture(mut self) -> Result<Self> {
        id(&self.workspace_id, false)?;
        id(&self.id, false)?;
        version(&self.version, false)?;
        identity::utc_instant(&self.created_at).map_err(|_| LocalError::InvalidRevision)?;
        identity::utc_instant(&self.updated_at).map_err(|_| LocalError::InvalidRevision)?;
        if let Some(d) = &self.deleted_at {
            identity::utc_instant(d).map_err(|_| LocalError::InvalidRevision)?;
            if d < &self.created_at {
                return Err(LocalError::InvalidRevision);
            }
        }
        if self.updated_at < self.created_at || self.content.deleted != self.deleted_at.is_some() {
            return Err(LocalError::InvalidRevision);
        }
        self.content = self.content.capture()?;
        Ok(self)
    }
}
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Snapshot {
    pub format_version: u8,
    pub base_revision: String,
    #[serde(deserialize_with = "nullable")]
    pub before: Option<State>,
    pub after: State,
}
impl Snapshot {
    pub fn capture(mut self) -> Result<Self> {
        if self.format_version != 1 {
            return Err(LocalError::InvalidRevision);
        }
        let base = version(&self.base_revision, true)?;
        self.before = self.before.map(State::capture).transpose()?;
        self.after = self.after.capture()?;
        if base.checked_add(1) != Some(version(&self.after.version, false)?)
            || self.before.is_none() != (base == 0)
        {
            return Err(LocalError::InvalidRevision);
        }
        if let Some(b) = &self.before
            && (b.version != self.base_revision
                || b.id != self.after.id
                || b.workspace_id != self.after.workspace_id
                || b.created_at != self.after.created_at)
        {
            return Err(LocalError::InvalidRevision);
        }
        Ok(self)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum ManualCommand {
    Create {
        id: String,
        account: AccountDescriptor,
        financial_date: String,
        amount_minor: String,
        movement_kind: String,
        display_name: String,
        #[serde(deserialize_with = "nullable")]
        original_description: Option<String>,
    },
    Edit {
        base: Box<State>,
        account: AccountDescriptor,
        financial_date: String,
        amount_minor: String,
        movement_kind: String,
        display_name: String,
    },
    Delete {
        base: Box<State>,
    },
    Restore {
        base: Box<State>,
    },
    Adjust {
        id: String,
        account: AccountDescriptor,
        financial_date: String,
        delta_minor: String,
        reason: String,
    },
}
fn manual_base(base: &State, w: &str) -> Result<()> {
    if base.workspace_id != w {
        return invalid();
    }
    if base.content.origin_kind != "MANUAL"
        || base.content.group_id.is_some()
        || !["INCOME", "EXPENSE", "ADJUSTMENT"].contains(&base.content.economic_kind.as_str())
    {
        return Err(LocalError::ManualMovementReadOnly);
    }
    Ok(())
}
impl ManualCommand {
    pub fn transaction_id(&self) -> &str {
        match self {
            Self::Create { id, .. } | Self::Adjust { id, .. } => id,
            Self::Edit { base, .. } | Self::Delete { base } | Self::Restore { base } => &base.id,
        }
    }
    pub fn base(&self) -> Option<&State> {
        match self {
            Self::Edit { base, .. } | Self::Delete { base } | Self::Restore { base } => Some(base),
            _ => None,
        }
    }
    pub fn account_id(&self) -> &str {
        match self {
            Self::Create { account, .. }
            | Self::Adjust { account, .. }
            | Self::Edit { account, .. } => &account.id,
            Self::Delete { base } | Self::Restore { base } => &base.content.account_id,
        }
    }
    pub fn descriptor(&self) -> Option<&AccountDescriptor> {
        match self {
            Self::Create { account, .. }
            | Self::Adjust { account, .. }
            | Self::Edit { account, .. } => Some(account),
            _ => None,
        }
    }
    pub fn capture(mut self, w: &str) -> Result<Self> {
        let result = (|| {
            id(w, false)?;
            match &mut self {
                Self::Create {
                    id: resource,
                    account,
                    financial_date,
                    amount_minor,
                    movement_kind,
                    display_name,
                    original_description,
                } => {
                    id(resource, true)?;
                    account.validate(w)?;
                    identity::financial_date(financial_date)
                        .map_err(|_| LocalError::InvalidManualMovement)?;
                    if integer(amount_minor)? <= 0
                        || !["INCOME", "EXPENSE"].contains(&movement_kind.as_str())
                    {
                        return invalid();
                    }
                    *display_name = label(display_name)?;
                    if let Some(s) = original_description
                        && (s.encode_utf16().count() > 2000 || s.chars().any(char::is_control))
                    {
                        return invalid();
                    }
                }
                Self::Edit {
                    base,
                    account,
                    financial_date,
                    amount_minor,
                    movement_kind,
                    display_name,
                } => {
                    **base = (**base).clone().capture()?;
                    manual_base(base, w)?;
                    account.validate(w)?;
                    identity::financial_date(financial_date)
                        .map_err(|_| LocalError::InvalidManualMovement)?;
                    if integer(amount_minor)? <= 0
                        || !["INCOME", "EXPENSE"].contains(&movement_kind.as_str())
                    {
                        return invalid();
                    }
                    if *display_name != base.content.display_name {
                        *display_name = label(display_name)?;
                    }
                    if base.content.deleted {
                        return Err(LocalError::MovementDeleted);
                    }
                    if base.content.economic_kind == "ADJUSTMENT" {
                        return Err(LocalError::ManualMovementReadOnly);
                    }
                }
                Self::Delete { base } | Self::Restore { base } => {
                    **base = (**base).clone().capture()?;
                    manual_base(base, w)?;
                }
                Self::Adjust {
                    id: resource,
                    account,
                    financial_date,
                    delta_minor,
                    reason,
                } => {
                    id(resource, true)?;
                    account.validate(w)?;
                    identity::financial_date(financial_date)
                        .map_err(|_| LocalError::InvalidManualMovement)?;
                    if integer(delta_minor)? == 0 {
                        return invalid();
                    }
                    *reason = label(reason)?;
                }
            }
            Ok(())
        })();
        match result {
            Ok(()) => Ok(self),
            Err(e @ (LocalError::MovementDeleted | LocalError::ManualMovementReadOnly)) => Err(e),
            Err(_) => invalid(),
        }
    }
    fn content(&self) -> Result<Content> {
        match self {
            Self::Delete { base } | Self::Restore { base } => {
                let mut content = base.content.clone();
                content.deleted = matches!(self, Self::Delete { .. });
                Ok(content)
            }
            Self::Create {
                account,
                financial_date,
                amount_minor,
                movement_kind,
                display_name,
                original_description,
                ..
            } => Ok(Content {
                account_id: account.id.clone(),
                group_id: None,
                counterparty_id: None,
                financial_date: financial_date.clone(),
                account_amount_minor: signed(amount_minor, movement_kind, account)?,
                economic_kind: movement_kind.clone(),
                original_description: original_description.clone(),
                display_name: display_name.clone(),
                origin_kind: "MANUAL".into(),
                deleted: false,
                allocations: vec![],
                tag_ids: vec![],
            }),
            Self::Adjust {
                account,
                financial_date,
                delta_minor,
                reason,
                ..
            } => Ok(Content {
                account_id: account.id.clone(),
                group_id: None,
                counterparty_id: None,
                financial_date: financial_date.clone(),
                account_amount_minor: delta_minor.clone(),
                economic_kind: "ADJUSTMENT".into(),
                original_description: Some(reason.clone()),
                display_name: format!("Ajuste de saldo: {reason}"),
                origin_kind: "MANUAL".into(),
                deleted: false,
                allocations: vec![],
                tag_ids: vec![],
            }),
            Self::Edit {
                base,
                account,
                financial_date,
                amount_minor,
                movement_kind,
                display_name,
            } => {
                let mut content = base.content.clone();
                let amount = signed(amount_minor, movement_kind, account)?;
                if !content.allocations.is_empty() && content.economic_kind != *movement_kind {
                    return Err(LocalError::AllocationReviewRequired);
                }
                let magnitude = i128::from(integer(&amount)?).abs();
                if !content.allocations.is_empty()
                    && magnitude != i128::from(integer(&content.account_amount_minor)?).abs()
                {
                    if content.allocations.len() != 1 {
                        return Err(LocalError::AllocationReviewRequired);
                    }
                    content.allocations[0].amount_minor = i64::try_from(magnitude)
                        .map_err(|_| LocalError::InvalidManualMovement)?
                        .to_string();
                }
                content.account_id = account.id.clone();
                content.financial_date = financial_date.clone();
                content.account_amount_minor = amount;
                content.economic_kind = movement_kind.clone();
                content.display_name = display_name.clone();
                Ok(content)
            }
        }
    }
}
fn signed(amount: &str, kind: &str, a: &AccountDescriptor) -> Result<String> {
    let n = i128::from(integer(amount)?)
        * if kind == "INCOME" { 1 } else { -1 }
        * if a.balance_nature == "ASSET" { 1 } else { -1 };
    Ok(i64::try_from(n)
        .map_err(|_| LocalError::InvalidManualMovement)?
        .to_string())
}
pub struct Plan {
    pub changed: bool,
    pub before: Option<State>,
    pub after: State,
    pub snapshot: Option<Snapshot>,
}
pub fn plan(
    w: &str,
    current: Option<State>,
    command: ManualCommand,
    target: &AccountDescriptor,
    previous: Option<&AccountDescriptor>,
    now: &str,
) -> Result<Plan> {
    let command = command.capture(w)?;
    let content = command.content()?.capture()?;
    let before = current.map(State::capture).transpose()?;
    let base = command.base().map_or("0", |b| b.version.as_str());
    if before.is_none() && base != "0" {
        return Err(LocalError::NotFound);
    }
    if let Some(b) = &before {
        if b.workspace_id != w || b.id != command.transaction_id() {
            return Err(LocalError::InvalidRevision);
        }
        if b.version != base {
            return Err(LocalError::VersionConflict);
        }
        if b.content.origin_kind != content.origin_kind
            || b.content.original_description != content.original_description
        {
            return Err(LocalError::OriginImmutable);
        }
        if b.content.group_id.is_some() && b.content.group_id != content.group_id {
            return Err(LocalError::CompositeRequired);
        }
    }
    let changed = before.as_ref().is_none_or(|b| b.content != content);
    let next = if changed {
        version(base, true)?
            .checked_add(1)
            .ok_or(LocalError::VersionExhausted)?
            .to_string()
    } else {
        base.into()
    };
    if before.as_ref() != command.base() {
        return Err(LocalError::ManualBaseConflict);
    }
    target.validate(w)?;
    if before.is_some() && previous.is_none() {
        return Err(LocalError::NotFound);
    }
    for a in [Some(target), previous].into_iter().flatten() {
        a.validate(w)?;
        if a.status != "ACTIVE" {
            return Err(LocalError::ManualAccountArchived);
        }
    }
    if command.descriptor().is_some_and(|a| a != target) {
        return Err(LocalError::ManualAccountChanged);
    }
    if target.id != content.account_id {
        return Err(LocalError::InvalidRevision);
    }
    let economic = i128::from(integer(&content.account_amount_minor)?)
        * if target.balance_nature == "ASSET" {
            1
        } else {
            -1
        };
    if (content.economic_kind == "INCOME" && economic <= 0)
        || (content.economic_kind == "EXPENSE" && economic >= 0)
    {
        return Err(LocalError::InvalidRevision);
    }
    identity::utc_instant(now).map_err(|_| LocalError::InvalidRevision)?;
    let at = before
        .as_ref()
        .map_or(now, |b| {
            if b.updated_at.as_str() > now {
                &b.updated_at
            } else {
                now
            }
        })
        .to_string();
    let after = if !changed {
        before.clone().ok_or(LocalError::InvalidRevision)?
    } else {
        State {
            workspace_id: w.into(),
            id: command.transaction_id().into(),
            version: next,
            created_at: before
                .as_ref()
                .map_or_else(|| at.clone(), |b| b.created_at.clone()),
            updated_at: at.clone(),
            deleted_at: if content.deleted {
                Some(
                    before
                        .as_ref()
                        .and_then(|b| b.deleted_at.clone())
                        .unwrap_or(at),
                )
            } else {
                None
            },
            content,
        }
        .capture()?
    };
    let snapshot = if changed {
        Some(Snapshot {
            format_version: 1,
            base_revision: base.into(),
            before: before.clone(),
            after: after.clone(),
        })
    } else {
        None
    };
    Ok(Plan {
        changed,
        before,
        after,
        snapshot,
    })
}
