use crate::{
    LocalError, Result, SecretKey, identity,
    keys::{KeyStore, random_key},
    migrations,
};
use rusqlite::{Connection, OpenFlags, params};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;
use zeroize::Zeroizing;

pub use crate::workspace_model::{CreateWorkspace, Purpose, Workspace};

fn checked_dir(path: &Path) -> Result<()> {
    if path.exists() {
        let metadata = fs::symlink_metadata(path)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(LocalError::IntegrityFailure);
        }
    } else {
        fs::create_dir(path)?;
    }
    Ok(())
}
fn checked_file(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(LocalError::IntegrityFailure);
    }
    Ok(())
}
pub fn open_database(path: &Path, key: &SecretKey) -> Result<Connection> {
    checked_file(path)?;
    let db = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    use std::fmt::Write;
    let mut literal = Zeroizing::new(String::with_capacity(67));
    literal.push_str("x'");
    for byte in key.iter() {
        write!(literal, "{byte:02x}").map_err(|_| LocalError::StorageUnavailable)?;
    }
    literal.push('\'');
    db.pragma_update(None, "key", literal.as_str())?;
    db.execute_batch("PRAGMA cipher_log_level=NONE;PRAGMA cipher_memory_security=ON;")?;
    let version: String = db.query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    if !version.starts_with("4.") {
        return Err(LocalError::IntegrityFailure);
    }
    db.query_row("SELECT count(*) FROM sqlite_schema", [], |row| {
        row.get::<_, i64>(0)
    })?;
    db.execute_batch("PRAGMA temp_store=MEMORY;PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=ON;PRAGMA trusted_schema=OFF;PRAGMA secure_delete=ON;PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;")?;
    Ok(db)
}

