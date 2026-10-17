use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};
use tauri::Manager;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SmokeReport {
    passed: bool,
    checks: BTreeMap<String, bool>,
}

struct SmokeState(PathBuf);

#[tauri::command]
fn finish_entry_smoke(app: tauri::AppHandle, report: SmokeReport) -> Result<(), &'static str> {
    const CHECKS: [&str; 6] = [
        "embedded_entry",
        "cloud_disabled_offline",
        "local_without_identity",
        "local_heading_focus",
        "return_to_entry",
        "no_network_or_storage",
    ];
    if !report.passed
        || report.checks.len() != CHECKS.len()
        || CHECKS
            .iter()
            .any(|key| report.checks.get(*key) != Some(&true))
    {
        app.exit(1);
        return Err("ENTRY_SMOKE_REJECTED");
    }
    let bytes = serde_json::to_vec_pretty(&report).map_err(|_| "ENTRY_SMOKE_INVALID")?;
    std::fs::write(&app.state::<SmokeState>().0, bytes).map_err(|_| "ENTRY_SMOKE_WRITE_FAILED")?;
    app.exit(0);
    Ok(())
}

fn main() {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() != 2 {
        eprintln!("ENTRY_SMOKE_ARGUMENTS_INVALID");
        std::process::exit(1);
    }
    let report_path = PathBuf::from(&args[0]);
    let profile = PathBuf::from(&args[1]);
    let mut context = tauri::generate_context!();
    let mut window_config = context.config_mut().app.windows.remove(0);
    window_config.visible = false;
    let result = tauri::Builder::default()
        .manage(SmokeState(report_path))
        .invoke_handler(tauri::generate_handler![finish_entry_smoke])
        .setup(move |app| {
            app.add_capability(
                tauri::ipc::CapabilityBuilder::new("entry-smoke-only")
                    .window("main")
                    .permission("allow-finish-entry-smoke"),
            )?;
            tauri::WebviewWindowBuilder::from_config(app, &window_config)?
                .data_directory(profile)
                .initialization_script(include_str!("../../smoke.js"))
                .build()?;
            Ok(())
        })
        .run(context);
    if result.is_err() {
        eprintln!("ENTRY_SMOKE_RUNTIME_FAILED");
        std::process::exit(1);
    }
}
