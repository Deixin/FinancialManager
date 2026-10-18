use crate::{
    LocalError, Result,
    backup_destination::{BackupDestination, WindowsBackupDestination},
    keys::KeyStore,
    local_backup::{BackupResult, CreateBackup, SealedBackup},
    local_lock::{ConfigurePin, LocalLock, LockStatus, PinInput},
    local_restore::{self, Controller, PreviewRestore, RestorePreview, SelectedBackup},
    local_workspaces::{CreateWorkspace, Installation, Workspace},
    lock_store::PolicyStore,
    restore_source::{RestoreSource, WindowsRestoreSource},
    windows_hello::{HelloAvailability, HelloVerifier, WindowsHello},
};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tauri::{Manager, State};

pub struct LocalState {
    root: PathBuf,
    keys: Arc<dyn KeyStore>,
    policies: Arc<dyn PolicyStore>,
    installation: Mutex<Option<Session>>,
    force_locked: AtomicBool,
    generation: AtomicU64,
    hello_pending: AtomicBool,
    hello: Arc<dyn HelloVerifier>,
    backup_active: Arc<AtomicBool>,
    backup_destination: Arc<dyn BackupDestination>,
    restore_source: Arc<dyn RestoreSource>,
}
pub struct BackupJob {
    sealed: SealedBackup,
    lease: BackupLease,
    _permit: BackupPermit,
}
pub struct RestoreSelectionJob {
    lease: BackupLease,
    _permit: BackupPermit,
}
impl RestoreSelectionJob {
    pub fn lease(&self) -> BackupLease {
        self.lease
    }
}
#[derive(Clone, Copy)]
pub struct BackupLease {
    installation: uuid::Uuid,
    generation: u64,
}
struct BackupPermit(Arc<AtomicBool>);
impl Drop for BackupPermit {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl BackupJob {
    pub fn lease(&self) -> BackupLease {
        self.lease
    }
}
struct Session {
    installation: Installation,
    privacy: LocalLock,
    restore: Controller,
}
impl LocalState {
    #[cfg(windows)]
    pub fn new(root: PathBuf, keys: Arc<dyn KeyStore>) -> Self {
        Self::with_policies(root, keys, Arc::new(crate::lock_store::WindowsPolicyStore))
    }
    pub fn with_policies(
        root: PathBuf,
        keys: Arc<dyn KeyStore>,
        policies: Arc<dyn PolicyStore>,
    ) -> Self {
        Self::with_hello(root, keys, policies, Arc::new(WindowsHello))
    }
    pub fn with_hello(
        root: PathBuf,
        keys: Arc<dyn KeyStore>,
        policies: Arc<dyn PolicyStore>,
        hello: Arc<dyn HelloVerifier>,
    ) -> Self {
        Self::with_backup_destination(
            root,
            keys,
            policies,
            hello,
            Arc::new(WindowsBackupDestination),
        )
    }
    pub fn with_backup_destination(
        root: PathBuf,
        keys: Arc<dyn KeyStore>,
        policies: Arc<dyn PolicyStore>,
        hello: Arc<dyn HelloVerifier>,
        backup_destination: Arc<dyn BackupDestination>,
    ) -> Self {
        Self {
            root,
            keys,
            policies,
            installation: Mutex::new(None),
            force_locked: AtomicBool::new(false),
            generation: AtomicU64::new(0),
            hello_pending: AtomicBool::new(false),
            hello,
            backup_active: Arc::new(AtomicBool::new(false)),
            backup_destination,
            restore_source: Arc::new(WindowsRestoreSource),
        }
    }
    pub fn with_restore_source(
        root: PathBuf,
        keys: Arc<dyn KeyStore>,
        policies: Arc<dyn PolicyStore>,
        source: Arc<dyn RestoreSource>,
    ) -> Self {
        let mut state = Self::with_policies(root, keys, policies);
        state.restore_source = source;
        state
    }
    pub fn force_lock(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.on_focus_lost();
    }
    pub fn on_focus_lost(&self) {
        // An owned OS consent prompt also blurs the main window. It starts locked;
        // only fresh OS verification plus foreground ownership may reopen it.
        self.force_locked.store(true, Ordering::SeqCst);
    }
    fn access<T>(
        &self,
        sensitive: bool,
        action: impl FnOnce(&mut Session) -> Result<T>,
    ) -> Result<T> {
        let mut state = self
            .installation
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?;
        if state.is_none() {
            let installation = Installation::open(&self.root, self.keys.clone())?;
            let privacy = LocalLock::load(installation.id(), &self.root, self.policies.clone())?;
            *state = Some(Session {
                installation,
                privacy,
                restore: Controller::default(),
            });
        }
        let session = state.as_mut().ok_or(LocalError::StorageUnavailable)?;
        if self.force_locked.swap(false, Ordering::SeqCst) {
            session.privacy.lock();
            session.restore.clear_preview(&session.installation)?;
        }
        if sensitive {
            session.privacy.require_open()?;
        }
        let result = action(session);
        if self.force_locked.swap(false, Ordering::SeqCst) {
            session.privacy.lock();
            session.restore.clear_preview(&session.installation)?;
        }
        if sensitive {
            session.privacy.require_open()?;
        }
        result
    }
    fn with<T>(&self, action: impl FnOnce(&Installation) -> Result<T>) -> Result<T> {
        self.access(true, |session| action(&session.installation))
    }
    pub fn list(&self) -> Result<Vec<Workspace>> {
        self.with(|i| i.list())
    }
    pub fn create(&self, input: CreateWorkspace) -> Result<Workspace> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            s.installation.create(input)
        })
    }
    pub fn open(&self, id: &str) -> Result<Workspace> {
        self.with(|i| i.open_workspace(id))
    }
    pub fn read_accounts(
        &self,
        workspace: &str,
    ) -> Result<crate::local_accounts::AccountsSnapshot> {
        self.with(|i| i.read_accounts(workspace))
    }
    pub fn apply_account_change(
        &self,
        workspace: &str,
        input: crate::account_model::AccountChange,
    ) -> Result<crate::local_accounts::AccountResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation.apply_account_change(workspace, input, || {
                if protected && self.force_locked.load(Ordering::SeqCst) {
                    Err(LocalError::LocalLocked)
                } else {
                    Ok(())
                }
            })
        })
    }
    pub fn read_movements(
        &self,
        workspace: &str,
    ) -> Result<crate::local_movements::MovementsSnapshot> {
        self.with(|i| i.read_movements(workspace))
    }
    pub fn read_movement_classifications(
        &self,
        workspace: &str,
    ) -> Result<crate::local_movements::MovementsSnapshot> {
        self.with(|i| i.read_movement_classifications(workspace))
    }
    pub fn apply_manual_movement(
        &self,
        workspace: &str,
        input: crate::movement_model::ManualCommand,
    ) -> Result<crate::local_movements::MovementResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation.apply_manual_movement(workspace, input, || {
                if protected && self.force_locked.load(Ordering::SeqCst) {
                    Err(LocalError::LocalLocked)
                } else {
                    Ok(())
                }
            })
        })
    }
    pub fn apply_classification(
        &self,
        workspace: &str,
        input: Vec<crate::classification_model::Command>,
    ) -> Result<crate::local_classification::ClassificationResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation.apply_classification(workspace, input, || {
                if protected && self.force_locked.load(Ordering::SeqCst) {
                    Err(LocalError::LocalLocked)
                } else {
                    Ok(())
                }
            })
        })
    }
    pub fn apply_allocations(
        &self,
        workspace: &str,
        input: Vec<crate::allocation_model::Command>,
    ) -> Result<crate::local_allocations::AllocationResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation.apply_allocations(workspace, input, || {
                if protected && self.force_locked.load(Ordering::SeqCst) {
                    Err(LocalError::LocalLocked)
                } else {
                    Ok(())
                }
            })
        })
    }
    pub fn read_transfers(
        &self,
        workspace: &str,
    ) -> Result<crate::local_transfers::TransfersSnapshot> {
        self.with(|i| i.read_transfers(workspace))
    }
    pub fn apply_transfer(
        &self,
        workspace: &str,
        input: crate::transfer_model::Command,
    ) -> Result<crate::local_transfers::TransferResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation.apply_transfer(workspace, input, || {
                if protected && self.force_locked.load(Ordering::SeqCst) {
                    Err(LocalError::LocalLocked)
                } else {
                    Ok(())
                }
            })
        })
    }
    pub fn read_card_payments(
        &self,
        workspace: &str,
    ) -> Result<crate::local_card_payments::CardPaymentsSnapshot> {
        self.with(|i| i.read_card_payments(workspace))
    }
    pub fn apply_card_payment(
        &self,
        workspace: &str,
        input: crate::card_payment_model::Command,
    ) -> Result<crate::local_card_payments::CardPaymentResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation.apply_card_payment(workspace, input, || {
                if protected && self.force_locked.load(Ordering::SeqCst) {
                    Err(LocalError::LocalLocked)
                } else {
                    Ok(())
                }
            })
        })
    }
    pub fn read_categories(
        &self,
        workspace: &str,
    ) -> Result<crate::local_categories::CategoriesSnapshot> {
        self.with(|i| i.read_categories(workspace))
    }
    pub fn apply_category_change(
        &self,
        workspace: &str,
        input: crate::category_model::Command,
    ) -> Result<crate::local_categories::CategoryResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation.apply_category_change(workspace, input, || {
                if protected && self.force_locked.load(Ordering::SeqCst) {
                    Err(LocalError::LocalLocked)
                } else {
                    Ok(())
                }
            })
        })
    }
    pub fn read_counterparties(
        &self,
        workspace: &str,
        include_movements: bool,
    ) -> Result<crate::local_counterparties::CounterpartySnapshot> {
        self.with(|i| i.read_counterparties(workspace, include_movements))
    }
    pub fn apply_counterparty_change(
        &self,
        workspace: &str,
        input: crate::counterparty_model::Command,
    ) -> Result<crate::local_counterparties::CounterpartyResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation
                .apply_counterparty_change(workspace, input, || {
                    if protected && self.force_locked.load(Ordering::SeqCst) {
                        Err(LocalError::LocalLocked)
                    } else {
                        Ok(())
                    }
                })
        })
    }
    pub fn apply_counterparty_association(
        &self,
        workspace: &str,
        input: Vec<crate::counterparty_association_model::Command>,
    ) -> Result<crate::local_counterparties::AssociationResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation
                .apply_counterparty_association(workspace, input, || {
                    if protected && self.force_locked.load(Ordering::SeqCst) {
                        Err(LocalError::LocalLocked)
                    } else {
                        Ok(())
                    }
                })
        })
    }
    pub fn read_taxonomy(
        &self,
        workspace: &str,
    ) -> Result<crate::local_taxonomy::TaxonomySnapshot> {
        self.with(|i| i.read_taxonomy(workspace))
    }
    pub fn apply_taxonomy_change(
        &self,
        workspace: &str,
        input: crate::taxonomy_model::Command,
    ) -> Result<crate::local_taxonomy::TaxonomyResult> {
        self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            let protected = s.privacy.status(LocalLock::now()?)?.enabled;
            s.installation.apply_taxonomy_change(workspace, input, || {
                if protected && self.force_locked.load(Ordering::SeqCst) {
                    Err(LocalError::LocalLocked)
                } else {
                    Ok(())
                }
            })
        })
    }
    pub fn prepare_backup(&self, input: CreateBackup) -> Result<BackupJob> {
        input.validate()?;
        self.backup_active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| LocalError::RequestConflict)?;
        let permit = BackupPermit(self.backup_active.clone());
        let generation = self
            .generation
            .fetch_add(1, Ordering::SeqCst)
            .wrapping_add(1);
        let (sealed, installation) = self.access(true, |s| {
            if s.restore.prepared.is_some() {
                return Err(LocalError::RequestConflict);
            }
            Ok((s.installation.prepare_backup(&input)?, s.installation.id()))
        })?;
        // Drop and zeroize the recovery password before any OS picker can wait for input.
        drop(input);
        if self.generation.load(Ordering::SeqCst) != generation {
            return Err(LocalError::LocalLocked);
        }
        Ok(BackupJob {
            sealed,
            lease: BackupLease {
                installation,
                generation,
            },
            _permit: permit,
        })
    }
    fn valid_backup_lease(&self, lease: BackupLease) -> bool {
        self.backup_active.load(Ordering::SeqCst)
            && self.generation.load(Ordering::SeqCst) == lease.generation
    }
    pub fn choose_backup_destination(
        &self,
        lease: BackupLease,
        window: isize,
    ) -> Result<Option<PathBuf>> {
        self.access(true, |s| {
            if !self.valid_backup_lease(lease) || s.installation.id() != lease.installation {
                return Err(LocalError::LocalLocked);
            }
            Ok(())
        })?;
        // Ownership transfer to the OS dialog always closes PIN-protected access,
        // even if the window manager does not deliver a focus notification.
        self.on_focus_lost();
        self.backup_destination.choose(window)
    }
    pub fn finish_backup(
        &self,
        job: BackupJob,
        destination: Option<PathBuf>,
    ) -> Result<BackupResult> {
        self.access(false, |s| {
            if !self.valid_backup_lease(job.lease) || s.installation.id() != job.lease.installation
            {
                return Err(LocalError::LocalLocked);
            }
            let result = match destination {
                None => Ok(BackupResult {
                    outcome: "CANCELED",
                    created_at: None,
                }),
                Some(destination) => job.sealed.publish(&destination, &self.root, || {
                    self.valid_backup_lease(job.lease)
                }),
            }?;
            if !self.valid_backup_lease(job.lease) {
                return Err(LocalError::LocalLocked);
            }
            Ok(result)
        })
    }
    pub fn status(&self) -> Result<LockStatus> {
        let mut status = self.access(false, |s| {
            if s.privacy.is_unavailable() {
                s.privacy =
                    LocalLock::load(s.installation.id(), &self.root, self.policies.clone())?;
            }
            s.privacy.status(LocalLock::now()?)
        })?;
        status.hello_availability = self.hello.availability();
        Ok(status)
    }
    pub fn lock(&self) -> Result<LockStatus> {
        self.force_lock();
        self.status()
    }
    pub fn unlock(&self, input: PinInput) -> Result<LockStatus> {
        self.force_lock();
        self.access(false, |s| s.privacy.unlock(&input, LocalLock::now()?))?;
        self.status()
    }
    pub fn configure(&self, input: ConfigurePin) -> Result<LockStatus> {
        self.force_lock();
        self.access(false, |s| s.privacy.configure(&input, LocalLock::now()?))?;
        self.status()
    }
    pub fn disable(&self, input: PinInput) -> Result<LockStatus> {
        self.force_lock();
        self.access(false, |s| s.privacy.disable(&input, LocalLock::now()?))?;
        self.status()
    }
    pub fn configure_hello(
        &self,
        input: PinInput,
        enabled: bool,
        window: isize,
        focused: impl Fn() -> bool,
    ) -> Result<LockStatus> {
        if !enabled {
            self.force_lock();
            self.access(false, |s| {
                s.privacy
                    .authorize_hello_change(&input, LocalLock::now()?)?;
                s.privacy.set_hello(false)
            })?;
            return self.status();
        }
        self.verify_hello(Some(input), window, focused)
    }
    pub fn unlock_with_hello(
        &self,
        window: isize,
        focused: impl Fn() -> bool,
    ) -> Result<LockStatus> {
        self.verify_hello(None, window, focused)
    }
    fn verify_hello(
        &self,
        enabling: Option<PinInput>,
        window: isize,
        focused: impl Fn() -> bool,
    ) -> Result<LockStatus> {
        self.hello_pending
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| LocalError::RequestConflict)?;
        struct Pending<'a>(&'a AtomicBool);
        impl Drop for Pending<'_> {
            fn drop(&mut self) {
                self.0.store(false, Ordering::SeqCst);
            }
        }
        let _pending = Pending(&self.hello_pending);
        self.force_lock();
        let generation = self.generation.load(Ordering::SeqCst);
        let is_enabling = enabling.is_some();
        self.access(false, |s| {
            if let Some(input) = enabling.as_ref() {
                s.privacy.authorize_hello_change(input, LocalLock::now()?)
            } else {
                s.privacy.require_hello(LocalLock::now()?)
            }
        })?;
        // The current app PIN is no longer needed during a potentially long OS prompt.
        drop(enabling);
        if self.hello.availability() != HelloAvailability::Available {
            return Err(LocalError::HelloUnavailable);
        }
        if !focused() || self.generation.load(Ordering::SeqCst) != generation {
            return Err(LocalError::LocalLocked);
        }
        // No installation mutex, financial key or open DB is held during OS consent.
        self.hello.verify(window)?;
        if !focused() {
            return Err(LocalError::LocalLocked);
        }
        self.access(false, |s| {
            if self.generation.load(Ordering::SeqCst) != generation {
                return Err(LocalError::LocalLocked);
            }
            if is_enabling {
                s.privacy.set_hello(true)
            } else {
                s.privacy.unlock_hello(LocalLock::now()?)
            }
        })?;
        let status = self.status()?;
        if !focused() || self.generation.load(Ordering::SeqCst) != generation {
            self.force_lock();
            return Err(LocalError::LocalLocked);
        }
        Ok(status)
    }
}
impl LocalState {
    pub fn begin_restore_selection(&self) -> Result<RestoreSelectionJob> {
        self.backup_active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| LocalError::RequestConflict)?;
        let permit = BackupPermit(self.backup_active.clone());
        let generation = self
            .generation
            .fetch_add(1, Ordering::SeqCst)
            .wrapping_add(1);
        let installation = self.access(true, |s| {
            s.restore.clear(&s.installation)?;
            Ok(s.installation.id())
        })?;
        Ok(RestoreSelectionJob {
            lease: BackupLease {
                installation,
                generation,
            },
            _permit: permit,
        })
    }
    pub fn choose_restore_source(
        &self,
        lease: BackupLease,
        window: isize,
    ) -> Result<Option<PathBuf>> {
        self.access(true, |s| {
            if !self.valid_backup_lease(lease) || s.installation.id() != lease.installation {
                return Err(LocalError::LocalLocked);
            }
            Ok(())
        })?;
        self.on_focus_lost();
        self.restore_source.choose(window)
    }
    pub fn finish_restore_selection(
        &self,
        job: RestoreSelectionJob,
        path: Option<PathBuf>,
    ) -> Result<SelectedBackup> {
        self.access(false, |s| {
            if !self.valid_backup_lease(job.lease) || s.installation.id() != job.lease.installation
            {
                return Err(LocalError::LocalLocked);
            }
            let Some(path) = path else {
                return Ok(SelectedBackup { selection_id: None });
            };
            let metadata = std::fs::symlink_metadata(&path)?;
            if metadata.file_type().is_symlink()
                || !metadata.is_file()
                || !path
                    .extension()
                    .is_some_and(|e| e.eq_ignore_ascii_case("fmbackup"))
                || metadata.len() > crate::local_backup::MAX_PACKAGE as u64
            {
                return Err(LocalError::RestoreUnavailable);
            }
            let path = path.canonicalize()?;
            if path.starts_with(self.root.canonicalize()?) {
                return Err(LocalError::RestoreUnavailable);
            }
            let id = crate::identity::new_id().map_err(|_| LocalError::StorageUnavailable)?;
            s.restore.selection = Some((id, path));
            Ok(SelectedBackup {
                selection_id: Some(id.to_string()),
            })
        })
    }
    pub fn preview_restore(&self, input: PreviewRestore) -> Result<RestorePreview> {
        input.validate()?;
        if self.backup_active.load(Ordering::SeqCst) {
            return Err(LocalError::RequestConflict);
        }
        let generation = self
            .generation
            .fetch_add(1, Ordering::SeqCst)
            .wrapping_add(1);
        let preview = self.access(true, |s| {
            s.restore.clear_preview(&s.installation)?;
            let (id, path) = s
                .restore
                .selection
                .as_ref()
                .ok_or(LocalError::RestoreUnavailable)?;
            if id.to_string() != input.selection_id {
                return Err(LocalError::RestoreUnavailable);
            }
            let backup = crate::local_backup::read_verified(path, &input.password)?;
            let prepared = local_restore::prepare(&s.installation, backup)?;
            let preview = prepared.preview.clone();
            s.restore.prepared = Some((generation, prepared));
            s.restore.selection = None;
            Ok(preview)
        })?;
        drop(input);
        if self.generation.load(Ordering::SeqCst) != generation {
            self.access(false, |s| s.restore.clear_preview(&s.installation))?;
            return Err(LocalError::LocalLocked);
        }
        Ok(preview)
    }
    pub fn confirm_restore(&self, restore_id: &str) -> Result<Workspace> {
        let id =
            crate::identity::resource_id(restore_id).map_err(|_| LocalError::RestoreUnavailable)?;
        let generation = self.generation.load(Ordering::SeqCst);
        let result = self.access(true, |s| {
            if let Some(workspace) = local_restore::replay(&s.installation, id)? {
                return Ok(workspace);
            }
            let (preview_generation, prepared) = s
                .restore
                .prepared
                .as_ref()
                .ok_or(LocalError::RestoreUnavailable)?;
            if *preview_generation != generation || prepared.preview.restore_id != restore_id {
                return Err(LocalError::RestoreUnavailable);
            }
            let result = local_restore::confirm(&s.installation, prepared, || {
                self.generation.load(Ordering::SeqCst) == generation
                    && !self.force_locked.load(Ordering::SeqCst)
            })?;
            s.restore.prepared = None;
            Ok(result)
        })?;
        if self.generation.load(Ordering::SeqCst) != generation {
            return Err(LocalError::LocalLocked);
        }
        Ok(result)
    }
    pub fn cancel_restore(&self) -> Result<()> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.access(false, |s| s.restore.clear(&s.installation))
    }
}
#[tauri::command]
pub async fn select_local_backup(
    state: State<'_, Arc<LocalState>>,
    window: tauri::WebviewWindow,
) -> Result<SelectedBackup> {
    let state = state.inner().clone();
    let worker = state.clone();
    let job = tauri::async_runtime::spawn_blocking(move || worker.begin_restore_selection())
        .await
        .map_err(|_| LocalError::RestoreUnavailable)??;
    let lease = job.lease();
    #[cfg(windows)]
    let handle = window.hwnd().map_err(|_| LocalError::RestoreUnavailable)?.0 as isize;
    #[cfg(not(windows))]
    let handle = 0;
    let (sender, receiver) = std::sync::mpsc::channel();
    let chooser = state.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(chooser.choose_restore_source(lease, handle));
        })
        .map_err(|_| LocalError::RestoreUnavailable)?;
    let path = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|_| LocalError::RestoreUnavailable)?
        .map_err(|_| LocalError::RestoreUnavailable)??;
    tauri::async_runtime::spawn_blocking(move || state.finish_restore_selection(job, path))
        .await
        .map_err(|_| LocalError::RestoreUnavailable)?
}
#[tauri::command]
pub async fn preview_local_restore(
    state: State<'_, Arc<LocalState>>,
    input: PreviewRestore,
) -> Result<RestorePreview> {
    input.validate()?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.preview_restore(input))
        .await
        .map_err(|_| LocalError::RestoreUnavailable)?
}
#[tauri::command]
pub async fn confirm_local_restore(
    state: State<'_, Arc<LocalState>>,
    restore_id: String,
) -> Result<Workspace> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.confirm_restore(&restore_id))
        .await
        .map_err(|_| LocalError::RestoreUnavailable)?
}
#[tauri::command]
pub async fn cancel_local_restore(state: State<'_, Arc<LocalState>>) -> Result<()> {
    state.generation.fetch_add(1, Ordering::SeqCst);
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.cancel_restore())
        .await
        .map_err(|_| LocalError::RestoreUnavailable)?
}
#[tauri::command]
pub async fn list_local_workspaces(state: State<'_, Arc<LocalState>>) -> Result<Vec<Workspace>> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.with(|installation| installation.list()))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn create_local_workspace(
    state: State<'_, Arc<LocalState>>,
    input: CreateWorkspace,
) -> Result<Workspace> {
    input.validate()?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.with(|installation| installation.create(input))
    })
    .await
    .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn open_local_workspace(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
) -> Result<Workspace> {
    crate::identity::resource_id(&workspace_id).map_err(|_| LocalError::InvalidWorkspace)?;
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.with(|installation| installation.open_workspace(&workspace_id))
    })
    .await
    .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn local_lock_status(state: State<'_, Arc<LocalState>>) -> Result<LockStatus> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.status())
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn lock_local_session(state: State<'_, Arc<LocalState>>) -> Result<LockStatus> {
    state.force_lock();
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.status())
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn unlock_local_session(
    state: State<'_, Arc<LocalState>>,
    input: PinInput,
) -> Result<LockStatus> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.unlock(input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn configure_local_pin(
    state: State<'_, Arc<LocalState>>,
    input: ConfigurePin,
) -> Result<LockStatus> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.configure(input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn disable_local_pin(
    state: State<'_, Arc<LocalState>>,
    input: PinInput,
) -> Result<LockStatus> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.disable(input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn configure_local_hello(
    state: State<'_, Arc<LocalState>>,
    window: tauri::WebviewWindow,
    input: PinInput,
    enabled: bool,
) -> Result<LockStatus> {
    let state = state.inner().clone();
    #[cfg(windows)]
    let handle = window.hwnd().map_err(|_| LocalError::HelloUnavailable)?.0 as isize;
    #[cfg(not(windows))]
    let handle = 0;
    tauri::async_runtime::spawn_blocking(move || {
        state.configure_hello(input, enabled, handle, || {
            window.is_focused().unwrap_or(false)
        })
    })
    .await
    .map_err(|_| LocalError::HelloUnavailable)?
}
#[tauri::command]
pub async fn unlock_local_hello(
    state: State<'_, Arc<LocalState>>,
    window: tauri::WebviewWindow,
) -> Result<LockStatus> {
    let state = state.inner().clone();
    #[cfg(windows)]
    let handle = window.hwnd().map_err(|_| LocalError::HelloUnavailable)?.0 as isize;
    #[cfg(not(windows))]
    let handle = 0;
    tauri::async_runtime::spawn_blocking(move || {
        state.unlock_with_hello(handle, || window.is_focused().unwrap_or(false))
    })
    .await
    .map_err(|_| LocalError::HelloUnavailable)?
}
#[tauri::command]
pub async fn create_local_backup(
    state: State<'_, Arc<LocalState>>,
    window: tauri::WebviewWindow,
    input: CreateBackup,
) -> Result<BackupResult> {
    input.validate()?;
    let state = state.inner().clone();
    let worker = state.clone();
    let job = tauri::async_runtime::spawn_blocking(move || worker.prepare_backup(input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)??;
    let lease = job.lease();
    #[cfg(windows)]
    let handle = window
        .hwnd()
        .map_err(|_| LocalError::BackupDestinationUnavailable)?
        .0 as isize;
    #[cfg(not(windows))]
    let handle = 0;
    let (sender, receiver) = std::sync::mpsc::channel();
    let chooser = state.clone();
    window
        .run_on_main_thread(move || {
            let _ = sender.send(chooser.choose_backup_destination(lease, handle));
        })
        .map_err(|_| LocalError::BackupDestinationUnavailable)?;
    let destination = tauri::async_runtime::spawn_blocking(move || receiver.recv())
        .await
        .map_err(|_| LocalError::BackupDestinationUnavailable)?
        .map_err(|_| LocalError::BackupDestinationUnavailable)??;
    tauri::async_runtime::spawn_blocking(move || state.finish_backup(job, destination))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
pub fn production_builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_local_workspaces,
            create_local_workspace,
            open_local_workspace,
            local_lock_status,
            lock_local_session,
            unlock_local_session,
            configure_local_pin,
            disable_local_pin,
            configure_local_hello,
            unlock_local_hello,
            create_local_backup,
            select_local_backup,
            preview_local_restore,
            confirm_local_restore,
            cancel_local_restore,
            read_local_accounts,
            apply_local_account_change,
            read_local_movements,
            apply_local_manual_movement,
            read_local_transfers,
            apply_local_transfer,
            read_local_card_payments,
            apply_local_card_payment,
            read_local_categories,
            apply_local_category_change,
            read_local_taxonomy,
            apply_local_taxonomy_change,
            apply_local_classification_change,
            apply_local_allocation_change,
            read_local_counterparties,
            apply_local_counterparty_change,
            apply_local_counterparty_association
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(false))
                && let Some(state) = window.try_state::<Arc<LocalState>>()
            {
                state.on_focus_lost();
            }
        })
        .setup(|app| {
            #[cfg(windows)]
            {
                let parent = app.path().app_local_data_dir()?;
                std::fs::create_dir_all(&parent)?;
                app.manage(Arc::new(LocalState::new(
                    parent.join("local-v1"),
                    Arc::new(crate::keys::WindowsKeyStore),
                )));
            }
            Ok(())
        })
}
#[tauri::command]
pub async fn read_local_accounts(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
) -> Result<crate::local_accounts::AccountsSnapshot> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.read_accounts(&workspace_id))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn apply_local_account_change(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: crate::account_model::AccountChange,
) -> Result<crate::local_accounts::AccountResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_account_change(&workspace_id, input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn read_local_movements(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    include_classification: Option<bool>,
) -> Result<crate::local_movements::MovementsSnapshot> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if include_classification == Some(true) {
            state.read_movement_classifications(&workspace_id)
        } else {
            state.read_movements(&workspace_id)
        }
    })
    .await
    .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn apply_local_manual_movement(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: crate::movement_model::ManualCommand,
) -> Result<crate::local_movements::MovementResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_manual_movement(&workspace_id, input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}

