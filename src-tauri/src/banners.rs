//! Windows' own notification banners off for the apps Crest shows, so a notification pops up once, in the notch.
//!
//! Per app, Windows keeps `ShowBanner` under `Notifications\Settings\<app id>` (the "Show notification banners"
//! switch in Settings). With it at 0 the notification still goes to the notification centre, which is where Crest
//! reads it. Crest marks every banner it turns off with `CrestHidBanner`, so turning them back on restores only
//! those and leaves the banners the user switched off alone. Only apps Windows already has a key for are touched.
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

#[tauri::command]
pub fn notices_banners(hide: bool, apps: Vec<String>) -> Result<(), String> {
    if cfg!(feature = "store") {
        if hide {
            crate::open_url("ms-settings:notifications")?;
        }
        return Err("settings".into());
    }
    if hide {
        for app in apps.iter().filter(|a| plain(a)) {
            let key = HSTRING::from(format!(r"{SETTINGS}\{app}"));
            // The banner is on unless the value says 0; one the user already turned off is not ours to mark.
            if exists(&key) && read(&key, BANNER) != Some(0) {
                write(&key, BANNER, 0)?;
                write(&key, MARK, 1)?;
            }
        }
    } else {
        // Crest's list and a scan of the keys: an app may have left the list, and a desktop app's id is a path of nested keys.
        let mut subs = marked();
        subs.extend(apps.into_iter().filter(|a| plain(a)));
        for sub in subs {
            let key = HSTRING::from(format!(r"{SETTINGS}\{sub}"));
            if read(&key, MARK) != Some(1) {
                continue;
            }
            // No ShowBanner is Windows' default: banners on.
            unsafe {
                let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, BANNER);
                let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, MARK);
            }
        }
    }
    Ok(())
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

/// Apps one key below Settings whose banner Crest turned off.
fn marked() -> Vec<String> {
    let mut root = HKEY::default();
    if unsafe { RegOpenKeyExW(HKEY_CURRENT_USER, &HSTRING::from(SETTINGS), Some(0), KEY_READ, &mut root) } != ERROR_SUCCESS {
        return Vec::new();
    }
    let mut out = Vec::new();
    for i in 0.. {
        let mut buf = [0u16; 520];
        let mut len = buf.len() as u32;
        match unsafe { RegEnumKeyExW(root, i, Some(PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None) } {
            ERROR_SUCCESS => {}
            ERROR_MORE_DATA => continue,
            _ => break,
        }
        let sub = String::from_utf16_lossy(&buf[..len as usize]);
        if read(&HSTRING::from(format!(r"{SETTINGS}\{sub}")), MARK) == Some(1) {
            out.push(sub);
        }
    }
    unsafe {
        let _ = RegCloseKey(root);
    }
    out
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

    /// Live: hides and restores the banner of a made-up app under the real key, then removes it.
    #[test]
    #[ignore]
    fn hides_and_restores_a_banner() {
        let app = "Crest.BannerTest";
        let key = HSTRING::from(format!(r"{SETTINGS}\{app}"));
        write(&key, w!("Enabled"), 1).unwrap();
        notices_banners(true, vec![app.into()]).unwrap();
        assert_eq!((read(&key, BANNER), read(&key, MARK)), (Some(0), Some(1)));
        notices_banners(false, vec![]).unwrap();
        assert_eq!((read(&key, BANNER), read(&key, MARK)), (None, None));
        unsafe {
            let _ = windows::Win32::System::Registry::RegDeleteTreeW(HKEY_CURRENT_USER, &key);
        }
    }
}
