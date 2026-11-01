//! System status for the closed notch's alerts: charger and battery, internet,
//! Bluetooth headphones.
//!
//! One thread with a message-only window. Power settings arrive as WM_POWERBROADCAST and are
//! handled in the GetMessageW loop, so the thread sleeps at idle. The network and audio
//! endpoint callbacks only post to the same loop; the network is settled with a window timer. Each source registers on its own:
//! a failure is logged and leaves only that source off. What a source reads at registration goes
//! into the seed (`status://seed`, `status_seed`), never into a change event.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};
use std::thread;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::{implement, w, GUID, PCWSTR};
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_DevNode_PropertyW, CM_Get_Device_ID_ListW, CM_Get_Device_ID_List_SizeW, CM_Locate_DevNodeW, CM_GETIDLIST_FILTER_ENUMERATOR,
    CM_GETIDLIST_FILTER_PRESENT, CM_LOCATE_DEVNODE_NORMAL, CR_SUCCESS,
};
use windows::Win32::Devices::Properties::{DEVPKEY_Device_ContainerId, DEVPROPTYPE, DEVPROP_TYPE_BYTE, DEVPROP_TYPE_GUID};
use windows::Win32::Media::Audio::{
    eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE, DEVICE_STATE_ACTIVE,
};
use windows::Win32::System::Com::StructuredStorage::{PropVariantToGUID, PropVariantToStringAlloc};
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation, NetworkStatusChangedEventHandler};
use windows::Win32::Foundation::{DEVPROPKEY, HANDLE, HWND, LPARAM, LRESULT, PROPERTYKEY, WPARAM};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Power::{GetSystemPowerStatus, RegisterPowerSettingNotification, SYSTEM_POWER_STATUS};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, KillTimer, PostMessageW, RegisterClassW, SetTimer, DEVICE_NOTIFY_WINDOW_HANDLE,
    HWND_MESSAGE, MSG, PBT_POWERSETTINGCHANGE, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_POWERBROADCAST, WM_TIMER, WNDCLASSW,
};

// Not in the enabled features; values from winnt.h.
const GUID_ACDC_POWER_SOURCE: GUID = GUID::from_u128(0x5d3e9a59_e9d5_4b00_a6bd_ff34ff516548);
const GUID_BATTERY_PERCENTAGE_REMAINING: GUID = GUID::from_u128(0xa7ad8041_b45a_4cae_87a3_eecbb468a9e1);
// Endpoint properties (functiondiscoverykeys_devpkey.h).
const PKEY_DEVICE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };
const PKEY_DEVICE_ENUMERATOR_NAME: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 24 };
const PKEY_DEVICE_INTERFACE_FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x026e516e_b814_414b_83cd_856d6fef4822), pid: 2 };
const PKEY_DEVICE_CONTAINER_ID: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x8c7ed206_3f8a_4827_b3ab_ae9e1faefc6c), pid: 2 };
/// Battery level Windows takes from the hands-free indicators; not in the crate.
const DEVPKEY_BLUETOOTH_BATTERY: DEVPROPKEY = DEVPROPKEY { fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5), pid: 2 };

/// WM_POWERBROADCAST is sent straight to the window procedure; it reposts this to reach the loop.
const WM_POWER: u32 = WM_APP + 1;
/// Posted from the WinRT threadpool on every network change.
const WM_NET: u32 = WM_APP + 2;
/// Network changes come in bursts (VPN, vSwitch, DHCP); only a state stable this long is sent.
const NET_TIMER: usize = 1;
const NET_SETTLE_MS: u32 = 2000;
/// Posted from the audio service thread on endpoint changes.
const WM_BT: u32 = WM_APP + 3;

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

/// A panic elsewhere must not take the alerts down with it: the seed stays readable.
fn seed() -> MutexGuard<'static, Seed> {
    SEED.lock().unwrap_or_else(|e| e.into_inner())
}

