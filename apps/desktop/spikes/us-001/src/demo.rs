use crate::secrets::{KeyStore, WindowsKeyStore};
use crate::vault::Installation;
use crate::{Result, key_literal, random_key};
use serde::Serialize;
use std::path::Path;
use std::sync::Arc;
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub struct DemoReport {
    pub passed: bool,
    pub cipher_version: String,
    pub credential_store: &'static str,
    pub installation_isolation: bool,
    pub original_key_removed_before_restore: bool,
    pub new_workspace: bool,
    pub exact_synthetic_data: bool,
    pub another_windows_profile_verified: bool,
}

struct Cleanup(Vec<(Uuid, Uuid)>);
impl Drop for Cleanup {
    fn drop(&mut self) {
        for (installation, workspace) in &self.0 {
            let _ = WindowsKeyStore.delete(*installation, *workspace);
        }
    }
}

pub fn run_synthetic_demo(parent: &Path) -> Result<DemoReport> {
    std::fs::create_dir_all(parent)?;
    let directory = tempfile::tempdir_in(parent)?;
    let mut cleanup = Cleanup(Vec::new());
    let source = Installation::open(
        &directory.path().join("installation-a"),
        Arc::new(WindowsKeyStore),
    )?;
    let workspace = source.create_fixture()?;
    cleanup.0.push((source.id(), workspace));
    let cipher_version =
        source
            .open_workspace(workspace)?
            .query_row("PRAGMA cipher_version", [], |row| row.get(0))?;
    let backup = directory.path().join("synthetic.fmbackup");
    let password = key_literal(&random_key()?);
    source.backup(workspace, &backup, password.as_bytes())?;
    WindowsKeyStore.delete(source.id(), workspace)?;
    let target = Installation::open(
        &directory.path().join("installation-b"),
        Arc::new(WindowsKeyStore),
    )?;
    target.preview_backup(&backup, password.as_bytes())?;
    let restored = target.restore(&backup, password.as_bytes())?;
    cleanup.0.push((target.id(), restored));
    target.verify_fixture(restored)?;
    Ok(DemoReport {
        passed: true,
        cipher_version,
        credential_store: "Windows Credential Manager (LocalMachine)",
        installation_isolation: source.id() != target.id(),
        original_key_removed_before_restore: true,
        new_workspace: restored != workspace,
        exact_synthetic_data: true,
        another_windows_profile_verified: false,
    })
}
