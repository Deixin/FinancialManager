fn main() {
    #[cfg(target_env = "msvc")]
    println!("cargo:rustc-link-arg=/IGNORE:4099");
    const COMMANDS: &[&str] = if cfg!(all(feature = "entry-smoke", feature = "workspace-smoke")) {
        &[
            "list_local_workspaces",
            "create_local_workspace",
            "open_local_workspace",
            "local_lock_status",
            "lock_local_session",
            "unlock_local_session",
            "configure_local_pin",
            "disable_local_pin",
            "finish_entry_smoke",
            "finish_workspace_smoke",
        ]
    } else if cfg!(feature = "workspace-smoke") {
        &[
            "list_local_workspaces",
            "create_local_workspace",
            "open_local_workspace",
            "local_lock_status",
            "lock_local_session",
            "unlock_local_session",
            "configure_local_pin",
            "disable_local_pin",
            "finish_workspace_smoke",
        ]
    } else if cfg!(feature = "entry-smoke") {
        &[
            "list_local_workspaces",
            "create_local_workspace",
            "open_local_workspace",
            "local_lock_status",
            "lock_local_session",
            "unlock_local_session",
            "configure_local_pin",
            "disable_local_pin",
            "finish_entry_smoke",
        ]
    } else {
        &[
            "list_local_workspaces",
            "create_local_workspace",
            "open_local_workspace",
            "local_lock_status",
            "lock_local_session",
            "unlock_local_session",
            "configure_local_pin",
            "disable_local_pin",
        ]
    };
    let mut commands = COMMANDS.to_vec();
    commands.extend([
        "configure_local_hello",
        "unlock_local_hello",
        "create_local_backup",
        "select_local_backup",
        "preview_local_restore",
        "confirm_local_restore",
        "cancel_local_restore",
    ]);
    if cfg!(feature = "lock-smoke") {
        commands.push("finish_lock_smoke");
    }
    if cfg!(feature = "backup-smoke") {
        commands.push("finish_backup_smoke");
    }
    if cfg!(feature = "restore-smoke") {
        commands.push("finish_restore_smoke");
    }
    if cfg!(feature = "manager-smoke") {
        commands.push("finish_workspace_manager_smoke");
    }
    // The build helper requires static command metadata for this short-lived process.
    let commands = Box::leak(commands.into_boxed_slice());
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("DESKTOP_CONFIGURATION_INVALID");
}
