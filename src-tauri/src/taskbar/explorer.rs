//! Windows' taskbar while Crest's bar stands in for it, and the safety net that always gives it back.
//!
//! Only Explorer's own taskbars count: `Shell_TrayWnd` and `Shell_SecondaryTrayWnd` in the process of the shell window, never a
//! window by its class alone. Before Crest hides them it writes a record, the file `taskbar-hidden` (in a portable copy's data
//! folder, else in Crest's folder in %LOCALAPPDATA%): "1" when Crest turned auto-hide on, "0" when auto-hide was on already.
//! `restore` shows the taskbars again, turns off only the auto-hide the record calls Crest's and removes the record: when Crest
//! exits (sign-out, a Store update and an installer's close included), at the next start (a run that ended without it), from
//! the uninstaller (`--restore-taskbar`) and from a guard process, the same exe started with `--taskbar-guard <pid>`, which
//! waits for Crest to end in any way (crash, Task Manager).
//!
//! The bar sets the mode (`set_mode`): `Hidden` once it has drawn, with the guard started and the record written first and
//! auto-hide turned on when it was off, so maximized windows fill the screen; `Shown` while the hide hotkey hides Crest, with
//! auto-hide, the record and the guard kept; `Off` when the bar goes, which is a restore. While `Hidden`, a taskbar Windows shows
//! again (Start, Win+T, a notification) is hidden again at once, and so are a restarted Explorer's new ones (mod.rs).

use std::fs;
use std::io::ErrorKind;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, ABS_AUTOHIDE, APPBARDATA};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW, GetShellWindow, ShowWindowAsync, SHOW_WINDOW_CMD, SW_HIDE, SW_SHOWNA};

use crate::display::{class_name, window_pid};
use crate::notices::OWN_APP;
use crate::portable;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// This process hid the taskbars and has not shown them since: a restore shows them even when the record is gone.
static HID_HERE: AtomicBool = AtomicBool::new(false);
/// Every hide, show and restore runs under it, so a re-hide never lands after a restore. Not re-entrant: only the public entry
/// points lock it, and code already holding it calls the `_locked` variants.
static SCAN: Mutex<Scan> = Mutex::new(Scan { mode: Mode::Off, guard: None, cleaned: false });

/// What `SCAN` keeps.
struct Scan {
    mode: Mode,
    /// The guard process, from the first hide until `Off`.
    guard: Option<Child>,
    /// The restore at start has run (`clean_locked`).
    cleaned: bool,
}

/// What Crest does with Windows' taskbars.
#[derive(Clone, Copy, PartialEq, Debug)]
pub(crate) enum Mode {
    /// Leaves them alone: the bar is off.
    Off,
    /// Hides them while the bar stands in for them.
    Hidden,
    /// Shows them while the hide hotkey hides Crest.
    Shown,
}

/// The mode for the bar (on once it has drawn) and the hide hotkey.
pub(crate) fn wanted(bar_on: bool, user_hidden: bool) -> Mode {
    match (bar_on, user_hidden) {
        (false, _) => Mode::Off,
        (true, true) => Mode::Shown,
        (true, false) => Mode::Hidden,
    }
}

/// Whether a window Windows has just shown is hidden again: only one of Explorer's taskbars, only while Crest hides them.
fn rehide(mode: Mode, is_taskbar: bool) -> bool {
    mode == Mode::Hidden && is_taskbar
}

/// Whether auto-hide is Crest's to turn off later: an existing record always wins over a new reading, and a new one never
/// claims an auto-hide Crest could not set.
fn autohide_is_crests(saved: Option<bool>, autohide_now: bool, appbar_ok: bool) -> bool {
    saved.unwrap_or(appbar_ok && !autohide_now)
}

/// The mode Crest moves to: shown from `Off` stays `Off`, since nothing is hidden yet.
fn step(current: Mode, wanted: Mode) -> Mode {
    if current == Mode::Off && wanted == Mode::Shown { Mode::Off } else { wanted }
}

/// Whether a hide first has the guard running and the record written, with Crest's auto-hide set again. Back from the hide
/// hotkey with both in place it only hides.
fn full_hide(guard_alive: bool, record: bool) -> bool {
    !(guard_alive && record)
}

/// The record's content (`parse`).
fn format(crests: bool) -> &'static str {
    if crests { "1" } else { "0" }
}

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

fn record_path() -> Option<PathBuf> {
    state_path(portable::data_dir(), std::env::var_os("LOCALAPPDATA").map(PathBuf::from))
}

/// What the record says.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Record {
    /// No file: Crest has hidden nothing.
    Missing,
    /// Crest hid the taskbars; true when it also turned auto-hide on.
    Saved(bool),
    /// There, but it cannot be read now (a scanner holding it): Crest hid the taskbars, and whose auto-hide it is stays unknown.
    Unreadable,
}

