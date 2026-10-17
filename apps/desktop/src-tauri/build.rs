fn main() {
    let commands = if cfg!(feature = "entry-smoke") {
        &["finish_entry_smoke"][..]
    } else {
        &[][..]
    };
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("DESKTOP_CONFIGURATION_INVALID");
}
