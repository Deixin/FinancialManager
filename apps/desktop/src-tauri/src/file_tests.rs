//! FIN-002 only. No real credentials or documents.
use crate::{commands::LocalState, keys::KeyStore, lock_store::PolicyStore, *};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};
use uuid::Uuid;
use zeroize::Zeroizing;
#[derive(Default)]
struct Keys(Mutex<HashMap<(Uuid, Uuid), SecretKey>>);
impl KeyStore for Keys {
    fn get(&self, i: Uuid, w: Uuid) -> Result<SecretKey> {
        self.0
            .lock()
            .unwrap()
            .get(&(i, w))
            .cloned()
            .ok_or(LocalError::KeyMissing)
    }
    fn put_new(&self, i: Uuid, w: Uuid, k: &SecretKey) -> Result<()> {
        let mut m = self.0.lock().unwrap();
        if m.contains_key(&(i, w)) {
            return Err(LocalError::RequestConflict);
        }
        m.insert((i, w), k.clone());
        Ok(())
    }
    fn delete(&self, i: Uuid, w: Uuid) -> Result<()> {
        self.0.lock().unwrap().remove(&(i, w));
        Ok(())
    }
}
#[derive(Default)]
struct Policies(Mutex<Option<Zeroizing<Vec<u8>>>>);
impl PolicyStore for Policies {
    fn read(&self, _: Uuid) -> Result<Option<Zeroizing<Vec<u8>>>> {
        Ok(self.0.lock().unwrap().clone())
    }
    fn write(&self, _: Uuid, bytes: &[u8]) -> Result<()> {
        *self.0.lock().unwrap() = Some(Zeroizing::new(bytes.to_vec()));
        Ok(())
    }
}
struct Source(Option<PathBuf>);
impl restore_source::RestoreSource for Source {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Ok(self.0.clone())
    }
}
pub(super) fn setup() -> (
    tempfile::TempDir,
    LocalState,
    String,
    String,
    PathBuf,
    Vec<u8>,
) {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("source");
    let keys = Arc::new(Keys::default());
    let i = vault_probe::fixture(&root, keys.clone()).unwrap();
    let w = vault_probe::dataset_workspace().to_string();
    i.open_workspace(&w).unwrap();
    let account = i
        .read_accounts(&w)
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.account.status == "ACTIVE")
        .unwrap()
        .account
        .id;
    let batch = import_probe::id(6000);
    i.prepare_import(&w, json!({"id":batch,"target_account_id":account}), || {
        Ok(())
    })
    .unwrap();
    let bytes = std::fs::read(vault_probe::vault_path(&root)).unwrap();
    drop(i);
    let file = temp.path().join("SYNTHETIC.csv");
    std::fs::write(&file, b"a,b\n1,2").unwrap();
    let state = LocalState::with_policies(root, keys, Arc::new(Policies::default()))
        .with_import_source(Arc::new(Source(Some(file.clone()))));
    (temp, state, w, batch, file, bytes)
}
pub(super) fn select(state: &LocalState, w: &str, b: &str) -> String {
    let job = state.begin_import_file(w, b).unwrap();
    let path = state.choose_import_file(&job, 1).unwrap();
    state.finish_import_file_selection(job, path).unwrap()["selection_id"]
        .as_str()
        .unwrap()
        .to_owned()
}
fn unchanged(state: &LocalState, w: &str, b: &str) {
    let value = state
        .read_import(w, json!({"id":b,"effect_after":null,"effect_limit":1}))
        .unwrap();
    assert_eq!(value["counts"]["total_items"], "0");
    assert_eq!(value["counts"]["total_effects"], "0");
    assert_eq!(value["sources"], json!([]));
}
#[test]
fn file_selection_requires_fresh_unlock_and_is_consumed_once() {
    let (t, state, w, b, _, before) = setup();
    let pin = "721947350682";
    state
        .configure(local_lock::ConfigurePin {
            current_pin: None,
            new_pin: pin.into(),
            confirm_pin: pin.into(),
        })
        .unwrap();
    state
        .unlock(local_lock::PinInput { pin: pin.into() })
        .unwrap();
    let token = select(&state, &w, &b);
    assert!(state.status().unwrap().locked);
    assert!(matches!(
        state.validate_import_file(&w, &b, &token, "utf-8", Some(",")),
        Err(LocalError::LocalLocked)
    ));
    state
        .unlock(local_lock::PinInput { pin: pin.into() })
        .unwrap();
    let result = state
        .validate_import_file(&w, &b, &token, "utf-8", Some(","))
        .unwrap();
    assert_eq!(result["result"]["outcome"], "VALIDATED");
    assert_eq!(result["workspace_id"], w);
    assert_eq!(result["selection_id"], token);
    assert!(
        state
            .validate_import_file(&w, &b, &token, "utf-8", Some(","))
            .is_err()
    );
    unchanged(&state, &w, &b);
    assert_eq!(
        before,
        std::fs::read(vault_probe::vault_path(&t.path().join("source"))).unwrap()
    );
}
#[test]
fn file_selection_scope_switch_and_explicit_cancel() {
    let (_t, state, w, b, _, _) = setup();
    let token = select(&state, &w, &b);
    assert!(
        state
            .validate_import_file(&w, &import_probe::id(6001), &token, "utf-8", Some(","))
            .is_err()
    );
    state.cancel_import_file(&import_probe::id(9999)).unwrap();
    assert_eq!(
        state
            .validate_import_file(&w, &b, &token, "utf-8", Some(","))
            .unwrap()["result"]["outcome"],
        "VALIDATED"
    );
    let token = select(&state, &w, &b);
    state.open(&w).unwrap();
    assert!(
        state
            .validate_import_file(&w, &b, &token, "utf-8", Some(","))
            .is_err()
    );
    let token = select(&state, &w, &b);
    state.cancel_import_file(&w).unwrap();
    assert!(
        state
            .validate_import_file(&w, &b, &token, "utf-8", Some(","))
            .is_err()
    );
    let job = state.begin_import_file(&w, &b).unwrap();
    state.force_lock();
    assert!(state.finish_import_file_selection(job, None).is_err());
    unchanged(&state, &w, &b);
}
#[test]
fn file_host_limits_reads_and_never_modifies_original() {
    let (t, state, w, b, path, _) = setup();
    let oversized = std::fs::OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&path)
        .unwrap();
    oversized.set_len(file_model::MAX_BYTES as u64 + 1).unwrap();
    drop(oversized);
    let token = select(&state, &w, &b);
    let result = state
        .validate_import_file(&w, &b, &token, "utf-8", Some(","))
        .unwrap();
    assert_eq!(result["result"]["code"], "FILE_LIMIT");
    assert_eq!(
        std::fs::metadata(&path).unwrap().len(),
        file_model::MAX_BYTES as u64 + 1
    );
    std::fs::write(&path, b"a,b\n1,\0").unwrap();
    let token = select(&state, &w, &b);
    assert_eq!(
        state
            .validate_import_file(&w, &b, &token, "utf-8", Some(","))
            .unwrap()["result"]["code"],
        "INVALID_CONTENT"
    );
    assert_eq!(std::fs::read_dir(t.path()).unwrap().count(), 2);
    unchanged(&state, &w, &b);
}
#[test]
fn file_cancelled_reads_return_safe_metadata_and_no_paths() {
    let (_t, state, w, b, path, _) = setup();
    let result = local_import_file::read_file(&path, "utf-8", Some(","), || false);
    assert_eq!(result, json!({"outcome":"REJECTED","code":"CANCELLED"}));
    let job = state.begin_import_file(&w, &b).unwrap();
    assert_eq!(
        state.finish_import_file_selection(job, None).unwrap(),
        json!({"selection_id":null})
    );
    unchanged(&state, &w, &b);
}
#[test]
fn file_input_contract_is_closed() {
    for raw in [
        r#"{"file_name":"\ud800.csv","mime":"","encoding":"utf-8","delimiter":","}"#,
        r#"{"file_name":"SYNTHETIC.csv","mime":"text/csv\udc00","encoding":"utf-8","delimiter":","}"#,
    ] {
        assert!(serde_json::from_str::<file_model::Metadata>(raw).is_err());
    }
    assert!(local_import_file::request(&json!({"action":"SELECT","batch_id":import_probe::id(6000),"path":"C:\\synthetic.csv"}),"SELECT",&["action","batch_id"]).is_err());
    let request: Value = json!({"action":"CANCEL"});
    assert!(local_import_file::request(&request, "CANCEL", &["action"]).is_ok());
}
