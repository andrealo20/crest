//! System status for the closed notch's alerts: charger and battery, internet.
//!
//! One thread with a message-only window. Power settings arrive as WM_POWERBROADCAST and are
//! handled in the GetMessageW loop, so the thread sleeps at idle. The network callback
//! posts to the same loop, which settles it with a window timer. Each source registers on its own:
//! a failure is logged and leaves only that source off. What a source reads at registration goes
//! into the seed (`status://seed`, `status_seed`), never into a change event.

use std::sync::Mutex;
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::{w, GUID};
use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation, NetworkStatusChangedEventHandler};
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Power::{GetSystemPowerStatus, RegisterPowerSettingNotification, SYSTEM_POWER_STATUS};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, KillTimer, PostMessageW, RegisterClassW, SetTimer, DEVICE_NOTIFY_WINDOW_HANDLE,
    HWND_MESSAGE, MSG, PBT_POWERSETTINGCHANGE, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_POWERBROADCAST, WM_TIMER, WNDCLASSW,
};

// Not in the enabled features; values from winnt.h.
const GUID_ACDC_POWER_SOURCE: GUID = GUID::from_u128(0x5d3e9a59_e9d5_4b00_a6bd_ff34ff516548);
const GUID_BATTERY_PERCENTAGE_REMAINING: GUID = GUID::from_u128(0xa7ad8041_b45a_4cae_87a3_eecbb468a9e1);

/// WM_POWERBROADCAST is sent straight to the window procedure; it reposts this to reach the loop.
const WM_POWER: u32 = WM_APP + 1;
/// Posted from the WinRT threadpool on every network change.
const WM_NET: u32 = WM_APP + 2;
/// Network changes come in bursts (VPN, vSwitch, DHCP); only a state stable this long is sent.
const NET_TIMER: usize = 1;
const NET_SETTLE_MS: u32 = 2000;

#[derive(Serialize, Clone, Copy, PartialEq)]
pub struct Power {
    ac: bool,
    percent: Option<u8>,
    /// False on PCs without a battery.
    battery: bool,
}

/// Current state of each source, `null` while a source is off. Kept up to date after the
/// start so a page that loads late compares against what was last sent.
#[derive(Serialize, Clone)]
pub struct Seed {
    power: Option<Power>,
    online: Option<bool>,
    headsets: Vec<String>,
}

static SEED: Mutex<Seed> = Mutex::new(Seed { power: None, online: None, headsets: Vec::new() });

#[tauri::command]
pub fn status_seed() -> Seed {
    SEED.lock().unwrap().clone()
}

pub fn spawn(app: AppHandle) {
    thread::spawn(move || run(app));
}

fn run(app: AppHandle) {
    unsafe {
        if let Err(e) = CoInitializeEx(None, COINIT_MULTITHREADED).ok() {
            eprintln!("sysevents: COM init failed: {e}");
        }
        let Some(hwnd) = window() else {
            let _ = app.emit("status://seed", status_seed());
            return;
        };

        // Registering sends the current value at once; it matches the seed, so it emits nothing.
        let power_on = [GUID_ACDC_POWER_SOURCE, GUID_BATTERY_PERCENTAGE_REMAINING].iter().fold(false, |on, guid| {
            match RegisterPowerSettingNotification(HANDLE(hwnd.0), guid, DEVICE_NOTIFY_WINDOW_HANDLE) {
                Ok(_) => true,
                Err(e) => {
                    eprintln!("sysevents: power notification failed: {e}");
                    on
                }
            }
        });
        if power_on {
            SEED.lock().unwrap().power = power();
        }

        let h = hwnd.0 as isize;
        let handler = NetworkStatusChangedEventHandler::new(move |_| {
            let _ = PostMessageW(Some(HWND(h as _)), WM_NET, WPARAM(0), LPARAM(0));
            Ok(())
        });
        match NetworkInformation::NetworkStatusChanged(&handler) {
            Ok(_) => SEED.lock().unwrap().online = Some(online()),
            Err(e) => eprintln!("sysevents: network notification failed: {e}"),
        }

        let _ = app.emit("status://seed", status_seed());

        // Runs for the app's lifetime; process exit releases the registrations.
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            match msg.message {
                WM_POWER => {
                    let now = power();
                    let mut seed = SEED.lock().unwrap();
                    if now.is_some() && now != seed.power {
                        seed.power = now;
                        let _ = app.emit("status://power", now);
                    }
                }
                // Same id re-arms the timer, so it fires 2 s after the last change.
                WM_NET => {
                    SetTimer(Some(hwnd), NET_TIMER, NET_SETTLE_MS, None);
                }
                WM_TIMER if msg.wParam.0 == NET_TIMER => {
                    let _ = KillTimer(Some(hwnd), NET_TIMER);
                    let now = Some(online());
                    let mut seed = SEED.lock().unwrap();
                    if now != seed.online {
                        seed.online = now;
                        let _ = app.emit("status://net", serde_json::json!({ "online": now }));
                    }
                }
                _ => {
                    DispatchMessageW(&msg);
                }
            }
        }
    }
}

/// Message-only window with its own class: no broadcasts, only what is registered on it.
unsafe fn window() -> Option<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        let class = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: instance.into(), lpszClassName: w!("CrestSysEvents"), ..Default::default() };
        if RegisterClassW(&class) == 0 {
            eprintln!("sysevents: window class failed: {}", windows::core::Error::from_thread());
            return None;
        }
        CreateWindowExW(WINDOW_EX_STYLE::default(), w!("CrestSysEvents"), w!(""), WINDOW_STYLE::default(), 0, 0, 0, 0, Some(HWND_MESSAGE), None, Some(instance.into()), None)
            .inspect_err(|e| eprintln!("sysevents: window failed: {e}"))
            .ok()
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
        if msg == WM_POWERBROADCAST && wparam.0 as u32 == PBT_POWERSETTINGCHANGE {
            let _ = PostMessageW(Some(hwnd), WM_POWER, WPARAM(0), LPARAM(0));
            return LRESULT(1);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

fn power() -> Option<Power> {
    let mut s = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut s) }.ok()?;
    // 128 = no system battery; 255 = unknown percent.
    let battery = s.BatteryFlag & 128 == 0;
    Some(Power { ac: s.ACLineStatus == 1, percent: (battery && s.BatteryLifePercent <= 100).then_some(s.BatteryLifePercent), battery })
}

/// No internet profile (cable out, Wi-Fi off) counts as offline.
fn online() -> bool {
    NetworkInformation::GetInternetConnectionProfile()
        .and_then(|p| p.GetNetworkConnectivityLevel())
        .is_ok_and(|level| level == NetworkConnectivityLevel::InternetAccess)
}