pub struct Installation {
    root: PathBuf,
    id: Uuid,
    keys: Arc<dyn KeyStore>,
    _lock: File,
}
impl Installation {
    pub(crate) fn id(&self) -> Uuid {
        self.id
    }
    pub fn open(root: &Path, keys: Arc<dyn KeyStore>) -> Result<Self> {
        checked_dir(root)?;
        let lock_path = root.join(".lock");
        if lock_path.exists() {
            checked_file(&lock_path)?;
        }
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(lock_path)?;
        lock.try_lock().map_err(|_| LocalError::InstallationBusy)?;
        let identity_path = root.join(".installation-id");
        let id = if identity_path.exists() {
            checked_file(&identity_path)?;
            let mut text = String::new();
            File::open(identity_path)?
                .take(65)
                .read_to_string(&mut text)?;
            identity::resource_id(&text).map_err(|_| LocalError::IntegrityFailure)?
        } else {
            if root.join("workspaces").exists() || root.join("staging").exists() {
                return Err(LocalError::IntegrityFailure);
            }
            let id = identity::new_id().map_err(|_| LocalError::StorageUnavailable)?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(identity_path)?;
            file.write_all(id.to_string().as_bytes())?;
            file.sync_all()?;
            id
        };
        for name in ["workspaces", "staging"] {
            checked_dir(&root.join(name))?;
        }
        let instance = Self {
            root: root.into(),
            id,
            keys,
            _lock: lock,
        };
        instance.recover()?;
        Ok(instance)
    }
    fn path(&self, id: Uuid) -> PathBuf {
        self.root
            .join("workspaces")
            .join(id.to_string())
            .join("vault.db")
    }
    fn recover(&self) -> Result<()> {
        for entry in fs::read_dir(self.root.join("staging"))? {
            let entry = entry?;
            checked_dir(&entry.path())?;
            let id = identity::resource_id(&entry.file_name().to_string_lossy())
                .map_err(|_| LocalError::IntegrityFailure)?;
            if !self.path(id).exists() {
                self.keys.delete(self.id, id)?;
            }
            fs::remove_dir_all(entry.path())?;
        }
        Ok(())
    }
    fn read(&self, id: Uuid) -> Result<Workspace> {
        let parent = self.root.join("workspaces").join(id.to_string());
        if !parent.exists() {
            return Err(LocalError::NotFound);
        }
        checked_dir(&parent)?;
        let key = self.keys.get(self.id, id)?;
        let mut db = open_database(&self.path(id), &key)?;
        migrations::migrate(&mut db)?;
        let count: i64 = db.query_row("SELECT count(*) FROM workspace", [], |row| row.get(0))?;
        if count != 1 {
            return Err(LocalError::IntegrityFailure);
        }
        let workspace=db.query_row("SELECT id,display_name,purpose,storage_mode,default_currency,created_at FROM workspace WHERE id=? AND storage_mode='LOCAL'",[id.to_string()],|row|{Ok(Workspace{id:row.get(0)?,display_name:row.get(1)?,purpose:match row.get::<_,String>(2)?.as_str(){"PERSONAL"=>Purpose::Personal,"BUSINESS"=>Purpose::Business,_=>Purpose::Other},storage_mode:row.get(3)?,default_currency:row.get(4)?,created_at:row.get(5)?})})?;
        if workspace.default_currency != "BRL"
            || identity::utc_instant(&workspace.created_at).is_err()
        {
            return Err(LocalError::IntegrityFailure);
        }
        migrations::verify_integrity(&db)?;
        Ok(workspace)
    }
    pub fn list(&self) -> Result<Vec<Workspace>> {
        let mut result = Vec::new();
        for entry in fs::read_dir(self.root.join("workspaces"))? {
            let entry = entry?;
            checked_dir(&entry.path())?;
            let id = identity::resource_id(&entry.file_name().to_string_lossy())
                .map_err(|_| LocalError::IntegrityFailure)?;
            result.push(self.read(id)?);
        }
        result.sort_by(|a, b| a.id.cmp(&b.id));
        Ok(result)
    }
    pub fn open_workspace(&self, id: &str) -> Result<Workspace> {
        self.read(identity::resource_id(id).map_err(|_| LocalError::InvalidWorkspace)?)
    }
    pub fn create(&self, input: CreateWorkspace) -> Result<Workspace> {
        self.create_inner(input, |_| Ok(()))
    }
    fn create_inner(
        &self,
        input: CreateWorkspace,
        hook: impl Fn(&str) -> Result<()>,
    ) -> Result<Workspace> {
        let name = input.validate()?.to_owned();
        let id =
            identity::resource_id(&input.workspace_id).map_err(|_| LocalError::InvalidWorkspace)?;
        if self.path(id).parent().is_some_and(|path| path.exists()) {
            let previous = self.read(id)?;
            if previous.display_name != name || previous.purpose != input.purpose {
                return Err(LocalError::RequestConflict);
            }
            return Ok(previous);
        }
        self.recover()?;
        let stage = self.root.join("staging").join(id.to_string());
        fs::create_dir(&stage)?;
        let result = (|| {
            let key = random_key()?;
            self.keys.put_new(self.id, id, &key)?;
            hook("key_stored")?;
            let path = stage.join("vault.db");
            File::create_new(&path)?.sync_all()?;
            let mut db = open_database(&path, &key)?;
            migrations::migrate(&mut db)?;
            let created_at = identity::now_instant().map_err(|_| LocalError::StorageUnavailable)?;
            let generation = identity::new_id().map_err(|_| LocalError::StorageUnavailable)?;
            let tx = db.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
            tx.execute("INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation,created_at) VALUES(?,?,?,'LOCAL','BRL',?,?)",params![id.to_string(),name,input.purpose.as_str(),generation.to_string(),created_at])?;
            tx.commit()?;
            migrations::verify_integrity(&db)?;
            drop(db);
            hook("database_committed")?;
            let workspace = Workspace {
                id: id.to_string(),
                display_name: name,
                purpose: input.purpose,
                storage_mode: "LOCAL".into(),
                default_currency: "BRL".into(),
                created_at,
            };
            fs::rename(&stage, self.root.join("workspaces").join(id.to_string()))?;
            Ok(workspace)
        })();
        if result.is_err() && stage.exists() {
            self.keys.delete(self.id, id)?;
            fs::remove_dir_all(&stage)?;
        }
        result
    }
    #[cfg(any(test, feature = "workspace-smoke", feature = "vault-smoke"))]
    pub fn create_with_hook(
        &self,
        input: CreateWorkspace,
        hook: impl Fn(&str) -> Result<()>,
    ) -> Result<Workspace> {
        self.create_inner(input, hook)
    }
    #[cfg(any(test, feature = "workspace-smoke", feature = "vault-smoke"))]
    pub fn probe_details(&self) -> (Uuid, PathBuf) {
        (self.id, self.root.clone())
    }
}
