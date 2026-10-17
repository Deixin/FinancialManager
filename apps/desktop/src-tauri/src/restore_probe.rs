//! Synthetic crash instrumentation, excluded from the default binary.
use std::sync::atomic::{AtomicU8, Ordering};
static CRASH: AtomicU8 = AtomicU8::new(0);
pub fn crash_at(phase: u8) {
    CRASH.store(phase, Ordering::SeqCst);
}
pub fn checkpoint(phase: &str) {
    let code = match phase {
        "staged" => 1,
        "before_publish" => 2,
        "after_publish" => 3,
        _ => 0,
    };
    if code != 0 && CRASH.load(Ordering::SeqCst) == code {
        std::process::exit(73);
    }
}

// Independent oracle: row ordinal identifies fixture records; explicit column
// names describe references. It does not read the production ID map or FK mapper.
pub fn semantic_snapshot(db: &rusqlite::Connection) -> crate::Result<String> {
    use crate::{LocalError, local_restore::TABLES};
    use rusqlite::types::ValueRef;
    use serde_json::{Value, json};
    use sha2::{Digest, Sha256};
    use std::collections::HashMap;
    struct Oracle(HashMap<(String, String), String>);
    impl Oracle {
        fn id(&mut self, table: &str, old: &str) -> String {
            let key = (table.into(), old.into());
            if let Some(v) = self.0.get(&key) {
                return v.clone();
            }
            let index = self.0.keys().filter(|(t, _)| t == table).count();
            let token = format!("{table}#{index}");
            self.0.insert(key, token.clone());
            token
        }
    }
    let mut oracle = Oracle(HashMap::new());
    for table in TABLES.iter().filter(|t| **t != "transaction_tag") {
        let mut q = db.prepare(&format!("SELECT id FROM {table} ORDER BY rowid"))?;
        for old in q.query_map([], |r| r.get::<_, String>(0))? {
            oracle.id(table, &old?);
        }
    }
    fn column(name: &str) -> Option<&'static str> {
        match name {
            "workspace_id" => Some("workspace"),
            "account_id" => Some("financial_account"),
            "category_id" => Some("category"),
            "subcategory_id" => Some("subcategory"),
            "tag_id" => Some("tag"),
            "transaction_id" => Some("financial_transaction"),
            "group_id" => Some("transaction_group"),
            "counterparty_id" => Some("counterparty"),
            _ => None,
        }
    }
    fn history(value: &mut Value, oracle: &mut Oracle) {
        for field in ["before", "after"] {
            let Some(state) = value.get_mut(field).and_then(|s| s.as_object_mut()) else {
                continue;
            };
            for (key, table) in [
                ("id", "financial_transaction"),
                ("workspace_id", "workspace"),
            ] {
                if let Some(v) = state.get_mut(key)
                    && let Some(id) = v.as_str()
                {
                    *v = json!(oracle.id(table, id));
                }
            }
            let Some(content) = state.get_mut("content").and_then(|c| c.as_object_mut()) else {
                continue;
            };
            for key in ["account_id", "group_id", "counterparty_id"] {
                if let Some(v) = content.get_mut(key)
                    && let Some(id) = v.as_str()
                {
                    *v = json!(oracle.id(column(key).unwrap(), id));
                }
            }
            if let Some(rows) = content
                .get_mut("allocations")
                .and_then(|v| v.as_array_mut())
            {
                for row in rows {
                    for (key, table) in [
                        ("id", "transaction_allocation"),
                        ("category_id", "category"),
                        ("subcategory_id", "subcategory"),
                    ] {
                        if let Some(v) = row.get_mut(key)
                            && let Some(id) = v.as_str()
                        {
                            *v = json!(oracle.id(table, id));
                        }
                    }
                }
            }
            if let Some(tags) = content.get_mut("tag_ids").and_then(|v| v.as_array_mut()) {
                for tag in tags {
                    if let Some(id) = tag.as_str() {
                        *tag = json!(oracle.id("tag", id));
                    }
                }
            }
        }
    }
    let mut result = serde_json::Map::new();
    for table in TABLES {
        let mut q = db.prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))?;
        let columns = q
            .column_names()
            .iter()
            .map(|v| v.to_string())
            .collect::<Vec<_>>();
        let mut rows = q.query([])?;
        let mut output = Vec::new();
        while let Some(row) = rows.next()? {
            let mut record = serde_json::Map::new();
            for (index, name) in columns.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(v) => json!(v.to_string()),
                    ValueRef::Text(v) => {
                        let text =
                            std::str::from_utf8(v).map_err(|_| LocalError::IntegrityFailure)?;
                        if table == "workspace"
                            && ["display_name", "created_at", "sync_generation"]
                                .contains(&name.as_str())
                        {
                            json!("NEW_WORKSPACE_METADATA")
                        } else if name == "id" {
                            json!(oracle.id(table, text))
                        } else if let Some(parent) = column(name) {
                            json!(oracle.id(parent, text))
                        } else if table == "transaction_revision" && name == "snapshot" {
                            let mut value: Value = serde_json::from_str(text)
                                .map_err(|_| LocalError::IntegrityFailure)?;
                            history(&mut value, &mut oracle);
                            value
                        } else {
                            json!(text)
                        }
                    }
                    _ => return Err(LocalError::IntegrityFailure),
                };
                record.insert(name.clone(), value);
            }
            output.push(Value::Object(record));
        }
        result.insert(table.into(), json!(output));
    }
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&result).map_err(|_| LocalError::IntegrityFailure)?)
    ))
}
