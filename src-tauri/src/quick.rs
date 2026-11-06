//! Overview's quick controls: Wi-Fi and Bluetooth radios, the dark theme, and lock, sleep, restart and shut down.
//!
//! - Radios: `Windows.Devices.Radios`, the API the quick settings use; a PC without a Wi-Fi or Bluetooth radio reports none.
//! - Dark theme: the two values Settings, Personalisation, Colours writes, then the broadcast that makes open windows repaint.
//! - Restart and shut down go through shutdown.exe, which holds the privilege a process would otherwise have to enable.

use serde::Serialize;
use windows::core::{w, HSTRING};
use windows::Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState};
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::Registry::{RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD};
use windows::Win32::UI::WindowsAndMessaging::{SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE};

const PERSONALIZE: windows::core::PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quick {
    /// None: no such radio on this PC.
    wifi: Option<bool>,
    bluetooth: Option<bool>,
    dark: bool,
    /// The default microphone is muted; None: no microphone (mic.rs).
    mic_muted: Option<bool>,
}

fn kind_of(name: &str) -> Option<RadioKind> {
    match name {
        "wifi" => Some(RadioKind::WiFi),
        "bluetooth" => Some(RadioKind::Bluetooth),
        _ => None,
    }
}

fn radios() -> windows::core::Result<Vec<Radio>> {
    Ok(Radio::GetRadiosAsync()?.join()?.into_iter().collect())
}

fn of_kind(list: &[Radio], kind: RadioKind) -> impl Iterator<Item = &Radio> {
    list.iter().filter(move |r| r.Kind().is_ok_and(|k| k == kind))
}

/// On when any radio of that kind is (a USB adapter next to the built-in one); None when there is none.
fn radio_on(list: &[Radio], kind: RadioKind) -> Option<bool> {
    let states: Vec<_> = of_kind(list, kind).filter_map(|r| r.State().ok()).collect();
    (!states.is_empty()).then(|| states.contains(&RadioState::On))
}

fn dark() -> bool {
    let mut value = 1u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, PERSONALIZE, w!("AppsUseLightTheme"), RRF_RT_REG_DWORD, None, Some(&mut value as *mut u32 as *mut _), Some(&mut size)) };
    read.is_ok() && value == 0
}

/// Runs `job` with COM on a thread of its own: the radio calls wait on WinRT operations.
async fn blocking<T: Send + 'static>(job: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        job()
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_get() -> Result<Quick, String> {
    blocking(|| {
        // One read of the list for both radios.
        let list = radios().unwrap_or_default();
        Quick { wifi: radio_on(&list, RadioKind::WiFi), bluetooth: radio_on(&list, RadioKind::Bluetooth), dark: dark(), mic_muted: crate::mic::muted() }
    })
    .await
}

/// Turns a radio ("wifi", "bluetooth") on or off. "denied": Windows' privacy settings keep apps from it.
#[tauri::command]
pub async fn quick_radio(kind: String, on: bool) -> Result<(), String> {
    let kind = kind_of(&kind).ok_or("unknown")?;
    blocking(move || -> Result<(), String> {
        if Radio::RequestAccessAsync().and_then(|a| a.join()).map_err(|e| e.to_string())? != RadioAccessStatus::Allowed {
            return Err("denied".into());
        }
        let list = radios().map_err(|e| e.to_string())?;
        let mut found = false;
        for r in of_kind(&list, kind) {
            found = true;
            if r.SetStateAsync(if on { RadioState::On } else { RadioState::Off }).and_then(|a| a.join()).map_err(|e| e.to_string())? != RadioAccessStatus::Allowed {
                return Err("denied".into());
            }
        }
        if found { Ok(()) } else { Err("none".into()) }
    })
    .await?
}

/// Dark or light for apps and for Windows itself, as Settings sets them. The Store package's registry writes land in its own
/// copy of the user's hive, which Windows does not read for the theme: there it opens Settings, Colours, and says "settings".
// `async`: runs off the main thread; the broadcast waits on every top-level window.
#[tauri::command(async)]
pub fn quick_dark(on: bool) -> Result<(), String> {
    if cfg!(feature = "store") {
        crate::open_url("ms-settings:colors")?;
        return Err("settings".into());
    }
    let light: u32 = if on { 0 } else { 1 };
    for name in [w!("AppsUseLightTheme"), w!("SystemUsesLightTheme")] {
        unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, PERSONALIZE, name, REG_DWORD.0, Some(&light as *const u32 as *const _), 4) }.ok().map_err(|e| e.to_string())?;
    }
    let topic = HSTRING::from("ImmersiveColorSet");
    unsafe {
        let _ = SendMessageTimeoutW(HWND_BROADCAST, WM_SETTINGCHANGE, WPARAM(0), LPARAM(topic.as_ptr() as isize), SMTO_ABORTIFHUNG, 500, None);
    }
    Ok(())
}

/// "lock", "sleep", "restart" or "shutdown". The frontend asks for a second click before the last three.
#[tauri::command(async)]
pub fn quick_power(action: String) -> Result<(), String> {
    use windows::Win32::System::Power::SetSuspendState;
    use windows::Win32::System::Shutdown::LockWorkStation;
    match action.as_str() {
        "lock" => unsafe { LockWorkStation() }.map_err(|e| e.to_string()),
        // Not hibernate, not forced, wake events kept.
        "sleep" => unsafe { SetSuspendState(false, false, false) }.then_some(()).ok_or_else(|| "failed".to_string()),
        "restart" | "shutdown" => {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            let root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
            std::process::Command::new(format!(r"{root}\System32\shutdown.exe"))
                .args([if action == "restart" { "/r" } else { "/s" }, "/t", "0"])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map(drop)
                .map_err(|e| e.to_string())
        }
        _ => Err("unknown".into()),
    }
}

#[cfg(test)]
mod live {
    //! Reads the radios and the theme, changes nothing: `cargo test --lib quick::live -- --ignored --nocapture`.
    use super::*;

    #[test]
    #[ignore]
    fn reads_radios_and_theme() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let list = radios().unwrap_or_default();
        eprintln!("wifi {:?} bluetooth {:?} dark {}", radio_on(&list, RadioKind::WiFi), radio_on(&list, RadioKind::Bluetooth), dark());
    }
}
