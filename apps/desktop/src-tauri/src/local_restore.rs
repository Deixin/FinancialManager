//! Restoration creates a new local authority. No existing workspace is written.
use crate::{
    LocalError, Result, identity,
    keys::random_key,
    local_backup::{self, VerifiedBackup},
    local_workspaces::{Installation, open_database},
    migrations,
    workspace_model::{CreateWorkspace, Purpose, Workspace},
};
use rusqlite::{Connection, params_from_iter, types::Value};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use uuid::Uuid;
use zeroize::Zeroize;

pub const TABLES: [&str; 16] = [
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
    "import_batch",
    "import_source",
    "import_item",
    "import_effect",
];
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PreviewRestore {
    pub selection_id: String,
    pub password: String,
}
impl Drop for PreviewRestore {
    fn drop(&mut self) {
        self.password.zeroize();
    }
}
impl PreviewRestore {
    pub fn validate(&self) -> Result<()> {
        identity::resource_id(&self.selection_id).map_err(|_| LocalError::RestoreUnavailable)?;
        if !local_backup::valid_password(&self.password) {
            return Err(LocalError::InvalidBackupPassword);
        }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RestorePreview {
    pub restore_id: String,
    pub source_name: String,
    pub display_name: String,
    pub purpose: Purpose,
    pub backup_created_at: String,
    pub record_counts: BTreeMap<String, String>,
}
#[derive(Serialize)]
pub struct SelectedBackup {
    pub selection_id: Option<String>,
}
pub struct PreparedRestore {
    pub preview: RestorePreview,
    digest: [u8; 32],
    counts: BTreeMap<String, String>,
}
struct Ids(HashMap<(String, String), String>);
impl Ids {
    fn get(&mut self, table: &str, old: &str) -> Result<String> {
        identity::resource_id(old).map_err(|_| LocalError::IntegrityFailure)?;
        let key = (table.into(), old.into());
        if let Some(value) = self.0.get(&key) {
            return Ok(value.clone());
        }
        let id = identity::new_id()
            .map_err(|_| LocalError::StorageUnavailable)?
            .to_string();
        self.0.insert(key, id.clone());
        Ok(id)
    }
}
fn exact_json(value: &serde_json::Value, keys: &[&str]) -> Result<()> {
    if !value
        .as_object()
        .is_some_and(|m| m.len() == keys.len() && keys.iter().all(|k| m.contains_key(*k)))
    {
        return Err(LocalError::UnsupportedBackup);
    }
    Ok(())
}
fn integer_json(value: &serde_json::Value) -> Result<i64> {
    let text = value.as_str().ok_or(LocalError::UnsupportedBackup)?;
    let number = text
        .parse::<i64>()
        .map_err(|_| LocalError::UnsupportedBackup)?;
    if number.to_string() != text {
        return Err(LocalError::UnsupportedBackup);
    }
    Ok(number)
}
fn rebase_snapshot(
    text: &str,
    old_workspace: &str,
    transaction_id: &str,
    version: i64,
    ids: &mut Ids,
) -> Result<String> {
    let mut value: serde_json::Value =
        serde_json::from_str(text).map_err(|_| LocalError::UnsupportedBackup)?;
    // The schema's initial empty historical placeholder carries no identities.
    if value.as_object().is_some_and(|m| m.is_empty()) {
        return Ok(text.into());
    }
    exact_json(
        &value,
        &["format_version", "base_revision", "before", "after"],
    )?;
    let base = integer_json(&value["base_revision"])?;
    if base < 0 || base.checked_add(1) != Some(version) || value["before"].is_null() != (base == 0)
    {
        return Err(LocalError::UnsupportedBackup);
    }
    let object = value.as_object_mut().ok_or(LocalError::UnsupportedBackup)?;
    if object.len() != 4
        || object.get("format_version").and_then(|v| v.as_u64()) != Some(1)
        || !object.contains_key("base_revision")
        || !object.contains_key("before")
        || !object.contains_key("after")
    {
        return Err(LocalError::UnsupportedBackup);
    }
    for field in ["before", "after"] {
        let state = object.get_mut(field).ok_or(LocalError::UnsupportedBackup)?;
        if field == "before" && state.is_null() {
            continue;
        }
        exact_json(
            state,
            &[
                "workspace_id",
                "id",
                "version",
                "created_at",
                "updated_at",
                "deleted_at",
                "content",
            ],
        )?;
        if state["id"].as_str() != Some(transaction_id)
            || integer_json(&state["version"])? != if field == "before" { base } else { version }
        {
            return Err(LocalError::IntegrityFailure);
        }
        for name in ["created_at", "updated_at"] {
            identity::utc_instant(state[name].as_str().ok_or(LocalError::UnsupportedBackup)?)
                .map_err(|_| LocalError::UnsupportedBackup)?;
        }
        if !state["deleted_at"].is_null() {
            identity::utc_instant(
                state["deleted_at"]
                    .as_str()
                    .ok_or(LocalError::UnsupportedBackup)?,
            )
            .map_err(|_| LocalError::UnsupportedBackup)?;
        }
        if state.get("workspace_id").and_then(|v| v.as_str()) != Some(old_workspace) {
            return Err(LocalError::IntegrityFailure);
        }
        for (key, table) in [
            ("workspace_id", "workspace"),
            ("id", "financial_transaction"),
        ] {
            remap_json(state, key, table, ids, false)?;
        }
        let content = state
            .get_mut("content")
            .ok_or(LocalError::UnsupportedBackup)?;
        exact_json(
            content,
            &[
                "account_id",
                "group_id",
                "counterparty_id",
                "financial_date",
                "account_amount_minor",
                "economic_kind",
                "original_description",
                "display_name",
                "origin_kind",
                "deleted",
                "allocations",
                "tag_ids",
            ],
        )?;
        integer_json(&content["account_amount_minor"])?;
        for (key, table, nullable) in [
            ("account_id", "financial_account", false),
            ("group_id", "transaction_group", true),
            ("counterparty_id", "counterparty", true),
        ] {
            remap_json(content, key, table, ids, nullable)?;
        }
        for allocation in content
            .get_mut("allocations")
            .and_then(|v| v.as_array_mut())
            .ok_or(LocalError::UnsupportedBackup)?
        {
            exact_json(
                allocation,
                &[
                    "id",
                    "category_id",
                    "subcategory_id",
                    "amount_minor",
                    "note",
                ],
            )?;
            integer_json(&allocation["amount_minor"])?;
            for (key, table, nullable) in [
                ("id", "transaction_allocation", false),
                ("category_id", "category", false),
                ("subcategory_id", "subcategory", true),
            ] {
                remap_json(allocation, key, table, ids, nullable)?;
            }
        }
        for tag in content
            .get_mut("tag_ids")
            .and_then(|v| v.as_array_mut())
            .ok_or(LocalError::UnsupportedBackup)?
        {
            *tag = serde_json::Value::String(
                ids.get("tag", tag.as_str().ok_or(LocalError::UnsupportedBackup)?)?,
            );
        }
    }
    serde_json::to_string(&value).map_err(|_| LocalError::IntegrityFailure)
}
fn remap_json(
    value: &mut serde_json::Value,
    key: &str,
    table: &str,
    ids: &mut Ids,
    nullable: bool,
) -> Result<()> {
    let field = value.get_mut(key).ok_or(LocalError::UnsupportedBackup)?;
    if nullable && field.is_null() {
        return Ok(());
    }
    *field = serde_json::Value::String(
        ids.get(table, field.as_str().ok_or(LocalError::UnsupportedBackup)?)?,
    );
    Ok(())
}
fn identifier(value: &str) -> Result<String> {
    if value.is_empty() || !value.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') {
        return Err(LocalError::UnsupportedSchema);
    }
    Ok(format!("\"{value}\""))
}
fn copy_records(
    source: &Connection,
    target: &mut Connection,
    old: &str,
    id: Uuid,
    name: &str,
    created: &str,
    generation: &str,
) -> Result<()> {
    let mut ids = Ids(HashMap::from([(
        ("workspace".into(), old.into()),
        id.to_string(),
    )]));
    // Seed IDs first, including forward references. No value is converted via float.
    for table in TABLES
        .iter()
        .filter(|t| **t != "workspace" && **t != "transaction_tag")
    {
        let mut q = source.prepare(&format!(
            "SELECT id FROM {} ORDER BY rowid",
            identifier(table)?
        ))?;
        for old in q.query_map([], |r| r.get::<_, String>(0))? {
            ids.get(table, &old?)?;
        }
    }
    let tx = target.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    tx.execute_batch("PRAGMA defer_foreign_keys=ON")?;
    for table in TABLES {
        let mut q = source.prepare(&format!(
            "SELECT * FROM {} ORDER BY rowid",
            identifier(table)?
        ))?;
        let columns = q
            .column_names()
            .iter()
            .map(|n| n.to_string())
            .collect::<Vec<_>>();
        let mut fk = source.prepare(&format!("PRAGMA foreign_key_list({})", identifier(table)?))?;
        let references = fk
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|(_, _, to)| to == "id")
            .map(|(from, table, _)| (from, table))
            .collect::<HashMap<_, _>>();
        let sql = format!(
            "INSERT INTO {}({}) VALUES({})",
            identifier(table)?,
            columns
                .iter()
                .map(|c| identifier(c))
                .collect::<Result<Vec<_>>>()?
                .join(","),
            vec!["?"; columns.len()].join(",")
        );
        let mut insert = tx.prepare(&sql)?;
        let mut rows = q.query([])?;
        while let Some(row) = rows.next()? {
            let mut values = Vec::with_capacity(columns.len());
            for (index, column) in columns.iter().enumerate() {
                let mut value = row.get::<_, Value>(index)?;
                if matches!(value, Value::Real(_) | Value::Blob(_)) {
                    return Err(LocalError::IntegrityFailure);
                }
                if let Value::Text(text) = &mut value {
                    if column == "id" {
                        *text = ids.get(table, text)?;
                    } else if column == "workspace_id" {
                        *text = ids.get("workspace", text)?;
                    } else if let Some(parent) = references.get(column) {
                        *text = ids.get(parent, text)?;
                    } else if table == "transaction_revision" && column == "snapshot" {
                        *text = rebase_snapshot(
                            text,
                            old,
                            &row.get::<_, String>("transaction_id")?,
                            row.get("version")?,
                            &mut ids,
                        )?;
                    }
                    if table == "workspace" {
                        match column.as_str() {
                            "display_name" => *text = name.into(),
                            "created_at" => *text = created.into(),
                            "sync_generation" => *text = generation.into(),
                            _ => (),
                        }
                    }
                }
                values.push(value);
            }
            insert.execute(params_from_iter(values))?;
        }
    }
    // FK, allocation commit guards and all existing triggers remain enabled.
    tx.commit()?;
    Ok(())
}
fn stage(root: &Path, id: Uuid) -> PathBuf {
    root.join("staging").join(id.to_string())
}
fn published(root: &Path, id: Uuid) -> PathBuf {
    root.join("workspaces").join(id.to_string())
}
fn digest(path: &Path) -> Result<[u8; 32]> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut bytes = [0; 64 * 1024];
    loop {
        let n = file.read(&mut bytes)?;
        if n == 0 {
            break;
        }
        hash.update(&bytes[..n]);
    }
    Ok(hash.finalize().into())
}
pub fn prepare(installation: &Installation, backup: VerifiedBackup) -> Result<PreparedRestore> {
    let id = identity::new_id().map_err(|_| LocalError::StorageUnavailable)?;
    if published(&installation.root, id).try_exists()? {
        return Err(LocalError::RequestConflict);
    }
    let folder = stage(&installation.root, id);
    fs::create_dir(&folder)?;
    let result = (|| {
        let input = folder.join("source.db");
        let mut f = File::create_new(&input)?;
        f.write_all(&backup.snapshot)?;
        f.sync_all()?;
        drop(f);
        let mut source = open_database(&input, &backup.snapshot_key)?;
        local_backup::validate_snapshot(&source, &backup.manifest)?;
        // Authenticate and verify the old schema before upgrading only the staging copy.
        migrations::migrate(&mut source)?;
        let normalized_counts = local_backup::record_counts(&source)?;
        let (source_name, purpose): (String, String) = source.query_row(
            "SELECT display_name,purpose FROM workspace WHERE id=?",
            [&backup.manifest.workspace_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        let purpose = match purpose.as_str() {
            "PERSONAL" => Purpose::Personal,
            "BUSINESS" => Purpose::Business,
            "OTHER" => Purpose::Other,
            _ => return Err(LocalError::IntegrityFailure),
        };
        let source_name = CreateWorkspace {
            workspace_id: id.to_string(),
            display_name: source_name.clone(),
            purpose,
        }
        .validate()?
        .to_owned();
        let mut name = String::new();
        for ch in source_name.chars() {
            if name.encode_utf16().count() + ch.len_utf16() > 106 {
                break;
            }
            name.push(ch);
        }
        name.push_str(" (restaurado)");
        CreateWorkspace {
            workspace_id: id.to_string(),
            display_name: name.clone(),
            purpose,
        }
        .validate()?;
        let created = identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?;
        let generation = identity::new_id()
            .map_err(|_| LocalError::StorageUnavailable)?
            .to_string();
        let key = random_key()?;
        let path = folder.join("vault.db");
        File::create_new(&path)?;
        let mut target = open_database(&path, &key)?;
        migrations::migrate(&mut target)?;
        copy_records(
            &source,
            &mut target,
            &backup.manifest.workspace_id,
            id,
            &name,
            &created,
            &generation,
        )?;
        target.pragma_update(None, "user_version", migrations::current_version())?;
        let mut expected = backup.manifest.clone();
        expected.workspace_id = id.to_string();
        expected.schema_version = migrations::current_version();
        expected.record_counts = normalized_counts.clone();
        local_backup::validate_snapshot(&target, &expected)?;
        drop(target);
        drop(source);
        fs::remove_file(input)?;
        fs::OpenOptions::new()
            .read(true)
            .write(true)
            .open(&path)?
            .sync_all()?;
        installation.keys.put_new(installation.id, id, &key)?;
        drop(key);
        let mut receipt = File::create_new(folder.join(".restored-v1"))?;
        receipt.write_all(id.to_string().as_bytes())?;
        receipt.sync_all()?;
        checkpoint("staged");
        Ok(PreparedRestore {
            preview: RestorePreview {
                restore_id: id.to_string(),
                source_name,
                display_name: name,
                purpose,
                backup_created_at: backup.manifest.created_at.clone(),
                record_counts: normalized_counts
                    .iter()
                    .filter(|(t, _)| TABLES.contains(&t.as_str()))
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
            },
            digest: digest(&path)?,
            counts: normalized_counts,
        })
    })();
    if result.is_err() {
        cancel(installation, id)?;
    }
    result
}
pub fn cancel(installation: &Installation, id: Uuid) -> Result<()> {
    let folder = stage(&installation.root, id);
    if !folder.try_exists()? {
        return Ok(());
    }
    if published(&installation.root, id).try_exists()? {
        return Err(LocalError::IntegrityFailure);
    }
    if fs::symlink_metadata(&folder)?.file_type().is_symlink() {
        return Err(LocalError::IntegrityFailure);
    }
    installation.keys.delete(installation.id, id)?;
    fs::remove_dir_all(folder)?;
    Ok(())
}
pub fn replay(installation: &Installation, id: Uuid) -> Result<Option<Workspace>> {
    let folder = published(&installation.root, id);
    if !folder.try_exists()? {
        return Ok(None);
    }
    let receipt = folder.join(".restored-v1");
    let meta = fs::symlink_metadata(&receipt)?;
    if meta.file_type().is_symlink()
        || !meta.is_file()
        || meta.len() != 36
        || fs::read_to_string(receipt)? != id.to_string()
    {
        return Err(LocalError::RestoreUnavailable);
    }
    installation.open_workspace(&id.to_string()).map(Some)
}
pub fn confirm(
    installation: &Installation,
    prepared: &PreparedRestore,
    valid: impl Fn() -> bool,
) -> Result<Workspace> {
    let id = identity::resource_id(&prepared.preview.restore_id)
        .map_err(|_| LocalError::RestoreUnavailable)?;
    if let Some(workspace) = replay(installation, id)? {
        return Ok(workspace);
    }
    let folder = stage(&installation.root, id);
    let path = folder.join("vault.db");
    if digest(&path)? != prepared.digest {
        return Err(LocalError::IntegrityFailure);
    }
    let key = installation.keys.get(installation.id, id)?;
    let db = open_database(&path, &key)?;
    migrations::verify_current(&db)?;
    if db.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0))? != "ok"
        || local_backup::record_counts(&db)? != prepared.counts
    {
        return Err(LocalError::IntegrityFailure);
    }
    let workspace = Workspace {
        id: id.to_string(),
        display_name: prepared.preview.display_name.clone(),
        purpose: prepared.preview.purpose,
        storage_mode: "LOCAL".into(),
        default_currency: "BRL".into(),
        created_at: db.query_row(
            "SELECT created_at FROM workspace WHERE id=?",
            [id.to_string()],
            |r| r.get(0),
        )?,
    };
    drop(db);
    drop(key);
    if digest(&path)? != prepared.digest || !valid() {
        return Err(LocalError::LocalLocked);
    }
    checkpoint("before_publish");
    fs::rename(&folder, published(&installation.root, id))?;
    checkpoint("after_publish");
    Ok(workspace)
}
fn checkpoint(_phase: &str) {
    #[cfg(feature = "restore-smoke")]
    crate::restore_probe::checkpoint(_phase);
}

#[derive(Default)]
pub struct Controller {
    pub selection: Option<(Uuid, PathBuf)>,
    pub prepared: Option<(u64, PreparedRestore)>,
}
impl Controller {
    pub fn clear_preview(&mut self, installation: &Installation) -> Result<()> {
        if let Some((_, p)) = &self.prepared {
            cancel(
                installation,
                identity::resource_id(&p.preview.restore_id)
                    .map_err(|_| LocalError::IntegrityFailure)?,
            )?;
        }
        self.prepared = None;
        Ok(())
    }
    pub fn clear(&mut self, installation: &Installation) -> Result<()> {
        self.clear_preview(installation)?;
        self.selection = None;
        Ok(())
    }
}