#[tauri::command]
pub async fn read_local_transfers(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
) -> Result<crate::local_transfers::TransfersSnapshot> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.read_transfers(&workspace_id))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn apply_local_transfer(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: crate::transfer_model::Command,
) -> Result<crate::local_transfers::TransferResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_transfer(&workspace_id, input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}

#[tauri::command]
pub async fn read_local_card_payments(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
) -> Result<crate::local_card_payments::CardPaymentsSnapshot> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.read_card_payments(&workspace_id))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn apply_local_card_payment(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: crate::card_payment_model::Command,
) -> Result<crate::local_card_payments::CardPaymentResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_card_payment(&workspace_id, input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}

#[tauri::command]
pub async fn read_local_categories(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
) -> Result<crate::local_categories::CategoriesSnapshot> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.read_categories(&workspace_id))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn apply_local_category_change(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: crate::category_model::Command,
) -> Result<crate::local_categories::CategoryResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_category_change(&workspace_id, input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}

#[tauri::command]
pub async fn read_local_taxonomy(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
) -> Result<crate::local_taxonomy::TaxonomySnapshot> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.read_taxonomy(&workspace_id))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn apply_local_taxonomy_change(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: crate::taxonomy_model::Command,
) -> Result<crate::local_taxonomy::TaxonomyResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_taxonomy_change(&workspace_id, input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}

