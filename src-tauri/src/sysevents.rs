//! System status for the closed notch's alerts: charger and battery, internet, Bluetooth devices, the volume of the default output
//! device for the HUD (brightness is in brightness.rs), the sound output itself, the microphone's mute, Do Not Disturb, airplane mode
//! and the power mode (monitors are in mirror.rs).
//!
//! One thread with a message-only window. Power settings arrive as WM_POWERBROADCAST and are
//! handled in the GetMessageW loop, so the thread sleeps at idle. The network, Bluetooth and audio
//! endpoint callbacks only post to the same loop; the network and Bluetooth are settled with window timers. Each source registers on its own:
//! a failure is logged and leaves only that source off. What a source reads at registration goes
//! into the seed (`status://seed`, `status_seed`), never into a change event. The volume callback only fires on a change,
//! so registering it is silent too; changes Crest makes itself carry `controls::OWN_CHANGE` and are skipped.
//! Caps Lock and Num Lock have no change event short of a keyboard hook, so a small thread reads them every `LOCK_POLL` while their alert is on and can show;
//! the Insert alert reads that key's toggle bit on the same thread.
//! The Bluetooth watcher and the volume and microphone callbacks run only while their alerts are on (`status_configure`).
//! The bar's Stato item reads the network in use, the Wi-Fi radio and the volume only while a bar shows it (`status_bar`): the radios
//! are watched then, and the volume callback runs for it even with its alert off (`status://network`, `status://sound`).
//! Likewise the bar's Microphone widget: the microphone and the volume callbacks run for it while a bar shows it, and it hears every
//! change, Crest's own included (`status://microphone`, `status://sound`).
//! Then too, once Windows' location consent for Crest reads allowed (wifi.rs `checked`), the Wi-Fi in use's signal is followed
//! through wlanapi's signal quality notification (`watch_signal`); without it the bars move with network events only.
//! Do Not Disturb has no public change event either: a thread reads it every `FOCUS_POLL` while its alert is on and can show. Airplane
//! mode has none that is documented: a thread waits on its registry key. The power mode and the battery's report call back on their own.
//! Changes Crest makes itself (the output device, Do Not Disturb, the power plan) are marked with `own` and not told back.
//! The session's lock and its move to a remote client or away from the console come as WM_WTSSESSION_CHANGE; with the
//! screen and sleep state they go to the page as `status://session`, which the glass's live copy waits on.

use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use windows::core::{implement, s, w, BOOL, GUID, PCWSTR, PWSTR};
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    CM_Get_DevNode_PropertyW, CM_Get_Device_ID_ListW, CM_Get_Device_ID_List_SizeW, CM_Locate_DevNodeW, CM_GETIDLIST_FILTER_ENUMERATOR,
    CM_GETIDLIST_FILTER_PRESENT, CM_LOCATE_DEVNODE_NORMAL, CR_SUCCESS,
};
use windows::Win32::Devices::Properties::{DEVPKEY_Device_ContainerId, DEVPROPTYPE, DEVPROP_TYPE_BYTE, DEVPROP_TYPE_GUID};
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, EDataFlow, ERole, IMMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, IMMNotificationClient, IMMNotificationClient_Impl, MMDeviceEnumerator, DEVICE_STATE,
};
use windows::core::{Array, IInspectable, Interface, Ref, HSTRING};
use windows::Devices::Power::Battery;
use windows::Devices::Radios::{Radio, RadioKind};
use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind, DeviceInformationUpdate, DeviceWatcher};
use windows_collections::IIterable;
use windows::Foundation::{IPropertyValue, TypedEventHandler};
use windows::Networking::Connectivity::{NetworkConnectivityLevel, NetworkInformation, NetworkStatusChangedEventHandler};
use windows::Win32::NetworkManagement::WiFi::{
    wlan_notification_msm_signal_quality_change, L2_NOTIFICATION_DATA, WLAN_API_VERSION_2_0, WLAN_NOTIFICATION_CALLBACK, WLAN_NOTIFICATION_SOURCES,
    WLAN_NOTIFICATION_SOURCE_MSM,
};
use windows::Win32::Foundation::{DEVPROPKEY, HANDLE, HWND, LPARAM, LRESULT, PROPERTYKEY, WPARAM};
use windows::Win32::System::Com::StructuredStorage::{PropVariantToStringAlloc, PropVariantToUInt32};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};
use windows::Win32::System::Registry::{
    RegNotifyChangeKeyValue, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_LOCAL_MACHINE, KEY_NOTIFY, KEY_QUERY_VALUE, REG_DWORD, REG_NOTIFY_CHANGE_LAST_SET, REG_VALUE_TYPE,
};
use windows::Win32::System::SystemInformation::GetTickCount64;
use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, GetKeyState, VIRTUAL_KEY, VK_CAPITAL, VK_CONTROL, VK_INSERT, VK_LWIN, VK_MENU, VK_NUMLOCK, VK_RWIN, VK_SHIFT,
};
use windows::Win32::System::Power::{
    GetSystemPowerStatus, PowerRegisterForEffectivePowerModeNotifications, RegisterPowerSettingNotification, RegisterSuspendResumeNotification, EFFECTIVE_POWER_MODE,
    EFFECTIVE_POWER_MODE_V1, EFFECTIVE_POWER_MODE_V2, POWERBROADCAST_SETTING, SYSTEM_POWER_STATUS,
};
use windows::Win32::System::RemoteDesktop::{
    WTSFreeMemory, WTSQuerySessionInformationW, WTSRegisterSessionNotification, WTSSessionInfoEx, NOTIFY_FOR_THIS_SESSION, WTSINFOEXW,
    WTS_CURRENT_SERVER_HANDLE, WTS_CURRENT_SESSION, WTS_SESSIONSTATE_LOCK,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, GetSystemMetrics, KillTimer, PostMessageW, RegisterClassW, SetTimer, DEVICE_NOTIFY_WINDOW_HANDLE,
    HWND_MESSAGE, MSG, PBT_APMRESUMEAUTOMATIC, PBT_APMRESUMESUSPEND, PBT_APMSUSPEND, PBT_POWERSETTINGCHANGE, SM_REMOTESESSION, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP,
    WM_POWERBROADCAST, WM_TIMER, WM_WTSSESSION_CHANGE, WNDCLASSW, WTS_CONSOLE_CONNECT, WTS_CONSOLE_DISCONNECT, WTS_REMOTE_CONNECT, WTS_SESSION_LOCK, WTS_SESSION_UNLOCK,
};

// Not in the enabled features; values from winnt.h.
const GUID_ACDC_POWER_SOURCE: GUID = GUID::from_u128(0x5d3e9a59_e9d5_4b00_a6bd_ff34ff516548);
const GUID_BATTERY_PERCENTAGE_REMAINING: GUID = GUID::from_u128(0xa7ad8041_b45a_4cae_87a3_eecbb468a9e1);
/// The console display: 0 off, 1 on, 2 dimmed (standby.rs).
const GUID_CONSOLE_DISPLAY_STATE: GUID = GUID::from_u128(0x6fe69556_704a_47a0_8f24_c28d936fda47);
/// Battery saver or Energy saver switched on or off.
const GUID_POWER_SAVING_STATUS: GUID = GUID::from_u128(0xe00958c0_c213_4ace_ac77_fecced2eeea5);
/// Battery level Windows takes from the hands-free indicators or the LE battery service; not in the crate.
const DEVPKEY_BLUETOOTH_BATTERY: DEVPROPKEY = DEVPROPKEY { fmtid: GUID::from_u128(0x104ea319_6ee2_4701_bd47_8ddbf425bbe5), pid: 2 };
/// Paired Bluetooth and Bluetooth LE devices, as Settings lists them: the device nodes Windows keeps for them (class Bluetooth,
/// with an address), read from its device store without the radio. Audio endpoints cannot tell them apart: with an offload
/// driver (AMD's) their enumerator is the driver's GUID, not BTHENUM, and mice or controllers have none. A watcher on the
/// association endpoints kept the radio searching for devices, which broke Bluetooth audio up on some PCs (issue #48).
pub(crate) const BT_PAIRED: &str = r#"System.Devices.ClassGuid:="{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}" AND System.Devices.Aep.DeviceAddress:<>[]"#;
/// True while the device is connected; Windows gives this property of a Bluetooth device node no public name.
const BT_CONNECTED: &str = "{83DA6326-97A6-4088-9453-A1923F573B29} 15";
const BT_CATEGORY: &str = "System.Devices.CategoryIds";
const BT_ADDRESS: &str = "System.Devices.Aep.DeviceAddress";
const BT_CONTAINER: &str = "System.Devices.ContainerId";

