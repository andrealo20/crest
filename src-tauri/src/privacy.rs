//! Dots like on iPhone: is anything using the mic or camera, or recording the screen?
//!
//! Windows tracks this itself (Settings → Privacy → "Recent activity") under
//! `HKCU\…\CapabilityAccessManager\ConsentStore\<capability>`: one key per app with
//! `LastUsedTimeStart`/`LastUsedTimeStop`. Stop = 0 means "in use". Desktop apps
//! sit one level deeper under `NonPackaged`.
//!
//! Screen recording: `graphicsCaptureProgrammatic` and `graphicsCaptureWithoutBorder`. Windows records them only
//! for packaged apps that go through its consent check (Snipping Tool, Click to Do, Store apps). Desktop apps
//! (OBS, Zoom, Discord, browsers sharing a tab or the screen) leave no entry with any capture API: measured on
//! build 26300 with FFmpeg's WGC, DXGI and GDI capture and Chrome's getDisplayMedia. `NonPackaged` is still
//! read in case a build starts recording them.

use serde::Serialize;
use windows::core::{HSTRING, PCWSTR};
use windows::Win32::Foundation::ERROR_SUCCESS;
use windows::Win32::System::Registry::{RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ};

const BASE: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

#[derive(Serialize)]
pub struct Privacy {
    mic: bool,
    camera: bool,
    screen: bool,
}

/// Crest's own entries: its exe path as the consent store spells it (`\` as `#`) and, in the Store build, its
/// package family. Never counted, so the Camera tool does not light the camera dot while the user looks at themself.
struct Own {
    exe: Option<String>,
    family: Option<String>,
}

impl Own {
    fn get() -> &'static Own {
        static OWN: std::sync::OnceLock<Own> = std::sync::OnceLock::new();
        OWN.get_or_init(|| Own {
            exe: std::env::current_exe().ok().map(|p| p.to_string_lossy().replace('\\', "#").to_lowercase()),
            // Fails outside a package, which is every build but the Store one.
            family: windows::ApplicationModel::Package::Current().and_then(|p| p.Id()).and_then(|id| id.FamilyName()).ok().map(|f| f.to_string().to_lowercase()),
        })
    }

    /// `name`: a subkey of `NonPackaged` (an exe path) or of the capability itself (a package family).
    fn is(&self, name: &str, non_packaged: bool) -> bool {
        let mine = if non_packaged { &self.exe } else { &self.family };
        mine.as_deref() == Some(name.to_lowercase().as_str())
    }
}

/// Snipping Tool declares only the borderless capability, so its recordings show up under that one alone.
const SCREEN: [&str; 2] = ["graphicsCaptureProgrammatic", "graphicsCaptureWithoutBorder"];

// async: the registry walk runs off the main thread, which animates the notch.
#[tauri::command(async)]
pub fn privacy_state() -> Privacy {
    let busy = |caps: &[&str]| any_in_use(BASE, caps, Own::get());
    Privacy { mic: busy(&["microphone"]), camera: busy(&["webcam"]), screen: busy(&SCREEN) }
}

fn any_in_use(base: &str, caps: &[&str], own: &Own) -> bool {
    caps.iter().any(|cap| in_use(&format!(r"{base}\{cap}"), own))
}

/// Is any app under `path` (or `path\NonPackaged`) active right now?
fn in_use(path: &str, own: &Own) -> bool {
    let Some(key) = open(HKEY_CURRENT_USER, path) else { return false };
    let mut active = false;
    for name in subkeys(key) {
        let Some(sub) = open(key, &name) else { continue };
        if name == "NonPackaged" {
            active |= subkeys(sub).iter().filter(|n| !own.is(n, true)).any(|n| open(sub, n).is_some_and(|k| running_close(k)));
        } else if !own.is(&name, false) {
            active |= running(sub);
        }
        close(sub);
        if active {
            break;
        }
    }
    close(key);
    active
}

/// Start set and Stop = 0 → in use.
fn running(key: HKEY) -> bool {
    let start = qword(key, "LastUsedTimeStart");
    let stop = qword(key, "LastUsedTimeStop");
    start.is_some_and(|s| s > 0) && stop == Some(0)
}

fn running_close(key: HKEY) -> bool {
    let r = running(key);
    close(key);
    r
}

