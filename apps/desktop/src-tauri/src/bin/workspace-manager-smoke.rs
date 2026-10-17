use financial_manager_desktop::{commands::LocalState, keys::WindowsKeyStore};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};
use tauri::Manager;
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Report {
    passed: bool,
    checks: BTreeMap<String, bool>,
}
struct Output(PathBuf);
#[tauri::command]
fn finish_workspace_manager_smoke(
    app: tauri::AppHandle,
    report: Report,
) -> std::result::Result<(), &'static str> {
    let expected = [
        "catalog_purpose_local_and_cloud_unavailable",
        "create_multiple_and_cancel",
        "switch_resets_context_and_route",
        "full_selector_after_reentry",
        "no_storage_or_egress",
    ];
    if report
        .checks
        .keys()
        .any(|key| !expected.contains(&key.as_str()))
    {
        app.exit(1);
        return Err("WORKSPACE_MANAGER_SMOKE_INVALID");
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
        Err("WORKSPACE_MANAGER_SMOKE_INVALID")
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
        .manage(Arc::new(LocalState::new(
            root.clone(),
            Arc::new(WindowsKeyStore),
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
            finish_workspace_manager_smoke
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
                tauri::ipc::CapabilityBuilder::new("workspace-manager-smoke-only")
                    .window("main")
                    .permission("allow-finish-workspace-manager-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .initialization_script(include_str!("../../workspace-manager-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context)
        .is_err()
    {
        eprintln!("WORKSPACE_MANAGER_SMOKE_FAILED");
        std::process::exit(1);
    }
}