/// WM_POWERBROADCAST is sent straight to the window procedure; it reposts this to reach the loop.
const WM_POWER: u32 = WM_APP + 1;
/// Posted from the WinRT threadpool on every network change.
const WM_NET: u32 = WM_APP + 2;
/// Network changes come in bursts (VPN, vSwitch, DHCP); only a state stable this long is sent.
const NET_TIMER: usize = 1;
const NET_SETTLE_MS: u32 = 2000;
/// Posted from the WinRT threadpool on every change of a paired Bluetooth device.
const WM_BT: u32 = WM_APP + 3;
/// A connection comes as a burst of updates, and the battery level lands a moment after it; one scan after the last.
const BT_TIMER: usize = 2;
const BT_SETTLE_MS: u32 = 1000;
/// Posted from the audio service thread on a volume or mute change: wParam the level in percent, lParam bit 0 muted, bit 1 Crest's own.
const WM_VOL: u32 = WM_APP + 4;
/// The default output device changed: the volume callback moves to the new one.
const WM_VOLDEV: u32 = WM_APP + 5;
/// `status_configure` switched the Bluetooth, the volume or the microphone source; the loop reads `SOURCES`.
const WM_SOURCES: u32 = WM_APP + 6;
const SRC_BT: usize = 1;
const SRC_VOLUME: usize = 2;
const SRC_MIC: usize = 4;
/// Posted from the audio service thread on a change of the default microphone's volume or mute, as WM_VOL.
const WM_MIC: u32 = WM_APP + 8;
/// The default microphone changed: its callback moves to the new one.
const WM_MICDEV: u32 = WM_APP + 9;
/// Windows' effective power mode changed (wParam the mode), from its own callback thread.
const WM_MODE: u32 = WM_APP + 10;
/// The Wi-Fi in use's signal quality changed (`watch_signal`), from wlanapi's notification thread.
const WM_SIGNAL: u32 = WM_APP + 11;
/// The sources the settings want on; all until the frontend says otherwise.
static SOURCES: AtomicUsize = AtomicUsize::new(SRC_BT | SRC_VOLUME | SRC_MIC);

/// Crest's own switches, whose result the status alerts do not tell back: the output device and Do Not Disturb (controls.rs), the
/// power plan (power.rs).
#[derive(Clone, Copy)]
pub(crate) enum Own {
    Output,
    Focus,
    Plan,
}
/// Until when (GetTickCount64, ms) a change of each counts as Crest's own: Windows tells of it within moments.
static OWN_UNTIL: [AtomicU64; 3] = [AtomicU64::new(0), AtomicU64::new(0), AtomicU64::new(0)];
const OWN_MS: u64 = 3000;

/// Crest is about to switch `what`: the change that follows is no alert.
pub(crate) fn own(what: Own) {
    OWN_UNTIL[what as usize].store(unsafe { GetTickCount64() } + OWN_MS, Ordering::SeqCst);
}

fn is_own(what: Own) -> bool {
    let now = unsafe { GetTickCount64() };
    now < OWN_UNTIL[what as usize].load(Ordering::SeqCst)
}

/// The loop's window, 0 until it exists.
static LOOP: AtomicIsize = AtomicIsize::new(0);
/// The session was locked or unlocked, moved to or from a remote client, or the screen or sleep state changed.
const WM_SESSION: u32 = WM_APP + 7;
/// Fires once the screen has been back for `standby::SETTLE`, when `asleep` turns false.
const SETTLE_TIMER: usize = 3;
/// Tries the session notifications again, which fail before the Remote Desktop services are up (RPC_S_INVALID_BINDING).
const WTS_TIMER: usize = 4;
const WTS_RETRY_MS: u32 = 5000;
const WTS_TRIES: u32 = 12;
/// Win+L or the lock after idle; set from the session notifications.
static LOCKED: AtomicBool = AtomicBool::new(false);
/// Shown on a remote client, or not shown at all (the console went to another session, the remote client disconnected).
static REMOTE: AtomicBool = AtomicBool::new(false);

/// The session is locked.
pub(crate) fn locked() -> bool {
    LOCKED.load(Ordering::SeqCst)
}

/// The session is not on this PC's own screen.
pub(crate) fn remote() -> bool {
    REMOTE.load(Ordering::SeqCst)
}

/// What keeps the glass's live copy (capture/glass_live.rs) stopped, for the page as `status://session`. `asleep`: the
/// screen off or the PC suspended, and for `standby::SETTLE` after it comes back.
#[derive(Serialize, Clone, Copy, PartialEq, Default, Debug)]
struct Session {
    locked: bool,
    remote: bool,
    asleep: bool,
}

impl Session {
    fn now() -> Session {
        Session { locked: locked(), remote: remote(), asleep: crate::standby::settling() }
    }

    /// Why the live copy stops now, the first that holds; None when nothing stops it.
    fn halts(self) -> Option<&'static str> {
        [(self.asleep, "asleep"), (self.locked, "locked"), (self.remote, "remote")].into_iter().find_map(|(on, why)| on.then_some(why))
    }
}

#[derive(Serialize, Clone, Copy, PartialEq)]
pub struct Power {
    ac: bool,
    percent: Option<u8>,
    /// False on PCs without a battery.
    battery: bool,
    /// Taking charge now; false on a full battery or under a charge limit, though the charger is in.
    charging: bool,
    /// Battery saver or Energy saver is on: Windows turns transparency off, and the glass (src/notch/glass) follows.
    saver: bool,
}

/// Current state of each source, `null` while a source is off. Kept up to date after the
/// start so a page that loads late compares against what was last sent.
#[derive(Serialize, Clone)]
pub struct Seed {
    power: Option<Power>,
    online: Option<bool>,
    /// Names of the Bluetooth devices connected now.
    devices: Vec<String>,
    /// The bar's Stato item, `null` while no bar shows it.
    network: Option<Network>,
    sound: Option<Sound>,
    /// The bar's Microphone widget: muted or not, null while no bar shows it or without a microphone.
    microphone: Option<bool>,
}

static SEED: Mutex<Seed> = Mutex::new(Seed { power: None, online: None, devices: Vec::new(), network: None, sound: None, microphone: None });

/// The kind of the network in use; any internet profile that is not WLAN counts as wired, a cellular modem included.
#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
#[serde(rename_all = "lowercase")]
enum Link {
    Wired,
    Wireless,
    None,
}

/// The network in use for the bar's Stato item (`status://network`).
#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    kind: Link,
    /// The Wi-Fi radio is on; None: no Wi-Fi radio on this PC.
    wifi: Option<bool>,
    /// Signal bars 0..5, only on Wi-Fi.
    bars: Option<u8>,
    /// The Wi-Fi's name, only on Wi-Fi and only when Windows gives it.
    ssid: Option<String>,
}

/// The default output's volume for the bar's Stato item (`status://sound`), every change, Crest's own included.
#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
pub struct Sound {
    level: u8,
    muted: bool,
}

/// One read of the internet profile.
struct Profile {
    wlan: bool,
    ssid: Option<String>,
    bars: Option<u8>,
}

