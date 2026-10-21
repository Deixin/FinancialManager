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
    if cfg!(feature = "imports-smoke") {
        commands.push("finish_imports_smoke");
    }
    commands.extend([
        "configure_local_hello",
        "unlock_local_hello",
        "create_local_backup",
        "select_local_backup",
        "preview_local_restore",
        "confirm_local_restore",
        "cancel_local_restore",
        "read_local_accounts",
        "apply_local_account_change",
        "read_local_movements",
        "apply_local_manual_movement",
        "read_local_transfers",
        "apply_local_transfer",
        "read_local_card_payments",
        "apply_local_card_payment",
        "read_local_taxonomy",
        "apply_local_taxonomy_change",
        "read_local_categories",
        "apply_local_category_change",
        "apply_local_classification_change",
        "apply_local_allocation_change",
        "read_local_counterparties",
        "apply_local_counterparty_change",
        "apply_local_counterparty_association",
        "list_local_imports",
        "read_local_import",
        "prepare_local_import",
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
    if cfg!(feature = "accounts-smoke") {
        commands.push("finish_accounts_smoke");
    }
    if cfg!(feature = "movements-smoke") {
        commands.push("finish_movements_smoke");
    }
    if cfg!(feature = "transfers-smoke") {
        commands.push("finish_transfers_smoke");
    }
    if cfg!(feature = "card-payments-smoke") {
        commands.push("finish_card_payments_smoke");
    }
    if cfg!(feature = "categories-smoke") {
        commands.push("finish_categories_smoke");
    }
    if cfg!(feature = "taxonomy-smoke") {
        commands.push("finish_taxonomy_smoke");
        commands.push("finish_classification_filters_smoke");
    }
    if cfg!(feature = "counterparties-smoke") {
        commands.push("finish_counterparties_smoke");
    }
    if cfg!(feature = "allocations-smoke") {
        commands.push("finish_allocations_smoke");
    }
    if cfg!(feature = "classification-smoke") {
        commands.push("finish_classification_smoke");
    }
    // The build helper requires static command metadata for this short-lived process.
    let commands = Box::leak(commands.into_boxed_slice());
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(commands)),
    )
    .expect("DESKTOP_CONFIGURATION_INVALID");
}
