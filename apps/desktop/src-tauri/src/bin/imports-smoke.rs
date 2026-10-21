//! SYNTHETIC US050 hidden WebView2 host with one deliberately lost acknowledgement.
use financial_manager_desktop::{
    LocalError,
    commands::{self, LocalState},
    keys::WindowsKeyStore,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::Manager;
struct Output(PathBuf);
#[derive(Default)]
struct Fault(Mutex<Option<serde_json::Value>>);
#[tauri::command]
async fn prepare_local_import(
    state: tauri::State<'_, Arc<LocalState>>,
    fault: tauri::State<'_, Fault>,
    workspace_id: String,
    input: serde_json::Value,
) -> Result<serde_json::Value, LocalError> {
    let i = input.clone();
    let state = state.inner().clone();
    let r = tauri::async_runtime::spawn_blocking(move || state.prepare_import(&workspace_id, i))
        .await
        .map_err(|_| LocalError::StorageUnavailable)??;
    let mut prior = fault.0.lock().map_err(|_| LocalError::StorageUnavailable)?;
    if prior.is_none() {
        *prior = Some(input);
        return Err(LocalError::StorageUnavailable);
    }
    if prior.as_ref() != Some(&input) {
        return Err(LocalError::InvalidImportRequest);
    }
    Ok(r)
}
#[tauri::command]
fn finish_imports_smoke(
    app: tauri::AppHandle,
    report: serde_json::Value,
) -> Result<(), &'static str> {
    let expected = [
        "list_filter_detail",
        "revision_link",
        "lost_ack_same_intent",
        "workspace_isolation",
        "lock_hides_tree",
        "no_storage_or_egress",
    ];
    let passed = report["passed"] == true
        && report["checks"].as_object().is_some_and(|m| {
            m.len() == expected.len()
                && expected
                    .iter()
                    .all(|k| m.get(*k) == Some(&serde_json::json!(true)))
        });
    std::fs::write(
        &app.state::<Output>().0,
        serde_json::to_vec_pretty(&report).map_err(|_| "REPORT_FAILED")?,
    )
    .map_err(|_| "REPORT_FAILED")?;
    app.exit(if passed { 0 } else { 1 });
    Ok(())
}
fn main() {
    let a = std::env::args().skip(1).collect::<Vec<_>>();
    if a.len() != 3 {
        std::process::exit(1)
    }
    let mut context = tauri::generate_context!();
    let mut window = context.config_mut().app.windows.remove(0);
    window.visible = false;
    let result = tauri::Builder::default()
        .manage(Output(PathBuf::from(&a[0])))
        .manage(Fault::default())
        .manage(Arc::new(LocalState::new(
            PathBuf::from(&a[2]),
            Arc::new(WindowsKeyStore),
        )))
        .invoke_handler(tauri::generate_handler![
            commands::list_local_workspaces,
            commands::create_local_workspace,
            commands::open_local_workspace,
            commands::local_lock_status,
            commands::configure_local_pin,
            commands::unlock_local_session,
            commands::lock_local_session,
            commands::read_local_accounts,
            commands::read_local_movements,
            commands::list_local_imports,
            commands::read_local_import,
            prepare_local_import,
            finish_imports_smoke
        ])
        .on_window_event(|w, e| {
            if matches!(e, tauri::WindowEvent::Focused(false))
                && let Some(s) = w.try_state::<Arc<LocalState>>()
            {
                s.on_focus_lost();
            }
        })
        .setup(move |app| {
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("imports-smoke-only")
                    .window("main")
                    .permission("allow-finish-imports-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&a[1]))
                .initialization_script(include_str!("../../imports-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context);
    if result.is_err() {
        eprintln!("IMPORT_SMOKE_FAILED");
        std::process::exit(1)
    }
}
