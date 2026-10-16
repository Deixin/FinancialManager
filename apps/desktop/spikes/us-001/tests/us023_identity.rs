use financial_manager_vault_spike::{identity, random_key, vault::open_database};
use serde_json::{Value, json};
use std::{collections::HashSet, fs, path::PathBuf};
const FIXTURE: &str = include_str!("../../../../../packages/contracts/fixtures/us023.json");
const SQL: &str = include_str!(
    "../../../../../packages/storage-schema/sqlite/migrations/0001-financial-core.sql"
);
type Result<T> = std::result::Result<T, &'static str>;
fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value[key].as_str().ok_or("SYNTHETIC_VECTOR_INVALID")
}
#[test]
fn uuid_and_time_native_contract() -> Result<()> {
    let vectors: Value = serde_json::from_str(FIXTURE).map_err(|_| "SYNTHETIC_VECTOR_INVALID")?;
    let vector = &vectors["rfc"];
    let millis = vector["milliseconds"]
        .as_u64()
        .ok_or("VECTOR_TIME_INVALID")?;
    let entropy: Vec<u8> = vector["entropy"]
        .as_array()
        .ok_or("VECTOR_ENTROPY_INVALID")?
        .iter()
        .map(|v| v.as_u64().map(|v| v as u8).ok_or("VECTOR_ENTROPY_INVALID"))
        .collect::<Result<_>>()?;
    let bytes: [u8; 10] = entropy.try_into().map_err(|_| "VECTOR_ENTROPY_INVALID")?;
    let expected = text(vector, "uuid")?;
    assert!(
        identity::uuid_v7(millis, &bytes)
            .map_err(|_| "UUID_VECTOR_FAILED")?
            .to_string()
            == expected,
        "RFC_VECTOR_FAILED"
    );
    assert!(
        identity::resource_id(text(&vectors, "legacy_uuid")?).is_ok(),
        "LEGACY_ID_CHANGED"
    );
    for invalid in vectors["invalid_uuid"]
        .as_array()
        .ok_or("VECTORS_INVALID")?
    {
        assert!(
            identity::resource_id(invalid.as_str().ok_or("VECTOR_INVALID")?).is_err(),
            "INVALID_ID_ACCEPTED"
        );
    }
    let mut ids = HashSet::new();
    for _ in 0..4096 {
        let id = identity::new_id_with(
            || Ok(millis as i64),
            |bytes| getrandom::fill(bytes).map_err(|_| identity::IdentityError::EntropyUnavailable),
        )
        .map_err(|_| "CSPRNG_FAILED")?;
        assert!(
            id.get_version_num() == 7 && identity::resource_id(&id.to_string()).is_ok(),
            "UUID_FORMAT_FAILED"
        );
        assert!(ids.insert(id), "DUPLICATE_IN_SYNTHETIC_CORPUS");
    }
    let mut previous = identity::uuid_v7(millis, &bytes).map_err(|_| "UUID_FAILED")?;
    for step in 1..=256 {
        let id = identity::uuid_v7(millis + step, &bytes).map_err(|_| "UUID_FAILED")?;
        assert!(id > previous, "INCREASING_CLOCK_ORDER_FAILED");
        previous = id;
    }
    assert!(
        identity::uuid_v7(millis, &bytes).map_err(|_| "UUID_FAILED")? < previous,
        "CLOCK_REGRESSION_POLICY_FAILED"
    );
    for _ in 0..1024 {
        assert!(
            ids.insert(identity::new_id().map_err(|_| "REAL_CLOCK_CSPRNG_FAILED")?),
            "DUPLICATE_IN_SYNTHETIC_CORPUS"
        );
    }
    assert!(
        identity::uuid_v7(identity::MAX_UUID_MILLISECONDS + 1, &bytes).is_err(),
        "UUID_TIME_OVERFLOW_ACCEPTED"
    );
    assert!(
        identity::new_id_with(|| Ok(-1), |_| Ok(())).is_err(),
        "NEGATIVE_UUID_TIME_ACCEPTED"
    );
    assert!(
        identity::new_id_with(
            || Ok(millis as i64),
            |_| Err(identity::IdentityError::EntropyUnavailable)
        )
        .is_err(),
        "ENTROPY_FAILURE_NOT_CLOSED"
    );
    for valid in vectors["valid_dates"].as_array().ok_or("VECTORS_INVALID")? {
        assert!(
            identity::financial_date(valid.as_str().ok_or("VECTOR_INVALID")?).is_ok(),
            "DATE_VECTOR_FAILED"
        );
    }
    for invalid in vectors["invalid_dates"]
        .as_array()
        .ok_or("VECTORS_INVALID")?
    {
        assert!(
            identity::financial_date(invalid.as_str().ok_or("VECTOR_INVALID")?).is_err(),
            "DATE_REJECTION_FAILED"
        );
    }
    for invalid in vectors["invalid_instants"]
        .as_array()
        .ok_or("VECTORS_INVALID")?
    {
        assert!(
            identity::utc_instant(invalid.as_str().ok_or("VECTOR_INVALID")?).is_err(),
            "INSTANT_REJECTION_FAILED"
        );
    }
    let directory = tempfile::tempdir().map_err(|_| "TEMPORARY_DIRECTORY_FAILED")?;
    let path = directory.path().join("us023-synthetic.sqlite");
    let key = random_key().map_err(|_| "CSPRNG_FAILED")?;
    let db = open_database(&path, &key, true).map_err(|_| "NATIVE_OPEN_FAILED")?;
    db.execute_batch(SQL).map_err(|_| "NATIVE_SCHEMA_FAILED")?;
    for (index, valid) in vectors["valid_instants"]
        .as_array()
        .ok_or("VECTORS_INVALID")?
        .iter()
        .enumerate()
    {
        let instant = text(valid, "text")?;
        let epoch = valid["milliseconds"].as_i64().ok_or("VECTOR_INVALID")?;
        assert!(
            identity::utc_instant(instant).is_ok(),
            "INSTANT_VECTOR_FAILED"
        );
        assert!(
            identity::instant_from_epoch_milliseconds(epoch).map_err(|_| "INSTANT_FAILED")?
                == instant,
            "EPOCH_VECTOR_FAILED"
        );
        let id = identity::new_id().map_err(|_| "CSPRNG_FAILED")?.to_string();
        let generation = identity::new_id().map_err(|_| "CSPRNG_FAILED")?.to_string();
        db.execute("INSERT INTO workspace(id,display_name,purpose,storage_mode,default_currency,sync_generation,created_at) VALUES(?,'SYNTHETIC_US023','PERSONAL','LOCAL','BRL',?,?)",[&id,&generation,instant]).map_err(|_|"NATIVE_ROUNDTRIP_WRITE_FAILED")?;
        let reopened: String = db
            .query_row(
                "SELECT created_at FROM workspace WHERE id=?",
                [&id],
                |row| row.get(0),
            )
            .map_err(|_| "NATIVE_ROUNDTRIP_READ_FAILED")?;
        assert!(reopened == instant, "NATIVE_ROUNDTRIP_CHANGED");
        assert!(index < 16, "SYNTHETIC_CORPUS_BOUND");
    }
    let cipher: String = db
        .query_row("PRAGMA cipher_version", [], |row| row.get(0))
        .map_err(|_| "NATIVE_VERSION_FAILED")?;
    let sqlite: String = db
        .query_row("SELECT sqlite_version()", [], |row| row.get(0))
        .map_err(|_| "NATIVE_VERSION_FAILED")?;
    drop(db);
    let reopened = open_database(&path, &key, false).map_err(|_| "NATIVE_REOPEN_FAILED")?;
    let count: i64 = reopened
        .query_row("SELECT count(*) FROM workspace", [], |row| row.get(0))
        .map_err(|_| "NATIVE_REOPEN_READ_FAILED")?;
    assert!(count == 6, "NATIVE_REOPEN_COUNT_FAILED");
    drop(reopened);
    directory.close().map_err(|_| "CLEANUP_FAILED")?;
    if let Some(file) = std::env::var_os("US023_DESKTOP_REPORT") {
        fs::write(PathBuf::from(file),serde_json::to_string_pretty(&json!({"format_version":1,"synthetic_only":true,"platform":"windows","passed":true,"same_millisecond_sample_count":4096,"cipher_version":cipher,"sqlite_version":sqlite,"checks":{"rfc_vector":true,"legacy_and_invalid_ids":true,"same_millisecond_csprng":true,"increasing_clock_order":true,"clock_regression_and_independent_generators":true,"canonical_temporal_vectors":true,"sqlcipher_roundtrip_reopen_and_cleanup":true}})).map_err(|_|"REPORT_ENCODING_FAILED")?).map_err(|_|"REPORT_WRITE_FAILED")?;
    }
    Ok(())
}
