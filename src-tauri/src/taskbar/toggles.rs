//! Windows buttons of the bar that switch something of Windows (design K): the desktop's icons and the mobile hotspot.
//!
//! - Desktop icons: read from the desktop's list window, which shows or hides with them however they were switched (the desktop's
//!   menu included). A switch first sets the documented folder flag FWF_NOICONS on the desktop's view, found from another process
//!   as in Raymond Chen's "Manipulating the positions of desktop icons" (The Old New Thing, 2013); if the list still shows as it
//!   was, the desktop menu's own Show desktop icons command follows (decisions W11 and W16). Never a restart of Explorer.
//! - Mobile hotspot: Windows.Networking.NetworkOperators' tethering manager on the internet profile, as Settings' Mobile hotspot
//!   page. Only its state and how many devices use it: never the network's name or password (GetCurrentAccessPointConfiguration)
//!   nor the devices themselves (GetTetheringClients). It needs no administrator and, outside a package, no capability.

use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::{w, Interface, PCWSTR};
use windows::Networking::Connectivity::NetworkInformation;
use windows::Networking::NetworkOperators::{NetworkOperatorTetheringManager, TetheringCapability, TetheringOperationStatus, TetheringOperationalState};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::System::Com::{CoCreateInstance, IServiceProvider, CLSCTX_ALL};
use windows::Win32::System::Variant::VARIANT;
use windows::Win32::UI::Shell::{IFolderView2, IShellBrowser, IShellWindows, ShellWindows, SID_STopLevelBrowser, CSIDL_DESKTOP, FWF_NOICONS, SWC_DESKTOP, SWFO_NEEDDISPATCH};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, GetShellWindow, IsWindowVisible, SendMessageTimeoutW, SMTO_ABORTIFHUNG, WM_COMMAND};

use crate::{launcher, quick};

/// The id of the desktop menu's View, Show desktop icons item: Explorer's own command, not an API, and a toggle.
const SHOW_ICONS_COMMAND: usize = 0x7402;
/// How long a switch waits for the desktop's list to show or hide.
const SETTLE: Duration = Duration::from_millis(400);

/// Whether the desktop's folder flags let it show icons.
fn icons_shown(flags: u32) -> bool {
    flags & FWF_NOICONS.0 as u32 == 0
}

/// The desktop's view window and its list of icons: under Progman, or under a WorkerW where a wallpaper slideshow or Task view moved it.
fn desktop() -> Option<(HWND, HWND)> {
    let list = |view: HWND| unsafe { FindWindowExW(Some(view), None, w!("SysListView32"), PCWSTR::null()) }.ok().map(|list| (view, list));
    unsafe {
        let progman = GetShellWindow();
        if !progman.is_invalid() {
            if let Ok(view) = FindWindowExW(Some(progman), None, w!("SHELLDLL_DefView"), PCWSTR::null()) {
                return list(view);
            }
        }
        let mut after = None;
        while let Ok(worker) = FindWindowExW(None, after, w!("WorkerW"), PCWSTR::null()) {
            if let Ok(view) = FindWindowExW(Some(worker), None, w!("SHELLDLL_DefView"), PCWSTR::null()) {
                return list(view);
            }
            after = Some(worker);
        }
    }
    None
}

fn shows(list: HWND) -> bool {
    unsafe { IsWindowVisible(list).as_bool() }
}

