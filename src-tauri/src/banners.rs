//! Windows' own notification banners off for the apps Crest shows, so a notification pops up once, in the notch.
//!
//! Per app, Windows keeps `ShowBanner` under `Notifications\Settings\<app id>` (the "Show notification banners"
//! switch in Settings). With it at 0 the notification still goes to the notification centre, which is where Crest
//! reads it. Crest marks every banner it turns off with `CrestHidBanner`, so turning them back on restores only
//! those and leaves the banners the user switched off alone. Only apps Windows already has a key for are touched.
//! A banner the user turns on in Windows and off again stays marked and comes back with the others: the value alone
//! cannot tell it from the one Crest wrote.
//!
//! Windows' notification sound goes the same way while Crest plays its own (issue #31): `SoundFile` in the same key is
//! the "Play a sound" switch, with no value Windows' sound and an empty one silence. Crest marks what it empties with
//! `CrestMutedSound`; a sound the user already turned off or replaced with a file of their own is left alone.
//!
//! Both come back when Crest exits (lib.rs) and when it is uninstalled (`windows/hooks.nsh`); after a crash, at the
//! next start.
//!
//! The Store build's registry writes are virtualized and would not reach Windows: for banners it opens Settings ›
//! Notifications instead and answers "settings"; its sound row tells the user to turn Windows' sound off there.

