//! The microphone mute: Overview's Microphone switch and the optional global shortcut (Settings, Window).
//!
//! - Windows: `IAudioEndpointVolume::SetMute` on the default capture device, the same switch as Sound settings. Calls use the
//!   other default too (the one Windows keeps for calls), so Teams or Zoom on that device are muted along with a browser on this one.
//! - macOS: no mute switch on the input, so the input level goes to 0 with `osascript` and back to what it was (kept in memory;
//!   75 when Crest restarted in between and has nothing to go back to).
//!
//! Nothing here runs by itself: the state is read when Overview asks (`quick_get`), and changed on a click or the shortcut.
//! The shortcut sends `status://mic` so the closed notch can say it (status alert "Microphone").

use tauri::{AppHandle, Emitter};

/// Sent after the shortcut toggled the mute.
const EVENT: &str = "status://mic";

#[cfg(windows)]
mod sys {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eCapture, eCommunications, eConsole, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    /// The default microphone for apps and the one for calls, usually the same device. None when the PC has none.
    fn endpoints() -> Vec<IAudioEndpointVolume> {
        unsafe {
            // Own thread per call (spawn_blocking) → MTA; "already initialized" is fine.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return Vec::new() };
            [eConsole, eCommunications]
                .into_iter()
                .filter_map(|role| devices.GetDefaultAudioEndpoint(eCapture, role).ok()?.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None).ok())
                .collect()
        }
    }

    /// Muted when every default microphone is; None without a microphone.
    pub fn muted() -> Option<bool> {
        let endpoints = endpoints();
        (!endpoints.is_empty()).then(|| endpoints.iter().all(|e| unsafe { e.GetMute() }.is_ok_and(|m| m.as_bool())))
    }

    pub fn set_muted(on: bool) -> Result<(), String> {
        let endpoints = endpoints();
        if endpoints.is_empty() {
            return Err("none".into());
        }
        for e in &endpoints {
            unsafe { e.SetMute(on, std::ptr::null()) }.map_err(|e| e.message())?;
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod sys {
    use std::process::Command;
    use std::sync::atomic::{AtomicU8, Ordering};

    use super::{level_from, restore_level};

    /// The input level before Crest set it to 0; 0 = none remembered.
    static BEFORE: AtomicU8 = AtomicU8::new(0);

    fn osascript(script: &str) -> Option<String> {
        let out = Command::new("/usr/bin/osascript").args(["-e", script]).output().ok()?;
        out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
    }

    fn level() -> Option<u8> {
        level_from(&osascript("input volume of (get volume settings)")?)
    }

    /// Muted at input level 0; None when the input has no level (no microphone, or one the system cannot set).
    pub fn muted() -> Option<bool> {
        level().map(|l| l == 0)
    }

    pub fn set_muted(on: bool) -> Result<(), String> {
        let now = level().ok_or("none")?;
        if (now == 0) == on {
            return Ok(());
        }
        if on {
            BEFORE.store(now, Ordering::SeqCst);
        }
        let target = if on { 0 } else { restore_level(BEFORE.load(Ordering::SeqCst)) };
        osascript(&format!("set volume input volume {target}")).map(drop).ok_or_else(|| "failed".to_string())
    }
}

/// `osascript` answers "missing value" for an input without a level.
#[cfg_attr(windows, allow(dead_code))]
fn level_from(answer: &str) -> Option<u8> {
    answer.trim().parse::<u8>().ok().filter(|l| *l <= 100)
}

/// Where unmuting goes back to: the level before the mute, or a usual one when there is none to go back to.
#[cfg_attr(windows, allow(dead_code))]
fn restore_level(before: u8) -> u8 {
    if before == 0 { 75 } else { before }
}

/// Muted or not, None without a microphone. Blocking: COM or a child process.
pub fn muted() -> Option<bool> {
    sys::muted()
}

/// Mutes (`on`) or unmutes the default microphone.
#[tauri::command]
pub async fn mic_mute(on: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || sys::set_muted(on)).await.map_err(|e| e.to_string())?
}

/// The shortcut: flips the mute and tells the interface. Without a microphone it does nothing.
pub fn toggle(app: &AppHandle) {
    let Some(now) = sys::muted() else { return };
    if sys::set_muted(!now).is_ok() {
        let _ = app.emit(EVENT, serde_json::json!({ "muted": !now }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_input_level() {
        assert_eq!(level_from("63\n"), Some(63));
        assert_eq!(level_from("0"), Some(0));
        assert_eq!(level_from("100\n"), Some(100));
        assert_eq!(level_from("missing value\n"), None);
        assert_eq!(level_from(""), None);
        assert_eq!(level_from("101"), None);
    }

    #[test]
    fn unmuting_goes_back_to_the_old_level() {
        assert_eq!(restore_level(42), 42);
        assert_eq!(restore_level(0), 75);
    }

    /// Flips the real default microphone for a moment and puts it back: `cargo test --lib mic::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_mute_round_trip() {
        let Some(was) = muted() else { return eprintln!("no microphone") };
        sys::set_muted(!was).unwrap();
        let flipped = muted();
        sys::set_muted(was).unwrap();
        eprintln!("was muted {was}, flipped reads {flipped:?}, now {:?}", muted());
        assert_eq!(flipped, Some(!was));
        assert_eq!(muted(), Some(was));
    }
}
