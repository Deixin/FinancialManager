fn main() {
    #[cfg(target_env = "msvc")]
    println!("cargo:rustc-link-arg=/IGNORE:4099");
    const COMMANDS: &[&str] = if cfg!(all(feature = "entry-smoke", feature = "workspace-smoke")) {
        &[
            "list_local_workspaces",
            "create_local_workspace",
            "open_local_workspace",
            "finish_entry_smoke",
            "finish_workspace_smoke",
        ]
    } else if cfg!(feature = "workspace-smoke") {
        &[
            "list_local_workspaces",
            "create_local_workspace",
            "open_local_workspace",
            "finish_workspace_smoke",
        ]
    } else if cfg!(feature = "entry-smoke") {
        &[
            "list_local_workspaces",
            "create_local_workspace",
            "open_local_workspace",
            "finish_entry_smoke",
        ]
    } else {
        &[
            "list_local_workspaces",
            "create_local_workspace",
            "open_local_workspace",
        ]
    };
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("DESKTOP_CONFIGURATION_INVALID");
}
