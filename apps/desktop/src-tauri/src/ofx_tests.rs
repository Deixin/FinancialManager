//! FIN-002 synthetic only; no original or ledger mutation by normalization.
use crate::{
    file_tests::{select, setup},
    *,
};
use serde_json::{Value, json};
use std::{cell::Cell, path::PathBuf, sync::Arc};
struct Source(PathBuf);
impl restore_source::RestoreSource for Source {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Ok(Some(self.0.clone()))
    }
}
fn text() -> String {
    concat!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<?OFX OFXHEADER=\"200\" VERSION=\"203\" SECURITY=\"NONE\" OLDFILEUID=\"NONE\" NEWFILEUID=\"NONE\"?>\n",
"<OFX><BANKMSGSRSV1><STMTTRNRS><STATUS><CODE>0</CODE><SEVERITY>INFO</SEVERITY></STATUS><STMTRS><CURDEF>BRL</CURDEF><BANKACCTFROM><BANKID>999</BANKID><ACCTID>SYNTHETIC-ONLY</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM><BANKTRANLIST><DTSTART>20261001</DTSTART><DTEND>20261101</DTEND><STMTTRN><TRNTYPE>XFER</TRNTYPE><DTPOSTED>20261025</DTPOSTED><TRNAMT>-1.23</TRNAMT><FITID>SYNTHETIC-1</FITID><MEMO>SYNTHETIC OFX private row</MEMO></STMTTRN><STMTTRN><TRNTYPE>OTHER</TRNTYPE><DTPOSTED>20261025</DTPOSTED><TRNAMT>invalid</TRNAMT><MEMO>SYNTHETIC INVALID</MEMO></STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>").to_owned()
}
fn unchanged(state: &commands::LocalState, w: &str, b: &str) {
    let detail = state
        .read_import(w, json!({"id":b,"effect_after":null,"effect_limit":1}))
        .unwrap();
    assert_eq!(detail["counts"]["total_items"], "0");
    assert_eq!(detail["sources"], json!([]));
    assert_eq!(detail["effects"], json!([]));
}
#[test]
fn selected_snapshot_normalizes_without_vault_or_original_mutation() {
    let (t, state, w, b, old, before) = setup();
    let path = old.with_extension("ofx");
    let original = text();
    std::fs::write(&path, &original).unwrap();
    let state = state.with_import_source(Arc::new(Source(path.clone())));
    let id = select(&state, &w, &b);
    let result = state
        .validate_import_file(&w, &b, &id, "utf-8", None)
        .unwrap();
    let model = &result["result"]["normalization"];
    assert_eq!(model["destination"]["workspace_id"], w);
    assert_eq!(model["items"][0]["normalized_amount_minor"], "-123");
    assert_eq!(model["items"][0]["source_transaction_type"], "XFER");
    assert_eq!(model["items"][1]["disposition"], "INVALID");
    assert_eq!(
        model["source"]["file_hash"],
        ofx_model::hash(original.as_bytes())
    );
    assert!(
        state
            .validate_import_file(&w, &b, &id, "utf-8", None)
            .is_err()
    );
    unchanged(&state, &w, &b);
    assert_eq!(std::fs::read_to_string(path).unwrap(), original);
    assert_eq!(
        std::fs::read(vault_probe::vault_path(&t.path().join("source"))).unwrap(),
        before
    );
}
#[test]
fn account_archived_after_selection_is_rejected() {
    let (_t, state, w, b, old, _) = setup();
    let path = old.with_extension("ofx");
    std::fs::write(&path, text()).unwrap();
    let state = state.with_import_source(Arc::new(Source(path)));
    let id = select(&state, &w, &b);
    let target = state
        .read_import(&w, json!({"id":b,"effect_after":null,"effect_limit":1}))
        .unwrap()["batch"]["target_account_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let account = state
        .read_accounts(&w)
        .unwrap()
        .accounts
        .into_iter()
        .find(|a| a.account.id == target)
        .unwrap()
        .account;
    let change=serde_json::from_value(json!({"kind":"UPDATE","base":account,"name":account.name,"institution_name":account.institution_name,"status":"ARCHIVED"})).unwrap();
    state.apply_account_change(&w, change).unwrap();
    assert!(matches!(
        state.validate_import_file(&w, &b, &id, "utf-8", None),
        Err(LocalError::ImportAccountUnavailable)
    ));
    unchanged(&state, &w, &b);
}
#[test]
fn locked_or_foreign_batch_never_exposes_normalized_data() {
    let (_t, state, w, b, old, _) = setup();
    let path = old.with_extension("ofx");
    std::fs::write(&path, text()).unwrap();
    let state = state.with_import_source(Arc::new(Source(path)));
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
    let id = select(&state, &w, &b);
    assert!(matches!(
        state.validate_import_file(&w, &b, &id, "utf-8", None),
        Err(LocalError::LocalLocked)
    ));
    state
        .unlock(local_lock::PinInput { pin: pin.into() })
        .unwrap();
    assert!(
        state
            .validate_import_file(&w, &import_probe::id(9999), &id, "utf-8", None)
            .is_err()
    );
    state.cancel_import_file(&w).unwrap();
    assert!(
        state
            .validate_import_file(&w, &b, &id, "utf-8", None)
            .is_err()
    );
    unchanged(&state, &w, &b);
}
#[test]
fn source_rejection_and_scope_switch_preserve_ledger() {
    let (_t, state, w, b, old, _) = setup();
    let path = old.with_extension("ofx");
    std::fs::write(&path, text().replace("BRL", "USD")).unwrap();
    let state = state.with_import_source(Arc::new(Source(path)));
    let id = select(&state, &w, &b);
    assert_eq!(
        state
            .validate_import_file(&w, &b, &id, "utf-8", None)
            .unwrap()["result"],
        json!({"outcome":"REJECTED","code":"CURRENCY_MISMATCH"})
    );
    let id = select(&state, &w, &b);
    state.open(&w).unwrap();
    assert!(
        state
            .validate_import_file(&w, &b, &id, "utf-8", None)
            .is_err()
    );
    unchanged(&state, &w, &b);
}
#[test]
fn cancellation_during_semantic_scan_is_safe_and_deterministic() {
    let metadata = file_model::Metadata {
        file_name: "SYNTHETIC.ofx".into(),
        mime: String::new(),
        encoding: "utf-8".into(),
        delimiter: None,
    };
    let d = ofx_model::Destination {
        workspace_id: import_probe::id(1),
        account_id: import_probe::id(2),
        balance_nature: "ASSET".into(),
        currency: "BRL".into(),
    };
    let gate = Cell::new(0);
    file_model::validate(&metadata, text().as_bytes(), || {
        gate.set(gate.get() + 1);
        true
    })
    .unwrap();
    let ticks = Cell::new(0);
    let result = ofx_model::parse(&metadata, text().as_bytes(), &d, || {
        ticks.set(ticks.get() + 1);
        ticks.get() < gate.get() * 2 + 10
    });
    assert_eq!(result, Err("CANCELLED"));
    let a = ofx_model::parse(&metadata, text().as_bytes(), &d, || true).unwrap();
    assert_eq!(
        a,
        ofx_model::parse(&metadata, text().as_bytes(), &d, || true).unwrap()
    );
    let mut foreign = d;
    foreign.balance_nature = "LIABILITY".into();
    assert_eq!(
        ofx_model::parse(&metadata, text().as_bytes(), &foreign, || true),
        Err("ACCOUNT_KIND_MISMATCH")
    );
}
#[test]
fn destination_and_provenance_contract_remains_closed() {
    let value: Value = json!({"workspace_id":import_probe::id(1),"account_id":import_probe::id(2),"balance_nature":"ASSET","currency":"BRL","authorized":true});
    assert!(serde_json::from_value::<ofx_model::Destination>(value).is_err());
    assert_eq!(
        ofx_model::minor("-92233720368547758.08", false),
        (Some("-9223372036854775808".into()), None)
    );
    assert_eq!(
        ofx_model::minor("-92233720368547758.08", true),
        (None, Some("AMOUNT_OUT_OF_RANGE"))
    );
    assert_eq!(
        ofx_model::date("20261025235960[-12:X]"),
        Some("2026-10-25".into())
    );
    assert_eq!(ofx_model::date("20260229"), None);
}
