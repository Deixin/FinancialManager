//! Windows owns file selection. No path or generic filesystem API is in IPC.
use crate::{LocalError, Result, restore_source::RestoreSource};
use std::path::PathBuf;
pub struct WindowsImportSource;
#[cfg(windows)]
impl RestoreSource for WindowsImportSource {
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
            return Err(LocalError::StorageUnavailable);
        }
        unsafe {
            (|| -> windows::core::Result<Option<PathBuf>> {
                let dialog: IFileOpenDialog =
                    CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
                dialog.SetFileTypes(&[
                    COMDLG_FILTERSPEC {
                        pszName: w!("Extratos OFX e CSV"),
                        pszSpec: w!("*.ofx;*.csv"),
                    },
                    COMDLG_FILTERSPEC {
                        pszName: w!("Todos os arquivos"),
                        pszSpec: w!("*.*"),
                    },
                ])?;
                dialog.SetTitle(w!("Selecionar extrato para validação local"))?;
                dialog.SetOptions(
                    dialog.GetOptions()?
                        | FOS_DONTADDTORECENT
                        | FOS_FILEMUSTEXIST
                        | FOS_FORCEFILESYSTEM
                        | FOS_PATHMUSTEXIST
                        | FOS_NOCHANGEDIR,
                )?;
                if let Err(e) = dialog.Show(Some(HWND(window as *mut core::ffi::c_void))) {
                    if e.code().0 as u32 == 0x800704c7 {
                        return Ok(None);
                    }
                    return Err(e);
                }
                let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
                let path = name.to_string();
                CoTaskMemFree(Some(name.0.cast()));
                Ok(Some(PathBuf::from(path?)))
            })()
            .map_err(|_| LocalError::StorageUnavailable)
        }
    }
}
#[cfg(not(windows))]
impl RestoreSource for WindowsImportSource {
    fn choose(&self, _: isize) -> Result<Option<PathBuf>> {
        Err(LocalError::StorageUnavailable)
    }
}
