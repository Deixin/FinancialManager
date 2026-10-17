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
fn finish_workspace_smoke(app: tauri::AppHandle, report: Report) -> Result<(), &'static str> {
    let expected = [
        "local_form_without_identity",
        "created_via_narrow_ipc",
        "empty_overview_without_fake_balance",
        "reopened_or_listed",
        "no_web_storage_or_egress",
    ];
    if !report.passed
        || report.checks.len() != expected.len()
        || expected
            .iter()
            .any(|key| report.checks.get(*key) != Some(&true))
    {
        app.exit(1);
        return Err("WORKSPACE_SMOKE_INVALID");
    }
    std::fs::write(
        &app.state::<Output>().0,
        serde_json::to_vec_pretty(&report).map_err(|_| "REPORT_FAILED")?,
    )
    .map_err(|_| "REPORT_FAILED")?;
    app.exit(0);
    Ok(())
}
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.len() != 4 {
        std::process::exit(1);
    }
    let output = PathBuf::from(&args[0]);
    let profile = PathBuf::from(&args[1]);
    let root = PathBuf::from(&args[2]);
    let mode = args[3].clone();
    let mut context = tauri::generate_context!();
    let mut window = context.config_mut().app.windows.remove(0);
    window.visible = false;
    if tauri::Builder::default()
        .manage(Output(output))
        .manage(Arc::new(LocalState::new(root, Arc::new(WindowsKeyStore))))
        .invoke_handler(tauri::generate_handler![
            financial_manager_desktop::commands::list_local_workspaces,
            financial_manager_desktop::commands::create_local_workspace,
            financial_manager_desktop::commands::open_local_workspace,
            financial_manager_desktop::commands::local_lock_status,
            financial_manager_desktop::commands::lock_local_session,
            financial_manager_desktop::commands::unlock_local_session,
            financial_manager_desktop::commands::configure_local_pin,
            financial_manager_desktop::commands::disable_local_pin,
            finish_workspace_smoke
        ])
        .setup(move |app| {
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("workspace-smoke-only")
                    .window("main")
                    .permission("allow-finish-workspace-smoke"),
            )?;
            let script =
                include_str!("../../workspace-smoke.js").replace("__WORKSPACE_SMOKE_MODE__", &mode);
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(profile)
                .initialization_script(script)
                .build()?;
            Ok(())
        })
        .run(context)
        .is_err()
    {
        eprintln!("WORKSPACE_SMOKE_FAILED");
        std::process::exit(1);
    }
}
