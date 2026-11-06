//! Windows' own notification banners off for the apps Crest shows, so a notification pops up once, in the notch.
//!
//! Per app, Windows keeps `ShowBanner` under `Notifications\Settings\<app id>` (the "Show notification banners"
//! switch in Settings). With it at 0 the notification still goes to the notification centre, which is where Crest
//! reads it. Crest marks every banner it turns off with `CrestHidBanner`, so turning them back on restores only
//! those and leaves the banners the user switched off alone. Only apps Windows already has a key for are touched.
//! They come back when Crest exits (lib.rs) and when it is uninstalled (`windows/hooks.nsh`); after a crash, at the
//! next start.
//!
//! The Store build's registry writes are virtualized and would not reach Windows: it opens Settings › Notifications
//! instead and answers "settings".

use windows::core::{w, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteKeyValueW, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD, RRF_RT_REG_DWORD,
};

const SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";
const BANNER: PCWSTR = w!("ShowBanner");
const MARK: PCWSTR = w!("CrestHidBanner");

/// `hide`: banners off for exactly `apps`; an app Crest hid before that is no longer in the list gets its banner back.
/// Not `hide`: every banner Crest hid comes back.
#[tauri::command]
pub fn notices_banners(hide: bool, apps: Vec<String>) -> Result<(), String> {
    if cfg!(feature = "store") {
        if hide {
            crate::open_url("ms-settings:notifications")?;
        }
        return Err("settings".into());
    }
    let apps: Vec<String> = if hide { apps.into_iter().filter(|a| plain(a)).collect() } else { Vec::new() };
    for sub in marked() {
        if !apps.iter().any(|a| a.eq_ignore_ascii_case(&sub)) {
            unmark(&sub);
        }
    }
    // One key Windows refuses (a locked system app) does not keep the others visible; the first error is reported.
    let mut first = Ok(());
    for app in &apps {
        let key = HSTRING::from(format!(r"{SETTINGS}\{app}"));
        // The banner is on unless the value says 0; one the user already turned off is not ours to mark.
        if exists(&key) && read(&key, BANNER) != Some(0) {
            // Mark first: a mark without ShowBanner = 0 only restores Windows' default.
            let done = write(&key, MARK, 1).and_then(|()| write(&key, BANNER, 0));
            if first.is_ok() {
                first = done;
            }
        }
    }
    first
}

/// Every banner Crest hid comes back: on exit, and from the uninstaller (`crest.exe --restore-banners`).
pub fn restore() {
    if !cfg!(feature = "store") {
        marked().iter().for_each(|sub| unmark(sub));
    }
}

fn unmark(sub: &str) {
    let key = HSTRING::from(format!(r"{SETTINGS}\{sub}"));
    // No ShowBanner is Windows' default: banners on.
    unsafe {
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, BANNER);
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, MARK);
    }
}

/// An app id that names a key below Settings. A desktop app's id such as `{GUID}\App\app.exe` is a path of nested keys;
/// `/` is an ordinary character in a key name (Windows keeps ids like `C:/Program/app.exe`).
fn plain(id: &str) -> bool {
    !id.is_empty() && id.len() <= 512 && !id.starts_with('\\') && !id.ends_with('\\') && !id.contains(r"\\") && id.chars().all(|c| !c.is_control())
}

fn exists(key: &HSTRING) -> bool {
    let mut h = HKEY::default();
    let ok = unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, key, Some(0), KEY_READ, &mut h) } == ERROR_SUCCESS;
    if ok {
        unsafe {
            let _ = RegCloseKey(h);
        }
    }
    ok
}

fn read(key: &HSTRING, name: PCWSTR) -> Option<u32> {
    let (mut value, mut size) = (0u32, 4u32);
    let ok = unsafe { RegGetValueW(HKEY_CURRENT_USER, key, name, RRF_RT_REG_DWORD, None, Some(&mut value as *mut u32 as *mut _), Some(&mut size)) } == ERROR_SUCCESS;
    ok.then_some(value)
}

fn write(key: &HSTRING, name: PCWSTR, value: u32) -> Result<(), String> {
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key, name, REG_DWORD.0, Some(&value as *const u32 as *const _), 4) }.ok().map_err(|e| e.to_string())
}

/// Apps below Settings whose banner Crest turned off, nested ids (`{GUID}\App\app.exe`) included.
fn marked() -> Vec<String> {
    let mut out = Vec::new();
    scan("", 0, &mut out);
    out
}

/// A desktop app's id is a few keys deep (`{GUID}\App\app.exe` is three); the scan stops below this.
const MAX_DEPTH: u32 = 6;

fn scan(prefix: &str, depth: u32, out: &mut Vec<String>) {
    let mut root = HKEY::default();
    let path = if prefix.is_empty() { SETTINGS.to_string() } else { format!(r"{SETTINGS}\{prefix}") };
    if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(path), Some(0), KEY_READ, &mut root) } != ERROR_SUCCESS {
        return;
    }
    let mut subs = Vec::new();
    for i in 0.. {
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        match unsafe { RegEnumKeyExW(root, i, Some(PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None) } {
            ERROR_SUCCESS => {}
            ERROR_MORE_DATA => continue,
            _ => break,
        }
        let name = String::from_utf16_lossy(&buf[..len as usize]);
        subs.push(if prefix.is_empty() { name } else { format!(r"{prefix}\{name}") });
    }
    unsafe {
        let _ = RegCloseKey(root);
    }
    for sub in subs {
        if read(&HSTRING::from(format!(r"{SETTINGS}\{sub}")), MARK) == Some(1) {
            out.push(sub.clone());
        }
        if depth + 1 < MAX_DEPTH {
            scan(&sub, depth + 1, out);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_ids_stay_below_settings() {
        assert!(plain("Microsoft.ScreenSketch_8wekyb3d8bbwe!App"));
        assert!(plain("{6D809377-6AF0-444B-8957-A3773F02200E}\\App\\app.exe"));
        assert!(plain("C:/ProgramData/ASUS/AsusSurvey/AsusSurvey.exe"));
        assert!(!plain("") && !plain("\\Root") && !plain("a\\\\b") && !plain("a\\"));
    }

    /// Live: hides and restores the banners of two made-up apps under the real key (one nested like a desktop app's id),
    /// then removes them. It also gives back every other banner Crest hid on this PC.
    #[test]
    #[ignore]
    fn hides_and_restores_a_banner() {
        let (app, nested) = ("Crest.BannerTest", r"Crest.BannerTest\App\app.exe");
        let keys = [app, nested].map(|a| HSTRING::from(format!(r"{SETTINGS}\{a}")));
        keys.iter().for_each(|k| write(k, w!("Enabled"), 1).unwrap());
        notices_banners(true, vec![app.into(), nested.into()]).unwrap();
        keys.iter().for_each(|k| assert_eq!((read(k, BANNER), read(k, MARK)), (Some(0), Some(1))));
        // Out of the list: its banner comes back, the other stays hidden.
        notices_banners(true, vec![nested.into()]).unwrap();
        assert_eq!((read(&keys[0], BANNER), read(&keys[0], MARK)), (None, None));
        assert_eq!(read(&keys[1], MARK), Some(1));
        // The exit and uninstall path finds the nested key by the scan alone.
        restore();
        keys.iter().for_each(|k| assert_eq!((read(k, BANNER), read(k, MARK)), (None, None)));
        unsafe {
            let _ = windows::Win32::System::Registry::RegDeleteTreeW(HKEY_CURRENT_USER, &keys[0]);
        }
    }
}
