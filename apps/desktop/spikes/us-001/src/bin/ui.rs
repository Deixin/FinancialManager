use financial_manager_vault_spike::demo::{DemoReport, run_synthetic_demo as run_demo};
use std::path::PathBuf;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};
use tauri::Manager;

struct SmokeState {
    report_path: Option<PathBuf>,
    result: Mutex<Option<DemoReport>>,
    busy: Arc<AtomicBool>,
}

#[tauri::command]
async fn run_synthetic_demo(app: tauri::AppHandle) -> Result<DemoReport, String> {
    let parent = app
        .path()
        .app_local_data_dir()
        .map_err(|_| "APP_PATH_UNAVAILABLE")?;
    let busy = app.state::<SmokeState>().busy.clone();
    if busy.swap(true, Ordering::AcqRel) {
        return Err("DEMO_BUSY".into());
    }
    let result = tauri::async_runtime::spawn_blocking(move || {
        struct Reset(Arc<AtomicBool>);
        impl Drop for Reset {
            fn drop(&mut self) {
                self.0.store(false, Ordering::Release);
            }
        }
        let _reset = Reset(busy);
        run_demo(&parent)
    })
    .await
    .map_err(|_| "DEMO_EXECUTION_FAILED")?
    .map_err(|error| error.to_string())?;
    *app.state::<SmokeState>()
        .result
        .lock()
        .map_err(|_| "DEMO_STATE_UNAVAILABLE")? = Some(result.clone());
    Ok(result)
}

#[tauri::command]
fn finish_smoke(app: tauri::AppHandle) {
    let state = app.state::<SmokeState>();
    if let Some(path) = &state.report_path {
        let outcome = state.result.lock().ok().and_then(|report| report.clone());
        let written = outcome
            .as_ref()
            .and_then(|report| serde_json::to_vec_pretty(report).ok())
            .is_some_and(|bytes| std::fs::write(path, bytes).is_ok());
        app.exit(if written { 0 } else { 1 });
    }
}

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let report_path = match args.as_slice() {
        [] => None,
        [flag, path] if flag == "--smoke-report" => Some(PathBuf::from(path)),
        _ => {
            eprintln!("INVALID_SPIKE_ARGUMENTS");
            std::process::exit(1);
        }
    };
    let smoke = report_path.is_some();
    let builder = tauri::Builder::default().manage(SmokeState { report_path, result: Mutex::new(None), busy: Arc::new(AtomicBool::new(false)) })
        .invoke_handler(tauri::generate_handler![run_synthetic_demo, finish_smoke])
        .setup(move |app| {
            let window = app.get_webview_window("main").ok_or("SPIKE_WINDOW_UNAVAILABLE")?;
            if smoke { window.eval("window.addEventListener('load', () => window.runSmoke()); if (document.readyState === 'complete') window.runSmoke();")?; }
            else { window.show()?; }
            Ok(())
        });
    if builder.run(tauri::generate_context!()).is_err() {
        eprintln!("TAURI_SPIKE_FAILED");
        std::process::exit(1);
    }
}
