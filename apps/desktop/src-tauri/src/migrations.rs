use crate::{LocalError, Result};
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};

pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up: &'static str,
    pub down: Option<&'static str>,
    pub checksum: &'static str,
}
include!("migration_catalog.rs");

pub(crate) fn current_version() -> i64 {
    CATALOG[CATALOG.len() - 1].version
}
pub(crate) fn verify_current(db: &Connection) -> Result<()> {
    if schema(db)? != expected(CATALOG.len())? {
        return Err(LocalError::UnsupportedSchema);
    }
    let mut query =
        db.prepare("SELECT version,checksum FROM _schema_migration ORDER BY version")?;
    let history = query
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    if history.len() != CATALOG.len()
        || history
            .iter()
            .zip(CATALOG.iter())
            .any(|(row, item)| row.0 != item.version || row.1 != item.checksum)
    {
        return Err(LocalError::UnsupportedSchema);
    }
    verify_integrity(db)
}

fn schema(db: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut query = db.prepare(
        "SELECT name,type,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    Ok(query
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}
fn expected(version: usize) -> Result<Vec<(String, String, String)>> {
    let reference = Connection::open_in_memory()?;
    for migration in &CATALOG[..version] {
        reference.execute_batch(migration.up)?;
    }
    schema(&reference)
}
pub fn verify_integrity(db: &Connection) -> Result<()> {
    if db.query_row("PRAGMA quick_check", [], |row| row.get::<_, String>(0))? != "ok" {
        return Err(LocalError::IntegrityFailure);
    }
    for query in ["PRAGMA foreign_key_check", "PRAGMA cipher_integrity_check"] {
        if db.prepare(query)?.query([])?.next()?.is_some() {
            return Err(LocalError::IntegrityFailure);
        }
    }
    Ok(())
}
pub fn migrate(db: &mut Connection) -> Result<()> {
    for item in &CATALOG {
        let content = if item.version == 1 {
            item.up.to_owned()
        } else {
            serde_json::to_string(&(item.version, item.name, item.up, item.down, false))
                .map_err(|_| LocalError::UnsupportedSchema)?
        };
        if format!("{:x}", Sha256::digest(content.as_bytes())) != item.checksum {
            return Err(LocalError::UnsupportedSchema);
        }
    }
    let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let objects = schema(&tx)?;
    let mut version = 0;
    if !objects.is_empty() {
        // Validate the table definition before reading potentially untrusted history.
        let definition = objects
            .iter()
            .find(|row| row.0 == "_schema_migration")
            .ok_or(LocalError::UnsupportedSchema)?;
        if !(1..=CATALOG.len()).any(|n| {
            expected(n)
                .ok()
                .is_some_and(|rows| rows.contains(definition))
        }) {
            return Err(LocalError::UnsupportedSchema);
        }
        let mut query =
            tx.prepare("SELECT version,checksum FROM _schema_migration ORDER BY version")?;
        let history = query
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        if history.is_empty() || history.len() > CATALOG.len() {
            return Err(LocalError::UnsupportedSchema);
        }
        for (i, row) in history.iter().enumerate() {
            if row.0 != CATALOG[i].version || row.1 != CATALOG[i].checksum {
                return Err(LocalError::UnsupportedSchema);
            }
        }
        version = history.len();
        if objects != expected(version)? {
            return Err(LocalError::UnsupportedSchema);
        }
    }
    verify_integrity(&tx)?;
    for item in &CATALOG[version..] {
        tx.execute_batch(item.up)?;
        tx.execute(
            "INSERT INTO _schema_migration(version,checksum) VALUES(?,?)",
            params![item.version, item.checksum],
        )?;
    }
    if schema(&tx)? != expected(CATALOG.len())? {
        return Err(LocalError::UnsupportedSchema);
    }
    verify_integrity(&tx)?;
    tx.commit()?;
    Ok(())
}
