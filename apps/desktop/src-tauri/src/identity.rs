//! US-023 production candidate. Existing spike formats/IDs are preserved.
use chrono::{DateTime, Datelike, NaiveDate, SecondsFormat, Timelike, Utc};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::{Builder, Uuid, Variant};

#[derive(Debug, PartialEq, Eq)]
pub enum IdentityError {
    InvalidId,
    InvalidUuidTime,
    InvalidInstant,
    InvalidDate,
    ClockUnavailable,
    EntropyUnavailable,
}
pub type Result<T> = std::result::Result<T, IdentityError>;
pub const MAX_UUID_MILLISECONDS: u64 = (1_u64 << 48) - 1;
pub fn resource_id(value: &str) -> Result<Uuid> {
    let id = Uuid::try_parse(value).map_err(|_| IdentityError::InvalidId)?;
    if id.hyphenated().to_string() != value
        || id.get_variant() != Variant::RFC4122
        || !(1..=8).contains(&id.get_version_num())
    {
        return Err(IdentityError::InvalidId);
    }
    Ok(id)
}
pub fn uuid_v7(milliseconds: u64, entropy: &[u8; 10]) -> Result<Uuid> {
    if milliseconds > MAX_UUID_MILLISECONDS {
        return Err(IdentityError::InvalidUuidTime);
    }
    Ok(Builder::from_unix_timestamp_millis(milliseconds, entropy).into_uuid())
}
pub fn new_id_with(
    clock: impl FnOnce() -> Result<i64>,
    fill: impl FnOnce(&mut [u8]) -> Result<()>,
) -> Result<Uuid> {
    let milliseconds = u64::try_from(clock()?).map_err(|_| IdentityError::InvalidUuidTime)?;
    if milliseconds > MAX_UUID_MILLISECONDS {
        return Err(IdentityError::InvalidUuidTime);
    }
    let mut bytes = [0_u8; 10];
    fill(&mut bytes)?;
    uuid_v7(milliseconds, &bytes)
}
pub(crate) fn system_milliseconds() -> Result<i64> {
    let nanos = match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(elapsed) => {
            i128::try_from(elapsed.as_nanos()).map_err(|_| IdentityError::ClockUnavailable)?
        }
        Err(before) => -i128::try_from(before.duration().as_nanos())
            .map_err(|_| IdentityError::ClockUnavailable)?,
    };
    i64::try_from(nanos.div_euclid(1_000_000)).map_err(|_| IdentityError::ClockUnavailable)
}
pub fn new_id() -> Result<Uuid> {
    new_id_with(system_milliseconds, |bytes| {
        getrandom::fill(bytes).map_err(|_| IdentityError::EntropyUnavailable)
    })
}
pub fn financial_date(value: &str) -> Result<&str> {
    if value.len() != 10 {
        return Err(IdentityError::InvalidDate);
    }
    let parsed =
        NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| IdentityError::InvalidDate)?;
    if !(1..=9999).contains(&parsed.year()) || parsed.format("%Y-%m-%d").to_string() != value {
        return Err(IdentityError::InvalidDate);
    }
    Ok(value)
}
pub fn utc_instant(value: &str) -> Result<&str> {
    if value.len() != 24 {
        return Err(IdentityError::InvalidInstant);
    }
    let parsed = DateTime::parse_from_rfc3339(value).map_err(|_| IdentityError::InvalidInstant)?;
    if !(1..=9999).contains(&parsed.year())
        || parsed.second() > 59
        || parsed.nanosecond() >= 1_000_000_000
        || parsed
            .with_timezone(&Utc)
            .to_rfc3339_opts(SecondsFormat::Millis, true)
            != value
        || parsed.timestamp_subsec_nanos() % 1_000_000 != 0
    {
        return Err(IdentityError::InvalidInstant);
    }
    Ok(value)
}
pub fn instant_from_epoch_milliseconds(value: i64) -> Result<String> {
    let parsed =
        DateTime::<Utc>::from_timestamp_millis(value).ok_or(IdentityError::InvalidInstant)?;
    if !(1..=9999).contains(&parsed.year()) {
        return Err(IdentityError::InvalidInstant);
    }
    Ok(parsed.to_rfc3339_opts(SecondsFormat::Millis, true))
}
pub fn now_instant() -> Result<String> {
    instant_from_epoch_milliseconds(system_milliseconds()?)
}