use windows::core::{w, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{ERROR_MORE_DATA, ERROR_SUCCESS};
use windows::Win32::System::Registry::{
    RegCloseKey, RegDeleteKeyValueW, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, RegSetKeyValueW, HKEY, HKEY_CURRENT_USER, KEY_READ, REG_DWORD, REG_SZ,
    RRF_RT_ANY, RRF_RT_REG_DWORD,
};

const SETTINGS: &str = r"Software\Microsoft\Windows\CurrentVersion\Notifications\Settings";
const BANNER: PCWSTR = w!("ShowBanner");
const MARK: PCWSTR = w!("CrestHidBanner");
const SOUND: PCWSTR = w!("SoundFile");
const SOUND_MARK: PCWSTR = w!("CrestMutedSound");

/// A per-app setting Crest turns off for the apps whose notices it shows: the value Windows reads, Crest's mark on what
/// it changed, whether the app still has Windows' default (one the user set is not Crest's to mark), and turning it off.
struct Switch {
    value: PCWSTR,
    mark: PCWSTR,
    at_default: fn(&HSTRING) -> bool,
    turn_off: fn(&HSTRING) -> Result<(), String>,
}

const BANNERS: Switch = Switch { value: BANNER, mark: MARK, at_default: banner_on, turn_off: banner_off };
const SOUNDS: Switch = Switch { value: SOUND, mark: SOUND_MARK, at_default: sound_default, turn_off: sound_off };

/// The banner is on unless the value says 0.
fn banner_on(key: &HSTRING) -> bool {
    read(key, BANNER) != Some(0)
}

fn banner_off(key: &HSTRING) -> Result<(), String> {
    write(key, BANNER, 0)
}

/// No value at all is Windows' own sound; an empty one (silence) or a path (the user's own sound) was set by the user.
fn sound_default(key: &HSTRING) -> bool {
    !has(key, SOUND)
}

fn sound_off(key: &HSTRING) -> Result<(), String> {
    write_text(key, SOUND, "")
}

/// Off the main thread two changes could overlap; one at a time keeps the marks right.
static BUSY: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// `hide`: banners off for exactly `apps`; an app Crest hid before that is no longer in the list gets its banner back.
/// Not `hide`: every banner Crest hid comes back.
#[tauri::command(async)]
pub fn notices_banners(hide: bool, apps: Vec<String>) -> Result<(), String> {
    let _busy = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    // The Store build's banners go off in Settings, which leaves the same empty window behind.
    empty_banner::watch(hide);
    if cfg!(feature = "store") {
        if hide {
            crate::open_url("ms-settings:notifications")?;
        }
        return Err("settings".into());
    }
    set(SETTINGS, &BANNERS, hide, apps)
}

/// `mute`: Windows' sound off for exactly `apps`, which Crest plays its own sound for; the others get it back.
/// Not `mute`: every sound Crest muted comes back.
#[tauri::command(async)]
pub fn notices_sounds(mute: bool, apps: Vec<String>) -> Result<(), String> {
    let _busy = BUSY.lock().unwrap_or_else(|e| e.into_inner());
    if cfg!(feature = "store") {
        return Err("store".into());
    }
    set(SETTINGS, &SOUNDS, mute, apps)
}

/// One switch off for exactly `apps` below the registry key `root` (the tests use a key of their own).
fn set(root: &str, s: &Switch, off: bool, apps: Vec<String>) -> Result<(), String> {
    let apps: Vec<String> = if off { apps.into_iter().filter(|a| plain(a)).collect() } else { Vec::new() };
    for sub in marked(root, s.mark) {
        if !apps.iter().any(|a| a.eq_ignore_ascii_case(&sub)) {
            unmark(root, &sub, s);
        }
    }
    // One key Windows refuses (a locked system app) does not keep the others; the first error is reported.
    let mut first = Ok(());
    for app in &apps {
        let key = HSTRING::from(format!(r"{root}\{app}"));
        if exists(&key) && (s.at_default)(&key) {
            // Mark first: a mark without the value only restores Windows' default.
            let done = write(&key, s.mark, 1).and_then(|()| (s.turn_off)(&key));
            if first.is_ok() {
                first = done;
            }
        }
    }
    first
}

/// Every banner and sound Crest turned off comes back: on exit, and from the uninstaller (`crest.exe --restore-banners`).
pub fn restore() {
    empty_banner::release();
    if !cfg!(feature = "store") {
        restore_in(SETTINGS);
    }
}

fn restore_in(root: &str) {
    for s in [&BANNERS, &SOUNDS] {
        marked(root, s.mark).iter().for_each(|sub| unmark(root, sub, s));
    }
}

fn unmark(root: &str, sub: &str, s: &Switch) {
    let key = HSTRING::from(format!(r"{root}\{sub}"));
    // No value is Windows' default: banners on, its own sound.
    unsafe {
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, s.value);
        let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, &key, s.mark);
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

/// Whether the value is there at all, whatever its type.
fn has(key: &HSTRING, name: PCWSTR) -> bool {
    (unsafe { RegGetValueW(HKEY_CURRENT_USER, key, name, RRF_RT_ANY, None, None, None) }) == ERROR_SUCCESS
}

fn write_text(key: &HSTRING, name: PCWSTR, value: &str) -> Result<(), String> {
    let wide: Vec<u16> = value.encode_utf16().chain([0]).collect();
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key, name, REG_SZ.0, Some(wide.as_ptr().cast()), (wide.len() * 2) as u32) }.ok().map_err(|e| e.to_string())
}

/// Apps below Settings that carry Crest's `mark`, nested ids (`{GUID}\App\app.exe`) included.
fn marked(root: &str, mark: PCWSTR) -> Vec<String> {
    let mut out = Vec::new();
    scan(root, "", 0, mark, &mut out);
    out
}

/// A desktop app's id is a few keys deep (`{GUID}\App\app.exe` is three); the scan stops below this.
const MAX_DEPTH: u32 = 6;

fn scan(base: &str, prefix: &str, depth: u32, mark: PCWSTR, out: &mut Vec<String>) {
    let mut root = HKEY::default();
    let path = if prefix.is_empty() { base.to_string() } else { format!(r"{base}\{prefix}") };
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
        if read(&HSTRING::from(format!(r"{base}\{sub}")), mark) == Some(1) {
            out.push(sub.clone());
        }
        if depth + 1 < MAX_DEPTH {
            scan(base, &sub, depth + 1, mark, out);
        }
    }
}

/// With an app's banner off, Windows still uncloaks its banner window for a few seconds on every notification of that
/// app, with nothing drawn in it: an invisible strip above the tray that takes clicks and keeps an auto-hidden taskbar
/// down (issue #23). While banners are hidden, that window lets the pointer through whenever it is empty. Windows uses
/// the same window for real banners, which grow it and get their clicks back on the next pass.
mod empty_banner {
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::sync::Once;
    use std::thread;
    use std::time::Duration;