#[tauri::command]
pub fn status_seed() -> Seed {
    seed().clone()
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
            seed().power = power();
        }

        let h = hwnd.0 as isize;
        let handler = NetworkStatusChangedEventHandler::new(move |_| {
            let _ = PostMessageW(Some(HWND(h as _)), WM_NET, WPARAM(0), LPARAM(0));
            Ok(())
        });
        match NetworkInformation::NetworkStatusChanged(&handler) {
            Ok(_) => seed().online = Some(online()),
            Err(e) => eprintln!("sysevents: network notification failed: {e}"),
        }

        // Enumerator and client live as long as the loop; nothing is unregistered in a callback.
        let client: IMMNotificationClient = Endpoints(h).into();
        let devices = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .and_then(|d| d.RegisterEndpointNotificationCallback(&client).map(|()| d))
            .inspect_err(|e| eprintln!("sysevents: audio endpoint notification failed: {e}"))
            .ok();
        let mut groups = devices.as_ref().map(headsets).unwrap_or_default();
        seed().headsets = groups.values().cloned().collect();

        let _ = app.emit("status://seed", status_seed());

        // Runs for the app's lifetime; process exit releases the registrations.
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            match msg.message {
                WM_POWER => {
                    // Only this thread writes the seed, and the lock is not held across emit.
                    let now = power();
                    if now.is_some() && seed().power != now {
                        seed().power = now;
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
                    if seed().online != now {
                        seed().online = now;
                        let _ = app.emit("status://net", serde_json::json!({ "online": now }));
                    }
                }
                WM_BT => {
                    let Some(devices) = &devices else { continue };
                    let now = headsets(devices);
                    for (container, name) in &now {
                        if !groups.contains_key(container) {
                            let _ = app.emit("status://bt", serde_json::json!({ "name": name, "connected": true, "battery": battery(*container) }));
                        }
                    }
                    for (container, name) in &groups {
                        if !now.contains_key(container) {
                            let _ = app.emit("status://bt", serde_json::json!({ "name": name, "connected": false, "battery": null }));
                        }
                    }
                    groups = now;
                    seed().headsets = groups.values().cloned().collect();
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

/// Runs on an audio service thread: it only wakes the loop, which rescans the endpoints.
#[implement(IMMNotificationClient)]
struct Endpoints(isize);

impl Endpoints {
    fn wake(&self) {
        let _ = unsafe { PostMessageW(Some(HWND(self.0 as _)), WM_BT, WPARAM(0), LPARAM(0)) };
    }
}

impl IMMNotificationClient_Impl for Endpoints_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> windows::core::Result<()> {
        self.wake();
        Ok(())
    }
    // A new endpoint becomes active through OnDeviceStateChanged.
    fn OnDeviceAdded(&self, _: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _: &PCWSTR) -> windows::core::Result<()> {
        self.wake();
        Ok(())
    }
    fn OnDefaultDeviceChanged(&self, _: EDataFlow, _: ERole, _: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

/// Active Bluetooth render endpoints by container ID, so the A2DP and hands-free endpoints of one
/// headset count once.
fn headsets(devices: &IMMDeviceEnumerator) -> HashMap<GUID, String> {
    let mut found = HashMap::new();
    unsafe {
        let Ok(list) = devices.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else { return found };
        for i in 0..list.GetCount().unwrap_or(0) {
            let Ok(store) = list.Item(i).and_then(|d| d.OpenPropertyStore(STGM_READ)) else { continue };
            let Some(enumerator) = prop_string(&store, &PKEY_DEVICE_ENUMERATOR_NAME) else { continue };
            let a2dp = enumerator.eq_ignore_ascii_case("BTHENUM");
            if !a2dp && !enumerator.eq_ignore_ascii_case("BTHHFENUM") {
                continue;
            }
            let Some(container) = prop_guid(&store, &PKEY_DEVICE_CONTAINER_ID) else { continue };
            let name = prop_string(&store, &PKEY_DEVICE_INTERFACE_FRIENDLY_NAME).or_else(|| prop_string(&store, &PKEY_DEVICE_FRIENDLY_NAME));
            let Some(name) = name else { continue };
            // The A2DP endpoint carries the plain device name; hands-free adds a suffix.
            if a2dp || !found.contains_key(&container) {
                found.insert(container, name);
            }
        }
    }
    found
}

unsafe fn prop_string(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<String> {
    unsafe {
        let value = store.GetValue(key).ok()?;
        let text = PropVariantToStringAlloc(&value).ok().and_then(|p| {
            let text = p.to_string().ok();
            CoTaskMemFree(Some(p.0 as _));
            text
        });
        text.filter(|t| !t.is_empty())
    }
}

unsafe fn prop_guid(store: &IPropertyStore, key: &PROPERTYKEY) -> Option<GUID> {
    unsafe {
        let value = store.GetValue(key).ok()?;
        PropVariantToGUID(&value).ok()
    }
}

/// Battery from the Bluetooth device nodes of the headset's container, read once at connection;
/// `None` when the headset does not report it.
fn battery(container: GUID) -> Option<u8> {
    let flags = CM_GETIDLIST_FILTER_ENUMERATOR | CM_GETIDLIST_FILTER_PRESENT;
    for enumerator in [w!("BTHENUM"), w!("BTHHFENUM")] {
        unsafe {
            let mut len = 0;
            if CM_Get_Device_ID_List_SizeW(&mut len, enumerator, flags) != CR_SUCCESS {
                continue;
            }
            let mut ids = vec![0u16; len as usize];
            if CM_Get_Device_ID_ListW(enumerator, &mut ids, flags) != CR_SUCCESS {
                continue;
            }
            for id in ids.split(|&c| c == 0).filter(|id| !id.is_empty()) {
                let id: Vec<u16> = id.iter().copied().chain([0]).collect();
                let mut node = 0;
                if CM_Locate_DevNodeW(&mut node, PCWSTR(id.as_ptr()), CM_LOCATE_DEVNODE_NORMAL) != CR_SUCCESS {
                    continue;
                }
                if node_prop::<GUID>(node, &DEVPKEY_Device_ContainerId, DEVPROP_TYPE_GUID) != Some(container) {
                    continue;
                }
                if let Some(level) = node_prop::<u8>(node, &DEVPKEY_BLUETOOTH_BATTERY, DEVPROP_TYPE_BYTE) {
                    return Some(level.min(100));
                }
            }
        }
    }
    None
}

/// A fixed-size device node property of the expected type.
unsafe fn node_prop<T: Default>(node: u32, key: &DEVPROPKEY, kind: DEVPROPTYPE) -> Option<T> {
    let mut value = T::default();
    let mut found = DEVPROPTYPE(0);
    let mut size = size_of::<T>() as u32;
    let ok = unsafe { CM_Get_DevNode_PropertyW(node, key, &mut found, Some(&mut value as *mut T as *mut u8), &mut size, 0) } == CR_SUCCESS;
    (ok && found == kind && size as usize == size_of::<T>()).then_some(value)
}
