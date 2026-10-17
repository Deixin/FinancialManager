//! OS consent only: no biometric material or Windows PIN enters this process.
use crate::{LocalError, Result};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum HelloAvailability {
    Available,
    NotConfigured,
    DisabledByPolicy,
    DeviceBusy,
    Unavailable,
}
pub trait HelloVerifier: Send + Sync {
    fn availability(&self) -> HelloAvailability;
    /// `window` must be obtained from the application's native window, never IPC input.
    fn verify(&self, window: isize) -> Result<()>;
}
pub struct WindowsHello;

#[cfg(windows)]
mod native {
    use super::*;
    use windows::{
        Security::Credentials::UI::{
            UserConsentVerificationResult as Verification, UserConsentVerifier,
            UserConsentVerifierAvailability as Availability,
        },
        Win32::{
            Foundation::HWND,
            System::WinRT::{
                IUserConsentVerifierInterop, RO_INIT_MULTITHREADED, RoInitialize, RoUninitialize,
            },
        },
        core::{HSTRING, factory},
    };
    struct Apartment;
    impl Apartment {
        fn initialize() -> Result<Self> {
            // Called on a blocking worker. Balance even S_FALSE with RoUninitialize.
            unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
                .map_err(|_| LocalError::HelloUnavailable)?;
            Ok(Self)
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) {
            unsafe { RoUninitialize() };
        }
    }
    impl HelloVerifier for WindowsHello {
        fn availability(&self) -> HelloAvailability {
            let Ok(_apartment) = Apartment::initialize() else {
                return HelloAvailability::Unavailable;
            };
            if factory::<UserConsentVerifier, IUserConsentVerifierInterop>().is_err() {
                return HelloAvailability::Unavailable;
            }
            match UserConsentVerifier::CheckAvailabilityAsync().and_then(|op| op.join()) {
                Ok(Availability::Available) => HelloAvailability::Available,
                Ok(Availability::NotConfiguredForUser) => HelloAvailability::NotConfigured,
                Ok(Availability::DisabledByPolicy) => HelloAvailability::DisabledByPolicy,
                Ok(Availability::DeviceBusy) => HelloAvailability::DeviceBusy,
                _ => HelloAvailability::Unavailable,
            }
        }
        fn verify(&self, window: isize) -> Result<()> {
            if window == 0 {
                return Err(LocalError::HelloUnavailable);
            }
            let _apartment = Apartment::initialize()?;
            let interop = factory::<UserConsentVerifier, IUserConsentVerifierInterop>()
                .map_err(|_| LocalError::HelloUnavailable)?;
            // HWND belongs to the invoking Tauri window. This desktop API owns its prompt.
            let operation: windows_future::IAsyncOperation<Verification> = unsafe {
                interop.RequestVerificationForWindowAsync(
                    HWND(window as *mut core::ffi::c_void),
                    &HSTRING::from("Libere o acesso local ao Financial Manager."),
                )
            }
            .map_err(|_| LocalError::HelloUnavailable)?;
            match operation.join() {
                Ok(Verification::Verified) => Ok(()),
                Ok(Verification::Canceled) => Err(LocalError::HelloCanceled),
                Ok(Verification::RetriesExhausted) => Err(LocalError::HelloFailed),
                _ => Err(LocalError::HelloUnavailable),
            }
        }
    }
}
#[cfg(not(windows))]
impl HelloVerifier for WindowsHello {
    fn availability(&self) -> HelloAvailability {
        HelloAvailability::Unavailable
    }
    fn verify(&self, _: isize) -> Result<()> {
        Err(LocalError::HelloUnavailable)
    }
}
