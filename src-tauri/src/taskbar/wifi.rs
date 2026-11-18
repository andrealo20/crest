//! The quick panel's Wi-Fi page, through Windows.Devices.WiFi: the networks nearby, connecting with a saved profile or a
//! password typed once, and disconnecting.
//!
//! Windows asks the user's location consent for every call of that namespace. `taskbar_wifi_scan` only reads it (`CheckAccess`,
//! which never prompts), and only `taskbar_wifi_allow`, run by a click on the page, may show Windows' prompt
//! (`RequestAccessAsync`). The password passes once, into Windows' credential, and is never logged nor put in an error: every
//! answer is a fixed word ("denied", "settings", "none", "unavailable", "password", "timeout", "failed").
//!
//! Only bars call these (`bar::from_bar`, the notch refused too). The Store package declares no `wiFiControl`, so there each
//! command answers "settings" (the bar never runs there anyway).

use std::cmp::Reverse;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::WebviewWindow;
use windows::core::HSTRING;
use windows::Devices::WiFi::{WiFiAccessStatus, WiFiAdapter, WiFiConnectionStatus, WiFiReconnectionKind};
use windows::Networking::Connectivity::{ConnectionProfileFilter, NetworkAuthenticationType, NetworkInformation};
use windows::Security::Authorization::AppCapabilityAccess::{AppCapability, AppCapabilityAccessStatus};
use windows::Security::Credentials::PasswordCredential;

use super::bar;

/// What a network asks to join: nothing, a password, or more than the page offers (Windows' settings).
#[derive(Serialize, Debug, PartialEq, Clone, Copy)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Open,
    Personal,
    Enterprise,
}

/// One row of the page.
#[derive(Serialize, Debug, PartialEq)]
pub struct WifiNetwork {
    ssid: String,
    /// 0 to 4.
    bars: u8,
    kind: Kind,
    /// Windows has a WLAN profile of that name.
    saved: bool,
    connected: bool,
}

/// `state`: "allowed" (with the rows), "ask" (Windows would prompt), "denied" (refused in Windows' privacy settings), "none" (no
/// Wi-Fi adapter).
#[derive(Serialize)]
pub struct WifiList {
    state: &'static str,
    networks: Vec<WifiNetwork>,
}

/// A network as the adapter's report gives it.
struct Seen {
    ssid: String,
    bars: u8,
    auth: NetworkAuthenticationType,
    direct: bool,
}

/// Enhanced open (OWE) is open; WEP and every pre-shared key ask a password; 802.1X, Ihv and unknown kinds go to Windows' settings.
fn kind_of(auth: NetworkAuthenticationType) -> Kind {
    use NetworkAuthenticationType as A;
    match auth {
        A::None | A::Open80211 | A::Owe => Kind::Open,
        A::WpaPsk | A::RsnaPsk | A::Wpa3Sae | A::SharedKey80211 | A::WpaNone => Kind::Personal,
        _ => Kind::Enterprise,
    }
}

/// One row per name with its strongest signal, hidden networks and Wi-Fi Direct left out; the network in use first, then by
/// signal, then by name.
fn rows(seen: Vec<Seen>, connected: Option<&str>, saved: &[String]) -> Vec<WifiNetwork> {
    let mut out: Vec<WifiNetwork> = Vec::new();
    for s in seen.into_iter().filter(|s| !s.direct && !s.ssid.is_empty()) {
        let bars = s.bars.min(4);
        match out.iter_mut().find(|n| n.ssid == s.ssid) {
            Some(n) if n.bars >= bars => {}
            Some(n) => {
                n.bars = bars;
                n.kind = kind_of(s.auth);
            }
            None => out.push(WifiNetwork { connected: connected == Some(s.ssid.as_str()), saved: saved.contains(&s.ssid), kind: kind_of(s.auth), bars, ssid: s.ssid }),
        }
    }
    out.sort_by_key(|n| (!n.connected, Reverse(n.bars), n.ssid.to_lowercase()));
    out
}

/// Windows' prompt answered "allowed" in this run. An unpackaged app may read "not declared" from `CheckAccess` even then, so
/// that reading counts as allowed once the prompt granted it; after a restart the first click answers at once.
static GRANTED: AtomicBool = AtomicBool::new(false);

/// Windows' consent as `CheckAccess` reads it, `granted` being the prompt's answer in this run. An unpackaged app may get "not
/// declared": its click asks Windows, which answers at once when Crest is already allowed.
fn access_word(s: AppCapabilityAccessStatus, granted: bool) -> &'static str {
    match s {
        AppCapabilityAccessStatus::Allowed => "allowed",
        AppCapabilityAccessStatus::NotDeclaredByApp if granted => "allowed",
        AppCapabilityAccessStatus::UserPromptRequired | AppCapabilityAccessStatus::NotDeclaredByApp => "ask",
        _ => "denied",
    }
}

