//! Windows' taskbar while Crest's bar stands in for it, and the safety net that always gives it back.
//!
//! Only Explorer's own taskbars count: `Shell_TrayWnd` and `Shell_SecondaryTrayWnd` in the process of the shell window, never a
//! window by its class alone. Before Crest hides them it writes a record, the file `taskbar-hidden` (in a portable copy's data
//! folder, else in Crest's folder in %LOCALAPPDATA%): "1" when Crest turned auto-hide on, "0" when auto-hide was on already.
//! `restore` shows the taskbars again, turns off only the auto-hide the record calls Crest's and removes the record: when Crest
//! exits (sign-out, a Store update and an installer's close included), at the next start (a run that ended without it), from
//! the uninstaller (`--restore-taskbar`) and from a guard process, the same exe started with `--taskbar-guard <pid>`, which
//! waits for Crest to end in any way (crash, Task Manager).

use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_SETSTATE, APPBARDATA};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW, GetShellWindow, ShowWindowAsync, SW_SHOWNA};

use crate::display::{class_name, window_pid};
use crate::notices::OWN_APP;
use crate::portable;

/// This process hid the taskbars and has not shown them since: a restore shows them even when the record is gone.
static HID_HERE: AtomicBool = AtomicBool::new(false);
/// Every hide, show and restore runs under it, so a re-hide never lands after a restore. Not re-entrant: only the public entry
/// points lock it, and code already holding it calls the `_locked` variants.
static SCAN: Mutex<()> = Mutex::new(());

