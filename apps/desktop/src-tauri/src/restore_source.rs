//! File selection is owned by Windows; no path is accepted from the WebView.
use crate::{LocalError, Result};
use std::path::PathBuf;
pub trait RestoreSource: Send + Sync {
    fn choose(&self, window: isize) -> Result<Option<PathBuf>>;
}
pub struct WindowsRestoreSource;
#[cfg(windows)]
impl RestoreSource for WindowsRestoreSource {
    fn choose(&self, window: isize) -> Result<Option<PathBuf>> {
        use windows::{
            Win32::{
                Foundation::HWND,
                System::Com::{CLSCTX_INPROC_SERVER, CoCreateInstance, CoTaskMemFree},
                UI::Shell::{
                    Common::COMDLG_FILTERSPEC, FOS_DONTADDTORECENT, FOS_FILEMUSTEXIST,
                    FOS_FORCEFILESYSTEM, FOS_NOCHANGEDIR, FOS_PATHMUSTEXIST, FileOpenDialog,
                    IFileOpenDialog, SIGDN_FILESYSPATH,
                },
            },
            core::w,
        };
        if window == 0 {
            return Err(LocalError::RestoreUnavailable);
        }
        // The Tauri UI thread has already initialized COM/WebView2.
        let result = unsafe {
            (|| -> windows::core::Result<Option<PathBuf>> {
                let dialog: IFileOpenDialog =
                    CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
                dialog.SetFileTypes(&[COMDLG_FILTERSPEC {
                    pszName: w!("Backup Financial Manager"),
                    pszSpec: w!("*.fmbackup"),
                }])?;
                dialog.SetTitle(w!("Selecionar backup criptografado"))?;
                dialog.SetOptions(
                    dialog.GetOptions()?
                        | FOS_DONTADDTORECENT
                        | FOS_FILEMUSTEXIST
                        | FOS_FORCEFILESYSTEM
                        | FOS_PATHMUSTEXIST
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
        result.map_err(|_| LocalError::RestoreUnavailable)
    }
}
#[cfg(not(windows))]
impl RestoreSource for WindowsRestoreSource {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Err(LocalError::RestoreUnavailable)
    }
}
