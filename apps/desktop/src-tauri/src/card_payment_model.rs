//! Pure Desktop mirror of the shared card_payment command and revision policy.
use crate::{
    LocalError, Result, identity,
    movement_model::{AccountDescriptor, Content, Plan, Snapshot, State, integer, version},
};
use serde::{Deserialize, Deserializer, Serialize};
fn nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
fn invalid<T>() -> Result<T> {
    Err(LocalError::InvalidCardPayment)
}
fn resource(s: &str, new: bool) -> Result<()> {
    let id = identity::resource_id(s).map_err(|_| LocalError::InvalidCardPayment)?;
    if new && id.get_version_num() != 7 {
        return invalid();
    }
    Ok(())
}
pub use crate::transfer_model::Group;
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Base {
    pub group_id: String,
    pub source: State,
    pub target: State,
}
impl Base {
    fn capture(mut self, w: &str) -> Result<Self> {
        resource(&self.group_id, false)?;
        self.source = self.source.capture()?;
        self.target = self.target.capture()?;
        let s = &self.source;
        let t = &self.target;
        if s.workspace_id != w
            || t.workspace_id != w
            || s.id == t.id
            || s.content.group_id.as_deref() != Some(&self.group_id)
            || t.content.group_id.as_deref() != Some(&self.group_id)
            || s.content.financial_date != t.content.financial_date
            || s.content.account_id == t.content.account_id
            || s.content.deleted != t.content.deleted
            || integer(&s.content.account_amount_minor)? >= 0
            || s.content.account_amount_minor != t.content.account_amount_minor
        {
            return invalid();
        }
        if [s, t].iter().any(|s| {
            s.content.origin_kind != "MANUAL" || s.content.economic_kind != "DEBT_SETTLEMENT"
        }) {
            return Err(LocalError::CardPaymentReadOnly);
        }
        Ok(self)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE", deny_unknown_fields)]
pub enum Command {
    Create {
        id: String,
        source_entry_id: String,
        target_entry_id: String,
        source_account: AccountDescriptor,
        target_account: AccountDescriptor,
        financial_date: String,
        amount_minor: String,
        display_name: String,
        #[serde(deserialize_with = "nullable")]
        original_description: Option<String>,
    },
    Edit {
        base: Box<Base>,
        source_account: AccountDescriptor,
        target_account: AccountDescriptor,
        financial_date: String,
        amount_minor: String,
        display_name: String,
    },
    Delete {
        base: Box<Base>,
    },
    Restore {
        base: Box<Base>,
    },
}
impl Command {
    pub fn group_id(&self) -> &str {
        match self {
            Self::Create { id, .. } => id,
            _ => &self.base().expect("captured card_payment base").group_id,
        }
    }
    pub fn ids(&self) -> [&str; 2] {
        match self {
            Self::Create {
                source_entry_id,
                target_entry_id,
                ..
            } => [source_entry_id, target_entry_id],
            _ => {
                let b = self.base().expect("captured card_payment base");
                [&b.source.id, &b.target.id]
            }
        }
    }
    pub fn base(&self) -> Option<&Base> {
        match self {
            Self::Create { .. } => None,
            Self::Edit { base, .. } | Self::Delete { base } | Self::Restore { base } => Some(base),
        }
    }
    fn descriptor(&self, index: usize) -> Option<&AccountDescriptor> {
        match self {
            Self::Create {
                source_account,
                target_account,
                ..
            }
            | Self::Edit {
                source_account,
                target_account,
                ..
            } => Some(if index == 0 {
                source_account
            } else {
                target_account
            }),
            _ => None,
        }
    }
    pub fn capture(mut self, w: &str) -> Result<Self> {
        let capture = (|| {
            resource(w, false)?;
            match &mut self {
                Self::Delete { base } | Self::Restore { base } => {
                    **base = (**base).clone().capture(w)?;
                }
                Self::Create {
                    id,
                    source_entry_id,
                    target_entry_id,
                    source_account,
                    target_account,
                    financial_date,
                    amount_minor,
                    display_name,
                    original_description,
                } => {
                    for id in [
                        id.as_str(),
                        source_entry_id.as_str(),
                        target_entry_id.as_str(),
                    ] {
                        resource(id, true)?;
                    }
                    if id == source_entry_id
                        || id == target_entry_id
                        || source_entry_id == target_entry_id
                    {
                        return invalid();
                    }
                    accounts(source_account, target_account, w)?;
                    fields(financial_date, amount_minor)?;
                    *display_name = crate::movement_model::label(display_name)?;
                    if original_description.as_ref().is_some_and(|s| {
                        s.encode_utf16().count() > 2000 || s.chars().any(char::is_control)
                    }) {
                        return invalid();
                    }
                }
                Self::Edit {
                    base,
                    source_account,
                    target_account,
                    financial_date,
                    amount_minor,
                    display_name,
                } => {
                    **base = (**base).clone().capture(w)?;
                    if base.source.content.deleted {
                        return Err(LocalError::CardPaymentDeleted);
                    }
                    accounts(source_account, target_account, w)?;
                    fields(financial_date, amount_minor)?;
                    if base.group_id == base.source.id || base.group_id == base.target.id {
                        return invalid();
                    }
                    if *display_name != base.source.content.display_name
                        || *display_name != base.target.content.display_name
                    {
                        *display_name = crate::movement_model::label(display_name)?;
                    }
                }
            }
            let _ = self.contents()?;
            Ok(())
        })();
        match capture {
            Ok(()) => Ok(self),
            Err(e) => Err(match e {
                LocalError::CardPaymentReadOnly
                | LocalError::CardPaymentDeleted
                | LocalError::AllocationReviewRequired => e,
                _ => LocalError::InvalidCardPayment,
            }),
        }
    }
    pub fn contents(&self) -> Result<[Content; 2]> {
        let mut entries = Vec::with_capacity(2);
        for index in 0..2 {
            let before = self
                .base()
                .map(|b| if index == 0 { &b.source } else { &b.target });
            let content = match self {
                Self::Delete { .. } | Self::Restore { .. } => {
                    let mut c = before
                        .ok_or(LocalError::InvalidCardPayment)?
                        .content
                        .clone();
                    c.deleted = matches!(self, Self::Delete { .. });
                    c
                }
                Self::Create {
                    financial_date,
                    amount_minor,
                    display_name,
                    ..
                }
                | Self::Edit {
                    financial_date,
                    amount_minor,
                    display_name,
                    ..
                } => {
                    let magnitude = integer(amount_minor)?;
                    let amount = (-magnitude).to_string();
                    let mut c = before.map_or_else(
                        || Content {
                            account_id: String::new(),
                            group_id: Some(self.group_id().into()),
                            counterparty_id: None,
                            financial_date: financial_date.clone(),
                            account_amount_minor: amount.clone(),
                            economic_kind: "DEBT_SETTLEMENT".into(),
                            original_description: None,
                            display_name: display_name.clone(),
                            origin_kind: "MANUAL".into(),
                            deleted: false,
                            allocations: vec![],
                            tag_ids: vec![],
                        },
                        |s| s.content.clone(),
                    );
                    if let Self::Create {
                        original_description,
                        ..
                    } = self
                    {
                        c.original_description = original_description.clone();
                    }
                    if before.is_some()
                        && amount != c.account_amount_minor
                        && !c.allocations.is_empty()
                    {
                        if c.allocations.len() != 1 {
                            return Err(LocalError::AllocationReviewRequired);
                        }
                        c.allocations[0].amount_minor = amount_minor.clone();
                    }
                    c.account_id = self
                        .descriptor(index)
                        .ok_or(LocalError::InvalidCardPayment)?
                        .id
                        .clone();
                    c.financial_date = financial_date.clone();
                    c.account_amount_minor = amount;
                    c.display_name = display_name.clone();
                    c.economic_kind = "DEBT_SETTLEMENT".into();
                    c.origin_kind = "MANUAL".into();
                    c.deleted = false;
                    c
                }
            };
            entries.push(content.capture()?);
        }
        entries
            .try_into()
            .map_err(|_| LocalError::InvalidCardPayment)
    }
}
fn accounts(a: &AccountDescriptor, b: &AccountDescriptor, w: &str) -> Result<()> {
    a.validate(w)?;
    b.validate(w)?;
    if a.id == b.id
        || a.status != "ACTIVE"
        || b.status != "ACTIVE"
        || a.balance_nature != "ASSET"
        || b.balance_nature != "LIABILITY"
        || b.account_kind != "CREDIT_CARD"
    {
        return invalid();
    }
    Ok(())
}
fn fields(date: &str, amount: &str) -> Result<()> {
    identity::financial_date(date).map_err(|_| LocalError::InvalidCardPayment)?;
    if integer(amount)? <= 0 {
        return invalid();
    }
    Ok(())
}
pub struct CardPaymentPlan {
    pub creation: bool,
    pub plans: Vec<Plan>,
}
fn revision(
    w: &str,
    id: &str,
    current: Option<State>,
    content: Content,
    base: &str,
    now: &str,
) -> Result<Plan> {
    let before = current.map(State::capture).transpose()?;
    if before.is_none() && base != "0" {
        return Err(LocalError::NotFound);
    }
    if let Some(b) = &before {
        if b.id != id || b.workspace_id != w {
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
        .to_owned();
    let after = if !changed {
        before.clone().ok_or(LocalError::InvalidRevision)?
    } else {
        State {
            workspace_id: w.into(),
            id: id.into(),
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
    let snapshot = changed.then(|| Snapshot {
        format_version: 1,
        base_revision: base.into(),
        before: before.clone(),
        after: after.clone(),
    });
    Ok(Plan {
        changed,
        before,
        after,
        snapshot,
    })
}
pub fn plan(
    w: &str,
    command: Command,
    current: [Option<State>; 2],
    live: &[AccountDescriptor],
    group: Option<&Group>,
    now: &str,
) -> Result<CardPaymentPlan> {
    let c = command.capture(w)?;
    let ids = c.ids();
    let contents = c.contents()?;
    let mut order = [0, 1];
    order.sort_by_key(|&i| ids[i]);
    let mut plans = Vec::with_capacity(2);
    for index in order {
        let expected = c
            .base()
            .map(|b| if index == 0 { &b.source } else { &b.target });
        let base = expected.map_or("0", |s| s.version.as_str());
        let p = revision(
            w,
            ids[index],
            current[index].clone(),
            contents[index].clone(),
            base,
            now,
        )?;
        let target = live
            .iter()
            .find(|a| a.id == p.after.content.account_id)
            .ok_or(LocalError::NotFound)?;
        let previous = p
            .before
            .as_ref()
            .map(|b| {
                live.iter()
                    .find(|a| a.id == b.content.account_id)
                    .ok_or(LocalError::NotFound)
            })
            .transpose()?;
        if p.before.as_ref() != expected {
            return Err(LocalError::CardPaymentBaseConflict);
        }
        for a in [Some(target), previous].into_iter().flatten() {
            a.validate(w)?;
            if a.status != "ACTIVE" {
                return Err(LocalError::CardPaymentAccountArchived);
            }
            if if index == 0 {
                a.balance_nature != "ASSET"
            } else {
                a.balance_nature != "LIABILITY" || a.account_kind != "CREDIT_CARD"
            } {
                return Err(LocalError::CardPaymentAccountChanged);
            }
        }
        if c.descriptor(index).is_some_and(|d| d != target) {
            return Err(LocalError::CardPaymentAccountChanged);
        }
        plans.push(p);
    }
    let creation = matches!(c, Command::Create { .. });
    if creation {
        if group.is_some() {
            return Err(LocalError::VersionConflict);
        }
    } else {
        let g = group.ok_or(LocalError::CompositeRequired)?;
        let mut members = g.member_ids.clone();
        members.sort();
        let mut expected = ids.iter().map(|id| id.to_string()).collect::<Vec<_>>();
        expected.sort();
        if g.workspace_id != w
            || g.id != c.group_id()
            || g.group_type != "CARD_PAYMENT"
            || g.state != "ACTIVE"
            || members != expected
        {
            return Err(LocalError::CompositeRequired);
        }
    }
    let s = &plans
        .iter()
        .find(|p| p.after.id == ids[0])
        .ok_or(LocalError::InvalidCardPayment)?
        .after;
    let t = &plans
        .iter()
        .find(|p| p.after.id == ids[1])
        .ok_or(LocalError::InvalidCardPayment)?
        .after;
    if s.content.account_id == t.content.account_id
        || s.content.financial_date != t.content.financial_date
        || s.content.deleted != t.content.deleted
        || integer(&s.content.account_amount_minor)? >= 0
        || s.content.account_amount_minor != t.content.account_amount_minor
    {
        return Err(LocalError::CompositeRequired);
    }
    Ok(CardPaymentPlan { creation, plans })
}