/// Reads the record. Anything but "1", text or not, is a record whose auto-hide is not Crest's.
fn read_record(path: &Path) -> Record {
    match fs::read_to_string(path) {
        Ok(text) => Record::Saved(parse(&text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Record::Missing,
        Err(e) if e.kind() == ErrorKind::InvalidData => Record::Saved(false),
        Err(_) => Record::Unreadable,
    }
}

#[derive(Debug, PartialEq)]
struct Steps {
    show: bool,
    autohide_off: bool,
    remove: bool,
}

/// What a restore does. An auto-hide Crest turned on that cannot be turned off now, and a record that cannot be read now, keep
/// the record for the next try.
fn restore_steps(record: Record, hid_here: bool, explorer_found: bool, appbar_ok: bool) -> Steps {
    let crests_autohide = record == Record::Saved(true);
    Steps {
        show: (record != Record::Missing || hid_here) && explorer_found,
        autohide_off: crests_autohide && explorer_found && appbar_ok,
        remove: matches!(record, Record::Saved(_)) && explorer_found && !(crests_autohide && !appbar_ok),
    }
}

fn lock() -> MutexGuard<'static, Scan> {
    SCAN.lock().unwrap_or_else(|e| e.into_inner())
}

/// Gives Windows' taskbar back as far as Crest took it; safe to call any time, also from another process.
pub(crate) fn restore() {
    let _scan = lock();
    restore_locked(HID_HERE.load(Ordering::SeqCst));
}

/// The restore at start, of what a run that ended without one left: once, and before any hide reads the record. When the bar
/// hides first, `set_mode` runs it then and this does nothing.
pub(crate) fn restore_at_start() {
    clean_locked(&mut lock());
}

fn clean_locked(scan: &mut Scan) {
    if !std::mem::replace(&mut scan.cleaned, true) {
        restore_locked(HID_HERE.load(Ordering::SeqCst));
    }
}

/// `restore` for code that already holds `SCAN`; `hid_here` shows the taskbars even without a record.
pub(crate) fn restore_locked(hid_here: bool) {
    let path = record_path();
    let record = path.as_deref().map_or(Record::Missing, read_record);
    let shell = shell_pid();
    let taskbars = taskbars(shell);
    let appbar = appbar_taskbar(shell);
    let steps = restore_steps(record, hid_here, !taskbars.is_empty(), appbar.is_some());
    if steps.show {
        post(&taskbars, SW_SHOWNA);
        HID_HERE.store(false, Ordering::SeqCst);
    }
    if let (true, Some(hwnd)) = (steps.autohide_off, appbar) {
        appbar_call(hwnd, ABM_SETSTATE, 0);
    }
    if let (true, Some(path)) = (steps.remove, &path) {
        let _ = fs::remove_file(path);
    }
}

/// Moves Windows' taskbars to `mode` (`step`).
pub(crate) fn set_mode(mode: Mode) {
    set_mode_with(|| mode);
}

/// `set_mode` with the mode read under `SCAN`, for a mode that follows what other threads change (the bar turned off), so it
/// is never applied late.
pub(crate) fn set_mode_with(mode: impl FnOnce() -> Mode) {
    let mut scan = lock();
    let mode = mode();
    set_mode_locked(&mut scan, mode);
}

fn set_mode_locked(scan: &mut Scan, wanted: Mode) {
    // The start's restore first, so it never removes a record written below.
    clean_locked(scan);
    let mode = step(scan.mode, wanted);
    if mode == scan.mode && (mode != Mode::Hidden || alive(&mut scan.guard)) {
        return;
    }
    match mode {
        Mode::Off => {
            restore_locked(HID_HERE.load(Ordering::SeqCst));
            if let Some(mut guard) = scan.guard.take() {
                let _ = guard.kill();
                let _ = guard.wait();
            }
            scan.mode = Mode::Off;
        }
        // Auto-hide, the record and the guard stay for the way back.
        Mode::Shown => {
            post(&taskbars(shell_pid()), SW_SHOWNA);
            scan.mode = Mode::Shown;
        }
        Mode::Hidden => hide_locked(scan, false),
    }
}

/// Hides Explorer's taskbars. The full path (`full_hide`, and always for the new taskbars of a restarted Explorer) first has the
/// guard running and the record written, then sets the auto-hide the record calls Crest's; else it only hides. Nothing is
/// hidden while the record cannot be read or written: the mode stays as it was.
fn hide_locked(scan: &mut Scan, explorer_restarted: bool) {
    let Some(path) = record_path() else { return };
    let saved = match read_record(&path) {
        Record::Missing => None,
        Record::Saved(crests) => Some(crests),
        Record::Unreadable => return,
    };
    let shell = shell_pid();
    if explorer_restarted || full_hide(alive(&mut scan.guard), saved.is_some()) {
        if !guarded(scan) {
            return;
        }
        let appbar = appbar_taskbar(shell);
        // Asked only for a new record: an existing one always wins.
        let autohide_now = saved.is_none() && appbar.is_some_and(|hwnd| appbar_call(hwnd, ABM_GETSTATE, 0) as u32 & ABS_AUTOHIDE != 0);
        let crests = autohide_is_crests(saved, autohide_now, appbar.is_some());
        if let Err(e) = crate::write_atomic(&path, format(crests).as_bytes()) {
            eprintln!("taskbar: record not written, Windows' taskbar stays: {e}");
            return;
        }
        if let (true, Some(hwnd)) = (crests, appbar) {
            appbar_call(hwnd, ABM_SETSTATE, ABS_AUTOHIDE);
        }
        HID_HERE.store(true, Ordering::SeqCst);
    }
    post(&taskbars(shell), SW_HIDE);
    scan.mode = Mode::Hidden;
}

/// Windows has shown `hwnd` (the thread's WinEvent hook, mod.rs): one of Explorer's taskbars is hidden again while Crest hides
/// them. Only a posted `SW_HIDE` here, never an appbar call.
pub(crate) fn on_show(hwnd: HWND) {
    let taskbar = is_explorers(hwnd, shell_pid());
    // Every window shown anywhere comes here; only Explorer's taskbars wait for the lock.
    if !taskbar {
        return;
    }
    let mut scan = lock();
    if rehide(scan.mode, taskbar) && guarded(&mut scan) {
        let _ = unsafe { ShowWindowAsync(hwnd, SW_HIDE) };
    }
}

/// Explorer has made its taskbars anew (`TaskbarCreated`, mod.rs): while Crest hides them, the new ones are hidden too, with the
/// auto-hide the record calls Crest's set again.
pub(crate) fn on_taskbar_created() {
    let mut scan = lock();
    if scan.mode == Mode::Hidden {
        hide_locked(&mut scan, true);
    }
}

fn alive(guard: &mut Option<Child>) -> bool {
    guard.as_mut().is_some_and(|child| matches!(child.try_wait(), Ok(None)))
}

/// Has the guard running, started again if it died (ended from Task Manager). Without one nothing more is hidden, and taskbars
/// hidden already come back (`Shown`), so Windows' taskbar stays reachable.
fn guarded(scan: &mut Scan) -> bool {
    if alive(&mut scan.guard) {
        return true;
    }
    scan.guard = std::env::current_exe()
        .and_then(|exe| Command::new(exe).arg("--taskbar-guard").arg(std::process::id().to_string()).creation_flags(CREATE_NO_WINDOW).spawn())
        .inspect_err(|e| eprintln!("taskbar: guard failed, Windows' taskbar stays: {e}"))
        .ok();
    if scan.guard.is_none() && scan.mode == Mode::Hidden {
        post(&taskbars(shell_pid()), SW_SHOWNA);
        scan.mode = Mode::Shown;
    }
    scan.guard.is_some()
}

/// The guard process (main.rs): waits for Crest to end, however it ends, then restores as the process that hid, so the taskbars
/// come back even after the uninstaller removed the record while Crest went on hiding. A pid it cannot open restores at once.
pub(crate) fn guard(pid: &str) -> i32 {
    if let Ok(pid) = pid.parse() {
        portable::wait_for_exit(pid);
    }
    let _scan = lock();
    restore_locked(true);
    0
}

/// Explorer's process, from its desktop window rather than from a taskbar class another program can register too.
fn shell_pid() -> u32 {
    window_pid(unsafe { GetShellWindow() })
}

fn is_explorers(hwnd: HWND, shell: u32) -> bool {
    is_explorer_taskbar(&class_name(hwnd), window_pid(hwnd), shell)
}

/// Explorer's taskbars: the primary's `Shell_TrayWnd` and a `Shell_SecondaryTrayWnd` on each other monitor.
fn taskbars(shell: u32) -> Vec<HWND> {
    let mut found = Vec::new();
    for class in [w!("Shell_TrayWnd"), w!("Shell_SecondaryTrayWnd")] {
        let mut after = None;
        while let Ok(hwnd) = unsafe { FindWindowExW(None, after, class, PCWSTR::null()) } {
            after = Some(hwnd);
            if is_explorers(hwnd, shell) {
                found.push(hwnd);
            }
        }
    }
    found
}

/// Shows or hides the taskbars without waiting on Explorer; `SW_SHOWNA` leaves the keyboard where it is.
fn post(taskbars: &[HWND], how: SHOW_WINDOW_CMD) {
    for &hwnd in taskbars {
        let _ = unsafe { ShowWindowAsync(hwnd, how) };
    }
}

/// Explorer's taskbar if `SHAppBarMessage` reaches it: that call finds its target by the class `Shell_TrayWnd`, whatever `hWnd`
/// says, and another program's can come first. None: Crest makes no appbar call.
fn appbar_taskbar(shell: u32) -> Option<HWND> {
    unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }.ok().filter(|&hwnd| is_explorers(hwnd, shell))
}