    use windows::core::{w, PCWSTR};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{
        FindWindowExW, GetWindowLongPtrW, GetWindowRect, GetWindowThreadProcessId, IsWindow, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED,
        WS_EX_TRANSPARENT,
    };

    static HIDING: AtomicBool = AtomicBool::new(false);
    /// The banner window once found; it lives as long as the shell does.
    static WINDOW: AtomicIsize = AtomicIsize::new(0);
    /// Both bits: transparent alone still takes the pointer.
    const PASS: isize = (WS_EX_TRANSPARENT.0 | WS_EX_LAYERED.0) as isize;
    /// Height in px at 100 % up to which the window shows nothing (31 when uncloaked, 0 while hidden); a banner is taller.
    const EMPTY_MAX: i32 = 48;
    /// Narrower is another shell window (Windows Shell Experience Host is 1 x 1); the banner window is 396 wide.
    const WIDTH_MIN: i32 = 200;

    pub fn watch(hide: bool) {
        static STARTED: Once = Once::new();
        HIDING.store(hide, Ordering::Relaxed);
        if hide {
            STARTED.call_once(|| {
                thread::spawn(|| loop {
                    thread::sleep(Duration::from_millis(250));
                    pass(HIDING.load(Ordering::Relaxed));
                });
            });
        }
    }

    /// Windows' own style back: on exit, a real banner must stay clickable without Crest.
    pub fn release() {
        HIDING.store(false, Ordering::Relaxed);
        pass(false);
    }

    fn pass(on: bool) {
        // Nothing to give back to a window Crest never touched.
        if !on && WINDOW.load(Ordering::Relaxed) == 0 {
            return;
        }
        let Some(hwnd) = window() else { return };
        let Some((width, height)) = size(hwnd) else { return };
        let empty = width >= WIDTH_MIN && height <= EMPTY_MAX;
        unsafe {
            let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
            let next = if on && empty { style | PASS } else { style & !PASS };
            if next != style {
                SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
            }
        }
    }

    /// The shell's banner window. Its title is in the system's language, so it is told by owner and shape instead:
    /// a CoreWindow of ShellExperienceHost as wide as a banner and no taller than an empty one (Notification Centre is
    /// as tall as the screen).
    fn window() -> Option<HWND> {
        let known = HWND(WINDOW.load(Ordering::Relaxed) as _);
        if !known.is_invalid() && unsafe { IsWindow(Some(known)) }.as_bool() {
            return Some(known);
        }
        let mut after = None;
        while let Ok(hwnd) = unsafe { FindWindowExW(None, after, w!("Windows.UI.Core.CoreWindow"), PCWSTR::null()) } {
            after = Some(hwnd);
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
            let shell = crate::mixer::process_path(pid).is_some_and(|p| crate::mixer::file_name(&p) == "shellexperiencehost.exe");
            if shell && size(hwnd).is_some_and(|(w, h)| w >= WIDTH_MIN && h <= EMPTY_MAX) {
                WINDOW.store(hwnd.0 as isize, Ordering::Relaxed);
                return Some(hwnd);
            }
        }
        None
    }

