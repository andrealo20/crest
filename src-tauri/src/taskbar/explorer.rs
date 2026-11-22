//! Windows' taskbar while Crest's bar stands in for it, and the safety net that always gives it back.
//!
//! Only Explorer's own taskbars count: `Shell_TrayWnd` and `Shell_SecondaryTrayWnd` in the process of the shell window, never a
//! window by its class alone. Before Crest hides them it writes a record, the file `taskbar-hidden` (in a portable copy's data
//! folder, else in Crest's folder in %LOCALAPPDATA%): "1" when Crest turned auto-hide on, "0" when auto-hide was on already.
//! Beside it, `taskbar-appbars` lists the appbars of the docked bars that reserve their strip (reserve.rs, registered on the
//! taskbar thread under `SCAN` taken with `try_locked`, and written before each registration). `restore` removes
//! those appbars and their record first (only through Explorer's taskbar, else both stay for a later restore), then turns off
//! only the auto-hide the record calls Crest's, removes the record and shows the taskbars again, in that order: when Crest
//! exits (sign-out, a Store update and an installer's close included), at the next start (a run that ended without it), from
//! the uninstaller (`--restore-taskbar`) and from a guard process, the same exe started with `--taskbar-guard <pid>`, which
//! waits for Crest to end in any way (crash, Task Manager).
//!
//! The bar sets the mode (`set_mode`): `Hidden` once it has drawn, with the guard started and the record written first and
//! auto-hide turned on when it was off, so maximized windows fill the screen; `Shown` while the hide hotkey hides Crest, with
//! auto-hide, the record and the guard kept; `Off` when the bar goes, which is a restore. While `Hidden`, a taskbar Windows shows
//! again (Start, Win+T, a notification) is hidden again at once, and so are a restarted Explorer's new ones (mod.rs). A hide
//! whose appbar calls Explorer's taskbar did not answer (none yet, or another program's `Shell_TrayWnd` first) writes "0", and
//! the taskbar thread tries auto-hide again once it answers (`retry_autohide`).
//!
//! Beside them, `taskbar-keys` is the record of the bar's Windows keys (keys.rs). The guard stays while it exists and, after the
//! taskbar, gives the keys back with an Explorer restart (`keys::after_crest`).

use std::fs;
use std::io::ErrorKind;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, TryLockError};
use std::time::{Duration, Instant};

use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_REMOVE, ABM_SETSTATE, ABS_AUTOHIDE, APPBARDATA};
use windows::Win32::UI::WindowsAndMessaging::{FindWindowExW, FindWindowW, GetShellWindow, ShowWindowAsync, SHOW_WINDOW_CMD, SW_HIDE, SW_SHOWNA};

use crate::display::{class_name, window_pid};
use crate::notices::OWN_APP;
use crate::portable;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// A guard lives at least this long; one that ends sooner could not wait for Crest (`died_at_once`).
const GUARD_MIN_LIFE: Duration = Duration::from_secs(2);

/// This process hid the taskbars and has not shown them since: a restore shows them even when the record is gone.
static HID_HERE: AtomicBool = AtomicBool::new(false);
/// Every hide, show and restore runs under it, so a re-hide never lands after a restore. Not re-entrant: only the public entry
/// points lock it, and code already holding it calls the `_locked` variants.
static SCAN: Mutex<Scan> = Mutex::new(Scan { mode: Mode::Off, guard: None, gave_up: false, cleaned: false, missed: false });

