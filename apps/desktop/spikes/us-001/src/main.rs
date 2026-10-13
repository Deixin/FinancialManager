use financial_manager_vault_spike::backup::RestoreCheckpoint;
use financial_manager_vault_spike::secrets::WindowsKeyStore;
use financial_manager_vault_spike::vault::{Installation, parse_id, preview};
use financial_manager_vault_spike::{Result, VaultError};
use serde_json::{Value, json};
use std::io::{self, IsTerminal, Read};
use std::path::Path;
use std::sync::Arc;
use zeroize::Zeroizing;

fn password() -> Result<Zeroizing<String>> {
    let mut secret = if io::stdin().is_terminal() {
        eprintln!("Senha do backup (12–1024 bytes):");
        Zeroizing::new(rpassword::read_password()?)
    } else {
        let mut text = Zeroizing::new(String::new());
        io::stdin().take(1026).read_to_string(&mut text)?;
        text
    };
    while secret.ends_with('\n') || secret.ends_with('\r') {
        secret.pop();
    }
    if !(12..=1024).contains(&secret.len()) {
        return Err(VaultError::Limit);
    }
    Ok(secret)
}

fn execute(args: &[String]) -> Result<Value> {
    if args.len() < 3 || args[0] != "--root" {
        return Err(VaultError::Invalid);
    }
    let installation = Installation::open(Path::new(&args[1]), Arc::new(WindowsKeyStore))?;
    let argument = |index: usize| args.get(index).ok_or(VaultError::Invalid);
    match args[2].as_str() {
        "create" if args.len() == 3 => Ok(json!({"workspace_id": installation.create_fixture()?})),
        "list" if args.len() == 3 => Ok(json!({"workspaces": installation.list()?})),
        "inspect" if args.len() == 4 => {
            let id = parse_id(argument(3)?)?;
            Ok(
                serde_json::to_value(preview(&installation.open_workspace(id)?)?)
                    .map_err(|_| VaultError::Invalid)?,
            )
        }
        "verify" if args.len() == 4 => {
            installation.verify_fixture(parse_id(argument(3)?)?)?;
            Ok(json!({"synthetic_fixture_verified": true}))
        }
        "remove-synthetic" if args.len() == 4 => {
            installation.remove_fixture(parse_id(argument(3)?)?)?;
            Ok(json!({"synthetic_fixture_removed": true}))
        }
        "backup" if args.len() == 5 => {
            installation.backup(
                parse_id(argument(3)?)?,
                Path::new(argument(4)?),
                password()?.as_bytes(),
            )?;
            Ok(json!({"backup_created": true}))
        }
        "preview" if args.len() == 4 => {
            let result =
                installation.preview_backup(Path::new(argument(3)?), password()?.as_bytes())?;
            serde_json::to_value(result).map_err(|_| VaultError::Invalid)
        }
        "restore" if args.len() == 5 && argument(4)? == "--confirm" => {
            let id = installation.restore(Path::new(argument(3)?), password()?.as_bytes())?;
            Ok(json!({"workspace_id": id}))
        }
        "restore-crash" if args.len() == 5 => {
            let stop = match argument(4)?.as_str() {
                "staged" => RestoreCheckpoint::Staged,
                "key-stored" => RestoreCheckpoint::KeyStored,
                _ => return Err(VaultError::Invalid),
            };
            installation.restore_with_checkpoint(
                Path::new(argument(3)?),
                password()?.as_bytes(),
                |step| {
                    if step == stop {
                        std::process::exit(86);
                    }
                    Ok(())
                },
            )?;
            Err(VaultError::Invalid)
        }
        _ => Err(VaultError::Invalid),
    }
}

fn main() {
    let arguments: Vec<_> = std::env::args().skip(1).collect();
    match execute(&arguments) {
        Ok(result) => println!("{result}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(1);
        }
    }
}
