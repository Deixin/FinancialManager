pub mod account_model;
pub mod allocation_model;
#[cfg(feature = "allocations-smoke")]
pub mod allocation_probe;
#[cfg(all(test, feature = "allocations-smoke"))]
mod allocation_tests;
pub mod backup_destination;
pub mod card_payment_model;
pub mod category_model;
pub mod classification_model;
pub mod commands;
pub mod counterparty_association_model;
pub mod counterparty_model;
#[cfg(feature = "counterparties-smoke")]
pub mod counterparty_probe;
#[cfg(all(test, feature = "counterparties-smoke"))]
mod counterparty_tests;
pub mod identity;
pub mod keys;
pub mod local_accounts;
pub mod local_allocations;
pub mod local_backup;
pub mod local_card_payments;
pub mod local_categories;
pub mod local_classification;
pub mod local_classification_filters;
pub mod local_counterparties;
pub mod local_lock;
pub mod local_movements;
pub mod local_restore;
pub mod local_taxonomy;
pub mod local_transfers;
pub mod local_workspaces;
pub mod lock_store;
mod migrations;
pub mod movement_model;
pub mod restore_source;
pub mod taxonomy_model;
pub mod transfer_model;
pub mod windows_hello;

pub type Result<T> = std::result::Result<T, LocalError>;
pub type SecretKey = zeroize::Zeroizing<[u8; 32]>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LocalError {
    InvalidWorkspace,
    StorageUnavailable,
    InstallationBusy,
    KeyMissing,
    IntegrityFailure,
    UnsupportedSchema,
    NotFound,
    RequestConflict,
    LocalLocked,
    InvalidPin,
    AuthenticationFailed,
    RetryLater,
    HelloUnavailable,
    HelloCanceled,
    HelloFailed,
    InvalidBackupPassword,
    BackupLimit,
    BackupAuthenticationFailed,
    UnsupportedBackup,
    BackupDestinationUnavailable,
    BackupAlreadyExists,
    BackupVerificationFailed,
    RestoreUnavailable,
    InvalidCategoryChange,
    InvalidCategoryState,
    CategoryNotFound,
    CategoryBaseConflict,
    CategoryNameConflict,
    CategorySeedConflict,
    CategoryLimit,
    InvalidCounterpartyChange,
    InvalidCounterpartyState,
    CounterpartyNotFound,
    CounterpartyBaseConflict,
    CounterpartyLimit,
    InvalidCounterpartyAssociation,
    CounterpartyAssociationBaseConflict,
    CounterpartyReferenceUnavailable,
    CounterpartyAssociationDeleted,
    InvalidTaxonomyChange,
    InvalidTaxonomyState,
    TaxonomyNotFound,
    TaxonomyBaseConflict,
    TaxonomyNameConflict,
    TaxonomyParentUnavailable,
    TaxonomyLimit,
    InvalidAccountChange,
    StaleAccount,
    AccountNotFound,
    AccountArchived,
    ReferenceConflict,
    AccountLimit,
    InvalidManualMovement,
    InvalidCardPayment,
    CardPaymentReadOnly,
    CardPaymentBaseConflict,
    CardPaymentAccountChanged,
    CardPaymentAccountArchived,
    CardPaymentDeleted,
    InvalidTransfer,
    TransferReadOnly,
    TransferBaseConflict,
    TransferAccountChanged,
    TransferAccountArchived,
    TransferDeleted,
    ManualMovementReadOnly,
    ManualBaseConflict,
    ManualAccountChanged,
    ManualAccountArchived,
    MovementDeleted,
    AllocationReviewRequired,
    VersionConflict,
    VersionExhausted,
    OriginImmutable,
    CompositeRequired,
    InvalidRevision,
    InvalidAllocationChange,
    AllocationTotalMismatch,
    AllocationBaseConflict,
    AllocationReferenceUnavailable,
    AllocationScopeMismatch,
    AllocationDeleted,
    InvalidClassification,
    ClassificationBaseConflict,
    ClassificationReferenceUnavailable,
    ClassificationScopeMismatch,
    ClassificationSplitReviewRequired,
    ClassificationAmountUnsupported,
    ClassificationDeleted,
    MovementLimit,
}
impl From<std::io::Error> for LocalError {
    fn from(_: std::io::Error) -> Self {
        Self::StorageUnavailable
    }
}
impl From<rusqlite::Error> for LocalError {
    fn from(_: rusqlite::Error) -> Self {
        Self::IntegrityFailure
    }
}

#[cfg(test)]
mod local_workspace_tests;

pub mod workspace_model;

// Test instrumentation only; the production host never enables this feature.
#[cfg(feature = "vault-smoke")]
pub mod vault_probe;

#[cfg(feature = "backup-smoke")]
pub mod backup_probe;

#[cfg(feature = "accounts-smoke")]
pub mod account_probe;
#[cfg(feature = "movements-smoke")]
pub mod movement_probe;
#[cfg(feature = "restore-smoke")]
pub mod restore_probe;

#[cfg(feature = "transfers-smoke")]
pub mod transfer_probe;

#[cfg(all(test, feature = "transfers-smoke"))]
mod transfer_tests;

#[cfg(feature = "card-payments-smoke")]
pub mod card_payment_probe;
#[cfg(all(test, feature = "card-payments-smoke"))]
mod card_payment_tests;

#[cfg(feature = "categories-smoke")]
pub mod category_probe;
#[cfg(all(test, feature = "categories-smoke"))]
mod category_tests;

#[cfg(all(test, feature = "taxonomy-smoke"))]
mod classification_filter_tests;
#[cfg(feature = "classification-smoke")]
pub mod classification_probe;
#[cfg(all(test, feature = "classification-smoke"))]
mod classification_tests;
#[cfg(feature = "taxonomy-smoke")]
pub mod taxonomy_probe;
#[cfg(all(test, feature = "taxonomy-smoke"))]
mod taxonomy_tests;