/// Waits up to SETTLE for the list to show (or hide) as asked.
fn settles(list: HWND, show: bool) -> bool {
    let start = Instant::now();
    loop {
        if shows(list) == show {
            return true;
        }
        if start.elapsed() >= SETTLE {
            return false;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// The desktop's folder view in Explorer's process. COM, on an STA thread.
unsafe fn desktop_view() -> windows::core::Result<IFolderView2> {
    let windows: IShellWindows = CoCreateInstance(&ShellWindows, None, CLSCTX_ALL)?;
    let mut hwnd = 0;
    let found = windows.FindWindowSW(&VARIANT::from(CSIDL_DESKTOP as i32), &VARIANT::default(), SWC_DESKTOP, &mut hwnd, SWFO_NEEDDISPATCH)?;
    let browser: IShellBrowser = found.cast::<IServiceProvider>()?.QueryService(&SID_STopLevelBrowser)?;
    browser.QueryActiveShellView()?.cast()
}

/// Shows or hides the icons and waits for the list to follow: the folder flag first, then while the list still shows as it was the
/// desktop menu's command, which toggles, so it goes only then.
// shortcut: a folder flag that takes effect only after SETTLE would meet the menu command and undo it; raise SETTLE if a PC shows that
fn switch_icons(show: bool) -> Result<(), &'static str> {
    let (view, list) = desktop().ok_or("desktop")?;
    if shows(list) == show {
        return Ok(());
    }
    if let Ok(folder) = unsafe { desktop_view() } {
        let flags = unsafe { folder.GetCurrentFolderFlags() }.unwrap_or(0);
        if icons_shown(flags) != show {
            let _ = unsafe { folder.SetCurrentFolderFlags(FWF_NOICONS.0 as u32, if show { 0 } else { FWF_NOICONS.0 as u32 }) };
        }
    }
    if settles(list, show) {
        return Ok(());
    }
    unsafe {
        let _ = SendMessageTimeoutW(view, WM_COMMAND, WPARAM(SHOW_ICONS_COMMAND), LPARAM(0), SMTO_ABORTIFHUNG, 1000, None);
    }
    if settles(list, show) { Ok(()) } else { Err("failed") }
}

/// Whether the desktop shows its icons; "desktop" while Explorer's desktop cannot be found (Explorer restarting).
#[tauri::command]
pub async fn taskbar_desktop_icons() -> Result<bool, String> {
    desktop().map(|(_, list)| shows(list)).ok_or_else(|| "desktop".into())
}

/// Shows or hides the desktop's icons; "desktop" or "failed". Off the calling thread: COM into Explorer, then a short wait.
#[tauri::command]
pub async fn taskbar_desktop_icons_set(show: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || launcher::on_sta(move || switch_icons(show)))
        .await
        .map_err(|e| e.to_string())?
        .ok_or("failed")?
        .map_err(Into::into)
}

/// The mobile hotspot: "on", "off", "turning", or why it cannot be used ("offline", "policy", "denied", "unsupported"); how many
/// devices use it and how many may.
#[derive(Serialize, Debug, PartialEq)]
pub struct Hotspot {
    state: &'static str,
    clients: u32,
    max: u32,
}

/// None while the PC may share its connection, else why not: a group policy, the system (a package without wiFiControl), or this PC.
fn capability_state(c: TetheringCapability) -> Option<&'static str> {
    match c {
        TetheringCapability::Enabled => None,
        TetheringCapability::DisabledByGroupPolicy => Some("policy"),
        TetheringCapability::DisabledBySystemCapability => Some("denied"),
        _ => Some("unsupported"),
    }
}

/// An unknown state reads as off: a click then tries to turn it on, and Windows says why not.
fn operational(s: TetheringOperationalState) -> &'static str {
    match s {
        TetheringOperationalState::On => "on",
        TetheringOperationalState::InTransition => "turning",
        _ => "off",
    }
}

/// What a start or stop answered, as the bar's words (toggles.ts hotspotNote).
fn tether_code(s: TetheringOperationStatus) -> Result<(), &'static str> {
    match s {
        TetheringOperationStatus::Success | TetheringOperationStatus::AlreadyOn => Ok(()),
        TetheringOperationStatus::WiFiDeviceOff => Err("wifi-off"),
        TetheringOperationStatus::BluetoothDeviceOff => Err("bt-off"),
        TetheringOperationStatus::NetworkLimitedConnectivity => Err("limited"),
        TetheringOperationStatus::OperationInProgress => Err("busy"),
        TetheringOperationStatus::EntitlementCheckTimeout | TetheringOperationStatus::EntitlementCheckFailure | TetheringOperationStatus::MobileBroadbandDeviceOff => {
            Err("operator")
        }
        _ => Err("failed"),
    }
}

/// The tethering manager of the internet profile, or why there is none: "offline" without internet, else the capability's word.
/// Creating it changes nothing.
fn manager() -> Result<NetworkOperatorTetheringManager, &'static str> {
    let profile = NetworkInformation::GetInternetConnectionProfile().map_err(|_| "offline")?;
    let capability = NetworkOperatorTetheringManager::GetTetheringCapabilityFromConnectionProfile(&profile).map_err(|_| "unsupported")?;
    if let Some(why) = capability_state(capability) {
        return Err(why);
    }
    NetworkOperatorTetheringManager::CreateFromConnectionProfile(&profile).map_err(|_| "denied")
}

fn hotspot_now() -> Hotspot {
    match manager() {
        Ok(m) => Hotspot {
            state: operational(m.TetheringOperationalState().unwrap_or(TetheringOperationalState::Unknown)),
            clients: m.ClientCount().unwrap_or(0),
            max: m.MaxClientCount().unwrap_or(0),
        },
        Err(why) => Hotspot { state: why, clients: 0, max: 0 },
    }
}

/// The mobile hotspot's state and how many devices use it; never the network's name, its password or the devices' names.
#[tauri::command]
pub async fn taskbar_hotspot() -> Result<Hotspot, String> {
    quick::blocking(hotspot_now).await
}