/// While a bar shows Stato (`status_bar`).
static BAR_STATUS: AtomicBool = AtomicBool::new(false);
/// While a bar shows the Microphone widget (`status_bar`).
static BAR_MIC: AtomicBool = AtomicBool::new(false);

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
        LOOP.store(hwnd.0 as isize, Ordering::SeqCst);
        let sources = SOURCES.load(Ordering::SeqCst);

        // Registering sends the current value at once; it matches the seed, so it emits nothing.
        let power_on = [GUID_ACDC_POWER_SOURCE, GUID_BATTERY_PERCENTAGE_REMAINING, GUID_POWER_SAVING_STATUS].iter().fold(false, |on, guid| {
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
        // The screen going off and the system suspending pause the pollers (standby.rs). Registering sends the
        // display's current state at once.
        if let Err(e) = RegisterPowerSettingNotification(HANDLE(hwnd.0), &GUID_CONSOLE_DISPLAY_STATE, DEVICE_NOTIFY_WINDOW_HANDLE) {
            eprintln!("sysevents: display state notification failed: {e}");
        }
        if let Err(e) = RegisterSuspendResumeNotification(HANDLE(hwnd.0), DEVICE_NOTIFY_WINDOW_HANDLE) {
            eprintln!("sysevents: suspend notification failed: {e}");
        }
        // Registering sends nothing: a Crest started inside a remote session reads it here.
        REMOTE.store(GetSystemMetrics(SM_REMOTESESSION) != 0, Ordering::SeqCst);
        let mut wts_tries = 0;
        if !watch_session(hwnd) {
            SetTimer(Some(hwnd), WTS_TIMER, WTS_RETRY_MS, None);
        }
        let mut session = Session::now();
        // The live copy stops and the page hears of it off this loop, which must not wait for a start meanwhile (the screen
        // going off comes here); one thread, so the events keep their order.
        let (to_page, changes) = std::sync::mpsc::channel::<Session>();
        let page = app.clone();
        thread::spawn(move || {
            for now in changes {
                if let Some(why) = now.halts() {
                    crate::capture::glass_live::halt(&page, why);
                }
                let _ = page.emit("status://session", now);
            }
        });

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
        let paired = Paired::default();
        let mut watcher = (sources & SRC_BT != 0).then(|| bt_watch(h, paired.clone())).flatten();
        // `None` until the watcher has listed every paired device and that has settled: that reading is the baseline, not a change.
        let mut connected: Option<HashMap<String, BtDevice>> = None;
        let mut enumerated = false;

        let volume_client: IAudioEndpointVolumeCallback = LevelWatch(h, WM_VOL).into();
        // The callback runs for the HUD's alert, for the bar's Stato or for its Microphone widget's speaker; `bar_on` and `bar_mic`
        // turn on through WM_SOURCES, posted below.
        let mut volume_alert = sources & SRC_VOLUME != 0;
        let mut bar_on = false;
        let mut radios: Vec<(Radio, i64)> = Vec::new();
        let mut signal: Option<Signal> = None;
        let mut volume_on = volume_alert;
        let mut volume = devices.as_ref().filter(|_| volume_on).and_then(|d| watch_level(d, eRender, &volume_client));
        let mut last_volume = volume.as_ref().map(|v| v.1);
        // The default microphone's mute, the same way: a key on the laptop, Windows' settings or another app muting it. For the
        // alert, or for the bar's Microphone widget, which hears Crest's own mutes too.
        let mic_client: IAudioEndpointVolumeCallback = LevelWatch(h, WM_MIC).into();
        let mut mic_alert = sources & SRC_MIC != 0;
        let mut bar_mic = false;
        let mut mic_on = mic_alert;
        let mut mic = devices.as_ref().filter(|_| mic_on).and_then(|d| watch_level(d, eCapture, &mic_client));
        let mut last_mic = mic.as_ref().map(|m| m.1 .1);
        // The sound output now is the baseline: the alert says where the sound goes next.
        let mut output = devices.as_ref().and_then(default_output).map(|o| o.id);

        // The charging flag has no power setting of its own: the battery's report says when it changes (a full battery, a charge
        // limit), and the loop reads the state again. A PC without a battery reports nothing.
        let report = TypedEventHandler::<Battery, IInspectable>::new(move |_, _| {
            let _ = PostMessageW(Some(HWND(h as _)), WM_POWER, WPARAM(0), LPARAM(0));
            Ok(())
        });
        let _battery = Battery::AggregateBattery()
            .and_then(|b| b.ReportUpdated(&report).map(|_| b))
            .inspect_err(|e| eprintln!("sysevents: battery report failed: {e}"))
            .ok();
        // The power mode; its first callback is the mode now, the baseline (`user_mode`). Version 2 knows game mode, which
        // version 1 (before Windows 10 2004) does not.
        let mut registration: *mut c_void = std::ptr::null_mut();
        let context = Some(hwnd.0 as *const c_void);
        if [EFFECTIVE_POWER_MODE_V2, EFFECTIVE_POWER_MODE_V1]
            .into_iter()
            .all(|version| PowerRegisterForEffectivePowerModeNotifications(version, Some(mode_changed), context, &mut registration).is_err())
        {
            eprintln!("sysevents: power mode notification failed");
        }
        let mut last_mode = None;
        watch_airplane(app.clone());

        let _ = app.emit("status://seed", status_seed());
        // `status_bar` may have come before the loop's window existed.
        if BAR_STATUS.load(Ordering::SeqCst) || BAR_MIC.load(Ordering::SeqCst) {
            let _ = PostMessageW(Some(hwnd), WM_SOURCES, WPARAM(0), LPARAM(0));
        }

        // Runs for the app's lifetime; process exit releases the registrations.
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            match msg.message {
                WM_POWER => {
                    // Only this thread writes the seed, and the lock is not held across emit.
                    let now = power();
                    if now.is_some() && seed().power != now {
                        if seed().power.zip(now).is_some_and(|(before, now)| before.ac != now.ac) {
                            crate::brightness::power_switched();
                        }
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
                    if bar_on {
                        send_network(&app, &radios);
                    }
                }
                WM_SESSION => session_changed(hwnd, &mut session, &to_page),
                WM_TIMER if msg.wParam.0 == SETTLE_TIMER => {
                    let _ = KillTimer(Some(hwnd), SETTLE_TIMER);
                    session_changed(hwnd, &mut session, &to_page);
                }
                WM_TIMER if msg.wParam.0 == WTS_TIMER => {
                    wts_tries += 1;
                    if watch_session(hwnd) || wts_tries >= WTS_TRIES {
                        let _ = KillTimer(Some(hwnd), WTS_TIMER);
                        session_changed(hwnd, &mut session, &to_page);
                    }
                }
                WM_BT if watcher.is_some() => {
                    enumerated |= msg.wParam.0 == 1;
                    SetTimer(Some(hwnd), BT_TIMER, BT_SETTLE_MS, None);
                }
                WM_TIMER if msg.wParam.0 == BT_TIMER => {
                    let _ = KillTimer(Some(hwnd), BT_TIMER);
                    let now = bluetooth(&paired);
                    if let Some(before) = &connected {
                        for (id, d) in &now {
                            if !before.contains_key(id) {
                                let battery = battery(&d.address, d.container);
                                let _ = app.emit("status://bt", serde_json::json!({ "name": d.name, "connected": true, "battery": battery, "categories": d.categories }));
                            }
                        }
                        for (id, d) in before {
                            if !now.contains_key(id) {
                                let _ = app.emit("status://bt", serde_json::json!({ "name": d.name, "connected": false, "battery": null, "categories": d.categories }));
                            }
                        }
                    }
                    seed().devices = now.values().map(|d| d.name.clone()).collect();
                    if enumerated {
                        connected = Some(now);
                    }
                }
                WM_VOL if volume_on => {
                    let now = (msg.wParam.0.min(100) as u8, msg.lParam.0 & 1 != 0);
                    let own = msg.lParam.0 & 2 != 0;
                    // Windows may bring its flyout up for a key that changes nothing (the level already at an end): hide that one too.
                    if volume_alert && !own {
                        crate::osd::after_change();
                    }
                    // Crest's own change still moves the baseline, so the next outside change compares against it.
                    if volume_changed(&mut last_volume, now) {
                        let (level, sound) = sound_events(volume_alert, bar_on || bar_mic, own);
                        if level {
                            emit_level(&app, "volume", now.0, now.1);
                        }
                        if sound {
                            send_sound(&app, Some(now));
                        }
                    }
                }
                WM_VOLDEV => {
                    if volume_on {
                        if let Some((endpoint, _)) = &volume {
                            let _ = endpoint.UnregisterControlChangeNotify(&volume_client);
                        }
                        volume = devices.as_ref().and_then(|d| watch_level(d, eRender, &volume_client));
                        last_volume = volume.as_ref().map(|v| v.1);
                        if bar_on || bar_mic {
                            send_sound(&app, last_volume);
                        }
                    }
                    // Where the sound went, unless Crest moved it; none at all is a new start, so the next device alerts.
                    let now = devices.as_ref().and_then(default_output);
                    if now.as_ref().map(|o| &o.id) != output.as_ref() {
                        output = now.as_ref().map(|o| o.id.clone());
                        if let Some(o) = now.filter(|_| !is_own(Own::Output)) {
                            let _ = app.emit("status://output", serde_json::json!({ "name": o.name, "form": o.form }));
                        }
                    }
                }
                WM_MIC if mic_on => {
                    let muted = msg.lParam.0 & 1 != 0;
                    let own = msg.lParam.0 & 2 != 0;
                    // Crest's own mute reaches the bar's widget but not the alert: the shortcut says it itself, Overview's switch shows it.
                    if last_mic.replace(muted).is_some_and(|before| before != muted) {
                        let (alert, bar) = sound_events(mic_alert, bar_mic, own);
                        if alert {
                            let _ = app.emit("status://mic", serde_json::json!({ "muted": muted }));
                        }
                        if bar {
                            send_microphone(&app, Some(muted));
                        }
                    }
                }
                WM_MICDEV if mic_on => {
                    if let Some((endpoint, _)) = &mic {
                        let _ = endpoint.UnregisterControlChangeNotify(&mic_client);
                    }
                    mic = devices.as_ref().and_then(|d| watch_level(d, eCapture, &mic_client));
                    last_mic = mic.as_ref().map(|m| m.1 .1);
                    // The new default microphone's state, or none left at all.
                    if bar_mic {
                        send_microphone(&app, last_mic);
                    }
                }
                WM_MODE => {
                    if let Some(mode) = user_mode(&mut last_mode, msg.wParam.0 as i32).filter(|_| !is_own(Own::Plan)) {
                        let _ = app.emit("status://mode", serde_json::json!({ "mode": mode }));
                    }
                }
                WM_SOURCES => {
                    let sources = SOURCES.load(Ordering::SeqCst);
                    if (sources & SRC_BT != 0) != watcher.is_some() {
                        if sources & SRC_BT != 0 {
                            watcher = bt_watch(h, paired.clone());
                        } else {
                            if let Some(w) = watcher.take() {
                                let _ = w.Stop();
                            }
                            let _ = KillTimer(Some(hwnd), BT_TIMER);
                            lock(&paired).clear();
                            seed().devices.clear();
                        }
                        // The next full scan is a new baseline, not a change.
                        connected = None;
                        enumerated = false;
                    }
                    volume_alert = sources & SRC_VOLUME != 0;
                    let bar = BAR_STATUS.load(Ordering::SeqCst);
                    let mic_bar = BAR_MIC.load(Ordering::SeqCst);
                    if (volume_alert || bar || mic_bar) != volume_on {
                        volume_on = !volume_on;
                        if let Some((endpoint, _)) = volume.take() {
                            let _ = endpoint.UnregisterControlChangeNotify(&volume_client);
                        }
                        if volume_on {
                            volume = devices.as_ref().and_then(|d| watch_level(d, eRender, &volume_client));
                        }
                        last_volume = volume.as_ref().map(|v| v.1);
                    }
                    if bar != bar_on {
                        bar_on = bar;
                        if bar_on {
                            radios = watch_radios(h);
                            send_network(&app, &radios);
                            send_sound(&app, last_volume);
                        } else {
                            unwatch_radios(std::mem::take(&mut radios));
                            signal = None;
                            let mut s = seed();
                            s.network = None;
                            // The Microphone widget's speaker still shows it.
                            if !mic_bar {
                                s.sound = None;
                            }
                        }
                    }
                    // The Wi-Fi signal while Stato shows, from the moment the location consent reads allowed: looked at on each
                    // WM_SOURCES, which the Wi-Fi page's consent posts too (`consent_changed`).
                    if bar_on && signal.is_none() {
                        signal = watch_signal(h);
                    }
                    mic_alert = sources & SRC_MIC != 0;
                    if (mic_alert || mic_bar) != mic_on {
                        mic_on = !mic_on;
                        if let Some((endpoint, _)) = mic.take() {
                            let _ = endpoint.UnregisterControlChangeNotify(&mic_client);
                        }
                        if mic_on {
                            mic = devices.as_ref().and_then(|d| watch_level(d, eCapture, &mic_client));
                        }
                        last_mic = mic.as_ref().map(|m| m.1 .1);
                    }
                    // After the callbacks above, so the widget starts from what they read.
                    if mic_bar != bar_mic {
                        bar_mic = mic_bar;
                        if bar_mic {
                            send_microphone(&app, last_mic);
                            send_sound(&app, last_volume);
                        } else {
                            let mut s = seed();
                            s.microphone = None;
                            if !bar_on {
                                s.sound = None;
                            }
                        }
                    }
                }
                // The Wi-Fi's signal changed: read at once, not through the network's 2 s settle, which a steady run of these would keep pushing back.
                WM_SIGNAL if bar_on => send_bars(&app),
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
        if msg == WM_POWERBROADCAST {
            match wparam.0 as u32 {
                PBT_POWERSETTINGCHANGE => {
                    // The setting is only readable during this call. The display state is handled here at once, so the
                    // pollers stop before the drivers power down; the others go through the loop.
                    let setting = lparam.0 as *const POWERBROADCAST_SETTING;
                    if !setting.is_null() && (*setting).PowerSetting == GUID_CONSOLE_DISPLAY_STATE && (*setting).DataLength >= 4 {
                        let state = std::ptr::read_unaligned((*setting).Data.as_ptr() as *const u32);
                        crate::standby::set_display(state != 0);
                    } else {
                        let _ = PostMessageW(Some(hwnd), WM_POWER, WPARAM(0), LPARAM(0));
                    }
                }
                PBT_APMSUSPEND => crate::standby::set_suspended(true),
                PBT_APMRESUMEAUTOMATIC | PBT_APMRESUMESUSPEND => crate::standby::set_suspended(false),
                _ => {}
            }
            // The loop compares with what it last sent: a battery change sends nothing there.
            let _ = PostMessageW(Some(hwnd), WM_SESSION, WPARAM(0), LPARAM(0));
            return LRESULT(1);
        }
        if msg == WM_WTSSESSION_CHANGE {
            match wparam.0 as u32 {
                WTS_SESSION_LOCK => LOCKED.store(true, Ordering::SeqCst),
                WTS_SESSION_UNLOCK => LOCKED.store(false, Ordering::SeqCst),
                WTS_REMOTE_CONNECT | WTS_CONSOLE_DISCONNECT => REMOTE.store(true, Ordering::SeqCst),
                WTS_CONSOLE_CONNECT => REMOTE.store(false, Ordering::SeqCst),
                _ => {}
            }
            let _ = PostMessageW(Some(hwnd), WM_SESSION, WPARAM(0), LPARAM(0));
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

/// Sends the session state on to the page when it changed, the live copy stopping first when something takes the screen
/// away, and looks again once the screen has been back for `standby::SETTLE`.
fn session_changed(hwnd: HWND, last: &mut Session, to_page: &std::sync::mpsc::Sender<Session>) {
    let now = Session::now();
    if now.asleep && !crate::standby::asleep() {
        unsafe { SetTimer(Some(hwnd), SETTLE_TIMER, crate::standby::SETTLE.as_millis() as u32 + 100, None) };
    }
    if now != *last {
        *last = now;
        let _ = to_page.send(now);
    }
}

/// The session notifications, and whether the session is locked now, which registering does not send (a Crest restarted
/// while the PC is locked). False when registering failed.
fn watch_session(hwnd: HWND) -> bool {
    unsafe {
        if let Err(e) = WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION) {
            eprintln!("sysevents: session notification failed: {e}");
            return false;
        }
        let (mut info, mut size) = (PWSTR::null(), 0u32);
        if WTSQuerySessionInformationW(Some(WTS_CURRENT_SERVER_HANDLE), WTS_CURRENT_SESSION, WTSSessionInfoEx, &mut info, &mut size).is_ok() {
            // Only the flags: the rest names the user and the domain.
            let ex = &*(info.0 as *const WTSINFOEXW);
            if ex.Level == 1 {
                LOCKED.store(ex.Data.WTSInfoExLevel1.SessionFlags == WTS_SESSIONSTATE_LOCK as i32, Ordering::SeqCst);
            }
            WTSFreeMemory(info.0 as _);
        }
        true
    }
}

fn power() -> Option<Power> {
    let mut s = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut s) }.ok()?;
    // 128 = no system battery; 255 = unknown percent.
    let battery = s.BatteryFlag & 128 == 0;
    Some(Power {
        ac: s.ACLineStatus == 1,
        percent: (battery && s.BatteryLifePercent <= 100).then_some(s.BatteryLifePercent),
        battery,
        charging: s.BatteryFlag & 8 != 0,
        saver: s.SystemStatusFlag & 1 != 0,
    })
}

/// No internet profile (cable out, Wi-Fi off) counts as offline.
fn online() -> bool {
    NetworkInformation::GetInternetConnectionProfile()
        .and_then(|p| p.GetNetworkConnectivityLevel())
        .is_ok_and(|level| level == NetworkConnectivityLevel::InternetAccess)
}

/// The internet profile in use, None without one. The name comes only from `GetConnectedSsid`: `ProfileName`, wlanapi.h and
/// Windows.Devices.WiFi ask for the location permission.
fn profile() -> Option<Profile> {
    let p = NetworkInformation::GetInternetConnectionProfile().ok()?;
    let wlan = p.IsWlanConnectionProfile().unwrap_or(false);
    let ssid = wlan.then(|| p.WlanConnectionProfileDetails().and_then(|d| d.GetConnectedSsid()).ok().map(|s| s.to_string())).flatten();
    let bars = p.GetSignalBars().and_then(|b| b.Value()).ok();
    Some(Profile { wlan, ssid, bars })
}

/// What the bar shows: no profile is no network, WLAN gives its bars and its name when not empty, anything else is wired.
fn network(profile: Option<Profile>, wifi: Option<bool>) -> Network {
    match profile {
        None => Network { kind: Link::None, wifi, bars: None, ssid: None },
        Some(p) if p.wlan => Network { kind: Link::Wireless, wifi, bars: p.bars, ssid: p.ssid.filter(|s| !s.is_empty()) },
        Some(_) => Network { kind: Link::Wired, wifi, bars: None, ssid: None },
    }
}

/// The radios, each waking the loop on a switch so it goes through the network's settle. Removed with `unwatch_radios`.
fn watch_radios(h: isize) -> Vec<(Radio, i64)> {
    let handler = TypedEventHandler::<Radio, IInspectable>::new(move |_, _| {
        let _ = unsafe { PostMessageW(Some(HWND(h as _)), WM_NET, WPARAM(0), LPARAM(0)) };
        Ok(())
    });
    crate::quick::radios()
        .inspect_err(|e| eprintln!("sysevents: radios failed: {e}"))
        .unwrap_or_default()
        .into_iter()
        .filter_map(|r| r.StateChanged(&handler).ok().map(|token| (r, token)))
        .collect()
}

fn unwatch_radios(radios: Vec<(Radio, i64)>) {
    for (r, token) in radios {
        let _ = r.RemoveStateChanged(token);
    }
}

/// Seeds the network for the bar and tells it, only on a change.
fn send_network(app: &AppHandle, radios: &[(Radio, i64)]) {
    let list: Vec<Radio> = radios.iter().map(|(r, _)| r.clone()).collect();
    let now = network(profile(), crate::quick::radio_on(&list, RadioKind::WiFi));
    if seed().network.as_ref() != Some(&now) {
        seed().network = Some(now.clone());
        let _ = app.emit("status://network", now);
    }
}

/// A signal change: only the bars, read again and sent on a change. The name stays the one `send_network` last read, as
/// `GetConnectedSsid` asks the location permission and the signal moves every few seconds. A profile that is no longer WLAN
/// waits for the network's own event.
fn send_bars(app: &AppHandle) {
    let Some(p) = NetworkInformation::GetInternetConnectionProfile().ok().filter(|p| p.IsWlanConnectionProfile().unwrap_or(false)) else {
        return;
    };
    // No value (a roam, a failed read) is no news: the shown bars stay until a real reading or the network's own event.
    let Ok(bars) = p.GetSignalBars().and_then(|b| b.Value()) else {
        return;
    };
    let now = rebar(seed().network.as_ref(), Some(bars));
    if let Some(now) = now {
        seed().network = Some(now.clone());
        let _ = app.emit("status://network", now);
    }
}

/// The shown network with new bars: only a Wi-Fi shown already, and only when they moved.
fn rebar(shown: Option<&Network>, bars: Option<u8>) -> Option<Network> {
    shown.filter(|n| n.kind == Link::Wireless && n.bars != bars).map(|n| Network { bars, ..n.clone() })
}

/// Seeds the volume for the bar and tells it, only on a change; None (no output device) tells nothing.
fn send_sound(app: &AppHandle, level: Option<Level>) {
    let now = level.map(|(level, muted)| Sound { level, muted });
    if now.is_some() && seed().sound != now {
        seed().sound = now;
        let _ = app.emit("status://sound", now);
    }
}

/// Seeds the microphone's mute for the bar's Microphone widget and tells it, only on a change; None (no microphone) too, so it dims.
fn send_microphone(app: &AppHandle, muted: Option<bool>) {
    if seed().microphone != muted {
        seed().microphone = muted;
        let _ = app.emit("status://microphone", muted);
    }
}

type WlanOpen = unsafe extern "system" fn(u32, *const c_void, *mut u32, *mut HANDLE) -> u32;
type WlanRegister = unsafe extern "system" fn(HANDLE, WLAN_NOTIFICATION_SOURCES, BOOL, WLAN_NOTIFICATION_CALLBACK, *const c_void, *const c_void, *mut u32) -> u32;
type WlanClose = unsafe extern "system" fn(HANDLE, *const c_void) -> u32;

/// The signal watch: its WLAN client handle, whose closing ends the notification, with wlanapi's close.
struct Signal {
    handle: HANDLE,
    close: WlanClose,
}

impl Drop for Signal {
    /// On the loop's thread, never in the callback, where closing would wait on itself.
    fn drop(&mut self) {
        unsafe { (self.close)(self.handle, std::ptr::null()) };
    }
}

/// The Wi-Fi in use's signal for Stato, from wlanapi's signal quality notification (MSM source). Windows lets an app register for
/// that source only with its location consent (the `wiFiControl` capability) and may bring up its one-time prompt for one without
/// it, which only the Wi-Fi page's click may: so nothing is looked up until that consent reads allowed (wifi.rs `checked`, which
/// never prompts). wlanapi.dll is looked up at run time, as hw.rs looks up nvml.dll, so a Windows without it still starts Crest.
/// None without the consent, the DLL or a running WLAN service.
fn watch_signal(h: isize) -> Option<Signal> {
    if crate::taskbar::wifi::checked() != "allowed" {
        return None;
    }
    unsafe {
        // Stays loaded: the close and the notification's caller live in it.
        let lib = LoadLibraryExW(w!("wlanapi.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32).ok()?;
        let open: WlanOpen = std::mem::transmute(GetProcAddress(lib, s!("WlanOpenHandle"))?);
        let register: WlanRegister = std::mem::transmute(GetProcAddress(lib, s!("WlanRegisterNotification"))?);
        let close: WlanClose = std::mem::transmute(GetProcAddress(lib, s!("WlanCloseHandle"))?);
        let (mut version, mut handle) = (0u32, HANDLE::default());
        if open(WLAN_API_VERSION_2_0, std::ptr::null(), &mut version, &mut handle) != 0 {
            return None;
        }
        let signal = Signal { handle, close };
        // Duplicates ignored: one change, one message. A refusal drops `signal`, which closes the handle.
        (register(handle, WLAN_NOTIFICATION_SOURCE_MSM, true.into(), Some(on_wlan), h as *const c_void, std::ptr::null(), std::ptr::null_mut()) == 0).then_some(signal)
    }
}

/// wlanapi's notification thread: only a change of the connected network's signal quality wakes the loop.
unsafe extern "system" fn on_wlan(data: *mut L2_NOTIFICATION_DATA, context: *mut c_void) {
    if let Some(d) = unsafe { data.as_ref() } {
        if is_signal(d.NotificationSource, d.NotificationCode) {
            let _ = unsafe { PostMessageW(Some(HWND(context)), WM_SIGNAL, WPARAM(0), LPARAM(0)) };
        }
    }
}

/// The signal quality notification (wlanapi.h `wlan_notification_msm_signal_quality_change`), told apart from the other MSM codes and
/// from the same number in another source.
fn is_signal(source: WLAN_NOTIFICATION_SOURCES, code: u32) -> bool {
    source == WLAN_NOTIFICATION_SOURCE_MSM && code == wlan_notification_msm_signal_quality_change.0 as u32
}

/// Runs on an audio service thread: it only tells the loop that the default output or microphone changed.
#[implement(IMMNotificationClient)]
struct Endpoints(isize);

impl IMMNotificationClient_Impl for Endpoints_Impl {
    fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceAdded(&self, _: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    fn OnDeviceRemoved(&self, _: &PCWSTR) -> windows::core::Result<()> {
        Ok(())
    }
    // The volume keys and the taskbar act on the console role of the default output; the microphone's mute likewise.
    fn OnDefaultDeviceChanged(&self, flow: EDataFlow, role: ERole, _: &PCWSTR) -> windows::core::Result<()> {
        let msg = if flow == eRender { WM_VOLDEV } else if flow == eCapture { WM_MICDEV } else { return Ok(()) };
        if role == eConsole {
            let _ = unsafe { PostMessageW(Some(HWND(self.0 as _)), msg, WPARAM(0), LPARAM(0)) };
        }
        Ok(())
    }
    fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> windows::core::Result<()> {
        Ok(())
    }
}

/// A paired Bluetooth device, as its device node describes it.
pub(crate) struct BtDevice {
    pub(crate) name: String,
    /// Windows' device categories ("Audio.Headphone", "Input.Mouse"), for the icon.
    pub(crate) categories: Vec<String>,
    /// "c0:e5:79:36:e7:c6".
    pub(crate) address: String,
    /// Missing on some LE devices.
    pub(crate) container: Option<GUID>,
}

pub(crate) fn bt_props() -> IIterable<HSTRING> {
    IIterable::from([BT_CONNECTED, BT_CATEGORY, BT_ADDRESS, BT_CONTAINER].map(HSTRING::from).to_vec())
}

/// The paired devices as the watcher reported them, by device instance id. Kept from its events, which come at each change.
type Paired = Arc<Mutex<HashMap<String, DeviceInformation>>>;

fn lock(paired: &Paired) -> MutexGuard<'_, HashMap<String, DeviceInformation>> {
    paired.lock().unwrap_or_else(|e| e.into_inner())
}

/// Keeps `paired` current and wakes the loop on every change; the loop reads it once the burst is over. Kept for the app's lifetime.
fn bt_watch(h: isize, paired: Paired) -> Option<DeviceWatcher> {
    // wParam 1: the first enumeration of the paired devices is complete.
    let wake = move |done: usize| unsafe {
        let _ = PostMessageW(Some(HWND(h as _)), WM_BT, WPARAM(done), LPARAM(0));
    };
    let (added, updated) = (paired.clone(), paired.clone());
    DeviceInformation::CreateWatcherWithKindAqsFilterAndAdditionalProperties(&BT_PAIRED.into(), &bt_props(), DeviceInformationKind::Device)
        .and_then(|w| {
            w.Added(&TypedEventHandler::new(move |_, info: Ref<DeviceInformation>| {
                if let Some(info) = info.as_ref() {
                    lock(&added).insert(info.Id()?.to_string(), info.clone());
                }
                Ok(wake(0))
            }))?;
            w.Updated(&TypedEventHandler::new(move |_, update: Ref<DeviceInformationUpdate>| {
                if let Some(update) = update.as_ref() {
                    if let Some(info) = lock(&updated).get(&update.Id()?.to_string()) {
                        info.Update(update)?;
                    }
                }
                Ok(wake(0))
            }))?;
            w.Removed(&TypedEventHandler::new(move |_, update: Ref<DeviceInformationUpdate>| {
                if let Some(update) = update.as_ref() {
                    lock(&paired).remove(&update.Id()?.to_string());
                }
                Ok(wake(0))
            }))?;
            w.EnumerationCompleted(&TypedEventHandler::new(move |_, _| Ok(wake(1))))?;
            w.Start()?;
            Ok(w)
        })
        .inspect_err(|e| eprintln!("sysevents: bluetooth watcher failed: {e}"))
        .ok()
}

/// A paired device as its node describes it, and whether it is connected now (the alerts and the bar's Bluetooth page).
pub(crate) fn read_device(d: &DeviceInformation) -> Option<(bool, BtDevice)> {
    let props = d.Properties().ok()?;
    let value = |key: &str| props.Lookup(&key.into()).ok().and_then(|v| v.cast::<IPropertyValue>().ok());
    let connected = value(BT_CONNECTED).and_then(|v| v.GetBoolean().ok()).unwrap_or(false);
    let name = d.Name().ok()?.to_string();
    let mut categories = Array::<HSTRING>::new();
    let categories = match value(BT_CATEGORY) {
        Some(v) if v.GetStringArray(&mut categories).is_ok() => categories.iter().map(|c| c.to_string()).collect(),
        _ => Vec::new(),
    };
    let address = value(BT_ADDRESS).and_then(|v| v.GetString().ok()).map(|a| a.to_string()).unwrap_or_default();
    let container = value(BT_CONTAINER).and_then(|v| v.GetGuid().ok());
    Some((connected, BtDevice { name, categories, address, container }))
}

/// The paired devices connected now, by device instance id.
fn bluetooth(paired: &Paired) -> HashMap<String, BtDevice> {
    lock(paired).iter().filter_map(|(id, d)| read_device(d).filter(|(c, _)| *c).map(|(_, dev)| (id.clone(), dev))).collect()
}

/// Battery from the device's Bluetooth nodes, found by its address in the instance id or by its container; read once at
/// connection, `None` when the device does not report it.
pub(crate) fn battery(address: &str, container: Option<GUID>) -> Option<u8> {
    let address = address.replace(':', "").to_ascii_uppercase();
    let flags = CM_GETIDLIST_FILTER_ENUMERATOR | CM_GETIDLIST_FILTER_PRESENT;
    for enumerator in [w!("BTHENUM"), w!("BTHHFENUM"), w!("BTHLE")] {
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
                let by_address = address.len() == 12 && String::from_utf16_lossy(id).to_ascii_uppercase().contains(&address);
                let id: Vec<u16> = id.iter().copied().chain([0]).collect();
                let mut node = 0;
                if CM_Locate_DevNodeW(&mut node, PCWSTR(id.as_ptr()), CM_LOCATE_DEVNODE_NORMAL) != CR_SUCCESS {
                    continue;
                }
                if !by_address && (container.is_none() || node_prop::<GUID>(node, &DEVPKEY_Device_ContainerId, DEVPROP_TYPE_GUID) != container) {
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

/// Volume and mute in percent, as the taskbar shows them.
type Level = (u8, bool);

/// The volume callback of the default output (`eRender`) or microphone (`eCapture`); returns its endpoint (kept to unregister) and the
/// level now, the baseline.
unsafe fn watch_level(devices: &IMMDeviceEnumerator, flow: EDataFlow, client: &IAudioEndpointVolumeCallback) -> Option<(IAudioEndpointVolume, Level)> {
    unsafe {
        // No such device at all is not an error: the next default change registers.
        let endpoint: IAudioEndpointVolume = devices.GetDefaultAudioEndpoint(flow, eConsole).and_then(|d| d.Activate(CLSCTX_ALL, None)).ok()?;
        endpoint.RegisterControlChangeNotify(client).inspect_err(|e| eprintln!("sysevents: volume notification failed: {e}")).ok()?;
        let now = (percent(endpoint.GetMasterVolumeLevelScalar().unwrap_or(0.0)), endpoint.GetMute().is_ok_and(|m| m.as_bool()));
        Some((endpoint, now))
    }
}

/// Runs on an audio service thread: it only posts the new level to the loop as its message (WM_VOL for the output, WM_MIC for the
/// microphone).
#[implement(IAudioEndpointVolumeCallback)]
struct LevelWatch(isize, u32);

impl IAudioEndpointVolumeCallback_Impl for LevelWatch_Impl {
    fn OnNotify(&self, data: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        let Some(d) = (unsafe { data.as_ref() }) else { return Ok(()) };
        let flags = d.bMuted.as_bool() as isize | ((d.guidEventContext == crate::controls::OWN_CHANGE) as isize) << 1;
        let _ = unsafe { PostMessageW(Some(HWND(self.0 as _)), self.1, WPARAM(percent(d.fMasterVolume) as usize), LPARAM(flags)) };
        Ok(())
    }
}

/// The default output: its id, its name as the sound menu shows it, and what kind of device it is (`form_name`).
struct Output {
    id: String,
    name: String,
    form: &'static str,
}

/// PKEY_AudioEndpoint_FormFactor, defined here so one key does not need the FunctionDiscovery feature.
const FORM_FACTOR: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x1da5d803_d492_4edd_8c23_e0c0ffee7f0e), pid: 0 };

fn default_output(devices: &IMMDeviceEnumerator) -> Option<Output> {
    unsafe {
        let device = devices.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        let id = crate::controls::take(device.GetId().ok()?)?;
        let store = device.OpenPropertyStore(STGM_READ).ok();
        let value = |key: &PROPERTYKEY| store.as_ref().and_then(|s| s.GetValue(key).ok());
        let name = value(&crate::controls::FRIENDLY_NAME).and_then(|v| PropVariantToStringAlloc(&v).ok()).and_then(|p| crate::controls::take(p));
        let form = value(&FORM_FACTOR).and_then(|v| PropVariantToUInt32(&v).ok());
        Some(Output { id, name: name.unwrap_or_default(), form: form_name(form) })
    }
}

/// The endpoint's EndpointFormFactor as the alert's icon: headphones and headsets, speakers, a monitor's speakers over HDMI or
/// DisplayPort, anything else.
fn form_name(form: Option<u32>) -> &'static str {
    match form {
        Some(3 | 5) => "headphones",
        Some(1) => "speakers",
        Some(9) => "display",
        _ => "other",
    }
}

/// Windows' callback thread: it only tells the loop the effective power mode now.
unsafe extern "system" fn mode_changed(mode: EFFECTIVE_POWER_MODE, context: *const c_void) {
    let _ = unsafe { PostMessageW(Some(HWND(context as _)), WM_MODE, WPARAM(mode.0 as usize), LPARAM(0)) };
}

/// The power mode the user chose, from Windows' effective one: 1 best power efficiency, 2 balanced, 4 best performance (high, 3, is
/// told as that too). Energy saver (0), game mode (5) and mixed reality (6) pass over it and leave it as it was, so they say nothing.
/// The first reading is the baseline; a change gives the new mode.
fn user_mode(last: &mut Option<i32>, effective: i32) -> Option<i32> {
    let mode = match effective {
        1 | 2 => effective,
        3 | 4 => 4,
        _ => return None,
    };
    let before = last.replace(mode)?;
    (before != mode).then_some(mode)
}

/// A scalar 0..1 as the whole percent Windows shows.
fn percent(scalar: f32) -> u8 {
    (scalar.clamp(0.0, 1.0) * 100.0).round() as u8
}

/// The callback also fires for balance and channel changes and repeats while a key is held: only a new level or mute counts.
fn volume_changed(last: &mut Option<Level>, now: Level) -> bool {
    let changed = *last != Some(now);
    *last = Some(now);
    changed
}

/// Which events a volume or a microphone change sends, (status://level, status://sound) or (status://mic, status://microphone): the
/// HUD's alert only with it on and only for an outside change, the bar every change while it shows Stato or the Microphone widget.
fn sound_events(alert: bool, bar: bool, own: bool) -> (bool, bool) {
    (alert && !own, bar)
}

/// One HUD reading for the frontend (status://level): `kind` "volume" or "brightness", `level` 0..100.
pub fn emit_level(app: &AppHandle, kind: &str, level: u8, muted: bool) {
    let _ = app.emit("status://level", serde_json::json!({ "kind": kind, "level": level, "muted": muted }));
    crate::osd::after_change();
}

/// From the settings: external monitors are read over DDC/CI only while the Brightness alert is on, Caps Lock and Num Lock only
/// while theirs is on and can show, Insert likewise with its own, Do Not Disturb likewise, the Bluetooth watcher and the volume and
/// microphone callbacks only while their alerts are, and the Windows indicator is hidden only while the frontend says Crest's HUD
/// replaces it (`osd_armed`: the option is on, even if it is not hiding just now).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn status_configure(app: AppHandle, ddc: bool, locks: bool, insert: bool, bt: bool, volume: bool, mic: bool, focus: bool, hide_osd: bool, osd_armed: bool) {
    crate::brightness::set_ddc(ddc);
    INSERT_ON.store(insert, Ordering::SeqCst);
    watch_locks(&app, locks || insert);
    watch_focus(&app, focus);
    crate::osd::set(hide_osd, osd_armed);
    SOURCES.store(if bt { SRC_BT } else { 0 } | if volume { SRC_VOLUME } else { 0 } | if mic { SRC_MIC } else { 0 }, Ordering::SeqCst);
    let h = LOOP.load(Ordering::SeqCst);
    if h != 0 {
        let _ = unsafe { PostMessageW(Some(HWND(h as _)), WM_SOURCES, WPARAM(0), LPARAM(0)) };
    }
}

/// From the notch: a bar shows Stato (on), or none does (off), and a bar shows the Microphone widget (`mic`). The loop then watches
/// the radios and the volume for Stato, the microphone and the volume for the widget.
#[tauri::command]
pub fn status_bar(on: bool, mic: bool) {
    BAR_STATUS.store(on, Ordering::SeqCst);
    BAR_MIC.store(mic, Ordering::SeqCst);
    let h = LOOP.load(Ordering::SeqCst);
    if h != 0 {
        let _ = unsafe { PostMessageW(Some(HWND(h as _)), WM_SOURCES, WPARAM(0), LPARAM(0)) };
    }
}

/// The Wi-Fi page's consent prompt answered (wifi.rs `taskbar_wifi_allow`): the loop looks again whether it may follow the Wi-Fi signal.
pub(crate) fn consent_changed() {
    let h = LOOP.load(Ordering::SeqCst);
    if h != 0 {
        let _ = unsafe { PostMessageW(Some(HWND(h as _)), WM_SOURCES, WPARAM(0), LPARAM(0)) };
    }
}

const LOCK_POLL: Duration = Duration::from_millis(150);
static LOCKS_ON: AtomicBool = AtomicBool::new(false);
/// The Insert alert is on and can show; the lock poll then runs for it too.
static INSERT_ON: AtomicBool = AtomicBool::new(false);
/// Bumped on every switch; a polling thread runs while the number is still its own, so turning off ends it.
static LOCKS_RUN: AtomicUsize = AtomicUsize::new(0);

/// Caps Lock and Num Lock, toggled on or not.
type Locks = (bool, bool);

fn locks() -> Locks {
    // The low bit is the toggle state.
    unsafe { (GetKeyState(VK_CAPITAL.0 as i32) & 1 != 0, GetKeyState(VK_NUMLOCK.0 as i32) & 1 != 0) }
}

fn watch_locks(app: &AppHandle, on: bool) {
    if LOCKS_ON.swap(on, Ordering::SeqCst) == on {
        return;
    }
    let run = LOCKS_RUN.fetch_add(1, Ordering::SeqCst) + 1;
    if !on {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        let (mut last, mut insert) = (None, None);
        while LOCKS_RUN.load(Ordering::SeqCst) == run {
            if crate::standby::asleep() {
                thread::sleep(LOCK_POLL);
                continue;
            }
            for (key, on) in lock_changes(&mut last, locks()) {
                let _ = app.emit("status://lock", serde_json::json!({ "key": key, "on": on }));
            }
            // Off, Insert is not read, and turning it on starts from a new baseline.
            if !INSERT_ON.load(Ordering::SeqCst) {
                insert = None;
            } else if insert_pressed(&mut insert, insert_state()) {
                let _ = app.emit("status://lock", serde_json::json!({ "key": "insert", "on": true }));
            }
            thread::sleep(LOCK_POLL);
        }
    });
}

/// The keys whose state differs from the last reading; the first reading is the baseline, so starting never alerts.
fn lock_changes(last: &mut Option<Locks>, now: Locks) -> Vec<(&'static str, bool)> {
    let Some(before) = last.replace(now) else { return Vec::new() };
    [("caps", before.0, now.0), ("num", before.1, now.1)].into_iter().filter(|(_, was, is)| was != is).map(|(key, _, is)| (key, is)).collect()
}

/// Insert's toggle bit, and whether Ctrl, Shift, Alt or a Windows key is down.
type Insert = (bool, bool);

fn insert_state() -> Insert {
    let down = |key: VIRTUAL_KEY| unsafe { GetAsyncKeyState(key.0 as i32) } as u16 & 0x8000 != 0;
    // The toggle flips on each press, once for a held key; programs keep their own overtype state, so it says nothing of on or off.
    (unsafe { GetKeyState(VK_INSERT.0 as i32) } & 1 != 0, [VK_SHIFT, VK_CONTROL, VK_MENU, VK_LWIN, VK_RWIN].into_iter().any(down))
}

/// A bare press: the toggle flipped since the last reading and no modifier was down at either reading, so Shift+Insert
/// and Ctrl+Insert stay silent. The first reading is the baseline. shortcut: two presses between readings cancel out,
/// and a modifier pressed and released between them goes unseen; a keyboard hook would see both, at the cost of every key.
fn insert_pressed(last: &mut Option<Insert>, now: Insert) -> bool {
    let Some(before) = last.replace(now) else { return false };
    before.0 != now.0 && !before.1 && !now.1
}

const FOCUS_POLL: Duration = Duration::from_millis(500);
/// The first readings after the poll starts only set the baseline: it also starts as a fullscreen app ends, for which Windows may
/// have switched Do Not Disturb on by itself and switches it off again just then.
const FOCUS_SETTLE: Duration = Duration::from_secs(3);
static FOCUS_ON: AtomicBool = AtomicBool::new(false);
/// Bumped on every switch, as `LOCKS_RUN`.
static FOCUS_RUN: AtomicUsize = AtomicUsize::new(0);

/// A focus session running, and Do Not Disturb on.
type FocusNow = (bool, bool);

fn watch_focus(app: &AppHandle, on: bool) {
    if FOCUS_ON.swap(on, Ordering::SeqCst) == on {
        return;
    }
    let run = FOCUS_RUN.fetch_add(1, Ordering::SeqCst) + 1;
    if !on {
        return;
    }
    let app = app.clone();
    thread::spawn(move || {
        // The focus session is WinRT.
        let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
        let manager = crate::controls::sessions();
        let (mut last, started) = (None, Instant::now());
        while FOCUS_RUN.load(Ordering::SeqCst) == run {
            if crate::standby::asleep() {
                // What changed while the screen was off is a new baseline, not a change.
                last = None;
            } else {
                let now = crate::controls::focus_now(manager.as_ref());
                // A change switched in Crest's Overview, whose switch shows it, only moves the baseline.
                if started.elapsed() < FOCUS_SETTLE {
                    last = Some(now);
                } else if let Some((on, focus)) = focus_change(&mut last, now).filter(|_| !is_own(Own::Focus)) {
                    let _ = app.emit("status://focus", serde_json::json!({ "on": on, "focus": focus }));
                }
            }
            thread::sleep(FOCUS_POLL);
        }
    });
}

/// Do Not Disturb or a focus session went on or off: `on` either of them, `focus` the session, the one starting or the one that ended.
/// The first reading is the baseline; one going on while the other is (a session that brings Do Not Disturb) changes nothing.
fn focus_change(last: &mut Option<FocusNow>, now: FocusNow) -> Option<(bool, bool)> {
    let before = last.replace(now)?;
    let (was, is) = (before.0 || before.1, now.0 || now.1);
    (was != is).then_some((is, if is { now.0 } else { before.0 }))
}

/// Airplane mode as Settings and the radio switch keep it: 1 on, 0 off.
const RADIO_STATE: PCWSTR = w!(r"SYSTEM\CurrentControlSet\Control\RadioManagement\SystemRadioState");

/// Airplane mode has no documented change event: a thread waits on its registry key for the app's lifetime and tells each change. The
/// state at start is the baseline.
fn watch_airplane(app: AppHandle) {
    thread::spawn(move || unsafe {
        let mut key = HKEY::default();
        if let Err(e) = RegOpenKeyExW(HKEY_LOCAL_MACHINE, RADIO_STATE, None, KEY_NOTIFY | KEY_QUERY_VALUE, &mut key).ok() {
            return eprintln!("sysevents: airplane mode key failed: {e}");
        }
        let mut last = airplane(key);
        loop {
            // Waits here until the key changes.
            if let Err(e) = RegNotifyChangeKeyValue(key, false, REG_NOTIFY_CHANGE_LAST_SET, None, false).ok() {
                return eprintln!("sysevents: airplane mode notification failed: {e}");
            }
            let now = airplane(key);
            if now.is_some() && now != last {
                if last.is_some() {
                    let _ = app.emit("status://airplane", serde_json::json!({ "on": now }));
                }
                last = now;
            }
        }
    });
}

/// The key's default value, a DWORD; None when it is not one.
unsafe fn airplane(key: HKEY) -> Option<bool> {
    let (mut kind, mut value, mut size) = (REG_VALUE_TYPE::default(), 0u32, 4u32);
    unsafe { RegQueryValueExW(key, PCWSTR::null(), None, Some(&mut kind), Some(&mut value as *mut u32 as *mut u8), Some(&mut size)) }.ok().ok()?;
    (kind == REG_DWORD && size == 4).then_some(value != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_signal_quality_notification_wakes_the_loop() {
        use windows::Win32::NetworkManagement::WiFi::{wlan_notification_acm_scan_fail, wlan_notification_msm_disconnected, WLAN_NOTIFICATION_SOURCE_ACM};
        let quality = wlan_notification_msm_signal_quality_change.0 as u32;
        assert!(is_signal(WLAN_NOTIFICATION_SOURCE_MSM, quality));
        assert_eq!(wlan_notification_acm_scan_fail.0 as u32, quality); // the same number from the ACM source is a failed scan
        assert!(!is_signal(WLAN_NOTIFICATION_SOURCE_ACM, quality));
        assert!(!is_signal(WLAN_NOTIFICATION_SOURCE_MSM, wlan_notification_msm_disconnected.0 as u32));
    }

    #[test]
    fn the_signal_is_registered_only_once_the_location_consent_reads_allowed() {
        // The module's code above its tests, read as text: watch_signal reads the consent before it looks up the registration, and the
        // loop is its only caller (Windows may prompt for the MSM source; only the Wi-Fi page's click may bring that prompt up).
        let src = include_str!("sysevents.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        let body = &code[code.find("fn watch_signal").unwrap()..];
        assert!(body.find("checked() != \"allowed\"").unwrap() < body.find("s!(\"WlanRegisterNotification\")").unwrap());
        assert_eq!(code.matches("watch_signal(").count(), 2); // its definition and the loop's one call
    }

    #[test]
    fn the_output_icon_follows_the_form_factor() {
        assert_eq!(form_name(Some(3)), "headphones");
        assert_eq!(form_name(Some(5)), "headphones");
        assert_eq!(form_name(Some(1)), "speakers");
        assert_eq!(form_name(Some(9)), "display");
        assert_eq!(form_name(Some(2)), "other");
        assert_eq!(form_name(None), "other");
    }

    #[test]
    fn the_power_mode_tells_only_the_chosen_one() {
        let mut last = None;
        // Game mode first says nothing and is no baseline; balanced is.
        assert_eq!(user_mode(&mut last, 5), None);
        assert_eq!(user_mode(&mut last, 2), None);
        assert_eq!(user_mode(&mut last, 2), None);
        assert_eq!(user_mode(&mut last, 4), Some(4));
        // High performance is best performance too.
        assert_eq!(user_mode(&mut last, 3), None);
        // Energy saver passes over and comes back to the same mode.
        assert_eq!(user_mode(&mut last, 0), None);
        assert_eq!(user_mode(&mut last, 4), None);
        assert_eq!(user_mode(&mut last, 1), Some(1));
        assert_eq!(last, Some(1));
    }

    #[test]
    fn focus_tells_on_and_off_and_which_one() {
        let mut last = None;
        assert_eq!(focus_change(&mut last, (false, false)), None);
        // Do Not Disturb alone.
        assert_eq!(focus_change(&mut last, (false, true)), Some((true, false)));
        assert_eq!(focus_change(&mut last, (false, false)), Some((false, false)));
        // A session that brings Do Not Disturb a reading later is one change.
        assert_eq!(focus_change(&mut last, (true, false)), Some((true, true)));
        assert_eq!(focus_change(&mut last, (true, true)), None);
        assert_eq!(focus_change(&mut last, (false, false)), Some((false, true)));
        // Do Not Disturb kept after the session: still on.
        assert_eq!(focus_change(&mut last, (true, true)), Some((true, true)));
        assert_eq!(focus_change(&mut last, (false, true)), None);
    }

    #[test]
    fn percent_rounds_and_clamps() {
        assert_eq!(percent(0.0), 0);
        assert_eq!(percent(0.319_99), 32);
        assert_eq!(percent(0.5), 50);
        assert_eq!(percent(1.2), 100);
        assert_eq!(percent(-0.1), 0);
    }

    #[test]
    fn volume_changed_only_on_a_new_level() {
        let mut last = None;
        assert!(volume_changed(&mut last, (40, false)));
        // The same level again (a balance change, a held key at the top) is no change.
        assert!(!volume_changed(&mut last, (40, false)));
        assert!(volume_changed(&mut last, (40, true)));
        assert!(volume_changed(&mut last, (42, true)));
        assert_eq!(last, Some((42, true)));
    }

    #[test]
    fn the_network_in_use_names_its_kind_and_only_wifi_has_a_name_and_bars() {
        assert_eq!(network(None, Some(true)), Network { kind: Link::None, wifi: Some(true), bars: None, ssid: None });
        assert_eq!(network(None, Some(false)).wifi, Some(false));
        assert_eq!(network(None, None).wifi, None);
        let wired = network(Some(Profile { wlan: false, ssid: Some("x".into()), bars: Some(3) }), Some(true));
        assert_eq!((wired.kind, wired.ssid, wired.bars), (Link::Wired, None, None));
        let wifi = network(Some(Profile { wlan: true, ssid: Some("Home".into()), bars: Some(4) }), Some(true));
        assert_eq!((wifi.kind, wifi.ssid.as_deref(), wifi.bars), (Link::Wireless, Some("Home"), Some(4)));
        assert_eq!(network(Some(Profile { wlan: true, ssid: Some(String::new()), bars: None }), Some(true)).ssid, None);
    }

    #[test]
    fn a_signal_change_moves_only_the_bars_of_the_wifi_already_shown() {
        let home = network(Some(Profile { wlan: true, ssid: Some("Home".into()), bars: Some(4) }), Some(true));
        assert_eq!(rebar(Some(&home), Some(2)), Some(Network { bars: Some(2), ..home.clone() }));
        assert_eq!(rebar(Some(&home), Some(4)), None);
        assert_eq!(rebar(Some(&network(None, Some(true))), Some(2)), None);
        assert_eq!(rebar(None, Some(2)), None);
        // The signal's path reads no name: GetConnectedSsid is one of the location-gated Wi-Fi reads.
        let src = include_str!("sysevents.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        let body = &code[code.find("fn send_bars").unwrap()..];
        assert!(!body[..body.find("\n}").unwrap()].contains("Ssid"));
    }

    #[test]
    fn the_network_reaches_the_page_in_lower_case() {
        let sent = serde_json::to_value(network(None, None)).unwrap();
        assert_eq!(sent["kind"], "none");
        assert_eq!(sent["wifi"], serde_json::Value::Null);
        assert_eq!(serde_json::to_value(Sound { level: 40, muted: true }).unwrap(), serde_json::json!({ "level": 40, "muted": true }));
    }

    #[test]
    fn a_volume_change_tells_the_hud_only_from_outside_and_the_bar_always() {
        // (alert, bar, own) -> (status://level, status://sound)
        assert_eq!(sound_events(true, false, false), (true, false));
        assert_eq!(sound_events(true, true, true), (false, true));
        assert_eq!(sound_events(false, true, false), (false, true));
        assert_eq!(sound_events(false, false, false), (false, false));
    }

    #[test]
    fn the_seed_carries_the_bar_microphone_or_null() {
        let seed = |microphone| Seed { power: None, online: None, devices: Vec::new(), network: None, sound: None, microphone };
        assert_eq!(serde_json::to_value(seed(Some(true))).unwrap()["microphone"], true);
        assert_eq!(serde_json::to_value(seed(None)).unwrap()["microphone"], serde_json::Value::Null);
    }

    #[test]
    fn a_mute_tells_the_bar_every_change_and_the_alert_only_outside_ones() {
        // The module's code above its tests, read as text: the microphone goes through the volume's rule, and its callback runs for
        // the alert or for the bar's Microphone widget.
        let src = include_str!("sysevents.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        assert!(code.contains("sound_events(mic_alert, bar_mic, own)"));
        assert!(code.contains("if (mic_alert || mic_bar) != mic_on"));
    }

    #[test]
    fn power_carries_the_saver_to_the_page() {
        let sent = serde_json::to_value(Power { ac: true, percent: Some(50), battery: true, charging: false, saver: true }).unwrap();
        assert_eq!(sent["saver"], true);
    }

    #[test]
    fn the_session_goes_to_the_page_as_three_flags() {
        let sent = serde_json::to_value(Session { locked: true, remote: false, asleep: true }).unwrap();
        assert_eq!(sent, serde_json::json!({ "locked": true, "remote": false, "asleep": true }));
    }

    #[test]
    fn the_live_copy_stops_for_the_first_reason_that_holds() {
        assert_eq!(Session::default().halts(), None);
        assert_eq!(Session { locked: true, ..Default::default() }.halts(), Some("locked"));
        assert_eq!(Session { remote: true, ..Default::default() }.halts(), Some("remote"));
        assert_eq!(Session { asleep: true, ..Default::default() }.halts(), Some("asleep"));
        assert_eq!(Session { locked: true, remote: true, asleep: true }.halts(), Some("asleep"));
        assert_eq!(Session { locked: true, remote: true, asleep: false }.halts(), Some("locked"));
    }

    #[test]
    fn lock_changes_skip_the_first_reading_and_repeats() {
        let mut last = None;
        assert!(lock_changes(&mut last, (false, true)).is_empty());
        assert!(lock_changes(&mut last, (false, true)).is_empty());
        assert_eq!(lock_changes(&mut last, (true, true)), vec![("caps", true)]);
        assert_eq!(lock_changes(&mut last, (false, false)), vec![("caps", false), ("num", false)]);
        assert_eq!(last, Some((false, false)));
    }

    #[test]
    fn insert_counts_only_a_bare_press() {
        let mut last = None;
        // The first reading is the baseline.
        assert!(!insert_pressed(&mut last, (true, false)));
        // Held or untouched: the toggle stays, nothing.
        assert!(!insert_pressed(&mut last, (true, false)));
        assert!(insert_pressed(&mut last, (false, false)));
        // Shift+Insert or Ctrl+Insert: a modifier down now, or at the reading before, is a shortcut.
        assert!(!insert_pressed(&mut last, (true, true)));
        assert!(!insert_pressed(&mut last, (true, true)));
        assert!(!insert_pressed(&mut last, (false, false)));
        assert!(insert_pressed(&mut last, (true, false)));
        assert_eq!(last, Some((true, false)));
    }
}
