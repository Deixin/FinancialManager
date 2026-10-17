//! Synthetic-only instrumentation. Absent from the default production binary.
use crate::{
    LocalError, Result, SecretKey, identity,
    keys::{KeyStore, random_key},
    local_workspaces::{Installation, open_database},
    migrations,
};
use rusqlite::{
    Connection, params, params_from_iter,
    trace::{TraceEvent, TraceEventCodes},
    types::{Value, ValueRef},
};
use serde_json::{Value as Json, json};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicU8, Ordering},
    },
};
use uuid::Uuid;

const V1: &str =
    include_str!("../../../../packages/storage-schema/sqlite/migrations/0001-financial-core.sql");
const DATA: &str = include_str!("../../../../packages/test-fixtures/fixtures/fin-002.json");
const TABLES: [&str; 12] = [
    "workspace",
    "financial_account",
    "balance_reference",
    "category",
    "subcategory",
    "tag",
    "counterparty",
    "transaction_group",
    "financial_transaction",
    "transaction_allocation",
    "transaction_tag",
    "transaction_revision",
];
pub const CANARY: &str = "SYNTHETIC_PRIVATE_VAULT_CANARY";
static CRASH: AtomicU8 = AtomicU8::new(0);

pub fn dataset_workspace() -> Uuid {
    Uuid::parse_str("0199d025-0000-7000-8000-000000000001").expect("FIXTURE_ID")
}
pub fn vault_path(root: &Path) -> PathBuf {
    root.join("workspaces")
        .join(dataset_workspace().to_string())
        .join("vault.db")
}
fn source() -> Result<Json> {
    serde_json::from_str(DATA).map_err(|_| LocalError::IntegrityFailure)
}
pub fn fixture(root: &Path, keys: Arc<dyn KeyStore>) -> Result<Installation> {
    let installation = Installation::open(root, keys.clone())?;
    if !installation.list()?.is_empty() {
        return Err(LocalError::IntegrityFailure);
    }
    let (installation_id, _) = installation.probe_details();
    let key = random_key()?;
    let path = vault_path(root);
    // Record ownership before touching the OS store, including on prepare failure.
    fs::create_dir(path.parent().ok_or(LocalError::IntegrityFailure)?)?;
    keys.put_new(installation_id, dataset_workspace(), &key)?;
    File::create_new(&path)?;
    let mut db = open_database(&path, &key)?;
    let tx = db.transaction()?;
    tx.execute_batch(V1)?;
    tx.execute(
        "INSERT INTO _schema_migration(version,checksum) VALUES(1,?)",
        [format!("{:x}", Sha256::digest(V1.as_bytes()))],
    )?;
    for seed in source()?["seed"]
        .as_array()
        .ok_or(LocalError::IntegrityFailure)?
    {
        let table = seed["table"].as_str().ok_or(LocalError::IntegrityFailure)?;
        if !TABLES.contains(&table) {
            return Err(LocalError::IntegrityFailure);
        }
        let mut values = seed["values"]
            .as_object()
            .ok_or(LocalError::IntegrityFailure)?
            .clone();
        let workspace = if table == "workspace" {
            &values["id"]
        } else {
            &values["workspace_id"]
        };
        if workspace.as_str() != Some(&dataset_workspace().to_string()) {
            continue;
        }
        if table == "workspace" {
            values.insert("storage_mode".into(), Json::String("LOCAL".into()));
        }
        if ["category", "tag"].contains(&table) {
            let name = values["name"]
                .as_str()
                .ok_or(LocalError::IntegrityFailure)?;
            if !name.is_ascii() {
                return Err(LocalError::IntegrityFailure);
            }
            let normalized = name
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .to_lowercase();
            values.insert("normalized_name".into(), Json::String(normalized));
        }
        let columns: Vec<_> = values.keys().cloned().collect();
        if columns
            .iter()
            .any(|name| !name.chars().all(|ch| ch.is_ascii_lowercase() || ch == '_'))
        {
            return Err(LocalError::IntegrityFailure);
        }
        let bound = columns
            .iter()
            .map(|name| match &values[name] {
                Json::Null => Ok(Value::Null),
                Json::String(value) => Ok(Value::Text(value.clone())),
                _ => Err(LocalError::IntegrityFailure),
            })
            .collect::<Result<Vec<_>>>()?;
        // Generated fixture identifiers only. Never accepts SQL/columns from IPC.
        tx.execute(
            &format!(
                "INSERT INTO {table}({}) VALUES({})",
                columns.join(","),
                vec!["?"; columns.len()].join(",")
            ),
            params_from_iter(bound),
        )?;
    }
    tx.commit()?;
    migrations::verify_integrity(&db)?;
    Ok(installation)
}
pub fn open_fixture(root: &Path, keys: &dyn KeyStore) -> Result<Connection> {
    let installation = identity::resource_id(&fs::read_to_string(root.join(".installation-id"))?)
        .map_err(|_| LocalError::IntegrityFailure)?;
    open_database(
        &vault_path(root),
        &keys.get(installation, dataset_workspace())?,
    )
}
pub fn snapshot(db: &Connection) -> Result<String> {
    let mut tables = serde_json::Map::new();
    for table in TABLES {
        let order = if table == "transaction_tag" {
            "transaction_id,tag_id"
        } else {
            "id"
        };
        let mut query = db.prepare(&format!("SELECT * FROM {table} ORDER BY {order}"))?;
        let columns = query
            .column_names()
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<_>>();
        let rows = query
            .query_map([], |row| {
                let mut value = serde_json::Map::new();
                for (index, name) in columns.iter().enumerate() {
                    let field = match row.get_ref(index)? {
                        ValueRef::Null => Json::Null,
                        ValueRef::Integer(number) => Json::String(number.to_string()),
                        ValueRef::Text(text) => {
                            Json::String(String::from_utf8_lossy(text).into_owned())
                        }
                        _ => return Err(rusqlite::Error::InvalidQuery),
                    };
                    value.insert(name.clone(), field);
                }
                Ok(Json::Object(value))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        tables.insert(table.into(), Json::Array(rows));
    }
    let bytes = serde_json::to_vec(&tables).map_err(|_| LocalError::IntegrityFailure)?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
pub fn version(db: &Connection) -> Result<i64> {
    Ok(
        db.query_row("SELECT max(version) FROM _schema_migration", [], |row| {
            row.get(0)
        })?,
    )
}
pub fn migrate(db: &mut Connection) -> Result<()> {
    migrations::migrate(db)
}
pub fn integrity(db: &Connection) -> Result<()> {
    migrations::verify_integrity(db)
}
fn trace(event: TraceEvent<'_>) {
    let phase = CRASH.load(Ordering::SeqCst);
    let stop = match event {
        TraceEvent::Profile(statement, _) => {
            let source = statement.sql();
            let sql = source.trim_start();
            (phase == 1 && sql.starts_with("CREATE INDEX balance_reference_lookup"))
                || (phase == 2
                    && sql.starts_with("INSERT INTO _schema_migration(version,checksum)"))
        }
        TraceEvent::Stmt(_, sql) => phase == 3 && sql.trim() == "COMMIT",
        _ => false,
    };
    if stop {
        std::process::exit(73);
    }
}
pub fn migration_child(db: &mut Connection, phase: u8) -> Result<()> {
    if !(1..=3).contains(&phase) || version(db)? != 1 {
        return Err(LocalError::IntegrityFailure);
    }
    CRASH.store(phase, Ordering::SeqCst);
    db.trace_v2(
        TraceEventCodes::SQLITE_TRACE_PROFILE | TraceEventCodes::SQLITE_TRACE_STMT,
        Some(trace),
    );
    migrations::migrate(db)?;
    Err(LocalError::IntegrityFailure)
}
pub fn journal_child(db: &Connection, path: &Path) -> Result<()> {
    if version(db)? != 2 {
        return Err(LocalError::IntegrityFailure);
    }
    db.execute_batch("PRAGMA cache_size=1;PRAGMA cache_spill=ON;BEGIN IMMEDIATE;")?;
    db.execute(
        "UPDATE financial_transaction SET display_name=? WHERE id=?",
        params![CANARY.repeat(2000), "0199d025-0000-7000-8000-000000000066"],
    )?;
    let journal = fs::read(path.with_extension("db-journal"))?;
    if journal.len() < 512 || journal[..8] != [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7] {
        return Err(LocalError::IntegrityFailure);
    }
    if journal
        .windows(CANARY.len())
        .any(|part| part == CANARY.as_bytes())
    {
        return Err(LocalError::IntegrityFailure);
    }
    std::process::exit(73);
}
pub fn runtime(db: &Connection) -> Result<Json> {
    let mut flags = serde_json::Map::new();
    for (name, expected) in [
        ("foreign_keys", 1),
        ("recursive_triggers", 1),
        ("trusted_schema", 0),
        ("temp_store", 2),
        ("synchronous", 2),
        ("secure_delete", 1),
        ("cipher_memory_security", 1),
    ] {
        let raw: Value = db.pragma_query_value(None, name, |row| row.get(0))?;
        // SQLCipher exposes its own pragma as TEXT; SQLite pragmas use INTEGER.
        let value = match raw {
            Value::Integer(value) => value,
            Value::Text(value) => value
                .parse::<i64>()
                .map_err(|_| LocalError::IntegrityFailure)?,
            _ => return Err(LocalError::IntegrityFailure),
        };
        flags.insert(name.into(), Json::Bool(value == expected));
    }
    let journal: String = db.pragma_query_value(None, "journal_mode", |row| row.get(0))?;
    flags.insert("journal_delete".into(), Json::Bool(journal == "delete"));
    let cipher: String = db.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    let sqlite: String = db.query_row("SELECT sqlite_version()", [], |row| row.get(0))?;
    if !flags.values().all(|value| value.as_bool() == Some(true)) {
        return Err(LocalError::IntegrityFailure);
    }
    Ok(json!({"passed":true,"cipher":cipher,"sqlite":sqlite,"flags":flags}))
}
pub fn cleanup_keys(root: &Path, keys: &dyn KeyStore) -> Result<()> {
    let file = root.join(".installation-id");
    if !file.exists() {
        return Ok(());
    }
    let installation = identity::resource_id(&fs::read_to_string(file)?)
        .map_err(|_| LocalError::IntegrityFailure)?;
    for folder in ["workspaces", "staging"] {
        let path = root.join(folder);
        if !path.exists() {
            continue;
        }
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let id = identity::resource_id(&entry.file_name().to_string_lossy())
                .map_err(|_| LocalError::IntegrityFailure)?;
            keys.delete(installation, id)?;
            if keys.get(installation, id).err() != Some(LocalError::KeyMissing) {
                return Err(LocalError::IntegrityFailure);
            }
        }
    }
    Ok(())
}
pub fn has_plaintext(root: &Path, secret: &SecretKey) -> Result<bool> {
    let encoded = secret
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            if has_plaintext(&path, secret)? {
                return Ok(true);
            }
        } else {
            if fs::metadata(&path)?.len() == 0 {
                continue;
            }
            let bytes = fs::read(path)?;
            if bytes.windows(32).any(|part| part == secret.as_ref())
                || bytes.windows(64).any(|part| part == encoded.as_bytes())
                || bytes
                    .windows(b"SYNTHETIC FIN-002 MOVEMENT".len())
                    .any(|part| part == b"SYNTHETIC FIN-002 MOVEMENT")
                || bytes
                    .windows(b"SYNTHETIC ENERGY".len())
                    .any(|part| part == b"SYNTHETIC ENERGY")
                || bytes
                    .windows(CANARY.len())
                    .any(|part| part == CANARY.as_bytes())
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
