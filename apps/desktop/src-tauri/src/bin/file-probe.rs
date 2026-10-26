//! Explicitly synthetic host probe, never registered in production IPC.
use financial_manager_desktop::file_model::{self, Metadata};
use serde_json::{Value, json};
fn main() {
    if let Err(()) = run() {
        eprintln!("FILE_PROTOCOL_FAILED");
        std::process::exit(1);
    }
}
fn run() -> Result<(), ()> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 2 {
        return Err(());
    }
    let vectors: Vec<Value> =
        serde_json::from_slice(&std::fs::read(&args[0]).map_err(|_| ())?).map_err(|_| ())?;
    let output = vectors
        .into_iter()
        .map(|v| {
            let result = || -> file_model::Check<_> {
                let metadata: Metadata =
                    serde_json::from_value(v["request"].clone()).map_err(|_| "INVALID_REQUEST")?;
                let destination = if v["mode"] == "OFX_NORMALIZE" {
                    Some(
                            serde_json::from_value::<
                                financial_manager_desktop::ofx_model::Destination,
                            >(v["destination"].clone())
                            .map_err(|_| "INVALID_DESTINATION")?,
                        )
                } else {
                    None
                };
                let bytes = if v["recipe"] == "CSV_16MIB" {
                    let row = [
                        "x".repeat(1023),
                        "y".repeat(1023),
                        "z".repeat(1023),
                        "w".repeat(1023),
                    ]
                    .join(",")
                        + "\n";
                    ("a,b,c,d\n".to_owned()
                        + &row.repeat(4095)
                        + &[
                            "x".repeat(1021),
                            "y".repeat(1021),
                            "z".repeat(1021),
                            "w".repeat(1022),
                        ]
                        .join(","))
                        .into_bytes()
                } else if let Some(text) = v["text"].as_str() {
                    if metadata.encoding == "windows-1252" {
                        text.chars()
                            .map(|c| if c == '€' { 0x80 } else { c as u8 })
                            .collect::<Vec<_>>()
                    } else {
                        text.as_bytes().to_vec()
                    }
                } else if let Some(length) = v["zeros"].as_u64() {
                    if length > file_model::MAX_BYTES as u64 + 1 {
                        return Err("INVALID_REQUEST");
                    }
                    vec![0; length as usize]
                } else {
                    serde_json::from_value::<Vec<u8>>(v["bytes"].clone())
                        .map_err(|_| "INVALID_REQUEST")?
                };
                if let Some(destination) = destination {
                    financial_manager_desktop::ofx_model::parse(
                        &metadata,
                        &bytes,
                        &destination,
                        || v["cancelled"] != true,
                    )
                } else {
                    file_model::validate(&metadata, &bytes, || v["cancelled"] != true)
                        .map(|v| serde_json::to_value(v).expect("INSPECTION_SERIALIZE"))
                }
            };
            match result() {
                Ok(inspection) => json!({"name":v["name"],"result":inspection}),
                Err(code) => json!({"name":v["name"],"error":code}),
            }
        })
        .collect::<Vec<_>>();
    std::fs::write(&args[1], serde_json::to_vec(&output).map_err(|_| ())?).map_err(|_| ())
}
