#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if financial_manager_desktop::commands::production_builder()
        .run(tauri::generate_context!())
        .is_err()
    {
        eprintln!("DESKTOP_START_FAILED");
        std::process::exit(1);
    }
}
