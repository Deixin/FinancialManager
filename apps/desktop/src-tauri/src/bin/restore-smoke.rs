use financial_manager_desktop::{
    Result, commands::LocalState, keys::WindowsKeyStore, lock_store::WindowsPolicyStore,
    restore_source::RestoreSource,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failure_stage: Option<u8>,
}
struct Output(PathBuf);
struct SyntheticSource {
    path: PathBuf,
    calls: AtomicUsize,
}
impl RestoreSource for SyntheticSource {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        match self.calls.fetch_add(1, Ordering::SeqCst) {
            0 => Ok(None),
            _ => Ok(Some(self.path.clone())),
        }
    }
}
#[tauri::command]
fn finish_restore_smoke(
    app: tauri::AppHandle,
    report: Report,
) -> std::result::Result<(), &'static str> {
    let expected = [
        "picker_policy_and_reauthentication",
        "invalid_secret_preserves_existing",
        "verified_preview_counts_and_no_publication",
        "confirmed_restore_opens_new_local_workspace",
        "canceled_preview_removes_stage",
        "no_storage_or_egress",
    ];
    if report
        .checks
        .keys()
        .any(|key| !expected.contains(&key.as_str()))
    {
        app.exit(1);
        return Err("RESTORE_SMOKE_INVALID");
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
        Err("RESTORE_SMOKE_INVALID")
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
        .manage(Arc::new(LocalState::with_restore_source(
            root.join("target"),
            Arc::new(WindowsKeyStore),
            Arc::new(WindowsPolicyStore),
            Arc::new(SyntheticSource {
                path: root.join("package.fmbackup"),
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
            financial_manager_desktop::commands::select_local_backup,
            financial_manager_desktop::commands::preview_local_restore,
            financial_manager_desktop::commands::confirm_local_restore,
            financial_manager_desktop::commands::cancel_local_restore,
            finish_restore_smoke
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
                tauri::ipc::CapabilityBuilder::new("restore-smoke-only")
                    .window("main")
                    .permission("allow-finish-restore-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .initialization_script(include_str!("../../restore-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context)
        .is_err()
    {
        eprintln!("RESTORE_SMOKE_FAILED");
        std::process::exit(1);
    }
}