/// Another program can register its own `Shell_TrayWnd`, so a taskbar is Explorer's only in the shell's process.
pub(crate) fn is_explorer_taskbar(class: &str, pid: u32, shell_pid: u32) -> bool {
    shell_pid != 0 && pid == shell_pid && matches!(class, "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}

/// The record's content: "1" when Crest turned auto-hide on, "0" when it was on already.
fn parse(text: &str) -> bool {
    text.trim() == "1"
}

/// The record's file, the one place Crest, its guard and the uninstaller look: with a portable copy's data, else in %LOCALAPPDATA%.
fn state_path(portable_data: Option<PathBuf>, local_app_data: Option<PathBuf>) -> Option<PathBuf> {
    portable_data.or_else(|| local_app_data.map(|dir| dir.join(OWN_APP))).map(|dir| dir.join("taskbar-hidden"))
}

#[derive(Debug, PartialEq)]
struct Steps {
    show: bool,
    autohide_off: bool,
    remove: bool,
}

/// What a restore does. An auto-hide Crest turned on that cannot be turned off now keeps the record for the next try.
fn restore_steps(record: Option<bool>, hid_here: bool, explorer_found: bool, appbar_ok: bool) -> Steps {
    let crests_autohide = record == Some(true);
    Steps {
        show: (record.is_some() || hid_here) && explorer_found,
        autohide_off: crests_autohide && explorer_found && appbar_ok,
        remove: record.is_some() && explorer_found && !(crests_autohide && !appbar_ok),
    }
}

/// Gives Windows' taskbar back as far as Crest took it; safe to call any time, also from another process.
pub(crate) fn restore() {
    let _scan = SCAN.lock().unwrap_or_else(|e| e.into_inner());
    restore_locked(HID_HERE.load(Ordering::SeqCst));
}

/// `restore` for code that already holds `SCAN`; `hid_here` shows the taskbars even without a record.
pub(crate) fn restore_locked(hid_here: bool) {
    let path = state_path(portable::data_dir(), std::env::var_os("LOCALAPPDATA").map(PathBuf::from));
    // A record that cannot be read still says Crest hid the taskbars; whose auto-hide it was is unknown, so it is left alone.
    let record = path.as_deref().and_then(|path| match fs::read_to_string(path) {
        Err(e) if e.kind() == ErrorKind::NotFound => None,
        text => Some(text.is_ok_and(|text| parse(&text))),
    });
    let shell = shell_pid();
    let taskbars = taskbars(shell);
    let appbar = appbar_taskbar(shell);
    let steps = restore_steps(record, hid_here, !taskbars.is_empty(), appbar.is_some());
    if steps.show {
        for &hwnd in &taskbars {
            let _ = unsafe { ShowWindowAsync(hwnd, SW_SHOWNA) };
        }
        HID_HERE.store(false, Ordering::SeqCst);
    }
    if let (true, Some(hwnd)) = (steps.autohide_off, appbar) {
        let mut data = APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, lParam: LPARAM(0), ..Default::default() };
        unsafe { SHAppBarMessage(ABM_SETSTATE, &mut data) };
    }
    if let (true, Some(path)) = (steps.remove, &path) {
        let _ = fs::remove_file(path);
    }
}

/// The guard process (main.rs): waits for Crest to end, however it ends, then restores as the process that hid, so the taskbars
/// come back even after the uninstaller removed the record while Crest went on hiding. A pid it cannot open restores at once.
pub(crate) fn guard(pid: &str) -> i32 {
    if let Ok(pid) = pid.parse() {
        portable::wait_for_exit(pid);
    }
    let _scan = SCAN.lock().unwrap_or_else(|e| e.into_inner());
    restore_locked(true);
    0
}

/// Explorer's process, from its desktop window rather than from a taskbar class another program can register too.
fn shell_pid() -> u32 {
    window_pid(unsafe { GetShellWindow() })
}

/// Explorer's taskbars: the primary's `Shell_TrayWnd` and a `Shell_SecondaryTrayWnd` on each other monitor.
fn taskbars(shell: u32) -> Vec<HWND> {
    let mut found = Vec::new();
    for class in [w!("Shell_TrayWnd"), w!("Shell_SecondaryTrayWnd")] {
        let mut after = None;
        while let Ok(hwnd) = unsafe { FindWindowExW(None, after, class, PCWSTR::null()) } {
            after = Some(hwnd);
            if is_explorer_taskbar(&class_name(hwnd), window_pid(hwnd), shell) {
                found.push(hwnd);
            }
        }
    }
    found
}

/// Explorer's taskbar if `SHAppBarMessage` reaches it: that call finds its target by the class `Shell_TrayWnd`, whatever `hWnd`
/// says, and another program's can come first. None: Crest makes no appbar call.
fn appbar_taskbar(shell: u32) -> Option<HWND> {
    unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }.ok().filter(|&hwnd| is_explorer_taskbar(&class_name(hwnd), window_pid(hwnd), shell))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_explorers_own_taskbars_count() {
        assert!(is_explorer_taskbar("Shell_TrayWnd", 40, 40) && is_explorer_taskbar("Shell_SecondaryTrayWnd", 40, 40));
        assert!(!is_explorer_taskbar("Shell_TrayWnd", 77, 40)); // another program's own Shell_TrayWnd
        assert!(!is_explorer_taskbar("Shell_TrayWnd", 40, 0)); // no shell
        assert!(!is_explorer_taskbar("Progman", 40, 40) && !is_explorer_taskbar("WorkerW", 40, 40));
    }

    #[test]
    fn the_record_reads_one_only_as_crests_autohide() {
        assert!(parse("1") && parse("1\n") && parse(" 1 "));
        assert!(!parse("0") && !parse("") && !parse("x"));
    }

    #[test]
    fn restore_touches_only_what_crest_hid() {
        let s = |show, autohide_off, remove| Steps { show, autohide_off, remove };
        assert_eq!(restore_steps(None, false, true, true), s(false, false, false));
        assert_eq!(restore_steps(Some(true), false, true, true), s(true, true, true));
        assert_eq!(restore_steps(Some(false), false, true, true), s(true, false, true)); // the user's own auto-hide stays
        assert_eq!(restore_steps(Some(true), false, false, true), s(false, false, false)); // no Explorer: keep the record
        assert_eq!(restore_steps(None, true, true, true), s(true, false, false)); // this process, or its guard, hid after the uninstaller restored
        assert_eq!(restore_steps(Some(true), false, true, false), s(true, false, false)); // another program answers the appbar calls: show, keep the record
        assert_eq!(restore_steps(Some(false), false, true, false), s(true, false, true));
    }

    #[test]
    fn the_record_lives_with_portable_data_or_in_local_app_data() {
        let (p, r) = (PathBuf::from(r"C:\Crest\data"), PathBuf::from(r"C:\Users\u\AppData\Local"));
        assert_eq!(state_path(Some(p.clone()), Some(r.clone())), Some(p.join("taskbar-hidden")));
        assert_eq!(state_path(None, Some(r.clone())), Some(r.join("io.github.andrealo20.crest").join("taskbar-hidden")));
        assert_eq!(state_path(None, None), None);
    }

    #[test]
    fn own_app_is_the_bundle_identifier() {
        let conf = include_str!("../../tauri.conf.json");
        assert!(conf.contains(&format!("\"identifier\": \"{}\"", crate::notices::OWN_APP)));
    }
}
