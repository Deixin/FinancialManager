use crate::file_model::{
    Budget, Check, MAX_DEPTH, MAX_FIELD, MAX_NODES, MAX_RECORD, MAX_RECORDS, trim, units,
};
use std::collections::BTreeMap;
const AGGREGATES: &[&str] = &[
    "OFX",
    "SIGNONMSGSRSV1",
    "SONRS",
    "STATUS",
    "FI",
    "BANKMSGSRSV1",
    "STMTTRNRS",
    "STMTRS",
    "BANKACCTFROM",
    "BANKTRANLIST",
    "STMTTRN",
    "LEDGERBAL",
    "AVAILBAL",
    "CREDITCARDMSGSRSV1",
    "CCSTMTTRNRS",
    "CCSTMTRS",
    "CCACCTFROM",
];
const SCALARS: &[&str] = &[
    "CODE",
    "SEVERITY",
    "MESSAGE",
    "DTSERVER",
    "LANGUAGE",
    "ORG",
    "FID",
    "TRNUID",
    "CURDEF",
    "BANKID",
    "BRANCHID",
    "ACCTID",
    "ACCTTYPE",
    "ACCTKEY",
    "DTSTART",
    "DTEND",
    "TRNTYPE",
    "DTPOSTED",
    "DTUSER",
    "DTAVAIL",
    "TRNAMT",
    "FITID",
    "NAME",
    "MEMO",
    "CHECKNUM",
    "REFNUM",
    "CORRECTFITID",
    "CORRECTACTION",
    "BALAMT",
    "DTASOF",
];
fn body(text: &str, encoding: &str) -> Check<(usize, bool)> {
    let start = text.find("<OFX>").ok_or("INVALID_OFX")?;
    if units(&text[..start]) > MAX_RECORD {
        return Err("INVALID_OFX");
    }
    let prefix = trim(&text[..start]);
    if prefix.starts_with("OFXHEADER:") {
        let lines = prefix.split('\n').collect::<Vec<_>>();
        if lines.len() > 16 {
            return Err("UNSUPPORTED_LAYOUT");
        }
        let mut header = BTreeMap::new();
        for line in lines {
            let line = line.strip_suffix('\r').unwrap_or(line);
            let (key, value) = line.split_once(':').ok_or("INVALID_OFX")?;
            if key.is_empty()
                || key.len() > 16
                || !key.bytes().all(|b| b.is_ascii_uppercase())
                || value.is_empty()
                || value.len() > 40
                || !value
                    .bytes()
                    .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b".-".contains(&b))
                || header.insert(key, value).is_some()
            {
                return Err("INVALID_OFX");
            }
        }
        if header.len() != 9
            || [
                ("OFXHEADER", "100"),
                ("DATA", "OFXSGML"),
                ("VERSION", "102"),
                ("SECURITY", "NONE"),
                ("COMPRESSION", "NONE"),
                ("OLDFILEUID", "NONE"),
                ("NEWFILEUID", "NONE"),
            ]
            .iter()
            .any(|(k, v)| header.get(k) != Some(v))
        {
            return Err("UNSUPPORTED_LAYOUT");
        }
        if !(encoding == "utf-8"
            && header.get("ENCODING") == Some(&"UNICODE")
            && header.get("CHARSET") == Some(&"UTF-8"))
            && !(encoding == "windows-1252"
                && header.get("ENCODING") == Some(&"USASCII")
                && header.get("CHARSET") == Some(&"1252"))
        {
            return Err("ENCODING_MISMATCH");
        }
        return Ok((start, true));
    }
    if encoding != "utf-8" {
        return Err("ENCODING_MISMATCH");
    }
    let (xml, rest) = prefix.split_once("?>").ok_or("UNSUPPORTED_LAYOUT")?;
    let xml = xml.strip_prefix("<?xml").ok_or("UNSUPPORTED_LAYOUT")?;
    let rest = trim(rest)
        .strip_prefix("<?OFX")
        .and_then(|s| s.strip_suffix("?>"))
        .ok_or("UNSUPPORTED_LAYOUT")?;
    if !xml.starts_with(crate::category_model::js_space)
        || !rest.starts_with(crate::category_model::js_space)
    {
        return Err("UNSUPPORTED_LAYOUT");
    }
    let tokens = |s: &str| {
        s.split(crate::category_model::js_space)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    let x = tokens(xml);
    let ofx = tokens(rest);
    if x != ["version=\"1.0\"", "encoding=\"UTF-8\""]
        || ofx.len() != 5
        || ofx[0] != "OFXHEADER=\"200\""
        || !["VERSION=\"203\"", "VERSION=\"220\"", "VERSION=\"230\""].contains(&ofx[1].as_str())
        || ofx[2..]
            != [
                "SECURITY=\"NONE\"",
                "OLDFILEUID=\"NONE\"",
                "NEWFILEUID=\"NONE\"",
            ]
    {
        return Err("UNSUPPORTED_LAYOUT");
    }
    Ok((start, false))
}
fn entities(text: &str) -> Check<()> {
    let mut offset = 0;
    while let Some(begin) = text[offset..].find('&') {
        let begin = offset + begin;
        let end = text[begin + 1..]
            .find(';')
            .map(|n| begin + 1 + n)
            .ok_or("ACTIVE_CONTENT")?;
        if units(&text[begin..end]) > 12 {
            return Err("ACTIVE_CONTENT");
        }
        let name = &text[begin + 1..end];
        if !["amp", "lt", "gt", "apos", "quot"].contains(&name) {
            let n = if let Some(digits) = name.strip_prefix("#x") {
                if digits.is_empty()
                    || digits.len() > 6
                    || !digits.bytes().all(|b| b.is_ascii_hexdigit())
                {
                    return Err("ACTIVE_CONTENT");
                }
                u32::from_str_radix(digits, 16).map_err(|_| "ACTIVE_CONTENT")?
            } else if let Some(digits) = name.strip_prefix('#') {
                if digits.is_empty()
                    || digits.len() > 7
                    || !digits.bytes().all(|b| b.is_ascii_digit())
                {
                    return Err("ACTIVE_CONTENT");
                }
                digits.parse::<u32>().map_err(|_| "ACTIVE_CONTENT")?
            } else {
                return Err("ACTIVE_CONTENT");
            };
            if !([9, 10, 13].contains(&n)
                || (32..=0xd7ff).contains(&n)
                || (0xe000..=0xfffd).contains(&n)
                || (0x10000..=0x10ffff).contains(&n))
            {
                return Err("INVALID_OFX");
            }
        }
        offset = end + 1;
    }
    Ok(())
}
pub fn inspect<F: Fn() -> bool>(
    text: &str,
    encoding: &str,
    budget: &Budget<F>,
) -> Check<(usize, usize)> {
    if text.contains("<!") {
        return Err("ACTIVE_CONTENT");
    }
    let (mut offset, sgml) = body(text, encoding)?;
    let mut stack: Vec<(&str, usize)> = vec![];
    let (mut nodes, mut depth, mut roots, mut records, mut position) = (0, 0, 0, 0, 0usize);
    let mut record_start = None;
    while offset < text.len() {
        budget.check()?;
        if record_start.is_some_and(|start| position - start > MAX_RECORD) {
            return Err("RECORD_LIMIT");
        }
        if text.as_bytes()[offset] != b'<' {
            let end = text[offset..]
                .find('<')
                .map(|n| offset + n)
                .unwrap_or(text.len());
            let content = &text[offset..end];
            let length = units(content);
            if stack
                .last()
                .is_none_or(|(name, _)| AGGREGATES.contains(name))
            {
                if !trim(content).is_empty() {
                    return Err("INVALID_OFX");
                }
            } else {
                let current = stack.last_mut().ok_or("INVALID_OFX")?;
                current.1 += length;
                if current.1 > MAX_FIELD {
                    return Err("FIELD_LIMIT");
                }
                if content.contains("]]>") {
                    return Err("INVALID_OFX");
                }
                entities(content)?;
            }
            position += length;
            offset = end;
            continue;
        }
        let end = text[offset + 1..]
            .find('>')
            .map(|n| offset + 1 + n)
            .ok_or("INVALID_OFX")?;
        if units(&text[offset..end]) > 64 {
            return Err("INVALID_OFX");
        }
        let tag = &text[offset + 1..end];
        let closing = tag.starts_with('/');
        let name = tag.strip_prefix('/').unwrap_or(tag);
        if name.is_empty()
            || name.len() > 32
            || !name.as_bytes()[0].is_ascii_uppercase()
            || !name
                .bytes()
                .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
        {
            return Err("ACTIVE_CONTENT");
        }
        if sgml
            && stack
                .last()
                .is_some_and(|(n, _)| SCALARS.contains(n) && !(closing && name == *n))
        {
            stack.pop();
        }
        if closing {
            if stack.last().is_none_or(|(n, _)| *n != name) {
                return Err("INVALID_OFX");
            }
            stack.pop();
            if name == "STMTTRN" {
                if record_start.is_none_or(|start| position + end + 1 - offset - start > MAX_RECORD)
                {
                    return Err("RECORD_LIMIT");
                }
                record_start = None;
            }
        } else {
            nodes += 1;
            if nodes > MAX_NODES {
                return Err("NODE_LIMIT");
            }
            if stack.is_empty() {
                roots += 1;
                if name != "OFX" || roots != 1 {
                    return Err("INVALID_OFX");
                }
            }
            if sgml && !AGGREGATES.contains(&name) && !SCALARS.contains(&name) {
                return Err("UNSUPPORTED_LAYOUT");
            }
            if stack.len() >= MAX_DEPTH {
                return Err("DEPTH_LIMIT");
            }
            if name == "STMTTRN" {
                if record_start.is_some() {
                    return Err("INVALID_OFX");
                }
                records += 1;
                if records > MAX_RECORDS {
                    return Err("ROW_LIMIT");
                }
                record_start = Some(position);
            }
            stack.push((name, 0));
            depth = depth.max(stack.len());
        }
        position += end + 1 - offset;
        offset = end + 1;
    }
    if !stack.is_empty() || roots != 1 {
        return Err("INVALID_OFX");
    }
    Ok((records, depth))
}