fn close(key: HKEY) {
    unsafe {
        let _ = RegCloseKey(key);
    }
}

fn open(parent: HKEY, path: &str) -> Option<HKEY> {
    let mut key = HKEY::default();
    let ok = unsafe { RegOpenKeyExW(parent, &HSTRING::from(path), Some(0), KEY_READ, &mut key) } == ERROR_SUCCESS;
    ok.then_some(key)
}

fn subkeys(key: HKEY) -> Vec<String> {
    let mut out = Vec::new();
    for i in 0.. {
        let mut buf = [0u16; 512];
        let mut len = buf.len() as u32;
        let status = unsafe { RegEnumKeyExW(key, i, Some(windows::core::PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None) };
        if status != ERROR_SUCCESS {
            break;
        }
        out.push(String::from_utf16_lossy(&buf[..len as usize]));
    }
    out
}

fn qword(key: HKEY, name: &str) -> Option<u64> {
    let mut value = 0u64;
    let mut size = 8u32;
    let name = HSTRING::from(name);
    let status = unsafe { RegQueryValueExW(key, PCWSTR(name.as_ptr()), None, None, Some(&mut value as *mut u64 as *mut u8), Some(&mut size)) };
    (status == ERROR_SUCCESS).then_some(value)
}

#[cfg(test)]
mod tests {
    use super::{any_in_use, Own, SCREEN};
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{RegCreateKeyW, RegDeleteTreeW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, REG_QWORD};

    /// `path` under the fake consent store, with LastUsedTimeStart/Stop like Windows writes them.
    fn entry(root: &str, path: &str, start: u64, stop: u64) {
        let mut key = HKEY::default();
        unsafe {
            assert!(RegCreateKeyW(HKEY_CURRENT_USER, &HSTRING::from(format!(r"{root}\{path}")), &mut key).is_ok());
            for (name, v) in [("LastUsedTimeStart", start), ("LastUsedTimeStop", stop)] {
                assert!(RegSetValueExW(key, &HSTRING::from(name), None, REG_QWORD, Some(&v.to_le_bytes())).is_ok());
            }
            super::close(key);
        }
    }

    #[test]
    fn screen_counts_either_capture_capability() {
        let root = format!(r"Software\CrestPrivacyTest{}", std::process::id());
        let own = Own { exe: Some(r"c:#apps#crest.exe".into()), family: None };
        let busy = || any_in_use(&root, &SCREEN, &own);
        let wipe = || unsafe { RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(root.as_str())) };

        entry(&root, r"graphicsCaptureProgrammatic\MSTeams_8wekyb3d8bbwe", 5, 9);
        entry(&root, r"graphicsCaptureWithoutBorder\NonPackaged\c:#apps#crest.exe", 5, 0);
        let idle = busy(); // only a finished capture and Crest's own
        // Snipping Tool declares only the borderless capability, so its recordings show up there alone.
        entry(&root, r"graphicsCaptureWithoutBorder\Microsoft.ScreenSketch_8wekyb3d8bbwe", 5, 0);
        let snipping = busy();
        let _ = wipe();
        entry(&root, r"graphicsCaptureProgrammatic\NonPackaged\c:#apps#obs64.exe", 5, 0);
        let desktop = busy();
        let _ = wipe();

        assert!(!idle);
        assert!(snipping);
        assert!(desktop);
    }

    #[test]
    fn own_entries_are_skipped() {
        let own = Own { exe: Some(r"c:#program files#crest#crest.exe".into()), family: Some("andrealo20.crest_abc123".into()) };
        assert!(own.is(r"C:#Program Files#Crest#crest.exe", true));
        assert!(own.is("AndreaLo20.Crest_abc123", false));
        // The exe path only counts under NonPackaged, the family only beside it.
        assert!(!own.is(r"C:#Program Files#Crest#crest.exe", false));
        assert!(!own.is("AndreaLo20.Crest_abc123", true));
        assert!(!own.is(r"C:#Program Files#Zoom#bin#Zoom.exe", true));
        assert!(!own.is("Microsoft.WindowsCamera_8wekyb3d8bbwe", false));
        assert!(!Own { exe: None, family: None }.is("", false));
    }
}
