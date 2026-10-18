//! SYNTHETIC_US045_FILTERS_ONLY. Hidden WebView2 host using the product read command.
use financial_manager_desktop::{commands::LocalState, keys::WindowsKeyStore};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf, sync::Arc};
use tauri::Manager;
struct Output(PathBuf);
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Report {
    passed: bool,
    checks: BTreeMap<String, bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failure_stage: Option<u8>,
}
#[tauri::command]
fn finish_classification_filters_smoke(
    app: tauri::AppHandle,
    report: Report,
) -> Result<(), &'static str> {
    let expected = [
        "complete_filter_read",
        "category_subcategory_and_tags",
        "workspace_isolation",
        "lock_removes_tree",
        "no_storage_or_egress",
    ];
    let passed = report.passed
        && report.checks.len() == expected.len()
        && expected
            .iter()
            .all(|k| report.checks.get(*k) == Some(&true));
    std::fs::write(
        &app.state::<Output>().0,
        serde_json::to_vec_pretty(&report).map_err(|_| "REPORT_FAILED")?,
    )
    .map_err(|_| "REPORT_FAILED")?;
    app.exit(if passed { 0 } else { 1 });
    if passed {
        Ok(())
    } else {
        Err("FILTER_SMOKE_FAILED")
    }
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 3 {
        std::process::exit(1)
    }
    let mut context = tauri::generate_context!();
    let mut window = context.config_mut().app.windows.remove(0);
    window.visible = false;
    let result = tauri::Builder::default()
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
            financial_manager_desktop::commands::configure_local_hello,
            financial_manager_desktop::commands::unlock_local_hello,
            financial_manager_desktop::commands::read_local_movements,
            finish_classification_filters_smoke
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
                tauri::ipc::CapabilityBuilder::new("classification-filters-smoke-only")
                    .window("main")
                    .permission("allow-finish-classification-filters-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .initialization_script(include_str!("../../classification-filters-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context);
    if result.is_err() {
        eprintln!("FILTER_SMOKE_FAILED");
        std::process::exit(1)
    }
}