/// Turns the mobile hotspot on or off, as the click asks; already so, it asks Windows nothing. Rejects with tether_code's words,
/// "offline" or "failed".
#[tauri::command]
pub async fn taskbar_hotspot_set(on: bool) -> Result<(), String> {
    quick::blocking(move || -> Result<(), String> {
        let m = manager()?;
        let want = if on { TetheringOperationalState::On } else { TetheringOperationalState::Off };
        if m.TetheringOperationalState().is_ok_and(|s| s == want) {
            return Ok(());
        }
        // Waits while Windows turns it on or off, seconds at most: on the blocking pool, never the main thread.
        let done = if on { m.StartTetheringAsync() } else { m.StopTetheringAsync() };
        let status = done.and_then(|d| d.join()).and_then(|r| r.Status()).map_err(|_| "failed")?;
        Ok(tether_code(status)?)
    })
    .await?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_no_icons_flag_hides_them() {
        assert!(icons_shown(0));
        assert!(!icons_shown(0x1000));
        // FWF_NOICONS among the desktop's other flags (FWF_DESKTOP, FWF_NOCLIENTEDGE, FWF_NOSCROLL, FWF_SNAPTOGRID...).
        assert!(!icons_shown(0x1225));
        assert!(icons_shown(0x0225));
    }

    #[test]
    fn each_capability_says_why_it_cannot_share() {
        assert_eq!(capability_state(TetheringCapability::Enabled), None);
        assert_eq!(capability_state(TetheringCapability::DisabledByGroupPolicy), Some("policy"));
        assert_eq!(capability_state(TetheringCapability::DisabledBySystemCapability), Some("denied"));
        for c in [
            TetheringCapability::DisabledByHardwareLimitation,
            TetheringCapability::DisabledByOperator,
            TetheringCapability::DisabledBySku,
            TetheringCapability::DisabledByRequiredAppNotInstalled,
            TetheringCapability::DisabledDueToUnknownCause,
        ] {
            assert_eq!(capability_state(c), Some("unsupported"), "{c:?}");
        }
    }

    #[test]
    fn each_state_reads_as_the_button_draws_it() {
        assert_eq!(operational(TetheringOperationalState::On), "on");
        assert_eq!(operational(TetheringOperationalState::Off), "off");
        assert_eq!(operational(TetheringOperationalState::InTransition), "turning");
        assert_eq!(operational(TetheringOperationalState::Unknown), "off");
    }

    #[test]
    fn each_answer_of_a_switch_has_its_word() {
        use TetheringOperationStatus as S;
        assert_eq!(tether_code(S::Success), Ok(()));
        // A start that finds it on did what the click asked.
        assert_eq!(tether_code(S::AlreadyOn), Ok(()));
        assert_eq!(tether_code(S::WiFiDeviceOff), Err("wifi-off"));
        assert_eq!(tether_code(S::BluetoothDeviceOff), Err("bt-off"));
        assert_eq!(tether_code(S::NetworkLimitedConnectivity), Err("limited"));
        assert_eq!(tether_code(S::OperationInProgress), Err("busy"));
        assert_eq!(tether_code(S::EntitlementCheckTimeout), Err("operator"));
        assert_eq!(tether_code(S::EntitlementCheckFailure), Err("operator"));
        assert_eq!(tether_code(S::MobileBroadbandDeviceOff), Err("operator"));
        for s in [S::Unknown, S::RadioRestriction, S::BandInterference, TetheringOperationStatus(99)] {
            assert_eq!(tether_code(s), Err("failed"), "{s:?}");
        }
    }
}

#[cfg(test)]
mod live {
    //! Reads only, never switches (decision W17): `cargo test --lib taskbar::toggles::live -- --ignored --nocapture`.
    use super::*;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    /// K1: the desktop's list, its folder flags and the HideIcons value Explorer keeps for its menu.
    #[test]
    #[ignore]
    fn reads_the_desktop_icons() {
        let found = desktop();
        eprintln!("view and list {found:?}, list shows {:?}", found.map(|(_, list)| shows(list)));
        let flags = launcher::on_sta(|| unsafe { desktop_view().and_then(|v| v.GetCurrentFolderFlags()) });
        eprintln!("folder flags {:x?}, icons shown by flags {:?}", flags, flags.as_ref().map(|f| f.as_ref().map(|&f| icons_shown(f))));
        let mut value = 0u32;
        let mut size = 4u32;
        let read = unsafe {
            RegGetValueW(HKEY_CURRENT_USER, w!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced"), w!("HideIcons"), RRF_RT_REG_DWORD, None, Some(&mut value as *mut u32 as *mut _), Some(&mut size))
        };
        eprintln!("HideIcons {:?}", read.is_ok().then_some(value));
    }

    /// K2: the hotspot's capability and state, from this unpackaged process; turns nothing on.
    #[test]
    #[ignore]
    fn reads_the_hotspot() {
        let h = tauri::async_runtime::block_on(taskbar_hotspot());
        eprintln!("hotspot {h:?}");
    }
}
