//! Synthetic protocol entry point; never registered by the production host.
fn main() {
    let a = std::env::args().skip(1).collect::<Vec<_>>();
    if a.len() != 3 {
        std::process::exit(1)
    };
    match financial_manager_desktop::import_probe::run(&a[0], std::path::Path::new(&a[1])) {
        Ok(v) => {
            std::fs::write(&a[2], serde_json::to_vec_pretty(&v).unwrap()).unwrap();
        }
        Err(_) => {
            eprintln!("IMPORT_PROTOCOL_FAILED");
            std::process::exit(1);
        }
    }
}
