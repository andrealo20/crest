//! The bar's Windows keys: Win+1..9 and Win+0 (with Shift, Ctrl, Ctrl+Shift or Alt), Win+T, Win+Shift+T and Win+B, while the bar
//! is on and its switch is on (store.ts `keysWanted`).
//!
//! Explorer holds those keys for its own taskbar. Crest adds their characters to Explorer's `DisabledHotkeys` value (under
//! `HKCU\...\Explorer\Advanced`), which Microsoft does not document: Explorer reads it as it starts and leaves the keys alone.
//! The others Crest relies on are the `TaskbandHWND` property on its tray spy (taskband.rs) and the `ITaskList_Deleted`
//! property it reads on apps' windows (tasks.rs). Before it writes the
//! value it writes a record, `taskbar-keys` beside `taskbar-hidden` (explorer.rs): whether the value existed and which characters
//! Crest added, so only those go again. Then it restarts Explorer through the Restart Manager, as installers do, and registers
//! the keys with `RegisterHotKey` through the global-shortcut plugin (shell.rs). No keyboard hook.
//!
//! The value goes back, and Explorer restarts so Windows has the keys again, when the switch or the bar goes off, and after Crest
//! quits: from the taskbar guard once Crest is gone (explorer.rs `guard`), or at once without a live guard. At sign-out it stays
//! while Crest starts with Windows, so the next sign-in needs no restart. The uninstaller takes it out (`--restore-taskbar`) and
//! Windows has the keys from the next sign-in; the next start gives back what a crash left.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
use windows::core::{w, PCWSTR, PWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, FILETIME, HWND};
use windows::Win32::System::Registry::{RegDeleteKeyValueW, RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ, RRF_RT_REG_SZ};
use windows::Win32::System::RestartManager::{RmEndSession, RmRegisterResources, RmRestart, RmShutdown, RmStartSession, CCH_RM_SESSION_KEY, RM_UNIQUE_PROCESS};
use windows::Win32::System::Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Input::KeyboardAndMouse::{RegisterHotKey, UnregisterHotKey, MOD_NOREPEAT, MOD_WIN};
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetSystemMetrics, IsWindowVisible, SM_SHUTTINGDOWN};

use super::{explorer, screens, tasks};

const ADVANCED: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced");
const VALUE: PCWSTR = w!("DisabledHotkeys");
/// Each character is a virtual-key code, so letters are upper case (a lower-case 't' would be VK_F5). Every modifier of a key
/// goes with it.
const OURS: &str = "1234567890TB";
/// A probe id of the calling thread's own (`free`), never one of the plugin's.
const PROBE_ID: i32 = 0xB6D0;
const VK_1: u32 = 0x31;

/// "off", "busy" (Explorer restarting), "on", "partial" (another program holds some), "held" (Windows keeps Win+1), "failed".
static STATUS: Mutex<&str> = Mutex::new("off");
/// Explorer was restarted for this turn-on: never twice.
static RESTARTED: AtomicBool = AtomicBool::new(false);
static APPLYING: Mutex<()> = Mutex::new(());

/// What a press is, as the page reads it (model.ts BarKey).
#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
enum Key {
    Number { n: u8, mods: Mods },
    Apps { by: i8 },
    Tray,
}

#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
enum Mods {
    Plain,
    Shift,
    Ctrl,
    CtrlShift,
    Alt,
}

const MODS: [(Mods, &str); 5] = [(Mods::Plain, "plain"), (Mods::Shift, "shift"), (Mods::Ctrl, "ctrl"), (Mods::CtrlShift, "ctrlShift"), (Mods::Alt, "alt")];
const DIGITS: [Code; 10] = [Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4, Code::Digit5, Code::Digit6, Code::Digit7, Code::Digit8, Code::Digit9, Code::Digit0];

/// Our characters added to `user` (None: no value): the new value, and those of ours that were not there (the record keeps them).
fn merge(user: Option<&str>, ours: &str) -> (String, String) {
    let user = user.unwrap_or_default();
    let added: String = ours.chars().filter(|c| !user.contains(*c)).collect();
    (format!("{user}{added}"), added)
}