/// The answer to Windows' prompt.
fn request_word(s: WiFiAccessStatus) -> &'static str {
    if s == WiFiAccessStatus::Allowed { "allowed" } else { "denied" }
}

fn connect_code(s: WiFiConnectionStatus) -> Result<(), &'static str> {
    use WiFiConnectionStatus as S;
    match s {
        S::Success => Ok(()),
        S::InvalidCredential => Err("password"),
        S::NetworkNotAvailable => Err("unavailable"),
        S::Timeout => Err("timeout"),
        S::UnsupportedAuthenticationProtocol => Err("settings"),
        S::AccessRevoked => Err("denied"),
        _ => Err("failed"),
    }
}

/// The calling window must be a bar; the Store build has no Wi-Fi page.
fn guard(window: &WebviewWindow) -> Result<(), String> {
    bar::from_bar(window)?;
    if cfg!(feature = "store") {
        return Err("settings".into());
    }
    Ok(())
}

/// Runs `job` on a COM thread (it waits on WinRT); any failure is a fixed word.
async fn run<T: Send + 'static>(job: impl FnOnce() -> Result<T, &'static str> + Send + 'static) -> Result<T, String> {
    crate::quick::blocking(job).await.map_err(|_| "failed".to_string())?.map_err(String::from)
}

/// Windows' consent, read without prompting.
fn checked() -> &'static str {
    AppCapability::Create(&HSTRING::from("wiFiControl")).and_then(|c| c.CheckAccess()).map(|s| access_word(s, GRANTED.load(Ordering::Relaxed))).unwrap_or("denied")
}

/// The adapter the page last scanned with. Windows fills `NetworkReport` from the last scan on that same object, so connecting
/// and rereading go through it: a new object's report may be empty.
static ADAPTER: Mutex<Option<WiFiAdapter>> = Mutex::new(None);

/// The value kept in `slot`, or a new one from `find` when `fresh` or none is kept (a failure keeps nothing).
fn kept<T: Clone>(slot: &Mutex<Option<T>>, fresh: bool, find: impl FnOnce() -> Result<T, &'static str>) -> Result<T, &'static str> {
    let mut slot = slot.lock().unwrap_or_else(|e| e.into_inner());
    if let (false, Some(a)) = (fresh, slot.as_ref()) {
        return Ok(a.clone());
    }
    let found = find();
    *slot = found.as_ref().ok().cloned();
    found
}

/// The first Wi-Fi adapter, looked up again when `fresh` (each scan, so an adapter plugged or pulled is seen); "none" without one.
fn adapter(fresh: bool) -> Result<WiFiAdapter, &'static str> {
    kept(&ADAPTER, fresh, || {
        let all = WiFiAdapter::FindAllAdaptersAsync().and_then(|op| op.join()).map_err(|_| "failed")?;
        all.into_iter().next().ok_or("none")
    })
}

/// The page's rows, after a fresh scan when `scan` (the page's first read and its refresh button). Without consent, only the
/// state: nothing else is called.
#[tauri::command]
pub async fn taskbar_wifi_scan(window: WebviewWindow, scan: bool) -> Result<WifiList, String> {
    guard(&window)?;
    run(move || {
        let state = checked();
        if state != "allowed" {
            return Ok(WifiList { state, networks: vec![] });
        }
        let adapter = match adapter(scan) {
            Err("none") => return Ok(WifiList { state: "none", networks: vec![] }),
            other => other?,
        };
        if scan {
            // A failed scan still leaves the last report.
            let _ = adapter.ScanAsync().map_err(|_| "failed")?.join();
        }
        let report = adapter.NetworkReport().and_then(|r| r.AvailableNetworks()).map_err(|_| "failed")?;
        // A network whose read fails is left out.
        let seen = report
            .into_iter()
            .filter_map(|n| {
                Some(Seen {
                    ssid: n.Ssid().ok()?.to_string_lossy(),
                    bars: n.SignalBars().ok()?,
                    auth: n.SecuritySettings().and_then(|s| s.NetworkAuthenticationType()).ok()?,
                    direct: n.IsWiFiDirect().ok()?,
                })
            })
            .collect();
        let connected = adapter
            .NetworkAdapter()
            .and_then(|a| a.GetConnectedProfileAsync())
            .and_then(|op| op.join())
            .and_then(|p| p.WlanConnectionProfileDetails())
            .and_then(|d| d.GetConnectedSsid())
            .map(|s| s.to_string_lossy())
            .ok()
            .filter(|s| !s.is_empty());
        let saved: Vec<String> = ConnectionProfileFilter::new()
            .and_then(|f| {
                f.SetIsWlanConnectionProfile(true)?;
                NetworkInformation::FindConnectionProfilesAsync(&f)?.join()
            })
            .map(|list| list.into_iter().filter_map(|p| p.ProfileName().ok()).map(|n| n.to_string_lossy()).collect())
            .unwrap_or_default();
        Ok(WifiList { state, networks: rows(seen, connected.as_deref(), &saved) })
    })
    .await
}

