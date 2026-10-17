//! Native-only save picker; the renderer never supplies a filesystem path.
use crate::{LocalError, Result};
use std::path::PathBuf;
pub trait BackupDestination: Send + Sync {
    /// Must run on Tauri's UI thread; window comes from the invoking native window.
    fn choose(&self, window: isize) -> Result<Option<PathBuf>>;
}
pub struct WindowsBackupDestination;
#[cfg(windows)]
impl BackupDestination for WindowsBackupDestination {
    fn choose(&self, window: isize) -> Result<Option<PathBuf>> {
        use windows::{
            Win32::{
                Foundation::HWND,
                System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance, CoTaskMemFree},
                UI::Shell::{
                    Common::COMDLG_FILTERSPEC, FOS_DONTADDTORECENT, FOS_FORCEFILESYSTEM,
                    FOS_NOCHANGEDIR, FOS_PATHMUSTEXIST, FOS_STRICTFILETYPES, FileSaveDialog,
                    IFileSaveDialog, SIGDN_FILESYSPATH,
                },
            },
            core::w,
        };
        if window == 0 {
            return Err(LocalError::BackupDestinationUnavailable);
        }
        // Tauri/WebView2 initialized COM on this UI thread. Errors are never serialized raw.
        let result = unsafe {
            (|| -> windows::core::Result<Option<PathBuf>> {
                let dialog: IFileSaveDialog =
                    CoCreateInstance(&FileSaveDialog, None, CLSCTX_INPROC_SERVER)?;
                dialog.SetFileTypes(&[COMDLG_FILTERSPEC {
                    pszName: w!("Backup Financial Manager"),
                    pszSpec: w!("*.fmbackup"),
                }])?;
                dialog.SetDefaultExtension(w!("fmbackup"))?;
                dialog.SetFileName(w!("FinancialManager.fmbackup"))?;
                dialog.SetTitle(w!("Criar novo backup criptografado"))?;
                dialog.SetOptions(
                    dialog.GetOptions()?
                        | FOS_DONTADDTORECENT
                        | FOS_FORCEFILESYSTEM
                        | FOS_PATHMUSTEXIST
                        | FOS_STRICTFILETYPES
                        | FOS_NOCHANGEDIR,
                )?;
                if let Err(error) = dialog.Show(Some(HWND(window as *mut core::ffi::c_void))) {
                    if error.code().0 as u32 == 0x800704c7 {
                        return Ok(None);
                    }
                    return Err(error);
                }
                let selected = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
                let path = selected.to_string();
                CoTaskMemFree(Some(selected.0.cast()));
                Ok(Some(PathBuf::from(path?)))
            })()
        };
        result.map_err(|_| LocalError::BackupDestinationUnavailable)
    }
}
#[cfg(not(windows))]
impl BackupDestination for WindowsBackupDestination {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Err(LocalError::BackupDestinationUnavailable)
    }
}