/// The value once `added` is taken out again; None deletes it (it did not exist before Crest and nothing else is in it).
/// Characters someone else added since stay.
fn unmerge(now: Option<&str>, added: &str, existed: bool) -> Option<String> {
    let rest: String = now?.chars().filter(|c| !added.contains(*c)).collect();
    (existed || !rest.is_empty()).then_some(rest)
}

fn format_record(existed: bool, added: &str) -> String {
    format!("{}\n{added}", if existed { "1" } else { "0" })
}

fn parse_record(text: &str) -> Option<(bool, String)> {
    let (flag, added) = text.split_once('\n')?;
    let existed = match flag {
        "1" => true,
        "0" => false,
        _ => return None,
    };
    added.chars().all(|c| OURS.contains(c)).then(|| (existed, added.to_owned()))
}

/// The 53 keys and their names: Win+digit with each of `MODS`, digits 1..9 then 0 (n 1..10), then Win+T, Win+Shift+T and Win+B.
/// The first is plain Win+1, which `apply` reads as results[0].
fn shortcuts() -> Vec<(Shortcut, String)> {
    let mut out = Vec::new();
    for (mods, name) in MODS {
        let held = Modifiers::SUPER
            | match mods {
                Mods::Plain => Modifiers::empty(),
                Mods::Shift => Modifiers::SHIFT,
                Mods::Ctrl => Modifiers::CONTROL,
                Mods::CtrlShift => Modifiers::CONTROL | Modifiers::SHIFT,
                Mods::Alt => Modifiers::ALT,
            };
        for (i, code) in DIGITS.into_iter().enumerate() {
            out.push((Shortcut::new(Some(held), code), format!("n:{}:{name}", i + 1)));
        }
    }
    out.push((Shortcut::new(Some(Modifiers::SUPER), Code::KeyT), "apps:1".into()));
    out.push((Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::KeyT), "apps:-1".into()));
    out.push((Shortcut::new(Some(Modifiers::SUPER), Code::KeyB), "tray".into()));
    out
}

fn parse_name(name: &str) -> Option<Key> {
    let mut parts = name.split(':');
    let key = match (parts.next()?, parts.next(), parts.next()) {
        ("n", Some(n), Some(m)) => Key::Number { n: n.parse().ok().filter(|n| (1..=10).contains(n))?, mods: MODS.iter().find(|(_, s)| *s == m)?.0 },
        ("apps", Some(by @ ("1" | "-1")), None) => Key::Apps { by: by.parse().ok()? },
        ("tray", None, None) => Key::Tray,
        _ => return None,
    };
    parts.next().is_none().then_some(key)
}

/// After the keys are given back: Explorer restarts only when Crest had changed the value, nobody holds Win+1 now (Explorer read
/// the value at its start) and the session is not ending.
fn restart_after_off(had_record: bool, win1_free: bool, shutting_down: bool) -> bool {
    had_record && win1_free && !shutting_down
}

/// Turning on: one restart per turn-on, and only when Win+1 could not be registered.
fn restart_after_on(win1_ok: bool, restarted: bool) -> bool {
    !win1_ok && !restarted
}

/// What the registration gave: every key, Win+1 and some others, or not Win+1.
fn classify(results: &[bool]) -> &'static str {
    match results {
        [true, ..] if results.iter().all(|&ok| ok) => "on",
        [true, ..] => "partial",
        _ => "held",
    }
}

/// The bar a key goes to: the one on `monitor` (the window in front's), else the primary `taskbar`, else none.
fn target(monitor: isize, bars: &[(String, isize)]) -> Option<String> {
    bars.iter().find(|(_, m)| *m == monitor).or_else(|| bars.iter().find(|(l, _)| l == super::bar::LABEL)).map(|(l, _)| l.clone())
}

fn read_value() -> Option<String> {
    let mut size = 0u32;
    if unsafe { RegGetValueW(HKEY_CURRENT_USER, ADVANCED, VALUE, RRF_RT_REG_SZ, None, None, Some(&mut size)) } != ERROR_SUCCESS {
        return None;
    }
    let mut buf = vec![0u16; size as usize / 2 + 1];
    let mut size = (buf.len() * 2) as u32;
    let ok = unsafe { RegGetValueW(HKEY_CURRENT_USER, ADVANCED, VALUE, RRF_RT_REG_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut size)) } == ERROR_SUCCESS;
    ok.then(|| String::from_utf16_lossy(&buf[..(size as usize / 2).saturating_sub(1)]))
}

