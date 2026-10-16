use financial_manager_vault_spike::{random_key, vault::open_database};
use rusqlite::{Connection, params_from_iter};
use serde_json::{Map, Value, json};
use std::{fs, path::PathBuf};

const SQL: &str = include_str!(
    "../../../../../packages/storage-schema/sqlite/migrations/0001-financial-core.sql"
);
const CORPUS: &str = include_str!("../../../../../packages/storage-schema/fixtures/us021.json");
type ProbeResult<T> = Result<T, &'static str>;
fn safe<T>(result: rusqlite::Result<T>) -> ProbeResult<T> {
    result.map_err(|_| "NATIVE_SCHEMA_SQL_FAILED")
}
fn parameters(values: &Value) -> ProbeResult<Vec<rusqlite::types::Value>> {
    values
        .as_array()
        .ok_or("CORPUS_INVALID")?
        .iter()
        .map(|value| match value {
            Value::Null => Ok(rusqlite::types::Value::Null),
            Value::String(text) => Ok(rusqlite::types::Value::Text(text.clone())),
            _ => Err("CORPUS_BIND_INVALID"),
        })
        .collect()
}
fn query(db: &Connection, sql: &str, values: &Value) -> ProbeResult<Value> {
    let mut statement = safe(db.prepare(sql))?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|name| name.to_string())
        .collect();
    let mut rows = safe(statement.query(params_from_iter(parameters(values)?)))?;
    let mut result = Vec::new();
    while let Some(row) = safe(rows.next())? {
        let mut record = Map::new();
        for (index, name) in names.iter().enumerate() {
            let value = match safe(row.get_ref(index))? {
                rusqlite::types::ValueRef::Null => Value::Null,
                rusqlite::types::ValueRef::Text(bytes) => Value::String(
                    std::str::from_utf8(bytes)
                        .map_err(|_| "NATIVE_TEXT_INVALID")?
                        .to_string(),
                ),
                _ => return Err("NATIVE_EXPECTED_TEXT_RESULT"),
            };
            record.insert(name.clone(), value);
        }
        result.push(Value::Object(record));
    }
    Ok(Value::Array(result))
}
#[test]
fn sqlcipher_product_schema_shared_corpus() -> ProbeResult<()> {
    let corpus: Value = serde_json::from_str(CORPUS).map_err(|_| "CORPUS_INVALID")?;
    let directory = tempfile::tempdir().map_err(|_| "TEMPORARY_DIRECTORY_FAILED")?;
    let path = directory.path().join("us021-synthetic.sqlite");
    let key = random_key().map_err(|_| "CSPRNG_FAILED")?;
    let db = open_database(&path, &key, true).map_err(|_| "NATIVE_OPEN_FAILED")?;
    safe(db.execute_batch("PRAGMA recursive_triggers=ON; BEGIN IMMEDIATE"))?;
    safe(db.execute_batch(SQL))?;
    assert!(
        db.execute_batch("SELECT 1 FROM deliberately_missing_table")
            .is_err(),
        "MIGRATION_INTERRUPTION_REQUIRED"
    );
    safe(db.execute_batch("ROLLBACK"))?;
    let tables: i64 = safe(db.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE type='table'",
        [],
        |row| row.get(0),
    ))?;
    assert!(tables == 0, "MIGRATION_ROLLBACK_FAILED");
    safe(db.execute_batch("BEGIN IMMEDIATE"))?;
    safe(db.execute_batch(SQL))?;
    safe(
        db.execute(
            "INSERT INTO _schema_migration VALUES(1,?)",
            [corpus["migration_sha256"]
                .as_str()
                .ok_or("CORPUS_HASH_INVALID")?],
        ),
    )?;
    for row in corpus["seed"].as_array().ok_or("CORPUS_INVALID")? {
        let table = row["table"].as_str().ok_or("CORPUS_INVALID")?;
        let values = row["values"].as_object().ok_or("CORPUS_INVALID")?;
        let names: Vec<_> = values.keys().cloned().collect();
        let sql = format!(
            "INSERT INTO {table}({}) VALUES ({})",
            names.join(","),
            vec!["?"; names.len()].join(",")
        );
        let args = Value::Array(names.iter().map(|name| values[name].clone()).collect());
        safe(db.execute(&sql, params_from_iter(parameters(&args)?)))?;
    }
    safe(db.execute_batch("COMMIT"))?;
    let mut cases = Map::new();
    for item in corpus["cases"].as_array().ok_or("CORPUS_INVALID")? {
        safe(db.execute_batch("BEGIN IMMEDIATE"))?;
        let mut rejected = false;
        for action in item["statements"].as_array().ok_or("CORPUS_INVALID")? {
            let sql = action["sql"].as_str().ok_or("CORPUS_INVALID")?;
            if db
                .execute(sql, params_from_iter(parameters(&action["parameters"])?))
                .is_err()
            {
                rejected = true;
                break;
            }
        }
        if !rejected {
            rejected = db.execute_batch("COMMIT").is_err();
        }
        if rejected {
            safe(db.execute_batch("ROLLBACK"))?;
        }
        assert!(
            rejected == item["reject"].as_bool().unwrap_or(false),
            "NATIVE_CORPUS_OUTCOME_FAILED"
        );
        if let Some(check) = item.get("query") {
            let rows = query(
                &db,
                check["sql"].as_str().ok_or("CORPUS_INVALID")?,
                &check["parameters"],
            )?;
            assert!(rows == check["rows"], "NATIVE_CORPUS_QUERY_FAILED");
        }
        cases.insert(
            item["name"].as_str().ok_or("CORPUS_INVALID")?.to_string(),
            json!(true),
        );
    }
    let cipher: String = safe(db.query_row("PRAGMA cipher_version", [], |row| row.get(0)))?;
    let sqlite: String = safe(db.query_row("SELECT sqlite_version()", [], |row| row.get(0)))?;
    let integrity: String = safe(db.query_row("PRAGMA integrity_check", [], |row| row.get(0)))?;
    assert!(integrity == "ok", "INTEGRITY_CHECK_FAILED");
    drop(db);
    let bytes = fs::read(&path).map_err(|_| "CIPHERTEXT_READ_FAILED")?;
    assert!(
        !bytes.starts_with(b"SQLite format 3\0"),
        "CIPHERTEXT_HEADER_FAILED"
    );
    let wrong = random_key().map_err(|_| "CSPRNG_FAILED")?;
    assert!(
        open_database(&path, &wrong, false).is_err(),
        "WRONG_KEY_ACCEPTED"
    );
    let plain = safe(Connection::open(&path))?;
    assert!(
        plain
            .query_row("SELECT count(*) FROM sqlite_schema", [], |row| row
                .get::<_, i64>(0))
            .is_err(),
        "UNKEYED_OPEN_ACCEPTED"
    );
    drop(plain);
    let reopened = open_database(&path, &key, false).map_err(|_| "REOPEN_FAILED")?;
    let check = &corpus["cases"][0]["query"];
    assert!(
        query(
            &reopened,
            check["sql"].as_str().ok_or("CORPUS_INVALID")?,
            &check["parameters"]
        )? == check["rows"],
        "REOPEN_BALANCE_FAILED"
    );
    drop(reopened);
    directory.close().map_err(|_| "NATIVE_CLEANUP_FAILED")?;
    if let Some(report) = std::env::var_os("US021_DESKTOP_REPORT") {
        let value = json!({"format_version":1,"synthetic_only":true,"platform":"windows","passed":true,"cases":cases,"cipher_version":cipher,"sqlite_version":sqlite,
            "checks":{"migration_rollback":true,"ciphertext_header":true,"wrong_key_rejected":true,"unkeyed_open_rejected":true,"reopened_balance":true,"database_integrity":true,"synthetic_artifacts_removed":true}});
        fs::write(
            PathBuf::from(report),
            serde_json::to_string_pretty(&value).map_err(|_| "REPORT_ENCODING_FAILED")?,
        )
        .map_err(|_| "REPORT_WRITE_FAILED")?;
    }
    Ok(())
}
