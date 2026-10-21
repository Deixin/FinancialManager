//! Bounded, non-executing US-051 file gate. No filesystem or financial ports.
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use zeroize::Zeroizing;
pub type Check<T> = std::result::Result<T, &'static str>;
pub const MAX_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_RECORDS: usize = 10000;
pub const MAX_FIELD: usize = 2048;
pub const MAX_RECORD: usize = 8192;
pub const MAX_COLUMNS: usize = 64;
pub const MAX_DEPTH: usize = 32;
pub const MAX_NODES: usize = 500000;
pub const MAX_LINES: usize = 200000;
#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub file_name: String,
    pub mime: String,
    pub encoding: String,
    pub delimiter: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Inspection {
    pub policy_version: &'static str,
    pub format: &'static str,
    pub encoding: String,
    pub byte_length: usize,
    pub records: usize,
    pub columns: Option<usize>,
    pub depth: Option<usize>,
}
pub struct Budget<F: Fn() -> bool> {
    started: Instant,
    valid: F,
}
impl<F: Fn() -> bool> Budget<F> {
    pub fn new(valid: F) -> Self {
        Self {
            started: Instant::now(),
            valid,
        }
    }
    pub fn check(&self) -> Check<()> {
        if !(self.valid)() {
            return Err("CANCELLED");
        }
        if self.started.elapsed() > Duration::from_secs(30) {
            return Err("TIME_LIMIT");
        }
        Ok(())
    }
}
pub fn units(text: &str) -> usize {
    text.encode_utf16().count()
}

pub fn trim(text: &str) -> &str {
    text.trim_matches(crate::category_model::js_space)
}
pub fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && units(name) <= 255
        && trim(name) == name
        && !name.ends_with(['.', ' '])
        && !name
            .chars()
            .any(|c| c.is_control() || crate::file_unicode::is_format(c) || "\\/:".contains(c))
}
fn decode(bytes: &[u8], encoding: &str) -> Check<Zeroizing<String>> {
    if encoding == "utf-8" {
        let text = std::str::from_utf8(bytes).map_err(|_| "INVALID_ENCODING")?;
        return Ok(Zeroizing::new(
            text.strip_prefix('\u{feff}').unwrap_or(text).to_owned(),
        ));
    }
    const CP1252: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž',
        '\u{8f}', '\u{90}', '‘', '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}',
        'ž', 'Ÿ',
    ];
    Ok(Zeroizing::new(
        bytes
            .iter()
            .map(|b| {
                if (0x80..=0x9f).contains(b) {
                    CP1252[(*b - 0x80) as usize]
                } else {
                    char::from(*b)
                }
            })
            .collect(),
    ))
}
pub fn validate<F: Fn() -> bool>(metadata: &Metadata, bytes: &[u8], valid: F) -> Check<Inspection> {
    if !valid_name(&metadata.file_name)
        || units(&metadata.mime) > 128
        || !["utf-8", "windows-1252"].contains(&metadata.encoding.as_str())
        || metadata
            .delimiter
            .as_deref()
            .is_some_and(|s| ![",", ";", "\t"].contains(&s))
    {
        return Err("INVALID_REQUEST");
    }
    if bytes.is_empty() {
        return Err("EMPTY_FILE");
    }
    if bytes.len() > MAX_BYTES {
        return Err("FILE_LIMIT");
    }
    let budget = Budget::new(valid);
    budget.check()?;
    let dot = metadata.file_name.rfind('.').ok_or("UNSUPPORTED_FORMAT")?;
    let extension = metadata.file_name[dot + 1..].to_ascii_lowercase();
    if dot == 0 || !["csv", "ofx"].contains(&extension.as_str()) {
        return Err("UNSUPPORTED_FORMAT");
    }
    let csv = extension == "csv";
    if csv != metadata.delimiter.is_some() {
        return Err("INVALID_REQUEST");
    }
    if !metadata.mime.is_empty() {
        let parts = metadata.mime.split(';').collect::<Vec<_>>();
        let mime = parts[0].to_ascii_lowercase();
        let kind = mime.trim_end_matches(crate::category_model::js_space);
        // Whitespace is permitted only before a charset separator.
        if (parts.len() == 1 && kind != mime)
            || mime.starts_with(crate::category_model::js_space)
            || !(if csv {
                ["text/csv", "text/plain", "application/octet-stream"].as_slice()
            } else {
                [
                    "application/x-ofx",
                    "application/vnd.intu.qfx",
                    "text/plain",
                    "application/octet-stream",
                ]
                .as_slice()
            })
            .contains(&kind)
            || parts.len() > 2
            || (parts.len() == 2
                && parts[1]
                    .trim_start_matches(crate::category_model::js_space)
                    .to_ascii_lowercase()
                    != format!("charset={}", metadata.encoding))
        {
            return Err("TYPE_MISMATCH");
        }
    }
    for prefix in [
        b"PK".as_slice(),
        b"%PDF",
        b"MZ",
        b"\x7fELF",
        b"\xd0\xcf",
        b"\x1f\x8b",
        b"\x89PNG",
        b"\xff\xd8",
    ] {
        if bytes.starts_with(prefix) {
            return Err("TYPE_MISMATCH");
        }
    }
    if bytes.starts_with(b"\xff\xfe")
        || bytes.starts_with(b"\xfe\xff")
        || (metadata.encoding != "utf-8" && bytes.starts_with(b"\xef\xbb\xbf"))
    {
        return Err("ENCODING_MISMATCH");
    }
    let text = decode(bytes, &metadata.encoding)?;
    let mut chars = text.chars().peekable();
    let mut lines = 1;
    let mut n = 0;
    while let Some(c) = chars.next() {
        if n % 4096 == 0 {
            budget.check()?;
        }
        n += 1;
        if (c < ' ' && !['\t', '\r', '\n'].contains(&c))
            || ('\u{7f}'..='\u{9f}').contains(&c)
            || ['\u{fffd}', '\u{fffe}', '\u{ffff}'].contains(&c)
        {
            return Err("INVALID_CONTENT");
        }
        if c == '\n' || (c == '\r' && chars.peek() != Some(&'\n')) {
            lines += 1;
        }
        if lines > MAX_LINES {
            return Err("LINE_LIMIT");
        }
    }
    budget.check()?;
    let (records, columns, depth) = if csv {
        let (records, columns) =
            crate::file_csv::inspect(&text, metadata.delimiter.as_deref().unwrap_or(","), &budget)?;
        (records, Some(columns), None)
    } else {
        let (records, depth) = crate::file_ofx::inspect(&text, &metadata.encoding, &budget)?;
        (records, None, Some(depth))
    };
    budget.check()?;
    Ok(Inspection {
        policy_version: "1",
        format: if csv { "CSV" } else { "OFX" },
        encoding: metadata.encoding.clone(),
        byte_length: bytes.len(),
        records,
        columns,
        depth,
    })
}

#[cfg(test)]
mod file_tests {
    use super::*;
    #[test]
    fn budget_enforces_deadline_and_cancellation() {
        let expired = Budget {
            started: Instant::now() - Duration::from_secs(31),
            valid: || true,
        };
        assert_eq!(expired.check(), Err("TIME_LIMIT"));
        assert_eq!(Budget::new(|| false).check(), Err("CANCELLED"));
    }
}