fn write_value(value: &str) -> Result<(), String> {
    let wide: Vec<u16> = value.encode_utf16().chain([0]).collect();
    unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, ADVANCED, VALUE, REG_SZ.0, Some(wide.as_ptr().cast()), (wide.len() * 2) as u32) }.ok().map_err(|e| e.to_string())
}

/// Takes Crest's characters out of the value as the record says, and the record away. False when there is no record, or it
/// cannot be read now (both stay for a later try).
pub(crate) fn restore_value() -> bool {
    let Some(path) = explorer::keys_path() else { return false };
    let Ok(text) = std::fs::read_to_string(&path) else { return false };
    if let Some((existed, added)) = parse_record(&text) {
        let written = match unmerge(read_value().as_deref(), &added, existed) {
            Some(value) => write_value(&value).is_ok(),
            None => unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, ADVANCED, VALUE) }.is_ok(),
        };
        if !written && read_value().is_some() {
            return false;
        }
    }
    // A record that does not parse was never Crest's to write: it goes, with nothing to take back.
    let _ = std::fs::remove_file(&path);
    true
}

/// Adds Crest's characters, the record first. A record already there means the value is Crest's from an earlier run.
fn set_value() -> Result<(), String> {
    let path = explorer::keys_path().ok_or("no folder")?;
    if path.exists() {
        return Ok(());
    }
    let user = read_value();
    let (value, added) = merge(user.as_deref(), OURS);
    crate::write_atomic(&path, format_record(user.is_some(), &added).as_bytes()).map_err(|e| e.to_string())?;
    write_value(&value).inspect_err(|_| {
        restore_value();
    })
}

/// Whether nobody holds Win+`vk` now. Only while Crest's own is not registered.
fn free(vk: u32) -> bool {
    let ok = unsafe { RegisterHotKey(None, PROBE_ID, MOD_WIN | MOD_NOREPEAT, vk) }.is_ok();
    if ok {
        let _ = unsafe { UnregisterHotKey(None, PROBE_ID) };
    }
    ok
}

/// The session is ending (documented).
fn shutting_down() -> bool {
    unsafe { GetSystemMetrics(SM_SHUTTINGDOWN) != 0 }
}

/// Explorer, process `pid`, closed by the Restart Manager (gracefully, never forced) and started again. False when it would not
/// close: it still runs and still holds the keys.
fn shut_down(pid: u32) -> bool {
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return false };
        let (mut created, mut exited, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default(), FILETIME::default());
        let timed = GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user).is_ok();
        let _ = CloseHandle(process);
        if !timed {
            return false;
        }
        let mut session = 0u32;
        let mut key = [0u16; CCH_RM_SESSION_KEY as usize + 1];
        if RmStartSession(&mut session, None, PWSTR(key.as_mut_ptr())) != ERROR_SUCCESS {
            return false;
        }
        let app = RM_UNIQUE_PROCESS { dwProcessId: pid, ProcessStartTime: created };
        let closed = RmRegisterResources(session, None, Some(&[app]), None) == ERROR_SUCCESS && RmShutdown(session, 0, None) == ERROR_SUCCESS;
        if closed {
            let _ = RmRestart(session, None, None);
        }
        let _ = RmEndSession(session);
        closed
    }
}

/// A shell other than `old` runs, with its taskbar.
fn new_shell(old: u32) -> bool {
    let pid = explorer::shell_pid();
    pid != 0 && pid != old && explorer::explorer_tray().is_some()
}

