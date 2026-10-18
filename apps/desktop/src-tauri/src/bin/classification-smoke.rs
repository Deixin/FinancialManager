//! SYNTHETIC_US045_CLASSIFICATION_ONLY. Hidden host with an explicit lost-ACK fault.
use financial_manager_desktop::{
    LocalError,
    classification_model::{Command, Selection},
    commands::LocalState,
    keys::WindowsKeyStore,
    local_classification::ClassificationResult,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::Manager;
struct Output(PathBuf);
#[derive(Default)]
struct Fault {
    intent: Mutex<Option<Vec<u8>>>,
    replayed: AtomicBool,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Report {
    passed: bool,
    checks: BTreeMap<String, bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failure_stage: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failure_code: Option<String>,
}
#[tauri::command]
async fn apply_local_classification_change(
    state: tauri::State<'_, Arc<LocalState>>,
    fault: tauri::State<'_, Arc<Fault>>,
    workspace_id: String,
    input: Vec<Command>,
) -> Result<ClassificationResult, LocalError> {
    let candidate = input.iter().any(|c| {
        c.base.id == "0199d345-0000-7000-8000-000000000810"
            && matches!(c.classification, Selection::Set { .. })
    });
    let bytes = serde_json::to_vec(&input).map_err(|_| LocalError::InvalidClassification)?;
    let native = state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        native.apply_classification(&workspace_id, input)
    })
    .await
    .map_err(|_| LocalError::StorageUnavailable)?;
    if candidate {
        let mut intent = fault
            .intent
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?;
        if intent.is_none() && result.is_ok() {
            *intent = Some(bytes);
            return Err(LocalError::StorageUnavailable);
        }
        if intent.as_ref() == Some(&bytes) && matches!(result, Err(LocalError::VersionConflict)) {
            fault.replayed.store(true, Ordering::SeqCst);
        }
    }
    result
}
#[tauri::command]
fn finish_classification_smoke(app: tauri::AppHandle, report: Report) -> Result<(), &'static str> {
    let expected = [
        "import_lost_ack_frozen_base",
        "paired_transfer_and_card",
        "split_tags_preserve_allocations",
        "clear_noop_and_history",
        "workspace_isolation",
        "lock_removes_editor_tree",
        "no_storage_or_egress",
    ];
    let passed = report.passed
        && report.failure_stage.is_none()
        && report.failure_code.is_none()
        && report.checks.len() == expected.len()
        && expected
            .iter()
            .all(|k| report.checks.get(*k) == Some(&true))
        && app.state::<Arc<Fault>>().replayed.load(Ordering::SeqCst);
    std::fs::write(
        &app.state::<Output>().0,
        serde_json::to_vec_pretty(&report).map_err(|_| "REPORT_FAILED")?,
    )
    .map_err(|_| "REPORT_FAILED")?;
    app.exit(if passed { 0 } else { 1 });
    if passed {
        Ok(())
    } else {
        Err("CLASSIFICATION_SMOKE_FAILED")
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
        .manage(Arc::new(Fault::default()))
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
            apply_local_classification_change,
            finish_classification_smoke
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
                tauri::ipc::CapabilityBuilder::new("classification-smoke-only")
                    .window("main")
                    .permission("allow-finish-classification-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .initialization_script(include_str!("../../classification-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context);
    if result.is_err() {
        eprintln!("CLASSIFICATION_SMOKE_FAILED");
        std::process::exit(1)
    }
}
