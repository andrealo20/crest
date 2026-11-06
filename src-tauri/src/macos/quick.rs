//! Overview's quick controls on a Mac, with the system's own command line tools: networksetup for Wi-Fi, System Events for
//! the dark appearance, restart and shut down, pmset to lock (the display sleeps and asks for the password) and to sleep.
//! Bluetooth has no public switch on macOS, so it is left out (None).

use std::process::Command;

use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quick {
    wifi: Option<bool>,
    bluetooth: Option<bool>,
    dark: bool,
    mic_muted: Option<bool>,
}

fn output(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// The Wi-Fi interface ("en0" on most Macs), from the list of hardware ports.
fn wifi_device() -> Option<String> {
    let ports = output("/usr/sbin/networksetup", &["-listallhardwareports"])?;
    let mut lines = ports.lines();
    while let Some(line) = lines.next() {
        if line.trim() == "Hardware Port: Wi-Fi" || line.trim() == "Hardware Port: AirPort" {
            return lines.next()?.trim().strip_prefix("Device: ").map(str::to_string);
        }
    }
    None
}

fn wifi_on() -> Option<bool> {
    let dev = wifi_device()?;
    Some(output("/usr/sbin/networksetup", &["-getairportpower", &dev])?.trim_end().ends_with("On"))
}

fn osascript(script: &str) -> Result<(), String> {
    let status = Command::new("/usr/bin/osascript").args(["-e", script]).status().map_err(|e| e.to_string())?;
    status.success().then_some(()).ok_or_else(|| "denied".into())
}

#[tauri::command]
pub async fn quick_get() -> Result<Quick, String> {
    tauri::async_runtime::spawn_blocking(|| Quick {
        wifi: wifi_on(),
        bluetooth: None,
        // Unset in light mode: `defaults` then fails.
        dark: output("/usr/bin/defaults", &["read", "-g", "AppleInterfaceStyle"]).is_some_and(|s| s.trim() == "Dark"),
        mic_muted: crate::mic::muted(),
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn quick_radio(kind: String, on: bool) -> Result<(), String> {
    if kind != "wifi" {
        return Err("none".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let dev = wifi_device().ok_or("none")?;
        output("/usr/sbin/networksetup", &["-setairportpower", &dev, if on { "on" } else { "off" }]).map(drop).ok_or_else(|| "failed".to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn quick_dark(on: bool) -> Result<(), String> {
    osascript(&format!("tell application \"System Events\" to tell appearance preferences to set dark mode to {on}"))
}

#[tauri::command]
pub fn quick_power(action: String) -> Result<(), String> {
    match action.as_str() {
        "lock" => output("/usr/bin/pmset", &["displaysleepnow"]).map(drop).ok_or_else(|| "failed".into()),
        "sleep" => output("/usr/bin/pmset", &["sleepnow"]).map(drop).ok_or_else(|| "failed".into()),
        "restart" => osascript("tell application \"System Events\" to restart"),
        "shutdown" => osascript("tell application \"System Events\" to shut down"),
        _ => Err("unknown".into()),
    }
}
