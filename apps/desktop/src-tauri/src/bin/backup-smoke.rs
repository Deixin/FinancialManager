use financial_manager_desktop::{
    LocalError, Result, backup_destination::BackupDestination, commands::LocalState,
    keys::WindowsKeyStore, lock_store::WindowsPolicyStore, windows_hello::WindowsHello,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use tauri::Manager;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Report {
    passed: bool,
    checks: BTreeMap<String, bool>,
}
struct Output(PathBuf);
struct SyntheticDestination {
    path: PathBuf,
    calls: AtomicUsize,
}
impl BackupDestination for SyntheticDestination {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        match self.calls.fetch_add(1, Ordering::SeqCst) {
            0 => Ok(Some(self.path.clone())),
            1 => Ok(None),
            _ => Err(LocalError::BackupDestinationUnavailable),
        }
    }
}
#[tauri::command]
fn finish_backup_smoke(
    app: tauri::AppHandle,
    report: Report,
) -> std::result::Result<(), &'static str> {
    let expected = [
        "backup_form_policy_and_validation",
        "ipc_export_hides_financial_tree",
        "verified_notice_keeps_pin_locked",
        "chooser_cancel_preserves_closed_state",
        "sanitized_destination_error",
        "no_storage_or_egress",
    ];
    if report
        .checks
        .keys()
        .any(|key| !expected.contains(&key.as_str()))
    {
        app.exit(1);
        return Err("BACKUP_SMOKE_INVALID");
    }
    std::fs::write(
        &app.state::<Output>().0,
        serde_json::to_vec_pretty(&report).map_err(|_| "REPORT_FAILED")?,
    )
    .map_err(|_| "REPORT_FAILED")?;
    let passed = report.passed
        && report.checks.len() == expected.len()
        && expected
            .iter()
            .all(|key| report.checks.get(*key) == Some(&true));
    app.exit(if passed { 0 } else { 1 });
    if passed {
        Ok(())
    } else {
        Err("BACKUP_SMOKE_INVALID")
    }
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        std::process::exit(1);
    }
    let root = PathBuf::from(&args[2]);
    let mut context = tauri::generate_context!();
    let mut window = context.config_mut().app.windows.remove(0);
    window.visible = false;
    if tauri::Builder::default()
        .manage(Output(PathBuf::from(&args[0])))
        .manage(Arc::new(LocalState::with_backup_destination(
            root.clone(),
            Arc::new(WindowsKeyStore),
            Arc::new(WindowsPolicyStore),
            Arc::new(WindowsHello),
            Arc::new(SyntheticDestination {
                path: root.with_extension("ui.fmbackup"),
                calls: AtomicUsize::new(0),
            }),
        )))
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
            financial_manager_desktop::commands::create_local_backup,
            finish_backup_smoke
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(false))
                && let Some(state) = window.try_state::<Arc<LocalState>>()
            {
                state.on_focus_lost();
            }
        })
        .setup(move |app| {
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("backup-smoke-only")
                    .window("main")
                    .permission("allow-finish-backup-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .initialization_script(include_str!("../../backup-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context)
        .is_err()
    {
        eprintln!("BACKUP_SMOKE_FAILED");
        std::process::exit(1);
    }
}
