use crate::{
    LocalError, Result,
    backup_destination::{BackupDestination, WindowsBackupDestination},
    keys::KeyStore,
    local_backup::{BackupResult, CreateBackup, SealedBackup},
    local_lock::{ConfigurePin, LocalLock, LockStatus, PinInput},
    local_workspaces::{CreateWorkspace, Installation, Workspace},
    lock_store::PolicyStore,
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
}
pub struct BackupJob {
    sealed: SealedBackup,
    lease: BackupLease,
    _permit: BackupPermit,
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
        }
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
            });
        }
        let session = state.as_mut().ok_or(LocalError::StorageUnavailable)?;
        if self.force_locked.swap(false, Ordering::SeqCst) {
            session.privacy.lock();
        }
        if sensitive {
            session.privacy.require_open()?;
        }
        let result = action(session);
        if self.force_locked.swap(false, Ordering::SeqCst) {
            session.privacy.lock();
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
        self.with(|i| i.create(input))
    }
    pub fn open(&self, id: &str) -> Result<Workspace> {
        self.with(|i| i.open_workspace(id))
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
            create_local_backup
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