fn wait_for(old: u32, limit: Duration) -> bool {
    let until = Instant::now() + limit;
    while !new_shell(old) {
        if Instant::now() >= until {
            return false;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    true
}

/// Restarts Explorer so it reads the value again. The taskbar thread hides the new taskbars again (`TaskbarCreated`, mod.rs).
/// True once a new shell is there.
pub(crate) fn restart_explorer() -> bool {
    // An Explorer started from an elevated Crest would be an elevated shell, and every app started from it too.
    if crate::notify_wire::own_token().is_none_or(|(_, level)| level >= 0x3000) {
        eprintln!("taskbar: Crest runs as administrator, Explorer is not restarted");
        return false;
    }
    let pid = explorer::shell_pid();
    if pid != 0 && !shut_down(pid) {
        return false;
    }
    let mut back = wait_for(pid, Duration::from_secs(15));
    if !back {
        // Explorer by its full path, no arguments, starts the shell when none runs.
        let _ = crate::opener().spawn();
        back = wait_for(pid, Duration::from_secs(10));
    }
    if back {
        // The new tray registers its own hotkeys first.
        std::thread::sleep(Duration::from_secs(1));
    }
    back
}

fn bind(app: &AppHandle, on: bool) -> Vec<bool> {
    crate::shell::bind_taskbar(app, if on { shortcuts() } else { Vec::new() })
}

fn apply(app: &AppHandle, on: bool) -> &'static str {
    if !on {
        bind(app, false);
        let had = restore_value();
        if restart_after_off(had, free(VK_1), shutting_down()) {
            set_status(app, "busy");
            restart_explorer();
        }
        RESTARTED.store(false, Ordering::SeqCst);
        return "off";
    }
    if let Err(e) = set_value() {
        eprintln!("taskbar: DisabledHotkeys not written, the keys stay with Windows: {e}");
        return "failed";
    }
    let mut results = bind(app, true);
    if restart_after_on(results[0], RESTARTED.swap(true, Ordering::SeqCst)) {
        bind(app, false);
        set_status(app, "busy");
        if !restart_explorer() {
            restore_value();
            return "failed";
        }
        results = bind(app, true);
    }
    let status = classify(&results);
    if status == "held" {
        // Explorer kept the keys: nothing to give back by a restart.
        bind(app, false);
        restore_value();
    }
    status
}

fn set_status(app: &AppHandle, status: &'static str) {
    *STATUS.lock().unwrap_or_else(|e| e.into_inner()) = status;
    let _ = app.emit("taskbar://keys", status);
}

/// The notch only: the bar's Windows keys wanted (bar on and the switch on) or not. Answers the status.
#[tauri::command]
pub async fn taskbar_keys(on: bool, app: AppHandle) -> String {
    // The Store build never turns the bar on (bar.rs).
    if cfg!(feature = "store") {
        return "off".into();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let _one = APPLYING.lock().unwrap_or_else(|e| e.into_inner());
        let status = apply(&app, on);
        set_status(&app, status);
        status.to_owned()
    })
    .await
    .unwrap_or_else(|_| "failed".into())
}

/// Where the keys stand, for the settings.
#[tauri::command]
pub fn taskbar_keys_status() -> String {
    (*STATUS.lock().unwrap_or_else(|e| e.into_inner())).to_owned()
}

/// A bar key was pressed (shell::on_shortcut): to the bar on the monitor of the window in front. Win+T and Win+B do nothing while
/// that bar is hidden.
pub(crate) fn pressed(app: &AppHandle, name: &str) {
    let Some(key) = parse_name(name) else { return };
    let all = screens::all();
    let bars: Vec<(String, isize)> = all.iter().map(|(l, h)| (l.clone(), tasks::monitor_of(HWND(*h as _)))).collect();
    let Some(label) = target(tasks::monitor_of(unsafe { GetForegroundWindow() }), &bars) else { return };
    let hidden = all.iter().any(|(l, h)| *l == label && !unsafe { IsWindowVisible(HWND(*h as _)) }.as_bool());
    if hidden && !matches!(key, Key::Number { .. }) {
        return;
    }
    let _ = app.emit_to(label.as_str(), "taskbar://key", key);
}

/// RunEvent::Exit, after taskbar::shutdown. At sign-out the value stays while Crest starts with Windows, else it goes (no
/// restart: Explorer is ending). Otherwise the guard gives it back once Crest is gone; without a live one it goes now and Windows
/// has the keys at the next sign-in.
pub(crate) fn on_exit(app: &AppHandle) {
    let keep = if shutting_down() { crate::startup::is_enabled(app) } else { explorer::guard_alive() };
    if !keep {
        restore_value();
    }
}

