use crate::{
    LocalError, Result,
    keys::KeyStore,
    local_workspaces::{CreateWorkspace, Installation, Workspace},
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Manager, State};

pub struct LocalState {
    root: PathBuf,
    keys: Arc<dyn KeyStore>,
    installation: Mutex<Option<Installation>>,
}
impl LocalState {
    pub fn new(root: PathBuf, keys: Arc<dyn KeyStore>) -> Self {
        Self {
            root,
            keys,
            installation: Mutex::new(None),
        }
    }
    fn with<T>(&self, action: impl FnOnce(&Installation) -> Result<T>) -> Result<T> {
        let mut state = self
            .installation
            .lock()
            .map_err(|_| LocalError::StorageUnavailable)?;
        if state.is_none() {
            *state = Some(Installation::open(&self.root, self.keys.clone())?);
        }
        action(state.as_ref().ok_or(LocalError::StorageUnavailable)?)
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
pub fn production_builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            list_local_workspaces,
            create_local_workspace,
            open_local_workspace
        ])
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
