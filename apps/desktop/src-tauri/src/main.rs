#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if tauri::Builder::default()
        .run(tauri::generate_context!())
        .is_err()
    {
        eprintln!("DESKTOP_START_FAILED");
        std::process::exit(1);
    }
}