/// The click on "Show nearby networks": Windows' prompt, then the focus back to the bar, which the prompt took (the panel waits
/// for it). "allowed" or "denied".
#[tauri::command]
pub async fn taskbar_wifi_allow(window: WebviewWindow) -> Result<String, String> {
    guard(&window)?;
    let word = run(|| WiFiAdapter::RequestAccessAsync().and_then(|op| op.join()).map(request_word).map_err(|_| "failed")).await;
    let _ = window.set_focus();
    let word = word?;
    GRANTED.store(word == "allowed", Ordering::Relaxed);
    Ok(word.into())
}

/// Joins `ssid` as the last report saw it (no scan), with Windows' saved profile when `password` is None, else with that
/// password, which Windows saves with automatic reconnection as it does itself.
#[tauri::command]
pub async fn taskbar_wifi_connect(window: WebviewWindow, ssid: String, password: Option<String>) -> Result<(), String> {
    guard(&window)?;
    run(move || {
        if checked() != "allowed" {
            return Err("denied");
        }
        let adapter = adapter(false)?;
        let report = adapter.NetworkReport().and_then(|r| r.AvailableNetworks()).map_err(|_| "failed")?;
        let net = report
            .into_iter()
            .filter(|n| n.Ssid().is_ok_and(|s| s.to_string_lossy() == ssid))
            .max_by_key(|n| n.SignalBars().unwrap_or(0))
            .ok_or("unavailable")?;
        let auth = net.SecuritySettings().and_then(|s| s.NetworkAuthenticationType()).map_err(|_| "failed")?;
        if kind_of(auth) == Kind::Enterprise {
            return Err("settings");
        }
        let auto = WiFiReconnectionKind::Automatic;
        let result = match password {
            Some(p) if p.is_empty() => return Err("password"),
            Some(p) => {
                let cred = PasswordCredential::new().map_err(|_| "failed")?;
                cred.SetPassword(&HSTRING::from(p.as_str())).map_err(|_| "failed")?;
                drop(p);
                adapter.ConnectWithPasswordCredentialAsync(&net, auto, &cred).and_then(|op| op.join())
            }
            None => adapter.ConnectAsync(&net, auto).and_then(|op| op.join()),
        };
        connect_code(result.and_then(|r| r.ConnectionStatus()).map_err(|_| "failed")?)
    })
    .await
}

