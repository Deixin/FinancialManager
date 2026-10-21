use financial_manager_desktop::{
    LocalError, identity,
    keys::{KeyStore, WindowsKeyStore},
    local_workspaces::Installation,
    vault_probe as probe,
};
use std::{fs, path::PathBuf, process::Command, sync::Arc};
const MARKER: &str = "SYNTHETIC_US032_ONLY\n";
fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() < 3 || args.len() > 4 {
        return Err("INVALID_ARGUMENTS".into());
    }
    let mode = args[0].as_str();
    let root = PathBuf::from(&args[1]);
    let output = PathBuf::from(&args[2]);
    let keys = Arc::new(WindowsKeyStore);
    if mode == "prepare" {
        if root.exists() {
            return Err("FRESH_SYNTHETIC_ROOT_REQUIRED".into());
        }
        fs::create_dir(&root)?;
        fs::write(root.join(".us032-fixture"), MARKER)?;
        let installation = probe::fixture(&root, keys.clone()).map_err(|_| "FIXTURE_FAILED")?;
        let db = probe::open_fixture(&root, keys.as_ref()).map_err(|_| "FIXTURE_OPEN_FAILED")?;
        fs::write(
            root.join("baseline.sha256"),
            probe::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")?,
        )?;
        fs::write(
            output,
            serde_json::to_vec_pretty(&probe::runtime(&db).map_err(|_| "ENGINE_FAILED")?)?,
        )?;
        drop(installation);
        return Ok(());
    }
    if fs::read_to_string(root.join(".us032-fixture"))? != MARKER {
        return Err("SYNTHETIC_ROOT_REQUIRED".into());
    }
    if mode == "cleanup" {
        probe::cleanup_keys(&root, keys.as_ref()).map_err(|_| "CLEANUP_FAILED")?;
        fs::write(output, b"{\"passed\":true,\"keys_removed\":true}")?;
        return Ok(());
    }
    if mode == "lock-check" {
        if Installation::open(&root, keys).err() != Some(LocalError::InstallationBusy) {
            return Err("LOCK_NOT_ENFORCED".into());
        }
        fs::write(output, b"{\"passed\":true,\"locked\":true}")?;
        return Ok(());
    }
    if mode == "lock-parent" {
        let installation = Installation::open(&root, keys).map_err(|_| "LOCK_OPEN_FAILED")?;
        let mut child = Command::new(std::env::current_exe()?);
        child.args(["lock-check", &args[1], &args[2]]);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            child.creation_flags(0x08000000);
        }
        if !child.status()?.success() {
            return Err("LOCK_CHILD_FAILED".into());
        }
        drop(installation);
        return Ok(());
    }
    if mode == "journal-inspect" {
        let installation =
            identity::resource_id(&fs::read_to_string(root.join(".installation-id"))?)
                .map_err(|_| "IDENTITY_FAILED")?;
        let key = keys
            .get(installation, probe::dataset_workspace())
            .map_err(|_| "KEY_FAILED")?;
        let journal = fs::read(probe::vault_path(&root).with_extension("db-journal"))?;
        if journal.len() < 512
            || journal[..8] != [0xd9, 0xd5, 0x05, 0xf9, 0x20, 0xa1, 0x63, 0xd7]
            || probe::has_plaintext(&root, &key).map_err(|_| "SCAN_FAILED")?
        {
            return Err("UNPROTECTED_OR_COLD_JOURNAL".into());
        }
        fs::write(output, b"{\"passed\":true,\"hot_journal_encrypted\":true}")?;
        return Ok(());
    }
    let mut db = probe::open_fixture(&root, keys.as_ref()).map_err(|_| "OPEN_FAILED")?;
    let baseline = fs::read_to_string(root.join("baseline.sha256"))?;
    match mode {
        "migration-child" => {
            let phase = args.get(3).ok_or("PHASE_REQUIRED")?.parse::<u8>()?;
            probe::migration_child(&mut db, phase).map_err(|_| "CHECKPOINT_NOT_REACHED")?;
        }
        "migration-recover" => {
            if probe::version(&db).map_err(|_| "VERSION_FAILED")? != 1
                || probe::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")? != baseline
            {
                return Err("PARTIAL_MIGRATION_VISIBLE".into());
            }
            probe::migrate(&mut db).map_err(|_| "RECOVERY_FAILED")?;
            if probe::version(&db).map_err(|_| "VERSION_FAILED")? != 3
                || probe::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")? != baseline
            {
                return Err("FINANCIAL_STATE_CHANGED".into());
            }
            fs::write(
                output,
                b"{\"passed\":true,\"history_and_financial_state_preserved\":true}",
            )?;
        }
        "upgrade" => {
            probe::migrate(&mut db).map_err(|_| "MIGRATION_FAILED")?;
            if probe::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")? != baseline {
                return Err("SNAPSHOT_CHANGED".into());
            }
            fs::write(output, b"{\"passed\":true}")?;
        }
        "journal-child" => {
            probe::journal_child(&db, &probe::vault_path(&root))
                .map_err(|_| "HOT_JOURNAL_REQUIRED")?;
        }
        "journal-recover" => {
            if probe::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")? != baseline
                || probe::version(&db).map_err(|_| "VERSION_FAILED")? != 3
            {
                return Err("UNCOMMITTED_DATA_VISIBLE".into());
            }
            probe::integrity(&db).map_err(|_| "INTEGRITY_FAILED")?;
            let installation =
                identity::resource_id(&fs::read_to_string(root.join(".installation-id"))?)
                    .map_err(|_| "IDENTITY_FAILED")?;
            let secret = keys
                .get(installation, probe::dataset_workspace())
                .map_err(|_| "KEY_FAILED")?;
            if probe::has_plaintext(&root, &secret).map_err(|_| "SCAN_FAILED")? {
                return Err("PLAINTEXT_FOUND".into());
            }
            fs::write(
                output,
                b"{\"passed\":true,\"hot_journal_recovered_without_plaintext\":true}",
            )?;
        }
        _ => return Err("MODE_INVALID".into()),
    }
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("US032_VAULT_PROBE_FAILED");
        std::process::exit(1);
    }
}
