fn main() {
    // openssl-src does not distribute its MSVC PDB. Suppress only missing third-party
    // debug symbols; executable linking and all code warnings remain checked.
    #[cfg(target_env = "msvc")]
    println!("cargo:rustc-link-arg=/IGNORE:4099");
    #[cfg(feature = "desktop-ui")]
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["run_synthetic_demo", "finish_smoke"]),
    ))
    .expect("Tauri spike configuration is invalid");
}
