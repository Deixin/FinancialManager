//! Visible, synthetic-only human protocol. Never a default product target.
use financial_manager_desktop::{
    LocalError, Result,
    commands::LocalState,
    keys::WindowsKeyStore,
    lock_store::WindowsPolicyStore,
    vault_probe,
    windows_hello::{HelloAvailability, HelloVerifier, WindowsHello},
};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
#[derive(Default)]
struct Recorder(Mutex<Vec<&'static str>>);
impl HelloVerifier for Recorder {
    fn availability(&self) -> HelloAvailability {
        WindowsHello.availability()
    }
    fn verify(&self, window: isize) -> Result<()> {
        let result = WindowsHello.verify(window);
        let outcome = match result {
            Ok(()) => "VERIFIED",
            Err(LocalError::HelloCanceled) => "CANCELED",
            _ => "UNAVAILABLE_OR_FAILED",
        };
        self.0
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?
            .push(outcome);
        result
    }
}
fn run() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        return Err("ARGUMENTS_INVALID".into());
    }
    let root = PathBuf::from(&args[0]);
    if fs::read_to_string(root.join(".us033-fixture"))? != "SYNTHETIC_US033_ONLY\n" {
        return Err("SYNTHETIC_ROOT_REQUIRED".into());
    }
    let recorder = Arc::new(Recorder::default());
    let state = Arc::new(LocalState::with_hello(
        root.clone(),
        Arc::new(WindowsKeyStore),
        Arc::new(WindowsPolicyStore),
        recorder.clone(),
    ));
    let mut context = tauri::generate_context!();
    let mut window = context.config_mut().app.windows.remove(0);
    window.title = "Financial Manager — teste sintético Windows Hello".into();
    tauri::Builder::default()
        .manage(state.clone())
        .invoke_handler(tauri::generate_handler![
            financial_manager_desktop::commands::list_local_workspaces,
            financial_manager_desktop::commands::create_local_workspace,
            financial_manager_desktop::commands::open_local_workspace,
            financial_manager_desktop::commands::local_lock_status,
            financial_manager_desktop::commands::lock_local_session,
            financial_manager_desktop::commands::unlock_local_session,
            financial_manager_desktop::commands::configure_local_pin,
            financial_manager_desktop::commands::disable_local_pin,
            financial_manager_desktop::commands::configure_local_hello,
            financial_manager_desktop::commands::unlock_local_hello,
            financial_manager_desktop::commands::create_local_backup
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(false))
                && let Some(state) = window.try_state::<Arc<LocalState>>()
            {
                state.on_focus_lost();
            }
        })
        .setup(move |app| {
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .build()?;
            Ok(())
        })
        .run(context)?;
    drop(state);
    let outcomes = recorder.0.lock().map_err(|_| "RECORDER_FAILED")?;
    let verified = outcomes
        .iter()
        .filter(|value| **value == "VERIFIED")
        .count();
    let canceled = outcomes
        .iter()
        .filter(|value| **value == "CANCELED")
        .count();
    let ciphertext_preserved = format!(
        "{:x}",
        Sha256::digest(fs::read(vault_probe::vault_path(&root))?)
    ) == fs::read_to_string(root.join("ciphertext.sha256"))?;
    let db =
        vault_probe::open_fixture(&root, &WindowsKeyStore).map_err(|_| "FIXTURE_OPEN_FAILED")?;
    let structured_state_preserved = vault_probe::integrity(&db).is_ok()
        && vault_probe::snapshot(&db).map_err(|_| "SNAPSHOT_FAILED")?
            == fs::read_to_string(root.join("baseline.sha256"))?;
    // Records actual OS outcomes only. Human review still checks the visible flow.
    fs::write(
        root.join("hello-result.json"),
        serde_json::to_vec_pretty(&serde_json::json!({
            "format_version": 1, "scope": "us033-windows-hello-human-run", "synthetic_only": true,
            "native_verified_count": verified, "native_canceled_count": canceled,
            "ciphertext_preserved": ciphertext_preserved, "structured_state_preserved": structured_state_preserved,
            "native_observations_passed": verified >= 2 && canceled >= 1 && ciphertext_preserved && structured_state_preserved,
            "human_review_required": true
        }))?,
    )?;
    Ok(())
}
fn main() {
    if run().is_err() {
        eprintln!("HELLO_MANUAL_FAILED");
        std::process::exit(1);
    }
}
