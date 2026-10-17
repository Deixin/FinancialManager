use financial_manager_desktop::{commands::LocalState, keys::WindowsKeyStore};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};
use tauri::Manager;
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Report {
    passed: bool,
    checks: BTreeMap<String, bool>,
}
struct Output(PathBuf);
#[tauri::command]
fn finish_lock_smoke(app: tauri::AppHandle, report: Report) -> Result<(), &'static str> {
    let expected = [
        "boot_locked_without_names",
        "wrong_pin_preserves_closed_view",
        "unlock_through_native_commands",
        "manual_and_blur_remove_financial_tree",
        "policy_and_disable_with_current_pin",
        "no_storage_or_egress",
    ];
    if report
        .checks
        .keys()
        .any(|key| !expected.contains(&key.as_str()))
    {
        app.exit(1);
        return Err("LOCK_SMOKE_INVALID");
    }
    std::fs::write(
        &app.state::<Output>().0,
        serde_json::to_vec_pretty(&report).map_err(|_| "REPORT_FAILED")?,
    )
    .map_err(|_| "REPORT_FAILED")?;
    if !report.passed
        || report.checks.len() != expected.len()
        || expected
            .iter()
            .any(|key| report.checks.get(*key) != Some(&true))
    {
        app.exit(1);
        return Err("LOCK_SMOKE_INVALID");
    }
    app.exit(0);
    Ok(())
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 3 {
        std::process::exit(1);
    }
    let mut context = tauri::generate_context!();
    let mut window = context.config_mut().app.windows.remove(0);
    window.visible = false;
    if tauri::Builder::default()
        .manage(Output(PathBuf::from(&args[0])))
        .manage(Arc::new(LocalState::new(
            PathBuf::from(&args[2]),
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
            finish_lock_smoke
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(false))
                && let Some(state) = window.try_state::<Arc<LocalState>>()
            {
                state.force_lock();
            }
        })
        .setup(move |app| {
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("lock-smoke-only")
                    .window("main")
                    .permission("allow-finish-lock-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .initialization_script(include_str!("../../lock-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context)
        .is_err()
    {
        eprintln!("LOCK_SMOKE_FAILED");
        std::process::exit(1);
    }
}
