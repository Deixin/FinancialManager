use financial_manager_desktop::{
    LocalError, identity,
    keys::{KeyStore, WindowsKeyStore},
    local_workspaces::{CreateWorkspace, Installation, Purpose, open_database},
};
use serde_json::json;
use std::{fs, path::PathBuf, sync::Arc};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        return Err("PROBE_ARGUMENTS_INVALID".into());
    }
    let root = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);
    let keys = Arc::new(WindowsKeyStore);
    let mode = args[0].as_str();
    if mode == "recover" {
        let installation_id =
            identity::resource_id(&fs::read_to_string(root.join(".installation-id"))?)
                .map_err(|_| "INSTALLATION_INVALID")?;
        let staged = fs::read_dir(root.join("staging"))?
            .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().to_string()))
            .collect::<std::io::Result<Vec<_>>>()?;
        if staged.len() != 1 {
            return Err("STAGING_REQUIRED".into());
        }
        let id = identity::resource_id(&staged[0]).map_err(|_| "STAGING_INVALID")?;
        if keys.get(installation_id, id).is_err() {
            return Err("STAGED_KEY_REQUIRED".into());
        }
        let installation =
            Installation::open(&root, keys.clone()).map_err(|_| "RECOVERY_FAILED")?;
        if keys.get(installation_id, id).err() != Some(LocalError::KeyMissing)
            || installation.list().map_err(|_| "LIST_FAILED")?.len() != 2
            || fs::read_dir(root.join("staging"))?.next().is_some()
        {
            return Err("RECOVERY_ATOMICITY_FAILED".into());
        }
        fs::write(
            output,
            serde_json::to_vec_pretty(&json!({"passed":true,"recovered":true}))?,
        )?;
        return Ok(());
    }
    let installation = Installation::open(&root, keys.clone()).map_err(|_| "OPEN_FAILED")?;
    if mode.starts_with("crash_") {
        let phase = if mode == "crash_key" {
            "key_stored"
        } else {
            "database_committed"
        };
        let _ = installation.create_with_hook(
            CreateWorkspace {
                workspace_id: identity::new_id().map_err(|_| "ID_FAILED")?.to_string(),
                display_name: "SYNTHETIC US031 UNPUBLISHED".into(),
                purpose: Purpose::Other,
            },
            |at| {
                if at == phase {
                    std::process::exit(73);
                }
                Ok(())
            },
        );
        return Err("CRASH_REQUIRED".into());
    }
    let workspaces = installation.list().map_err(|_| "LIST_FAILED")?;
    let (installation_id, base) = installation.probe_details();
    if mode == "cleanup" {
        for row in workspaces {
            keys.delete(
                installation_id,
                identity::resource_id(&row.id).map_err(|_| "ID_INVALID")?,
            )
            .map_err(|_| "KEY_CLEANUP_FAILED")?;
        }
        fs::write(
            output,
            serde_json::to_vec_pretty(&json!({"passed":true,"keys_removed":true}))?,
        )?;
        return Ok(());
    }
    if workspaces.is_empty() {
        return Err("PERSISTED_WORKSPACE_REQUIRED".into());
    }
    let first = &workspaces[0];
    let id = identity::resource_id(&first.id).map_err(|_| "ID_INVALID")?;
    let key = keys.get(installation_id, id).map_err(|_| "KEY_FAILED")?;
    let path = base.join("workspaces").join(&first.id).join("vault.db");
    let before = fs::read(&path)?;
    let encrypted = !before.starts_with(b"SQLite format 3")
        && !before
            .windows(first.display_name.len())
            .any(|part| part == first.display_name.as_bytes())
        && !before.windows(32).any(|part| part == key.as_ref());
    let wrong_key_rejected = open_database(
        &path,
        &financial_manager_desktop::keys::random_key().map_err(|_| "KEY_FAILED")?,
    )
    .is_err();
    let plain = rusqlite::Connection::open(&path)?;
    let plaintext_rejected = plain
        .query_row("SELECT count(*) FROM workspace", [], |row| {
            row.get::<_, i64>(0)
        })
        .is_err();
    drop(plain);
    let db = open_database(&path, &key).map_err(|_| "DB_FAILED")?;
    let cloud_absent: [bool; 3] = ["cloud_user", "auth_identity", "workspace_member"].map(|name| {
        db.query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name=?",
            [name],
            |row| row.get::<_, i64>(0),
        )
        .ok()
            == Some(0)
    });
    // Keep the historical gate identifier; assert the entire adopted v3 catalog.
    let migrations_v2 = db.query_row("SELECT count(*) FROM _schema_migration", [], |row| {
        row.get::<_, i64>(0)
    })? == 3;
    drop(db);
    keys.delete(installation_id, id)
        .map_err(|_| "DELETE_KEY_FAILED")?;
    let missing_key_rejected = installation.open_workspace(&first.id).err()
        == Some(LocalError::KeyMissing)
        && fs::read(&path)? == before;
    keys.put_new(installation_id, id, &key)
        .map_err(|_| "RESTORE_KEY_FAILED")?;
    let reopened = installation
        .open_workspace(&first.id)
        .map_err(|_| "REOPEN_FAILED")?
        == *first;
    let second = installation
        .create(CreateWorkspace {
            workspace_id: identity::new_id().map_err(|_| "ID_FAILED")?.to_string(),
            display_name: "SYNTHETIC US031 SECOND".into(),
            purpose: Purpose::Other,
        })
        .map_err(|_| "CREATE_SECOND_FAILED")?;
    let isolation = second.id != first.id
        && installation
            .open_workspace(&first.id)
            .map_err(|_| "OPEN_FAILED")?
            == *first
        && installation.list().map_err(|_| "LIST_FAILED")?.len() == 2;
    let checks = json!({"encrypted_at_rest":encrypted,"wrong_key_rejected":wrong_key_rejected,"plaintext_rejected":plaintext_rejected,"no_cloud_identity_tables":cloud_absent.iter().all(|value|*value),"migrations_v2":migrations_v2,"missing_key_preserves_database":missing_key_rejected,"reopened_exactly":reopened,"workspace_isolation":isolation});
    if !checks
        .as_object()
        .ok_or("REPORT_INVALID")?
        .values()
        .all(|value| value.as_bool() == Some(true))
    {
        return Err("PROBE_CHECK_FAILED".into());
    }
    fs::write(
        output,
        serde_json::to_vec_pretty(&json!({"passed":true,"checks":checks}))?,
    )?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("WORKSPACE_PROBE_FAILED");
        std::process::exit(1);
    }
}
