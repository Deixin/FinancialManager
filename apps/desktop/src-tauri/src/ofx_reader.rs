use crate::{
    file_model::{Budget, Check, trim, units},
    ofx_model::{Destination, Fields, bad_text, date, get},
    ofx_schema::children,
};
use serde_json::Value;
use std::collections::BTreeSet;
use zeroize::Zeroizing;
pub struct Statement {
    pub liability: bool,
    pub currency: String,
    pub account: Fields,
    pub from: String,
    pub to: String,
    pub sgml: bool,
    period: Fields,
}
struct Frame {
    name: String,
    text: Zeroizing<String>,
    seen: BTreeSet<String>,
    values: Fields,
}
fn entities(text: &str) -> Check<String> {
    let mut out = String::new();
    let mut offset = 0;
    while let Some(start) = text[offset..].find('&') {
        let start = offset + start;
        out.push_str(&text[offset..start]);
        let end = text[start..].find(';').ok_or("ACTIVE_CONTENT")? + start;
        let name = &text[start + 1..end];
        let value = match name {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "apos" => '\'',
            "quot" => '"',
            _ => {
                let n = if let Some(hex) = name.strip_prefix("#x") {
                    u32::from_str_radix(hex, 16)
                } else {
                    name.strip_prefix('#')
                        .ok_or("ACTIVE_CONTENT")?
                        .parse::<u32>()
                }
                .map_err(|_| "INVALID_OFX")?;
                char::from_u32(n).ok_or("INVALID_OFX")?
            }
        };
        out.push(value);
        offset = end + 1;
    }
    out.push_str(&text[offset..]);
    Ok(out)
}
fn close(
    stack: &mut Vec<Frame>,
    statement: &mut Statement,
    rows: &mut Vec<Value>,
    destination: &Destination,
) -> Check<()> {
    let mut node = stack.pop().ok_or("INVALID_OFX_STRUCTURE")?;
    if children(&node.name).is_none() {
        let decoded = Zeroizing::new(entities(&node.text)?);
        stack
            .last_mut()
            .ok_or("INVALID_OFX_STRUCTURE")?
            .values
            .insert(node.name.clone(), Zeroizing::new(trim(&decoded).to_owned()));
    }
    if node.name == "STATUS"
        && (get(&node.values, "CODE") != "0"
            || !["INFO", "WARN"].contains(&get(&node.values, "SEVERITY")))
    {
        return Err("OFX_SOURCE_ERROR");
    }
    if ["STMTTRNRS", "CCSTMTTRNRS", "SONRS"].contains(&node.name.as_str())
        && !node.seen.contains("STATUS")
    {
        return Err("OFX_SOURCE_ERROR");
    }
    match node.name.as_str() {
        "STMTRS" | "CCSTMTRS" => statement.currency = get(&node.values, "CURDEF").to_owned(),
        "BANKACCTFROM" | "CCACCTFROM" => statement.account = std::mem::take(&mut node.values),
        "BANKTRANLIST" => {
            statement.period = std::mem::take(&mut node.values);
        }
        "STMTTRN" => {
            let locator = format!(
                "/{}/STMTTRN[{}]",
                stack
                    .iter()
                    .map(|n| n.name.as_str())
                    .collect::<Vec<_>>()
                    .join("/"),
                rows.len() + 1
            );
            rows.push(crate::ofx_normalization::row(
                &node.values,
                destination,
                rows.len() + 1,
                &locator,
            ));
        }
        _ => {}
    }
    Ok(())
}
pub fn read<F: Fn() -> bool>(
    text: &str,
    encoding: &str,
    destination: &Destination,
    budget: &Budget<F>,
) -> Check<(Statement, Vec<Value>)> {
    let (mut offset, sgml) = crate::file_ofx::body(text, encoding)?;
    let mut statement = Statement {
        liability: false,
        currency: String::new(),
        account: Fields::new(),
        from: String::new(),
        to: String::new(),
        sgml,
        period: Fields::new(),
    };
    let mut stack: Vec<Frame> = Vec::new();
    let mut rows = Vec::new();
    let (mut statements, mut accounts, mut lists) = (0, 0, 0);
    while offset < text.len() {
        budget.check()?;
        if text.as_bytes()[offset] != b'<' {
            let end = text[offset..]
                .find('<')
                .map(|i| offset + i)
                .unwrap_or(text.len());
            let part = &text[offset..end];
            if let Some(current) = stack.last_mut().filter(|n| children(&n.name).is_none()) {
                current.text.push_str(part);
            } else if !trim(part).is_empty() {
                return Err("INVALID_OFX_STRUCTURE");
            }
            offset = end;
            continue;
        }
        let end = text[offset..].find('>').ok_or("INVALID_OFX_STRUCTURE")? + offset;
        let tag = &text[offset + 1..end];
        let closing = tag.starts_with('/');
        let name = tag.strip_prefix('/').unwrap_or(tag);
        if sgml
            && stack
                .last()
                .is_some_and(|n| children(&n.name).is_none() && !(closing && n.name == name))
        {
            close(&mut stack, &mut statement, &mut rows, destination)?;
        }
        if closing {
            if stack.last().is_none_or(|n| n.name != name) {
                return Err("INVALID_OFX_STRUCTURE");
            }
            close(&mut stack, &mut statement, &mut rows, destination)?;
        } else {
            if let Some(parent) = stack.last_mut() {
                if children(&parent.name).is_none_or(|allowed| !allowed.contains(&name))
                    || (parent.seen.contains(name)
                        && !(parent.name == "BANKTRANLIST" && name == "STMTTRN"))
                {
                    return Err("INVALID_OFX_STRUCTURE");
                }
                parent.seen.insert(name.to_owned());
            } else if name != "OFX" {
                return Err("INVALID_OFX_STRUCTURE");
            }
            if ["STMTRS", "CCSTMTRS"].contains(&name) {
                statements += 1;
                if statements != 1 {
                    return Err("INVALID_OFX_STRUCTURE");
                }
                statement.liability = name == "CCSTMTRS";
            }
            if ["BANKACCTFROM", "CCACCTFROM"].contains(&name) {
                accounts += 1;
                if accounts != 1 {
                    return Err("INVALID_OFX_STRUCTURE");
                }
            }
            if name == "BANKTRANLIST" {
                lists += 1;
                if lists != 1 {
                    return Err("INVALID_OFX_STRUCTURE");
                }
            }
            stack.push(Frame {
                name: name.to_owned(),
                text: Zeroizing::new(String::new()),
                seen: BTreeSet::new(),
                values: Fields::new(),
            });
        }
        offset = end + 1;
    }
    if !stack.is_empty() || statements != 1 || accounts != 1 || lists != 1 {
        return Err("INVALID_OFX_STRUCTURE");
    }
    let account_id = get(&statement.account, "ACCTID");
    if account_id.is_empty()
        || units(account_id) > 256
        || bad_text(account_id)
        || (!statement.liability
            && (get(&statement.account, "BANKID").is_empty()
                || !["CHECKING", "SAVINGS", "MONEYMRKT"]
                    .contains(&get(&statement.account, "ACCTTYPE"))))
    {
        return Err("INVALID_SOURCE_ACCOUNT");
    }
    statement.from = date(get(&statement.period, "DTSTART")).ok_or("INVALID_PERIOD")?;
    statement.to = date(get(&statement.period, "DTEND")).ok_or("INVALID_PERIOD")?;
    if statement.from > statement.to {
        return Err("INVALID_PERIOD");
    }
    if rows.is_empty() {
        return Err("EMPTY_STATEMENT");
    }
    Ok((statement, rows))
}
