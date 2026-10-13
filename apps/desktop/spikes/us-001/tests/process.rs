#![cfg(windows)]
use financial_manager_vault_spike::secrets::{KeyStore, WindowsKeyStore};
use financial_manager_vault_spike::vault::parse_id;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

const PASSWORD: &[u8] = b"SYNTHETIC CROSS PROCESS RECOVERY SECRET";

fn cli(root: &Path, args: &[&str], password: Option<&[u8]>) -> Output {
    let mut process = Command::new(env!("CARGO_BIN_EXE_vault-spike"))
        .arg("--root")
        .arg(root)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    if let Some(secret) = password {
        process.stdin.take().unwrap().write_all(secret).unwrap();
    }
    drop(process.stdin.take());
    process.wait_with_output().unwrap()
}

fn success(root: &Path, args: &[&str], password: Option<&[u8]>) -> Value {
    let output = cli(root, args, password);
    let code = String::from_utf8_lossy(&output.stderr);
    let code = code.trim();
    let safe_code = if code
        .bytes()
        .all(|byte| byte.is_ascii_uppercase() || byte == b'_')
    {
        code
    } else {
        "NATIVE_PROCESS_FAILURE"
    };
    assert!(
        output.status.success(),
        "Synthetic CLI {} failed: {}",
        args[0],
        safe_code
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

// Delete only credentials belonging to these unique temporary installations, including on panic.
struct Cleanup(Vec<PathBuf>);
impl Drop for Cleanup {
    fn drop(&mut self) {
        for root in &self.0 {
            let Some(id) = fs::read_to_string(root.join(".installation-id"))
                .ok()
                .and_then(|id| parse_id(&id).ok())
            else {
                continue;
            };
            for name in ["workspaces", "staging"] {
                let Ok(entries) = fs::read_dir(root.join(name)) else {
                    continue;
                };
                for entry in entries.flatten() {
                    if let Ok(workspace) = parse_id(&entry.file_name().to_string_lossy()) {
                        let _ = WindowsKeyStore.delete(id, workspace);
                    }
                }
            }
        }
    }
}

#[test]
fn real_windows_store_survives_process_restart_and_crash_recovery_preserves_existing_vault() {
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("installation-a");
    let target = directory.path().join("installation-b");
    let _cleanup = Cleanup(vec![source.clone(), target.clone()]);
    let created = success(&source, &["create"], None);
    let original = created["workspace_id"].as_str().unwrap();
    success(&source, &["verify", original], None); // New process reads the Windows credential.
    let backup = directory.path().join("synthetic.fmbackup");
    let backup_arg = backup.to_str().unwrap();
    success(&source, &["backup", original, backup_arg], Some(PASSWORD));
    let original_package = fs::read(&backup).unwrap();
    assert!(
        !cli(&source, &["backup", original, backup_arg], Some(PASSWORD))
            .status
            .success()
    );
    assert!(
        original_package == fs::read(&backup).unwrap(),
        "Backup must never overwrite an existing package"
    );
    success(&source, &["remove-synthetic", original], None); // Both original DB and device key are gone.
    let existing = success(&target, &["create"], None);
    let existing_id = existing["workspace_id"].as_str().unwrap();
    let existing_path = target.join("workspaces").join(existing_id).join("vault.db");
    let before = fs::read(&existing_path).unwrap();
    for stop in ["staged", "key-stored"] {
        let crashed = cli(
            &target,
            &["restore-crash", backup_arg, stop],
            Some(PASSWORD),
        );
        assert_eq!(crashed.status.code(), Some(86));
        assert_eq!(fs::read_dir(target.join("staging")).unwrap().count(), 1);
        let stage = fs::read_dir(target.join("staging"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap();
        let pending = parse_id(&stage.file_name().to_string_lossy()).unwrap();
        let target_id =
            parse_id(&fs::read_to_string(target.join(".installation-id")).unwrap()).unwrap();
        success(&target, &["list"], None); // Restart performs recovery without publishing the partial workspace.
        assert!(WindowsKeyStore.get(target_id, pending).is_err());
        assert_eq!(fs::read_dir(target.join("staging")).unwrap().count(), 0);
        success(&target, &["verify", existing_id], None);
        assert!(
            before == fs::read(&existing_path).unwrap(),
            "Crash must preserve the existing vault"
        );
    }
    let preview = success(&target, &["preview", backup_arg], Some(PASSWORD));
    assert_eq!(preview["items"].as_u64(), Some(2));
    let restored = success(
        &target,
        &["restore", backup_arg, "--confirm"],
        Some(PASSWORD),
    );
    let restored_id = restored["workspace_id"].as_str().unwrap();
    assert_ne!(original, restored_id);
    success(&target, &["verify", restored_id], None);
    assert!(
        before == fs::read(&existing_path).unwrap(),
        "Restore must preserve the existing vault"
    );
}