/// In the guard, after Crest ended in any way: the value back, and Explorer restarted when that frees the keys for Windows
/// (Crest's own hotkeys died with it).
pub(crate) fn after_crest() {
    if !shutting_down() && restore_value() && free(VK_1) {
        restart_explorer();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crests_characters_go_in_and_out_alone() {
        assert_eq!(merge(None, OURS), (OURS.to_owned(), OURS.to_owned()));
        assert_eq!(merge(Some("F1"), OURS), ("F1234567890TB".to_owned(), "234567890TB".to_owned()));
        assert!(merge(Some(OURS), OURS).1.is_empty());
        assert_eq!(unmerge(Some("F1234567890TB"), "234567890TB", true), Some("F1".to_owned()));
        assert_eq!(unmerge(Some(OURS), OURS, false), None);
        assert_eq!(unmerge(Some("1234567890TBX"), OURS, false), Some("X".to_owned())); // added since by someone else
        assert_eq!(unmerge(None, OURS, false), None);
        assert_eq!(unmerge(Some(OURS), OURS, true), Some(String::new())); // an empty value of the user's stays
        assert!(OURS.chars().all(|c| c.is_ascii_digit() || c.is_ascii_uppercase()));
    }

    #[test]
    fn the_record_round_trips() {
        for (existed, added) in [(true, "234567890TB"), (false, OURS), (true, "")] {
            assert_eq!(parse_record(&format_record(existed, added)), Some((existed, added.to_owned())));
        }
        assert_eq!(parse_record("junk"), None);
        assert_eq!(parse_record("2\n1"), None);
        assert_eq!(parse_record("1\nxyz"), None);
    }

    #[test]
    fn every_key_has_a_name_the_page_reads() {
        let all = shortcuts();
        assert_eq!(all.len(), 53);
        assert_eq!(all[0].1, "n:1:plain");
        assert!(all.iter().all(|(_, name)| parse_name(name).is_some()));
        let ids: std::collections::HashSet<u32> = all.iter().map(|(s, _)| s.id()).collect();
        assert_eq!(ids.len(), 53);
        assert_eq!(parse_name("n:10:alt"), Some(Key::Number { n: 10, mods: Mods::Alt }));
        assert_eq!(parse_name("apps:-1"), Some(Key::Apps { by: -1 }));
        assert_eq!(parse_name("tray"), Some(Key::Tray));
        assert!(parse_name("x").is_none() && parse_name("n:11:plain").is_none() && parse_name("apps:2").is_none() && parse_name("tray:1").is_none());
        assert_eq!(serde_json::to_value(Key::Number { n: 3, mods: Mods::CtrlShift }).unwrap(), serde_json::json!({ "kind": "number", "n": 3, "mods": "ctrlShift" }));
        assert_eq!(serde_json::to_value(Key::Apps { by: 1 }).unwrap(), serde_json::json!({ "kind": "apps", "by": 1 }));
    }

    #[test]
    fn explorer_restarts_only_when_it_changes_something() {
        assert!(restart_after_off(true, true, false));
        assert!(!restart_after_off(false, true, false) && !restart_after_off(true, false, false) && !restart_after_off(true, true, true));
        assert!(restart_after_on(false, false));
        assert!(!restart_after_on(true, false) && !restart_after_on(false, true));
        let mut results = vec![true; 53];
        assert_eq!(classify(&results), "on");
        results[5] = false;
        assert_eq!(classify(&results), "partial");
        results[0] = false;
        assert_eq!(classify(&results), "held");
    }

    #[test]
    fn a_key_goes_to_the_bar_of_the_window_in_front() {
        let bars = vec![("taskbar".to_owned(), 1), ("taskbar-1".to_owned(), 2)];
        assert_eq!(target(2, &bars).as_deref(), Some("taskbar-1"));
        assert_eq!(target(9, &bars).as_deref(), Some("taskbar"));
        assert_eq!(target(1, &[]), None);
    }
}