/// Leaves the network in use.
#[tauri::command]
pub async fn taskbar_wifi_disconnect(window: WebviewWindow) -> Result<(), String> {
    guard(&window)?;
    run(|| {
        if checked() != "allowed" {
            return Err("denied");
        }
        adapter(false)?.Disconnect().map_err(|_| "failed")
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seen(ssid: &str, bars: u8, auth: NetworkAuthenticationType) -> Seen {
        Seen { ssid: ssid.into(), bars, auth, direct: false }
    }

    #[test]
    fn one_row_per_name_the_strongest_kept_the_one_in_use_first() {
        let psk = NetworkAuthenticationType::RsnaPsk;
        let list = rows(
            vec![seen("Cafe", 1, psk), seen("Home", 2, psk), seen("Cafe", 3, psk), seen("Lab", 4, NetworkAuthenticationType::Open80211)],
            Some("Home"),
            &["Home".to_string()],
        );
        assert_eq!(list.iter().map(|n| (n.ssid.as_str(), n.bars, n.connected)).collect::<Vec<_>>(), [("Home", 2, true), ("Lab", 4, false), ("Cafe", 3, false)]);
        assert!(list[0].saved && !list[2].saved);
        assert_eq!(list[1].kind, Kind::Open);
    }

    #[test]
    fn equal_signals_sort_by_name_and_bars_stay_in_range() {
        let open = NetworkAuthenticationType::Open80211;
        let list = rows(vec![seen("beta", 9, open), seen("Alpha", 4, open)], None, &[]);
        assert_eq!(list.iter().map(|n| (n.ssid.as_str(), n.bars)).collect::<Vec<_>>(), [("Alpha", 4), ("beta", 4)]);
    }

    #[test]
    fn hidden_and_wifi_direct_networks_are_left_out() {
        let psk = NetworkAuthenticationType::RsnaPsk;
        let mut direct = seen("DIRECT-xy", 4, psk);
        direct.direct = true;
        assert!(rows(vec![seen("", 4, psk), direct], None, &[]).is_empty());
    }

    #[test]
    fn security_decides_password_or_settings() {
        use NetworkAuthenticationType as A;
        for a in [A::None, A::Open80211, A::Owe] {
            assert_eq!(kind_of(a), Kind::Open);
        }
        for a in [A::WpaPsk, A::RsnaPsk, A::Wpa3Sae, A::SharedKey80211, A::WpaNone] {
            assert_eq!(kind_of(a), Kind::Personal);
        }
        for a in [A::Wpa, A::Rsna, A::Wpa3Enterprise192Bits, A::Wpa3Enterprise, A::Ihv, A::Unknown] {
            assert_eq!(kind_of(a), Kind::Enterprise);
        }
    }

    #[test]
    fn access_is_asked_only_where_windows_would_prompt() {
        use AppCapabilityAccessStatus as C;
        assert_eq!(access_word(C::Allowed, false), "allowed");
        assert_eq!(access_word(C::UserPromptRequired, false), "ask");
        assert_eq!(access_word(C::NotDeclaredByApp, false), "ask");
        assert_eq!(access_word(C::DeniedByUser, false), "denied");
        assert_eq!(access_word(C::DeniedBySystem, false), "denied");
        // Granted by the prompt in this run: honoured only where an unpackaged Crest reads "not declared".
        assert_eq!(access_word(C::NotDeclaredByApp, true), "allowed");
        assert_eq!(access_word(C::UserPromptRequired, true), "ask");
        assert_eq!(access_word(C::DeniedByUser, true), "denied");
        assert_eq!(request_word(WiFiAccessStatus::Allowed), "allowed");
        assert_eq!(request_word(WiFiAccessStatus::DeniedByUser), "denied");
        assert_eq!(request_word(WiFiAccessStatus::DeniedBySystem), "denied");
        assert_eq!(request_word(WiFiAccessStatus::Unspecified), "denied");
    }

    #[test]
    fn the_scanned_adapter_is_kept_for_connect_and_found_again_at_each_scan() {
        let slot = Mutex::new(None);
        assert_eq!(kept(&slot, false, || Ok(1)), Ok(1));
        // Connect and reread reuse the object the scan filled.
        assert_eq!(kept(&slot, false, || Ok(2)), Ok(1));
        assert_eq!(kept(&slot, true, || Ok(3)), Ok(3));
        assert_eq!(kept(&slot, false, || Ok(4)), Ok(3));
        // An adapter gone at a scan is forgotten.
        assert_eq!(kept(&slot, true, || Err("none")), Err::<i32, _>("none"));
        assert_eq!(kept(&slot, false, || Ok(5)), Ok(5));
    }

    #[test]
    fn connection_answers_are_fixed_words() {
        use WiFiConnectionStatus as S;
        assert_eq!(connect_code(S::Success), Ok(()));
        assert_eq!(connect_code(S::InvalidCredential), Err("password"));
        assert_eq!(connect_code(S::NetworkNotAvailable), Err("unavailable"));
        assert_eq!(connect_code(S::Timeout), Err("timeout"));
        assert_eq!(connect_code(S::UnsupportedAuthenticationProtocol), Err("settings"));
        assert_eq!(connect_code(S::AccessRevoked), Err("denied"));
        assert_eq!(connect_code(S::UnspecifiedFailure), Err("failed"));
    }

    #[test]
    fn only_the_click_asks_windows_and_no_message_carries_the_password_or_an_error() {
        // The module's code above its tests, read as text: one prompt, in taskbar_wifi_allow, and nothing that formats or logs.
        let src = include_str!("wifi.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        let ask = concat!("RequestAccess", "Async(");
        assert_eq!(code.matches(ask).count(), 1);
        let at = code.find(ask).unwrap();
        assert!(code.find("fn taskbar_wifi_allow").unwrap() < at && at < code.find("fn taskbar_wifi_connect").unwrap());
        for leak in ["eprintln!", "println!", "dbg!", "format!", "panic!", "e.to_string()", "{e}", "{password"] {
            assert!(!code.contains(leak), "wifi.rs must not contain {leak}");
        }
    }
}