#[tauri::command]
pub async fn apply_local_classification_change(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: Vec<crate::classification_model::Command>,
) -> Result<crate::local_classification::ClassificationResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_classification(&workspace_id, input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}

#[tauri::command]
pub async fn apply_local_allocation_change(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: Vec<crate::allocation_model::Command>,
) -> Result<crate::local_allocations::AllocationResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || state.apply_allocations(&workspace_id, input))
        .await
        .map_err(|_| LocalError::StorageUnavailable)?
}

#[tauri::command]
pub async fn read_local_counterparties(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    include_movements: Option<bool>,
) -> Result<crate::local_counterparties::CounterpartySnapshot> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.read_counterparties(&workspace_id, include_movements.unwrap_or(false))
    })
    .await
    .map_err(|_| LocalError::StorageUnavailable)?
}
#[tauri::command]
pub async fn apply_local_counterparty_change(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: crate::counterparty_model::Command,
) -> Result<crate::local_counterparties::CounterpartyResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.apply_counterparty_change(&workspace_id, input)
    })
    .await
    .map_err(|_| LocalError::StorageUnavailable)?
}

#[tauri::command]
pub async fn apply_local_counterparty_association(
    state: State<'_, Arc<LocalState>>,
    workspace_id: String,
    input: Vec<crate::counterparty_association_model::Command>,
) -> Result<crate::local_counterparties::AssociationResult> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.apply_counterparty_association(&workspace_id, input)
    })
    .await
    .map_err(|_| LocalError::StorageUnavailable)?
}
