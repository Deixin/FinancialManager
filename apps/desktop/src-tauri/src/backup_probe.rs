//! Explicitly synthetic-only backup test instrumentation, excluded from default.
use crate::{
    LocalError, Result,
    local_backup::{self, VerifiedBackup},
    local_workspaces::open_database,
};
use std::{
    fs::{self, File},
    io::Write,
    path::Path,
    sync::atomic::{AtomicU8, Ordering},
};
static CRASH: AtomicU8 = AtomicU8::new(0);
pub fn set_crash(phase: u8) {
    CRASH.store(phase, Ordering::SeqCst);
}
pub(crate) fn checkpoint(name: &str) {
    let phase = match name {
        "snapshot_ready" => 1,
        "before_publish" => 2,
        "after_publish" => 3,
        _ => 0,
    };
    if phase != 0 && CRASH.load(Ordering::SeqCst) == phase {
        std::process::exit(73);
    }
}
pub fn inspect(backup: &VerifiedBackup, stage: &Path) -> Result<String> {
    fs::create_dir(stage)?;
    let path = stage.join("snapshot.db");
    let result = (|| {
        let mut file = File::create_new(&path)?;
        file.write_all(&backup.snapshot)?;
        file.sync_all()?;
        drop(file);
        let db = open_database(&path, &backup.snapshot_key)?;
        local_backup::validate_snapshot(&db, &backup.manifest)?;
        crate::vault_probe::snapshot(&db)
    })();
    fs::remove_dir_all(stage)?;
    result
}
pub fn forge(
    source: &Path,
    destination: &Path,
    root: &Path,
    password: &str,
    kind: &str,
) -> Result<()> {
    let mut backup = local_backup::read_verified(source, password)?;
    match kind {
        "schema" => backup.manifest.schema_version = 99,
        "checksum" => backup
            .manifest
            .integrity_hashes
            .insert("payload.enc".into(), "0".repeat(64))
            .map(|_| ())
            .ok_or(LocalError::IntegrityFailure)?,
        "descriptor" => backup.manifest.encryption_descriptor.memory_kib = u32::MAX,
        "counts" => {
            backup
                .manifest
                .record_counts
                .insert("financial_account".into(), "999".into());
        }
        "version" => backup.manifest.format_version = 2,
        _ => return Err(LocalError::IntegrityFailure),
    }
    local_backup::seal(
        &backup.manifest,
        &backup.snapshot_key,
        &backup.snapshot,
        password,
    )?
    .publish(destination, root, || true)?;
    Ok(())
}
