use financial_manager_desktop::{
    LocalError, commands::LocalState, keys::WindowsKeyStore, local_movements::MovementResult,
    movement_model::ManualCommand,
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
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Report {
    passed: bool,
    checks: BTreeMap<String, bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    failure_stage: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    progress: Option<bool>,
}
struct Output(PathBuf);
#[derive(Default)]
struct LostAcknowledgement {
    intent: Mutex<Option<Vec<u8>>>,
    replayed: AtomicBool,
}
// Test-only transport fault: execute the product operation, then lose its first
// CREATE acknowledgement. Tauri's immutable invoke function cannot be patched.
#[tauri::command]
async fn apply_local_manual_movement(
    state: tauri::State<'_, Arc<LocalState>>,
    fault: tauri::State<'_, Arc<LostAcknowledgement>>,
    workspace_id: String,
    input: ManualCommand,
) -> Result<MovementResult, LocalError> {
    let create = matches!(input, ManualCommand::Create { .. });
    let bytes = serde_json::to_vec(&input).map_err(|_| LocalError::InvalidManualMovement)?;
    if create {
        let prior = fault
            .intent
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?;
        if prior.as_ref() == Some(&bytes) {
            fault.replayed.store(true, Ordering::SeqCst);
        }
    }
    let state = state.inner().clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        state.apply_manual_movement(&workspace_id, input)
    })
    .await
    .map_err(|_| LocalError::StorageUnavailable)??;
    if create {
        let mut intent = fault
            .intent
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?;
        match intent.as_ref() {
            None => {
                *intent = Some(bytes);
                return Err(LocalError::StorageUnavailable);
            }
            Some(previous) if *previous == bytes && !result.changed => {
                fault.replayed.store(true, Ordering::SeqCst);
            }
            _ => {}
        }
    }
    Ok(result)
}
#[tauri::command]
fn finish_movements_smoke(
    app: tauri::AppHandle,
    report: Report,
) -> std::result::Result<(), &'static str> {
    let expected = [
        "crud_history_and_soft_deletion",
        "explicit_adjustment",
        "lost_ack_frozen_intent",
        "workspace_isolation",
        "lock_removes_financial_data",
        "no_storage_or_egress",
    ];
    if report
        .checks
        .keys()
        .any(|key| !expected.contains(&key.as_str()))
    {
        app.exit(1);
        return Err("MOVEMENTS_SMOKE_INVALID");
    }
    std::fs::write(
        &app.state::<Output>().0,
        serde_json::to_vec_pretty(&report).map_err(|_| "REPORT_FAILED")?,
    )
    .map_err(|_| "REPORT_FAILED")?;
    if report.progress == Some(true) && report.failure_stage.is_some_and(|s| (1..=6).contains(&s)) {
        return Ok(());
    }
    let passed = report.passed
        && app
            .state::<Arc<LostAcknowledgement>>()
            .replayed
            .load(Ordering::SeqCst)
        && report.checks.len() == expected.len()
        && expected
            .iter()
            .all(|key| report.checks.get(*key) == Some(&true));
    app.exit(if passed { 0 } else { 1 });
    if passed {
        Ok(())
    } else {
        Err("MOVEMENTS_SMOKE_INVALID")
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
        .manage(Arc::new(LostAcknowledgement::default()))
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
            financial_manager_desktop::commands::read_local_accounts,
            financial_manager_desktop::commands::apply_local_account_change,
            financial_manager_desktop::commands::read_local_movements,
            apply_local_manual_movement,
            finish_movements_smoke
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
                tauri::ipc::CapabilityBuilder::new("movements-smoke-only")
                    .window("main")
                    .permission("allow-finish-movements-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window)?
                .data_directory(PathBuf::from(&args[1]))
                .initialization_script(include_str!("../../movements-smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context)
        .is_err()
    {
        eprintln!("MOVEMENTS_SMOKE_FAILED");
        std::process::exit(1);
    }
}
