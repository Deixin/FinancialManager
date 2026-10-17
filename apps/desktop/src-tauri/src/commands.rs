use crate::{
    LocalError, Result,
    keys::KeyStore,
    local_lock::{ConfigurePin, LocalLock, LockStatus, PinInput},
    local_workspaces::{CreateWorkspace, Installation, Workspace},
    lock_store::PolicyStore,
};
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Manager, State};

pub struct LocalState {
    root: PathBuf,
    keys: Arc<dyn KeyStore>,
    policies: Arc<dyn PolicyStore>,
    installation: Mutex<Option<Session>>,
    force_locked: AtomicBool,
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
        Self {
            root,
            keys,
            policies,
            installation: Mutex::new(None),
            force_locked: AtomicBool::new(false),
        }
    }
    pub fn force_lock(&self) {
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
    pub fn status(&self) -> Result<LockStatus> {
        self.access(false, |s| {
            if s.privacy.is_unavailable() {
                s.privacy =
                    LocalLock::load(s.installation.id(), &self.root, self.policies.clone())?;
            }
            s.privacy.status(LocalLock::now()?)
        })
    }
    pub fn lock(&self) -> Result<LockStatus> {
        self.force_lock();
        self.status()
    }
    pub fn unlock(&self, input: PinInput) -> Result<LockStatus> {
        self.access(false, |s| s.privacy.unlock(&input, LocalLock::now()?))?;
        self.status()
    }
    pub fn configure(&self, input: ConfigurePin) -> Result<LockStatus> {
        self.access(false, |s| s.privacy.configure(&input, LocalLock::now()?))?;
        self.status()
    }
    pub fn disable(&self, input: PinInput) -> Result<LockStatus> {
        self.access(false, |s| s.privacy.disable(&input, LocalLock::now()?))?;
        self.status()
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
            disable_local_pin
        ])
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(false))
                && let Some(state) = window.try_state::<Arc<LocalState>>()
            {
                state.force_lock();
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
