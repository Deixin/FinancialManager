//! US-052 pure normalizer. No storage or authorization port.
use crate::file_model::{self, Budget, Check, Metadata};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use zeroize::Zeroizing;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Destination {
    pub workspace_id: String,
    pub account_id: String,
    pub balance_nature: String,
    pub currency: String,
}
impl Destination {
    pub fn validate(&self) -> Check<()> {
        let valid_id = |s: &str| {
            uuid::Uuid::parse_str(s).is_ok_and(|u| {
                u.to_string() == s
                    && (1..=8).contains(&(u.as_bytes()[6] >> 4))
                    && u.as_bytes()[8] & 0xc0 == 0x80
            })
        };
        if !valid_id(&self.workspace_id)
            || !valid_id(&self.account_id)
            || !["ASSET", "LIABILITY"].contains(&self.balance_nature.as_str())
            || self.currency != "BRL"
        {
            return Err("INVALID_DESTINATION");
        }
        Ok(())
    }
}
pub type Fields = BTreeMap<String, Zeroizing<String>>;
pub fn get<'a>(fields: &'a Fields, key: &str) -> &'a str {
    fields.get(key).map(|s| s.as_str()).unwrap_or("")
}
pub fn bad_text(s: &str) -> bool {
    s.chars()
        .any(|c| c.is_control() || crate::file_unicode::is_format(c))
}
pub fn date(raw: &str) -> Option<String> {
    use chrono::NaiveDate;
    if !raw.is_ascii() || raw.len() < 8 || !raw.as_bytes()[..8].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let n = |a, b| raw[a..b].parse::<u32>().ok();
    let year = n(0, 4)?;
    if year == 0 {
        return None;
    }
    NaiveDate::from_ymd_opt(year as i32, n(4, 6)?, n(6, 8)?)?;
    if raw.len() != 8 {
        if raw.len() < 14
            || !raw.as_bytes()[8..14].iter().all(u8::is_ascii_digit)
            || n(8, 10)? > 23
            || n(10, 12)? > 59
            || n(12, 14)? > 60
        {
            return None;
        }
        let mut suffix = &raw[14..];
        if let Some(tail) = suffix.strip_prefix('.') {
            let digits = tail.bytes().take_while(u8::is_ascii_digit).count();
            if !(1..=3).contains(&digits) {
                return None;
            }
            suffix = &tail[digits..];
        }
        if !suffix.is_empty() {
            let zone = suffix.strip_prefix('[')?.strip_suffix(']')?;
            let parts: Vec<_> = zone.split(':').collect();
            if parts.len() > 2
                || (parts.len() == 2
                    && (parts[1].is_empty()
                        || parts[1].len() > 8
                        || !parts[1].bytes().all(|c| c.is_ascii_alphabetic())))
            {
                return None;
            }
            let offset = parts[0].strip_prefix(['+', '-']).unwrap_or(parts[0]);
            let components: Vec<_> = offset.split('.').collect();
            if components.len() > 2
                || components
                    .iter()
                    .any(|s| s.is_empty() || s.len() > 2 || !s.bytes().all(|c| c.is_ascii_digit()))
            {
                return None;
            }
            let whole = components[0].parse::<u32>().ok()?;
            let fraction = if components.len() == 2 {
                components[1].parse::<u32>().ok()?
            } else {
                0
            };
            if whole > 12 || (whole == 12 && fraction != 0) {
                return None;
            }
        }
    }
    Some(format!("{}-{}-{}", &raw[..4], &raw[4..6], &raw[6..8]))
}
pub fn minor(raw: &str, liability: bool) -> (Option<String>, Option<&'static str>) {
    let invalid = (None, Some("INVALID_AMOUNT"));
    if raw.is_empty() || raw.len() > 64 {
        return invalid;
    }
    let unsigned = raw.strip_prefix(['+', '-']).unwrap_or(raw);
    let parts: Vec<_> = unsigned.split('.').collect();
    if parts.len() > 2
        || parts[0].is_empty()
        || parts[0].len() > 20
        || !parts[0].bytes().all(|c| c.is_ascii_digit())
        || (parts.len() == 2
            && (parts[1].is_empty()
                || parts[1].len() > 2
                || !parts[1].bytes().all(|c| c.is_ascii_digit())))
    {
        return invalid;
    }
    let whole = parts[0].parse::<i128>().unwrap_or(0);
    let fraction = if parts.len() == 1 {
        0
    } else {
        parts[1].parse::<i128>().unwrap_or(0) * if parts[1].len() == 1 { 10 } else { 1 }
    };
    let amount = (whole * 100 + fraction)
        * if raw.starts_with('-') { -1 } else { 1 }
        * if liability { -1 } else { 1 };
    let Ok(amount) = i64::try_from(amount) else {
        return (None, Some("AMOUNT_OUT_OF_RANGE"));
    };
    (
        Some(amount.to_string()),
        if amount == 0 {
            Some("ZERO_AMOUNT")
        } else {
            None
        },
    )
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn parse(
    metadata: &Metadata,
    bytes: &[u8],
    destination: &Destination,
    valid: impl Fn() -> bool,
) -> Check<Value> {
    destination.validate()?;
    let budget = Budget::new(&valid);
    budget.check()?;
    let inspection = file_model::validate(metadata, bytes, || valid() && budget.check().is_ok());
    budget.check()?;
    let inspection = inspection?;
    if inspection.format != "OFX" {
        return Err("UNSUPPORTED_FORMAT");
    }
    let text = file_model::decode(bytes, &metadata.encoding)?;
    let (statement, mut rows) =
        crate::ofx_reader::read(&text, &metadata.encoding, destination, &budget)?;
    if rows.len() != inspection.records {
        return Err("INVALID_OFX_STRUCTURE");
    }
    if statement.currency != destination.currency {
        return Err("CURRENCY_MISMATCH");
    }
    if statement.liability != (destination.balance_nature == "LIABILITY") {
        return Err("ACCOUNT_KIND_MISMATCH");
    }
    let file_hash = hash(bytes);
    budget.check()?;
    let account_bytes = Zeroizing::new(
        serde_json::to_vec(&json!([
            "OFX",
            if statement.liability {
                "CCSTMTRS"
            } else {
                "STMTRS"
            },
            get(&statement.account, "BANKID"),
            get(&statement.account, "BRANCHID"),
            get(&statement.account, "ACCTID"),
            if statement.account.contains_key("ACCTTYPE") {
                get(&statement.account, "ACCTTYPE")
            } else {
                "CREDIT_CARD"
            }
        ]))
        .map_err(|_| "INVALID_OFX_STRUCTURE")?,
    );
    let account_hash = hash(&account_bytes);
    budget.check()?;
    let mut counts = BTreeMap::new();
    for row in &rows {
        if let Some(id) = row["source_external_id"].as_str() {
            *counts.entry(id.to_owned()).or_insert(0usize) += 1;
        }
    }
    for row in &mut rows {
        budget.check()?;
        let repeated = row["source_external_id"]
            .as_str()
            .is_some_and(|id| counts.get(id).copied().unwrap_or(0) > 1);
        let outside = row["normalized_date"]
            .as_str()
            .is_some_and(|d| d < statement.from.as_str() || d > statement.to.as_str());
        let warnings = row["warnings"]
            .as_array_mut()
            .ok_or("INVALID_OFX_STRUCTURE")?;
        if repeated {
            warnings.push(json!("REPEATED_SOURCE_ID"));
        }
        if outside {
            warnings.push(json!("DATE_OUTSIDE_SOURCE_PERIOD"));
        }
        row["provenance"]["file_hash"] = json!(file_hash);
    }
    budget.check()?;
    Ok(
        json!({"model_version":"1","destination":destination,"source":{"file_name":metadata.file_name,"file_hash":file_hash,"format":"OFX","parser_name":"fm-ofx","parser_version":"1.0.0","layout":if statement.sgml {"OFX_102_SGML"} else {"OFX_2_XML"},"detected_currency":"BRL","period_start":statement.from,"period_end":statement.to,"source_account_hash":account_hash},"items":rows}),
    )
}
