//! FIN-002 hidden WebView2 host; only the OS chooser is synthetic.
use financial_manager_desktop::{
    Result,
    commands::{self, LocalState},
    keys::WindowsKeyStore,
    restore_source::RestoreSource,
};
use std::{path::PathBuf, sync::Arc};
use tauri::Manager;
struct Source(PathBuf);
impl RestoreSource for Source {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Ok(Some(self.0.clone()))
    }
}
struct Output(PathBuf);
#[tauri::command]
fn finish_file_smoke(
    app: tauri::AppHandle,
    report: serde_json::Value,
) -> std::result::Result<(), &'static str> {
    let checks = [
        "gui_picker_unlock_validate",
        "locked_no_validation",
        "scoped_one_shot_selection",
        "cancel_preserves_ledger",
        "no_storage_or_egress",
    ];
    let passed = report["passed"] == true
        && report["checks"].as_object().is_some_and(|m| {
            m.len() == checks.len()
                && checks
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
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 4 {
        std::process::exit(1);
    }
    let mut context = tauri::generate_context!();
    let mut window = context.config_mut().app.windows.remove(0);
    window.visible = false;
    let state = LocalState::new(PathBuf::from(&args[2]), Arc::new(WindowsKeyStore))
        .with_import_source(Arc::new(Source(PathBuf::from(&args[3]))));
    let run = tauri::Builder::default()
        .manage(Output(PathBuf::from(&args[0])))
        .manage(Arc::new(state))
        .invoke_handler(tauri::generate_handler![
            commands::list_local_workspaces,
            commands::open_local_workspace,
            commands::local_lock_status,
            commands::lock_local_session,
            commands::unlock_local_session,
            commands::read_local_accounts,
            commands::read_local_movements,
            commands::list_local_imports,
            commands::read_local_import,
            commands::prepare_local_import,
            commands::local_import_file,
            finish_file_smoke
        ])
        .on_window_event(|w, e| {
            if matches!(e, tauri::WindowEvent::Focused(false))
                && let Some(state) = w.try_state::<Arc<LocalState>>()
            {
                state.on_focus_lost();
            }
        })
        .setup(move |app| {
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("file-smoke-only")
                    .window("main")
                    .permission("allow-finish-file-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .initialization_script(include_str!("../../file-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context);
    if run.is_err() {
        eprintln!("FILE_SMOKE_FAILED");
        std::process::exit(1);
    }
}