/// `SHAppBarMessage` to Explorer's taskbar `hwnd` (`appbar_taskbar`), with `state` for `ABM_SETSTATE`.
fn appbar_call(hwnd: HWND, message: u32, state: u32) -> usize {
    let mut data = APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd, lParam: LPARAM(state as isize), ..Default::default() };
    unsafe { SHAppBarMessage(message, &mut data) }
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
        let (missing, crests, users) = (Record::Missing, Record::Saved(true), Record::Saved(false));
        assert_eq!(restore_steps(missing, false, true, true), s(false, false, false));
        assert_eq!(restore_steps(crests, false, true, true), s(true, true, true));
        assert_eq!(restore_steps(users, false, true, true), s(true, false, true)); // the user's own auto-hide stays
        assert_eq!(restore_steps(crests, false, false, true), s(false, false, false)); // no Explorer: keep the record
        assert_eq!(restore_steps(missing, true, true, true), s(true, false, false)); // this process, or its guard, hid after the uninstaller restored
        assert_eq!(restore_steps(crests, false, true, false), s(true, false, false)); // another program answers the appbar calls: show, keep the record
        assert_eq!(restore_steps(users, false, true, false), s(true, false, true));
        assert_eq!(restore_steps(Record::Unreadable, false, true, true), s(true, false, false)); // whose auto-hide is unknown: keep it and the file
        assert_eq!(restore_steps(Record::Unreadable, false, false, true), s(false, false, false));
    }

    #[test]
    fn a_record_that_cannot_be_read_now_is_not_the_users() {
        let dir = std::env::temp_dir().join(format!("crest-taskbar-read-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("taskbar-hidden");
        assert_eq!(read_record(&path), Record::Missing);
        for (bytes, record) in [(&b"1"[..], Record::Saved(true)), (b"0", Record::Saved(false)), (b"x", Record::Saved(false)), (b"\xff\xfe", Record::Saved(false))] {
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(read_record(&path), record);
        }
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap(); // an error other than a missing file or bad content, as a scanner holding the file
        assert_eq!(read_record(&path), Record::Unreadable);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn windows_shows_are_undone_only_while_hidden() {
        assert_eq!(wanted(false, false), Mode::Off);
        assert_eq!(wanted(false, true), Mode::Off);
        assert_eq!(wanted(true, true), Mode::Shown);
        assert_eq!(wanted(true, false), Mode::Hidden);
        assert!(rehide(Mode::Hidden, true));
        assert!(!rehide(Mode::Shown, true) && !rehide(Mode::Off, true) && !rehide(Mode::Hidden, false));
        assert_eq!(step(Mode::Off, Mode::Shown), Mode::Off); // nothing hidden yet: nothing to show
        assert_eq!(step(Mode::Hidden, Mode::Shown), Mode::Shown);
        assert_eq!(step(Mode::Shown, Mode::Hidden), Mode::Hidden);
        assert_eq!(step(Mode::Hidden, Mode::Off), Mode::Off);
    }

    #[test]
    fn hiding_without_a_guard_and_a_record_takes_the_full_path() {
        assert!(full_hide(false, false) && full_hide(true, false) && full_hide(false, true));
        assert!(!full_hide(true, true)); // back from the hide shortcut: SW_HIDE only
    }

    #[test]
    fn the_users_own_autohide_is_never_turned_off() {
        assert!(autohide_is_crests(None, false, true));
        assert!(!autohide_is_crests(None, true, true));
        assert!(autohide_is_crests(Some(true), true, true)); // a re-hide after an Explorer restart keeps Crest's record
        assert!(!autohide_is_crests(Some(false), false, true));
        assert!(!autohide_is_crests(None, false, false)); // another program answers the appbar calls: never claim auto-hide
        assert!(autohide_is_crests(Some(true), true, false)); // an earlier record still stands
    }

    #[test]
    fn the_record_round_trips() {
        let dir = std::env::temp_dir().join(format!("crest-taskbar-record-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("taskbar-hidden");
        crate::write_atomic(&path, format(true).as_bytes()).unwrap();
        assert!(parse(&std::fs::read_to_string(&path).unwrap()));
        crate::write_atomic(&path, format(false).as_bytes()).unwrap();
        assert!(!parse(&std::fs::read_to_string(&path).unwrap()));
        std::fs::remove_dir_all(&dir).unwrap();
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
