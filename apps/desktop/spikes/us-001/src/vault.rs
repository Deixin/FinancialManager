use crate::secrets::KeyStore;
use crate::{Result, SecretKey, VaultError, key_literal, random_key};
use rusqlite::{Connection, OpenFlags, params};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use uuid::Uuid;

const MIGRATION: &str = include_str!("../migrations/0001-synthetic.sql");

#[derive(Serialize)]
pub struct Preview {
    pub workspace_id: Uuid,
    pub accounts: usize,
    pub movements: usize,
    pub items: usize,
    pub rules: usize,
    pub history: usize,
}

// Monetary strings are canonical decimal i64 representations, including over 2^53.
// Deliberately no Debug: test failures must not print financial payloads.
#[derive(PartialEq, Eq, Serialize)]
pub struct SyntheticData {
    pub account_references_minor: Vec<String>,
    pub movements_minor: Vec<String>,
    pub items: Vec<(String, String)>,
    pub rules: Vec<(String, String)>,
    pub history: Vec<String>,
}

pub fn synthetic_fixture() -> SyntheticData {
    SyntheticData {
        account_references_minor: vec!["9007199254740993".into()],
        movements_minor: vec!["-123".into(), "123".into(), "0".into()],
        items: vec![
            ("SYNTHETIC ITEM MAX".into(), i64::MAX.to_string()),
            ("SYNTHETIC ITEM MIN".into(), i64::MIN.to_string()),
        ],
        rules: vec![("SYNTHETIC MATCH".into(), "SYNTHETIC CATEGORY".into())],
        history: vec!["SYNTHETIC FIXTURE CREATED".into()],
    }
}

pub fn parse_id(text: &str) -> Result<Uuid> {
    let id = Uuid::parse_str(text).map_err(|_| VaultError::Invalid)?;
    if id.get_version_num() != 7 || id.to_string() != text {
        return Err(VaultError::Invalid);
    }
    Ok(id)
}

pub fn open_database(path: &Path, key: &SecretKey, create: bool) -> Result<Connection> {
    let mut flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    if create {
        flags |= OpenFlags::SQLITE_OPEN_CREATE;
    }
    let database = Connection::open_with_flags(path, flags)?;
    database.pragma_update(None, "key", key_literal(key).as_str())?;
    database
        .execute_batch("PRAGMA cipher_log_level = NONE; PRAGMA cipher_memory_security = ON;")?;
    let version: String = database.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    if !version.starts_with("4.") {
        return Err(VaultError::Unsupported);
    }
    database.query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
        row.get::<_, i64>(0)
    })?;
    database.execute_batch(
        "PRAGMA temp_store = MEMORY; PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;
         PRAGMA secure_delete = ON; PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL;",
    )?;
    Ok(database)
}

fn schema(database: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut query = database.prepare(
        "SELECT name, type, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name",
    )?;
    Ok(query
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?)
}

pub fn validate_database(database: &Connection) -> Result<Uuid> {
    let schema_version: i64 =
        database.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if schema_version != 1 {
        return Err(VaultError::Unsupported);
    }
    // Reject triggers, views and changed definitions before executing any restored mutation.
    let expected = Connection::open_in_memory()?;
    expected.execute_batch(MIGRATION)?;
    if schema(database)? != schema(&expected)? {
        return Err(VaultError::Schema);
    }
    let mut cipher_check = database.prepare("PRAGMA cipher_integrity_check")?;
    if cipher_check.query([])?.next()?.is_some() {
        return Err(VaultError::Integrity);
    }
    let integrity: String = database.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(VaultError::Integrity);
    }
    let mut fk_check = database.prepare("PRAGMA foreign_key_check")?;
    if fk_check.query([])?.next()?.is_some() {
        return Err(VaultError::Integrity);
    }
    let count: i64 = database.query_row("SELECT count(*) FROM workspace", [], |row| row.get(0))?;
    if count != 1 {
        return Err(VaultError::Integrity);
    }
    let (id, authority): (String, String) =
        database.query_row("SELECT id, authority FROM workspace", [], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })?;
    if authority != "LOCAL" {
        return Err(VaultError::Integrity);
    }
    parse_id(&id)
}

