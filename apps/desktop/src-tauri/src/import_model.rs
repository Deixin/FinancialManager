//! Pure import metadata validation; no paths, SQL or financial mutations.
use crate::{LocalError, Result, identity};
use serde_json::Value;
pub const STATUSES: [&str; 7] = [
    "PREPARING",
    "REVIEW",
    "CONFIRMING",
    "COMMITTED",
    "FAILED",
    "REVERSED",
    "PARTIALLY_REVERSED",
];
pub const ITEMS: [&str; 7] = [
    "NEW",
    "DUPLICATE",
    "POSSIBLE_DUPLICATE",
    "UPDATE",
    "INVALID",
    "SKIPPED",
    "COMMITTED",
];
pub const ACTIONS: [&str; 6] = ["CREATE", "UPDATE", "LINK", "UNLINK", "RESTORE", "DELETE"];
fn invalid<T>() -> Result<T> {
    Err(LocalError::InvalidImportState)
}
pub fn exact(v: &Value, keys: &[&str]) -> Result<()> {
    if v.as_object()
        .is_none_or(|m| m.len() != keys.len() || keys.iter().any(|k| !m.contains_key(*k)))
    {
        return invalid();
    }
    Ok(())
}
pub fn text<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v[key].as_str().ok_or(LocalError::InvalidImportState)
}
fn id(v: &Value, key: &str, nullable: bool) -> Result<()> {
    if nullable && v[key].is_null() {
        return Ok(());
    }
    identity::resource_id(text(v, key)?).map_err(|_| LocalError::InvalidImportState)?;
    Ok(())
}
fn instant(v: &Value, key: &str, nullable: bool) -> Result<()> {
    if nullable && v[key].is_null() {
        return Ok(());
    }
    identity::utc_instant(text(v, key)?).map_err(|_| LocalError::InvalidImportState)?;
    Ok(())
}
fn label(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.trim_matches(crate::category_model::js_space) == s
        && s.encode_utf16().count() <= max
        && !s.chars().any(char::is_control)
}
pub fn count(v: &Value) -> Result<i64> {
    let s = v.as_str().ok_or(LocalError::InvalidImportState)?;
    if s.len() > 19 {
        return invalid();
    }
    let n = s
        .parse::<i64>()
        .map_err(|_| LocalError::InvalidImportState)?;
    if n < 0 || n.to_string() != s {
        return invalid();
    }
    Ok(n)
}
pub fn query(v: &Value) -> Result<()> {
    let run = || {
        exact(v, &["statuses", "account_id", "cursor", "limit"])?;
        let ss = v["statuses"]
            .as_array()
            .ok_or(LocalError::InvalidImportState)?;
        if ss.len() > 7
            || ss
                .iter()
                .any(|s| s.as_str().is_none_or(|s| !STATUSES.contains(&s)))
            || ss.iter().enumerate().any(|(i, s)| ss[..i].contains(s))
            || v["limit"].as_u64().is_none_or(|n| !(1..=100).contains(&n))
        {
            return invalid();
        }
        id(v, "account_id", true)?;
        if !v["cursor"].is_null() {
            exact(&v["cursor"], &["created_at", "id"])?;
            id(&v["cursor"], "id", false)?;
            instant(&v["cursor"], "created_at", false)?;
        }
        Ok(())
    };
    run().map_err(|_| LocalError::InvalidImportRequest)
}
pub fn prepare(v: &Value) -> Result<()> {
    let run = || {
        exact(v, &["id", "target_account_id"])?;
        id(v, "id", false)?;
        id(v, "target_account_id", false)?;
        if identity::resource_id(text(v, "id")?)
            .map_err(|_| LocalError::InvalidImportState)?
            .get_version_num()
            != 7
        {
            return invalid();
        }
        Ok(())
    };
    run().map_err(|_| LocalError::InvalidImportRequest)
}
pub fn detail(v: &Value) -> Result<()> {
    let run = || {
        exact(v, &["id", "effect_after", "effect_limit"])?;
        id(v, "id", false)?;
        id(v, "effect_after", true)?;
        if v["effect_limit"]
            .as_u64()
            .is_none_or(|n| !(1..=100).contains(&n))
        {
            return invalid();
        }
        Ok(())
    };
    run().map_err(|_| LocalError::InvalidImportRequest)
}
pub fn batch(v: &Value, w: &str) -> Result<()> {
    exact(
        v,
        &[
            "id",
            "workspace_id",
            "target_account_id",
            "batch_kind",
            "status",
            "reverses_batch_id",
            "created_by_member_id",
            "created_at",
            "committed_at",
            "version",
            "failure_code",
        ],
    )?;
    for k in ["id", "workspace_id"] {
        id(v, k, false)?;
    }
    for k in [
        "target_account_id",
        "reverses_batch_id",
        "created_by_member_id",
    ] {
        id(v, k, true)?;
    }
    instant(v, "created_at", false)?;
    instant(v, "committed_at", true)?;
    let status = text(v, "status")?;
    if v["workspace_id"] != w
        || !STATUSES.contains(&status)
        || count(&v["version"])? == 0
        || !["IMPORT", "REVERSAL"].contains(&text(v, "batch_kind")?)
        || (v["batch_kind"] == "IMPORT") != v["reverses_batch_id"].is_null()
        || v["id"] == v["reverses_batch_id"]
        || ["COMMITTED", "REVERSED", "PARTIALLY_REVERSED"].contains(&status)
            == v["committed_at"].is_null()
        || (!v["committed_at"].is_null() && text(v, "committed_at")? < text(v, "created_at")?)
        || (status == "FAILED") == v["failure_code"].is_null()
    {
        return invalid();
    }
    if !v["failure_code"].is_null() {
        let s = text(v, "failure_code")?;
        if !label(s, 64)
            || !s.as_bytes()[0].is_ascii_uppercase()
            || !s
                .bytes()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
        {
            return invalid();
        }
    }
    Ok(())
}
pub fn source(v: &Value, w: &str, b: &str) -> Result<()> {
    exact(
        v,
        &[
            "id",
            "workspace_id",
            "batch_id",
            "file_name",
            "file_hash",
            "format",
            "parser_name",
            "parser_version",
            "detected_currency",
            "period_start",
            "period_end",
            "imported_at",
        ],
    )?;
    for k in ["id", "workspace_id", "batch_id"] {
        id(v, k, false)?;
    }
    instant(v, "imported_at", false)?;
    let name = text(v, "file_name")?;
    let format = text(v, "format")?;
    let hash = text(v, "file_hash")?;
    if v["workspace_id"] != w
        || v["batch_id"] != b
        || !label(name, 255)
        || name.contains(['\\', '/', ':'])
        || [".", ".."].contains(&name)
        || !label(format, 32)
        || !format
            .bytes()
            .enumerate()
            .all(|(i, c)| c.is_ascii_alphanumeric() || c == b'_' || (i > 0 && b".-".contains(&c)))
        || hash.len() != 64
        || !hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        || v["parser_name"].is_null() != v["parser_version"].is_null()
    {
        return invalid();
    }
    for (k, max) in [
        ("parser_name", 120),
        ("parser_version", 40),
        ("detected_currency", 3),
    ] {
        if !v[k].is_null() && !label(text(v, k)?, max) {
            return invalid();
        }
    }
    if !v["detected_currency"].is_null()
        && (text(v, "detected_currency")?.len() != 3
            || !text(v, "detected_currency")?
                .bytes()
                .all(|c| c.is_ascii_uppercase()))
    {
        return invalid();
    }
    for k in ["period_start", "period_end"] {
        if !v[k].is_null() {
            identity::financial_date(text(v, k)?).map_err(|_| LocalError::InvalidImportState)?;
        }
    }
    if !v["period_start"].is_null()
        && !v["period_end"].is_null()
        && text(v, "period_start")? > text(v, "period_end")?
    {
        return invalid();
    }
    Ok(())
}
pub fn effect(v: &Value, w: &str, b: &str) -> Result<()> {
    exact(
        v,
        &[
            "id",
            "workspace_id",
            "batch_id",
            "import_item_id",
            "transaction_id",
            "action",
            "before_revision_id",
            "after_revision_id",
            "created_at",
        ],
    )?;
    for k in [
        "id",
        "workspace_id",
        "batch_id",
        "import_item_id",
        "transaction_id",
    ] {
        id(v, k, false)?;
    }
    for k in ["before_revision_id", "after_revision_id"] {
        id(v, k, true)?;
    }
    instant(v, "created_at", false)?;
    let a = text(v, "action")?;
    if v["workspace_id"] != w
        || v["batch_id"] != b
        || !ACTIONS.contains(&a)
        || (a == "CREATE"
            && (!v["before_revision_id"].is_null() || v["after_revision_id"].is_null()))
        || (["UPDATE", "RESTORE", "DELETE"].contains(&a)
            && (v["before_revision_id"].is_null()
                || v["after_revision_id"].is_null()
                || v["before_revision_id"] == v["after_revision_id"]))
    {
        return invalid();
    }
    Ok(())
}