/// What `SCAN` keeps.
struct Scan {
    mode: Mode,
    /// The guard process and when it started, from the first hide until an `Off` leaves nothing to give back.
    guard: Option<(Child, Instant)>,
    /// A guard ended at once (`died_at_once`): none is started again until the user asks for `Hidden`.
    gave_up: bool,
    /// The restore at start has run (`clean_locked`).
    cleaned: bool,
    /// A new record was written while Explorer's taskbar did not answer the appbar calls: auto-hide is still to try
    /// (`retry_autohide`). Kept through `Shown`, cleared by `Off`.
    missed: bool,
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

/// Whether Windows' taskbar was given back from outside while Crest hides it, so Crest stops hiding it again (`on_show`,
/// `on_taskbar_created`). While Crest hides, the record always exists: a missing or unreadable one means the uninstaller's
/// `--restore-taskbar` ran while Crest still runs.
fn given_back(record: Record) -> bool {
    !matches!(record, Record::Saved(_))
}

/// Whether an `Off` left nothing to give back, so the guard can go; otherwise it restores when Crest ends. `listed`: the
/// appbars record still exists; `keys`: the keys record does (keys.rs).
fn nothing_left(hid_here: bool, record: Record, listed: bool, keys: bool) -> bool {
    !hid_here && record == Record::Missing && !listed && !keys
}

/// Whether a restore removes the appbars the record `listed`: only while Explorer's taskbar answers the appbar calls
/// (`appbar_ok`), since with another program's `Shell_TrayWnd` first the removal would reach that program, not Explorer.
fn unregisters(listed: bool, appbar_ok: bool) -> bool {
    listed && appbar_ok
}

/// Whether a guard found dead `lived` after it started counts as failed: it could not wait for Crest and gave the taskbar back
/// at once, and starting it again would loop (start, give back, hide again).
fn died_at_once(lived: Duration) -> bool {
    lived < GUARD_MIN_LIFE
}

/// Whether auto-hide is Crest's to turn off later: an existing record always wins over a new reading, and a new one never
/// claims an auto-hide Crest could not set.
fn autohide_is_crests(saved: Option<bool>, autohide_now: bool, appbar_ok: bool) -> bool {
    saved.unwrap_or(appbar_ok && !autohide_now)
}

/// What the record says once Explorer's taskbar answers (`appbar_ok`) after a hide that `missed` auto-hide: Some(true) claims
/// auto-hide and turns it on, Some(false) leaves the user's own, already on. None: nothing to do yet.
fn retry_claim(missed: bool, appbar_ok: bool, autohide_now: bool) -> Option<bool> {
    (missed && appbar_ok).then_some(!autohide_now)
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

/// The record of the docked bars' appbars (`reserve::format_hwnds`), in the folder of the taskbar's record.
fn appbars_beside(record: &Path) -> PathBuf {
    record.with_file_name("taskbar-appbars")
}

pub(crate) fn appbars_path() -> Option<PathBuf> {
    record_path().map(|p| appbars_beside(&p))
}

/// The record of the bar's Windows keys (keys.rs), in the same folder.
fn keys_beside(record: &Path) -> PathBuf {
    record.with_file_name("taskbar-keys")
}

pub(crate) fn keys_path() -> Option<PathBuf> {
    record_path().map(|p| keys_beside(&p))
}

fn record_now() -> Record {
    record_path().as_deref().map_or(Record::Missing, read_record)
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

/// Runs `f` under `SCAN`, so none of Crest's appbar calls (all made under it) is on its way meanwhile (tray.rs `taskbar_tray_on`).
pub(crate) fn locked<T>(f: impl FnOnce() -> T) -> T {
    let _scan = lock();
    f()
}

/// `SCAN` if it is free. The taskbar thread takes it only this way: a thread waiting for a lock answers no message, and a holder
/// may be waiting on Explorer, which may be sending to that thread's window. mod.rs tries again shortly.
fn try_lock() -> Option<MutexGuard<'static, Scan>> {
    match SCAN.try_lock() {
        Ok(scan) => Some(scan),
        Err(TryLockError::Poisoned(e)) => Some(e.into_inner()),
        Err(TryLockError::WouldBlock) => None,
    }
}

/// Runs `f` under `SCAN` if it is free, for the docked bars' appbar calls on the taskbar thread (reserve.rs `reconcile`); None
/// when it is taken. `f` hears whether a bar may reserve: Crest hides Windows' taskbar (`Hidden`, or `Shown` by the hide
/// hotkey) with the guard alive, so a crash is covered, and the record is there, so a taskbar given back from outside is not
/// reserved against again.
pub(crate) fn try_locked<T>(f: impl FnOnce(bool) -> T) -> Option<T> {
    let mut scan = try_lock()?;
    let hiding = scan.mode != Mode::Off && alive(&mut scan.guard) && record_now() != Record::Missing;
    Some(f(hiding))
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
///
/// The show comes last, after the record is gone: a restore from another process (the uninstaller, the guard) raises
/// `on_show` in a Crest still running, which hides the taskbars again while it still finds the record. A restore that stops
/// before the removal leaves the record, and the next one finishes the job.
pub(crate) fn restore_locked(hid_here: bool) {
    let path = record_path();
    let record = path.as_deref().map_or(Record::Missing, read_record);
    let shell = shell_pid();
    let taskbars = taskbars(shell);
    let appbar = appbar_taskbar(shell);
    let steps = restore_steps(record, hid_here, !taskbars.is_empty(), appbar.is_some());
    // The docked bars' strips first; an unreadable record counts as not listed and stays.
    if let Some(appbars) = appbars_path() {
        let listed = fs::read_to_string(&appbars).ok();
        if unregisters(listed.is_some(), appbar.is_some()) {
            for hwnd in super::reserve::parse_hwnds(listed.as_deref().unwrap_or_default()) {
                appbar_call(HWND(hwnd as _), ABM_REMOVE, 0);
            }
            let _ = fs::remove_file(&appbars);
        }
    }
    if let (true, Some(hwnd)) = (steps.autohide_off, appbar) {
        appbar_call(hwnd, ABM_SETSTATE, 0);
    }
    if let (true, Some(path)) = (steps.remove, &path) {
        let _ = fs::remove_file(path);
    }
    if steps.show {
        post(&taskbars, SW_SHOWNA);
        HID_HERE.store(false, Ordering::SeqCst);
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
    // Asked for by the user (the bar's first draw, the hotkey): a guard that failed may be started again.
    if wanted == Mode::Hidden {
        scan.gave_up = false;
    }
    let mode = step(scan.mode, wanted);
    if mode == scan.mode && (mode != Mode::Hidden || alive(&mut scan.guard)) {
        return;
    }
    match mode {
        Mode::Off => {
            restore_locked(HID_HERE.load(Ordering::SeqCst));
            // Kept while anything is left to give back (no Explorer, the appbar calls answered by another program): it
            // restores when Crest ends.
            let exists = |p: Option<PathBuf>| p.is_some_and(|p| p.exists());
            if nothing_left(HID_HERE.load(Ordering::SeqCst), record_now(), exists(appbars_path()), exists(keys_path())) {
                if let Some((mut guard, _)) = scan.guard.take() {
                    let _ = guard.kill();
                    let _ = guard.wait();
                }
            }
            // Off ends the auto-hide retry. A record kept because Explorer was down is reused by the next hide, which does not
            // retry.
            scan.missed = false;
            scan.mode = Mode::Off;
        }
        // Auto-hide, the record and the guard stay for the way back.
        Mode::Shown => {
            post(&taskbars(shell_pid()), SW_SHOWNA);
            scan.mode = Mode::Shown;
        }
        // The short path is for the way back from the hotkey only, not for a guard and a record an `Off` kept.
        Mode::Hidden => {
            let full = scan.mode == Mode::Off;
            hide_locked(scan, record_now(), full);
        }
    }
}

/// Hides Explorer's taskbars. The full path (`full`, or `full_hide`) first has the guard running and the record written, then
/// sets the auto-hide the record calls Crest's; else it only hides. Nothing is hidden while the record cannot be read or
/// written: the mode stays as it was.
fn hide_locked(scan: &mut Scan, record: Record, full: bool) {
    let saved = match record {
        Record::Missing => None,
        Record::Saved(crests) => Some(crests),
        Record::Unreadable => return,
    };
    let shell = shell_pid();
    if full || full_hide(alive(&mut scan.guard), saved.is_some()) {
        let Some(path) = record_path() else { return };
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
        // A new record says "0" without asking Explorer when it did not answer: the taskbar thread asks again.
        if saved.is_none() {
            scan.missed = appbar.is_none();
            if scan.missed {
                super::autohide_missed();
            }
        }
        HID_HERE.store(true, Ordering::SeqCst);
    }
    post(&taskbars(shell), SW_HIDE);
    scan.mode = Mode::Hidden;
}

/// Windows has shown `hwnd` (the thread's WinEvent hook, mod.rs): one of Explorer's taskbars is hidden again while Crest hides
/// them, unless it was given back from outside (`given_back`). Only a posted `SW_HIDE` here, never an appbar call. False when
/// `SCAN` is taken: nothing was done, and the thread tries again shortly.
pub(crate) fn on_show(hwnd: HWND) -> bool {
    let taskbar = is_explorers(hwnd, shell_pid());
    // Every window shown anywhere comes here; only Explorer's taskbars need the lock.
    if !taskbar {
        return true;
    }
    let Some(mut scan) = try_lock() else { return false };
    if rehide(scan.mode, taskbar) && !given_back(record_now()) && guarded(&mut scan) {
        let _ = unsafe { ShowWindowAsync(hwnd, SW_HIDE) };
    }
    // Shown, it may have come ahead of the tray's spy: a post to the spy's thread, which raises itself (tray.rs).
    super::tray::raise();
    true
}

/// Explorer has made its taskbars anew (`TaskbarCreated`, mod.rs): while Crest hides them, the new ones are hidden too, with the
/// auto-hide the record calls Crest's set again, unless the taskbar was given back from outside. False when `SCAN` is taken, as
/// `on_show`.
pub(crate) fn on_taskbar_created() -> bool {
    let Some(mut scan) = try_lock() else { return false };
    if scan.mode == Mode::Hidden {
        let record = record_now();
        if !given_back(record) {
            hide_locked(&mut scan, record, true);
        }
    }
    true
}

/// The auto-hide a hide could not set (`missed`), tried again on the taskbar thread (mod.rs) once Explorer's own taskbar answers
/// the appbar calls: the record first, then auto-hide, as `hide_locked` does. Only while `Hidden`, and never on a taskbar given
/// back from outside. False when `SCAN` is taken, as `on_show`.
pub(crate) fn retry_autohide() -> bool {
    let Some(mut scan) = try_lock() else { return false };
    if scan.mode != Mode::Hidden || !scan.missed {
        return true;
    }
    match record_now() {
        Record::Saved(_) => {}
        // Given back from outside (`given_back`): nothing left to claim.
        Record::Missing => {
            scan.missed = false;
            return true;
        }
        // Cannot be read now: the next try.
        Record::Unreadable => return true,
    }
    let appbar = appbar_taskbar(shell_pid());
    let autohide_now = appbar.is_some_and(|hwnd| appbar_call(hwnd, ABM_GETSTATE, 0) as u32 & ABS_AUTOHIDE != 0);
    let (Some(claim), Some(path)) = (retry_claim(scan.missed, appbar.is_some(), autohide_now), record_path()) else { return true };
    if let Err(e) = crate::write_atomic(&path, format(claim).as_bytes()) {
        eprintln!("taskbar: record not written, auto-hide stays off: {e}");
        return true;
    }
    if let (true, Some(hwnd)) = (claim, appbar) {
        appbar_call(hwnd, ABM_SETSTATE, ABS_AUTOHIDE);
    }
    scan.missed = false;
    true
}

/// Whether auto-hide is still to try (`retry_autohide`). True while `SCAN` is taken: mod.rs keeps its timer, whose next tick
/// decides.
pub(crate) fn missed() -> bool {
    try_lock().is_none_or(|scan| scan.missed)
}

fn alive(guard: &mut Option<(Child, Instant)>) -> bool {
    guard.as_mut().is_some_and(|(child, _)| matches!(child.try_wait(), Ok(None)))
}

/// Has the guard running, started again if it died (ended from Task Manager), but not after one that ended at once
/// (`died_at_once`) until the user asks for `Hidden` again. Without one nothing more is hidden, and taskbars hidden already
/// come back (`Shown`), so Windows' taskbar stays reachable.
fn guarded(scan: &mut Scan) -> bool {
    if alive(&mut scan.guard) {
        return true;
    }
    if let Some((_, started)) = scan.guard.take() {
        scan.gave_up |= died_at_once(started.elapsed());
    }
    if !scan.gave_up {
        scan.guard = std::env::current_exe()
            .and_then(|exe| Command::new(exe).arg("--taskbar-guard").arg(std::process::id().to_string()).creation_flags(CREATE_NO_WINDOW).spawn())
            .inspect_err(|e| eprintln!("taskbar: guard failed, Windows' taskbar stays: {e}"))
            .ok()
            .map(|child| (child, Instant::now()));
    }
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
    let scan = lock();
    restore_locked(true);
    drop(scan);
    // After the taskbar is back, so Explorer's restart never lands between the record's removal and the auto-hide reset.
    super::keys::after_crest();
    0
}

/// Whether the guard runs, to give the keys back once Crest is gone (keys.rs `on_exit`).
pub(crate) fn guard_alive() -> bool {
    alive(&mut lock().guard)
}

/// Explorer's process, from its desktop window rather than from a taskbar class another program can register too.
pub(crate) fn shell_pid() -> u32 {
    window_pid(unsafe { GetShellWindow() })
}

fn is_explorers(hwnd: HWND, shell: u32) -> bool {
    is_explorer_taskbar(&class_name(hwnd), window_pid(hwnd), shell)
}

/// Explorer's taskbars: the primary's `Shell_TrayWnd` and a `Shell_SecondaryTrayWnd` on each other monitor.
fn taskbars(shell: u32) -> Vec<HWND> {
    [w!("Shell_TrayWnd"), w!("Shell_SecondaryTrayWnd")].into_iter().flat_map(windows_of).filter(|&hwnd| is_explorers(hwnd, shell)).collect()
}

/// Every top-level window of `class`, front to back, hidden ones included.
pub(super) fn windows_of(class: PCWSTR) -> Vec<HWND> {
    let mut found = Vec::new();
    while let Ok(hwnd) = unsafe { FindWindowExW(None, found.last().copied(), class, PCWSTR::null()) } {
        found.push(hwnd);
    }
    found
}

/// Explorer's own `Shell_TrayWnd`, by the shell's process: where the tray's spy passes every message on (tray.rs), never
/// another program's. None while Explorer has none (it is restarting).
pub(crate) fn explorer_tray() -> Option<HWND> {
    let shell = shell_pid();
    windows_of(w!("Shell_TrayWnd")).into_iter().find(|&hwnd| is_explorers(hwnd, shell))
}

/// Shows or hides the taskbars without waiting on Explorer; `SW_SHOWNA` leaves the keyboard where it is.
fn post(taskbars: &[HWND], how: SHOW_WINDOW_CMD) {
    for &hwnd in taskbars {
        let _ = unsafe { ShowWindowAsync(hwnd, how) };
    }
}

/// Whether `SHAppBarMessage` reaches Explorer from the first `Shell_TrayWnd`: it is Explorer's own, or the tray's spy, which
/// passes Crest's call on and waits for Explorer's answer, as without the spy (tray.rs).
fn appbar_ok(explorers: bool, spy: bool) -> bool {
    explorers || spy
}

/// Explorer's taskbar if `SHAppBarMessage` reaches it: that call finds its target by the class `Shell_TrayWnd`, whatever `hWnd`
/// says, and another program's can come first (`appbar_ok`). Explorer's own window even with the spy first, so `hWnd` names it.
/// None: Crest makes no appbar call.
fn appbar_taskbar(shell: u32) -> Option<HWND> {
    let first = unsafe { FindWindowW(w!("Shell_TrayWnd"), None) }.ok()?;
    if appbar_ok(is_explorers(first, shell), super::tray::is_spy(first)) { explorer_tray() } else { None }
}

/// Whether Crest's appbar calls reach Explorer now (`appbar_taskbar`): the docked bars register and remove only then.
pub(crate) fn appbar_reachable() -> bool {
    appbar_taskbar(shell_pid()).is_some()
}

/// `SHAppBarMessage` for `hwnd` (Explorer's taskbar from `appbar_taskbar`, or one of Crest's appbars for `ABM_REMOVE`), with
/// `state` for `ABM_SETSTATE`.
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
    fn a_taskbar_given_back_from_outside_is_not_taken_again() {
        assert!(!given_back(Record::Saved(true)) && !given_back(Record::Saved(false)));
        assert!(given_back(Record::Missing)); // the uninstaller's --restore-taskbar ran while Crest still runs
        assert!(given_back(Record::Unreadable));
    }

    #[test]
    fn the_guard_stays_while_anything_is_left_to_give_back() {
        assert!(nothing_left(false, Record::Missing, false, false));
        assert!(!nothing_left(true, Record::Missing, false, false)); // no Explorer to show the taskbars to
        assert!(!nothing_left(false, Record::Saved(true), false, false)); // Crest's auto-hide still on: another program answers the appbar calls
        assert!(!nothing_left(false, Record::Saved(false), false, false) && !nothing_left(false, Record::Unreadable, false, false));
        assert!(!nothing_left(false, Record::Missing, true, false)); // an appbar another program kept Crest from removing
        assert!(!nothing_left(false, Record::Missing, false, true)); // the Windows keys, given back after Crest is gone
    }

    #[test]
    fn crests_appbars_are_removed_only_through_explorer() {
        assert!(unregisters(true, true));
        assert!(!unregisters(true, false)); // another program first: the record stays for the next restore
        assert!(!unregisters(false, true));
    }

    #[test]
    fn the_appbars_record_lives_beside_the_taskbar_record() {
        assert_eq!(appbars_beside(Path::new(r"C:\Crest\data\taskbar-hidden")), PathBuf::from(r"C:\Crest\data\taskbar-appbars"));
        assert_eq!(keys_beside(Path::new(r"C:\Crest\data\taskbar-hidden")), PathBuf::from(r"C:\Crest\data\taskbar-keys"));
    }

    #[test]
    fn a_guard_that_ends_at_once_is_not_started_again() {
        assert!(died_at_once(Duration::from_millis(300)) && died_at_once(Duration::from_millis(1999)));
        assert!(!died_at_once(Duration::from_secs(2)) && !died_at_once(Duration::from_secs(600))); // ended from Task Manager later: started again
    }

    /// The tests that hold `SCAN` take this first: run in parallel, one's "free" check could meet the other's held lock.
    static SCAN_TESTS: Mutex<()> = Mutex::new(());

    #[test]
    fn the_taskbar_thread_never_waits_for_the_lock() {
        let _serial = SCAN_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let held = lock();
        assert!(!on_taskbar_created()); // taken: nothing done, the thread tries again
        drop(held);
        assert!(on_taskbar_created()); // free, and nothing hidden: done
    }

    #[test]
    fn the_appbar_calls_never_wait_for_the_lock() {
        let _serial = SCAN_TESTS.lock().unwrap_or_else(|e| e.into_inner());
        let held = lock();
        assert!(try_locked(|_| ()).is_none()); // taken: the bar's thread defers
        drop(held);
        assert_eq!(try_locked(|hiding| hiding), Some(false)); // free, nothing hidden: no registration
    }

    #[test]
    fn the_spy_answers_for_explorer_appbar_calls() {
        assert!(appbar_ok(true, false));
        assert!(appbar_ok(false, true));
        assert!(!appbar_ok(false, false));
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
    fn auto_hide_is_tried_again_once_explorer_answers() {
        assert_eq!(retry_claim(true, true, false), Some(true)); // write "1", turn auto-hide on
        assert_eq!(retry_claim(true, true, true), Some(false)); // the user's own auto-hide: write "0", stop
        assert_eq!(retry_claim(true, false, false), None); // still no answer: keep waiting
        assert_eq!(retry_claim(false, true, false), None); // nothing was missed
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
