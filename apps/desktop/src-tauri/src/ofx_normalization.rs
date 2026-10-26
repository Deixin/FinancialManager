use crate::{
    file_model::units,
    ofx_model::{Destination, Fields, bad_text, date, get, minor},
    ofx_schema::TYPES,
};
use serde_json::{Value, json};
use unicode_normalization::UnicodeNormalization;
pub fn row(fields: &Fields, destination: &Destination, ordinal: usize, locator: &str) -> Value {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    let mut error = |field, code| errors.push(json!({"field":field,"code":code}));
    let parsed_date = date(get(fields, "DTPOSTED"));
    let (money, money_error) = minor(
        get(fields, "TRNAMT"),
        destination.balance_nature == "LIABILITY",
    );
    if parsed_date.is_none() {
        error("date", "INVALID_DATE");
    }
    if let Some(code) = money_error {
        error("amount", code);
    }
    let kind = get(fields, "TRNTYPE");
    let known = TYPES.contains(&kind);
    if !known {
        error("type", "UNSUPPORTED_TRANSACTION_TYPE");
    }
    if money.is_some()
        && ((kind == "CREDIT" && get(fields, "TRNAMT").starts_with('-'))
            || (kind == "DEBIT"
                && !get(fields, "TRNAMT").starts_with('-')
                && money.as_deref() != Some("0")))
    {
        error("type", "SIGN_TYPE_MISMATCH");
    }
    if fields.contains_key("CORRECTFITID") || fields.contains_key("CORRECTACTION") {
        error("correction", "CORRECTION_REQUIRES_REVIEW");
    }
    if ["XFER", "PAYMENT"].contains(&kind) {
        warnings.push("MOVEMENT_REQUIRES_REVIEW");
    }
    let description_tag = if !get(fields, "MEMO").is_empty() {
        Some("MEMO")
    } else if !get(fields, "NAME").is_empty() {
        Some("NAME")
    } else {
        None
    };
    let mut description = description_tag.map(|tag| get(fields, tag));
    if description.is_none_or(|s| s.is_empty() || units(s) > 1024 || bad_text(s)) {
        error("description", "INVALID_DESCRIPTION");
        description = None;
    }
    let mut name = description.map(|s| {
        s.nfc()
            .collect::<String>()
            .split(crate::category_model::js_space)
            .filter(|p| !p.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
    });
    if name.as_deref().is_some_and(|s| units(s) > 512) {
        error("description", "INVALID_DESCRIPTION");
        name = None;
    }
    let mut id = if get(fields, "FITID").is_empty() {
        None
    } else {
        Some(get(fields, "FITID"))
    };
    if id.is_none() {
        warnings.push("MISSING_SOURCE_ID");
    } else if id.is_some_and(|s| units(s) > 256 || bad_text(s)) {
        error("external_id", "INVALID_SOURCE_ID");
        id = None;
    }
    let path = |tag: &str| fields.contains_key(tag).then(|| format!("{locator}/{tag}"));
    json!({"row_no":ordinal,"source_external_id":id,"source_transaction_type":if known {Some(kind)} else {None},"normalized_date":parsed_date,"normalized_amount_minor":money,"original_description":description,"proposed_name":name,"disposition":if errors.is_empty() {"NEW"} else {"INVALID"},"validation_errors":errors,"warnings":warnings,"provenance":{"file_hash":"","parser_name":"fm-ofx","parser_version":"1.0.0","source_locator":locator,"fields":{"date":path("DTPOSTED"),"amount":path("TRNAMT"),"description":description_tag.and_then(path),"external_id":path("FITID"),"type":path("TRNTYPE")}}})
}