pub fn data(database: &Connection) -> Result<SyntheticData> {
    fn amounts(database: &Connection, sql: &str) -> Result<Vec<String>> {
        Ok(database
            .prepare(sql)?
            .query_map([], |row| Ok(row.get::<_, i64>(0)?.to_string()))?
            .collect::<std::result::Result<Vec<_>, _>>()?)
    }
    let items = database
        .prepare("SELECT description, total_minor FROM item ORDER BY id")?
        .query_map([], |row| {
            Ok((row.get(0)?, row.get::<_, i64>(1)?.to_string()))
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let rules = database
        .prepare("SELECT needle, category FROM rule ORDER BY id")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let history = database
        .prepare("SELECT event FROM history ORDER BY id")?
        .query_map([], |row| row.get(0))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(SyntheticData {
        account_references_minor: amounts(
            database,
            "SELECT reference_minor FROM account ORDER BY id",
        )?,
        movements_minor: amounts(database, "SELECT amount_minor FROM movement ORDER BY id")?,
        items,
        rules,
        history,
    })
}

pub fn preview(database: &Connection) -> Result<Preview> {
    let workspace_id = validate_database(database)?;
    let snapshot = data(database)?;
    Ok(Preview {
        workspace_id,
        accounts: snapshot.account_references_minor.len(),
        movements: snapshot.movements_minor.len(),
        items: snapshot.items.len(),
        rules: snapshot.rules.len(),
        history: snapshot.history.len(),
    })
}

pub struct Installation {
    pub(crate) root: PathBuf,
    pub(crate) id: Uuid,
    pub(crate) keys: Arc<dyn KeyStore>,
    _lock: File,
}

impl Installation {
    pub fn open(root: &Path, keys: Arc<dyn KeyStore>) -> Result<Self> {
        fs::create_dir_all(root)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".lock"))?;
        lock.try_lock().map_err(|_| VaultError::Busy)?;
        let identity = root.join(".installation-id");
        let id = if identity.exists() {
            let mut text = String::new();
            File::open(&identity)?.take(65).read_to_string(&mut text)?;
            parse_id(&text)?
        } else {
            if root.join("workspaces").exists() || root.join("staging").exists() {
                return Err(VaultError::Invalid);
            }
            let id = Uuid::now_v7();
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&identity)?;
            file.write_all(id.to_string().as_bytes())?;
            file.sync_all()?;
            id
        };
        for name in ["workspaces", "staging", "backups"] {
            fs::create_dir_all(root.join(name))?;
        }
        let installation = Self {
            root: root.into(),
            id,
            keys,
            _lock: lock,
        };
        installation.recover_staging()?;
        Ok(installation)
    }

    pub fn id(&self) -> Uuid {
        self.id
    }

    pub fn workspace_path(&self, workspace: Uuid) -> PathBuf {
        self.root
            .join("workspaces")
            .join(workspace.to_string())
            .join("vault.db")
    }

    fn recover_staging(&self) -> Result<()> {
        for entry in fs::read_dir(self.root.join("staging"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() || entry.file_type()?.is_symlink() {
                return Err(VaultError::Invalid);
            }
            let workspace = parse_id(&entry.file_name().to_string_lossy())?;
            if !self.workspace_path(workspace).exists() {
                self.keys.delete(self.id, workspace)?;
            }
            fs::remove_dir_all(entry.path())?;
        }
        Ok(())
    }

    pub fn list(&self) -> Result<Vec<Uuid>> {
        let mut ids = Vec::new();
        for entry in fs::read_dir(self.root.join("workspaces"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() || entry.file_type()?.is_symlink() {
                return Err(VaultError::Invalid);
            }
            ids.push(parse_id(&entry.file_name().to_string_lossy())?);
        }
        ids.sort();
        Ok(ids)
    }

    pub fn open_workspace(&self, workspace: Uuid) -> Result<Connection> {
        if !self.workspace_path(workspace).is_file() {
            return Err(VaultError::Invalid);
        }
        let key = self.keys.get(self.id, workspace)?;
        let database = open_database(&self.workspace_path(workspace), &key, false)?;
        if validate_database(&database)? != workspace {
            return Err(VaultError::Integrity);
        }
        Ok(database)
    }

    pub fn create_fixture(&self) -> Result<Uuid> {
        let workspace = Uuid::now_v7();
        let stage = self.root.join("staging").join(workspace.to_string());
        fs::create_dir(&stage)?;
        let result = (|| {
            let key = random_key()?;
            let mut database = open_database(&stage.join("vault.db"), &key, true)?;
            let transaction = database.transaction()?;
            transaction.execute_batch(MIGRATION)?;
            transaction.execute(
                "INSERT INTO workspace VALUES (?1, 'LOCAL')",
                [workspace.to_string()],
            )?;
            let fixture = synthetic_fixture();
            for amount in fixture.account_references_minor {
                transaction.execute(
                    "INSERT INTO account (reference_minor) VALUES (?1)",
                    [amount.parse::<i64>().map_err(|_| VaultError::Invalid)?],
                )?;
            }
            for amount in fixture.movements_minor {
                transaction.execute(
                    "INSERT INTO movement (amount_minor) VALUES (?1)",
                    [amount.parse::<i64>().map_err(|_| VaultError::Invalid)?],
                )?;
            }
            for (description, amount) in fixture.items {
                transaction.execute(
                    "INSERT INTO item (description, total_minor) VALUES (?1, ?2)",
                    params![
                        description,
                        amount.parse::<i64>().map_err(|_| VaultError::Invalid)?
                    ],
                )?;
            }
            for (needle, category) in fixture.rules {
                transaction.execute(
                    "INSERT INTO rule (needle, category) VALUES (?1, ?2)",
                    params![needle, category],
                )?;
            }
            for event in fixture.history {
                transaction.execute("INSERT INTO history (event) VALUES (?1)", [event])?;
            }
            transaction.commit()?;
            validate_database(&database)?;
            drop(database);
            self.keys.put_new(self.id, workspace, &key)?;
            OpenOptions::new()
                .write(true)
                .open(stage.join("vault.db"))?
                .sync_all()?;
            fs::rename(
                &stage,
                self.root.join("workspaces").join(workspace.to_string()),
            )?;
            Ok(workspace)
        })();
        if result.is_err() && self.keys.delete(self.id, workspace).is_ok() {
            fs::remove_dir_all(&stage)?;
        }
        result
    }

    pub fn verify_fixture(&self, workspace: Uuid) -> Result<()> {
        if data(&self.open_workspace(workspace)?)? != synthetic_fixture() {
            return Err(VaultError::Integrity);
        }
        Ok(())
    }

    pub fn remove_fixture(&self, workspace: Uuid) -> Result<()> {
        self.verify_fixture(workspace)?;
        self.keys.delete(self.id, workspace)?;
        fs::remove_dir_all(
            self.workspace_path(workspace)
                .parent()
                .ok_or(VaultError::Invalid)?,
        )?;
        Ok(())
    }
}