    /// Width and height in px at 100 %.
    fn size(hwnd: HWND) -> Option<(i32, i32)> {
        let mut rect = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut rect) }.ok()?;
        let dpi = unsafe { GetDpiForWindow(hwnd) }.max(96) as i32;
        Some(((rect.right - rect.left) * 96 / dpi, (rect.bottom - rect.top) * 96 / dpi))
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

    /// A registry key of its own for a test, removed with it (also when an assert fails).
    struct TestRoot(String);

    impl TestRoot {
        fn new(name: &str) -> Self {
            TestRoot(format!(r"Software\Crest-test-{}-{name}", std::process::id()))
        }

        fn settings(&self) -> String {
            format!(r"{}\Settings", self.0)
        }

        fn key(&self, app: &str) -> HSTRING {
            HSTRING::from(format!(r"{}\{app}", self.settings()))
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            unsafe {
                let _ = windows::Win32::System::Registry::RegDeleteTreeW(HKEY_CURRENT_USER, &HSTRING::from(self.0.as_str()));
            }
        }
    }

    /// Hides and restores the banners of made-up apps below a key of the test's own (one nested like a desktop app's id).
    #[test]
    fn hides_and_restores_banners() {
        let root = TestRoot::new("banners");
        let (app, nested, off) = ("Crest.BannerTest", r"Crest.BannerTest\App\app.exe", "Crest.UserOff");
        let [k_app, k_nested, k_off] = [app, nested, off].map(|a| root.key(a));
        for k in [&k_app, &k_nested, &k_off] {
            write(k, w!("Enabled"), 1).unwrap();
        }
        // The user switched this one off in Windows: it is not Crest's to mark or to give back.
        write(&k_off, BANNER, 0).unwrap();
        set(&root.settings(), &BANNERS, true, vec![app.into(), nested.into(), off.into()]).unwrap();
        for k in [&k_app, &k_nested] {
            assert_eq!((read(k, BANNER), read(k, MARK)), (Some(0), Some(1)));
        }
        assert_eq!((read(&k_off, BANNER), read(&k_off, MARK)), (Some(0), None));
        // Out of the list: its banner comes back, the other stays hidden.
        set(&root.settings(), &BANNERS, true, vec![nested.into()]).unwrap();
        assert_eq!((read(&k_app, BANNER), read(&k_app, MARK)), (None, None));
        assert_eq!(read(&k_nested, MARK), Some(1));
        // The exit and uninstall path finds the nested key by the scan alone.
        assert_eq!(marked(&root.settings(), MARK), vec![nested.to_string()]);
        restore_in(&root.settings());
        assert_eq!((read(&k_nested, BANNER), read(&k_nested, MARK)), (None, None));
        assert_eq!(read(&k_off, BANNER), Some(0));
    }

    fn text(key: &HSTRING, name: PCWSTR) -> Option<String> {
        use windows::Win32::System::Registry::RRF_RT_REG_SZ;
        let (mut buf, mut size) = ([0u16; 260], 520u32);
        let ok = unsafe { RegGetValueW(HKEY_CURRENT_USER, key, name, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut size)) } == ERROR_SUCCESS;
        ok.then(|| String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]))
    }

    /// Mutes Windows' sound for made-up apps and gives it back; sounds the user set are left as they are (issue #31).
    #[test]
    fn mutes_and_restores_sounds() {
        let root = TestRoot::new("sounds");
        let (app, silent, own) = ("Crest.SoundTest", "Crest.UserSilent", "Crest.UserSound");
        let [k_app, k_silent, k_own] = [app, silent, own].map(|a| root.key(a));
        for k in [&k_app, &k_silent, &k_own] {
            write(k, w!("Enabled"), 1).unwrap();
        }
        write_text(&k_silent, SOUND, "").unwrap();
        write_text(&k_own, SOUND, r"C:\Sounds\ping.wav").unwrap();
        set(&root.settings(), &SOUNDS, true, vec![app.into(), silent.into(), own.into()]).unwrap();
        assert_eq!((text(&k_app, SOUND), read(&k_app, SOUND_MARK)), (Some(String::new()), Some(1)));
        assert_eq!((text(&k_silent, SOUND), read(&k_silent, SOUND_MARK)), (Some(String::new()), None));
        assert_eq!((text(&k_own, SOUND), read(&k_own, SOUND_MARK)), (Some(r"C:\Sounds\ping.wav".into()), None));
        // The banner switch does not see the sound's mark, and the exit path restores both.
        assert!(marked(&root.settings(), MARK).is_empty());
        restore_in(&root.settings());
        assert_eq!((has(&k_app, SOUND), read(&k_app, SOUND_MARK)), (false, None));
        assert_eq!(text(&k_own, SOUND), Some(r"C:\Sounds\ping.wav".into()));
        assert_eq!(text(&k_silent, SOUND), Some(String::new()));
    }
}
