//! The Recycle Bin's button on the bar: how many items it holds, from Windows' own count, read again when the shell reports a
//! change in the bin (one read 300 ms after the last of a burst, off the taskbar thread). Opening it goes through Explorer, and
//! emptying it through Windows' own call once the user said yes in Crest's panel (RecyclePanel.tsx, its red button alone), so
//! Windows does not ask a second time.

use std::cell::Cell;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, WPARAM};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    FOLDERID_RecycleBinFolder, ILFree, SHChangeNotification_Lock, SHChangeNotification_Unlock, SHChangeNotifyDeregister, SHChangeNotifyEntry,
    SHChangeNotifyRegister, SHEmptyRecycleBinW, SHGetKnownFolderIDList, SHQueryRecycleBinW, SHCNE_ALLEVENTS, SHCNRF_InterruptLevel, SHCNRF_NewDelivery,
    SHCNRF_ShellLevel, SHERB_NOCONFIRMATION, SHQUERYRBINFO,
};
use windows::Win32::UI::WindowsAndMessaging::{KillTimer, SetTimer, WM_APP};

use super::bar;

/// The shell's change notification for the bin, on the taskbar thread's window.
pub(super) const RECYCLE_MSG: u32 = WM_APP + 4;
/// The one-shot timer that turns a burst of notifications into one read.
pub(super) const RECYCLE_TIMER: usize = 4;
const RECYCLE_MS: u32 = 300;
/// Crest's panel asked already: no confirmation of Windows' own, its progress and sound kept.
const EMPTY_FLAGS: u32 = SHERB_NOCONFIRMATION;

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
pub struct Recycle {
    items: i64,
    bytes: i64,
}

/// The number of the newest read that ended (`take`), and the last count the bar was sent.
static LAST: Mutex<(u64, Option<Recycle>)> = Mutex::new((0, None));
/// The reads started, to number them.
static READS: AtomicU64 = AtomicU64::new(0);

thread_local! {
    /// The registration's id and the bin's pidl, on the taskbar thread.
    static WATCH: Cell<(u32, usize)> = const { Cell::new((0, 0)) };
    static ARMED: Cell<bool> = const { Cell::new(false) };
    /// For the read the timer starts.
    static APP: std::cell::RefCell<Option<AppHandle>> = const { std::cell::RefCell::new(None) };
}

fn query() -> Option<Recycle> {
    let mut info = SHQUERYRBINFO { cbSize: size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) }.ok()?;
    Some(Recycle { items: info.i64NumItems, bytes: info.i64Size })
}

/// A count worth sending: a new one. A failed read keeps what the bar shows.
fn changed(prev: Option<Recycle>, now: Option<Recycle>) -> bool {
    now.is_some() && prev != now
}

/// Read `seq`'s count `now` into `last`: whether the bar is sent it. A read older than one already in changes nothing, as a failed
/// one: a big bin counts slowly, so while it empties a read begun earlier can end after the newer one that found it empty.
fn take(last: &mut (u64, Option<Recycle>), seq: u64, now: Option<Recycle>) -> bool {
    if seq < last.0 {
        return false;
    }
    last.0 = seq;
    if !changed(last.1, now) {
        return false;
    }
    last.1 = now;
    true
}

fn refresh(app: &AppHandle) {
    // Numbered before the count, which is what takes long.
    let seq = READS.fetch_add(1, Ordering::SeqCst) + 1;
    let now = query();
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if take(&mut last, seq, now) {
        let _ = app.emit_to(bar::LABEL, "taskbar://recycle", now);
    }
}

/// Asks the shell for the bin's change notices, sent to `window`: the registration's id, 0 when the shell refuses.
fn register(window: HWND, pidl: *mut ITEMIDLIST) -> u32 {
    let entry = SHChangeNotifyEntry { pidl, fRecursive: true.into() };
    let sources = SHCNRF_ShellLevel | SHCNRF_InterruptLevel | SHCNRF_NewDelivery;
    let id = unsafe { SHChangeNotifyRegister(window, sources, SHCNE_ALLEVENTS.0 as i32, RECYCLE_MSG, 1, &entry) };
    if id == 0 {
        eprintln!("taskbar: no Recycle Bin notifications");
    }
    id
}

/// Watches the bin from the taskbar thread's window; without the registration the button keeps the count it has.
fn watch_bin(window: HWND) {
    if let Ok(pidl) = unsafe { SHGetKnownFolderIDList(&FOLDERID_RecycleBinFolder, 0, None) } {
        WATCH.set((register(window, pidl), pidl as usize));
    }
}

pub(super) fn begin(app: AppHandle, window: HWND) {
    watch_bin(window);
    APP.set(Some(app.clone()));
    std::thread::spawn(move || refresh(&app));
}

/// Explorer restarted (TaskbarCreated, mod.rs). The bin's watch lived in the old Explorer, so the new one is asked for it again (or for
/// the first time, when Explorer was not ready as the bar started), and the bin is read again, as it may have changed meanwhile (#107).
pub(super) fn renew(window: HWND) {
    let (id, pidl) = WATCH.get();
    if id != 0 {
        let _ = unsafe { SHChangeNotifyDeregister(id) };
    }
    if pidl == 0 {
        watch_bin(window);
    } else {
        WATCH.set((register(window, pidl as *mut ITEMIDLIST), pidl));
    }
    arm(window);
}

/// One read 300 ms from now, unless one is on its way already: a burst of notices makes a single read.
fn arm(window: HWND) {
    if !ARMED.get() {
        ARMED.set(unsafe { SetTimer(Some(window), RECYCLE_TIMER, RECYCLE_MS, None) } != 0);
    }
}

/// Stops watching the bin: the registration, the bin's pidl and a read still to come.
fn unwatch(window: HWND) {
    let (id, pidl) = WATCH.replace((0, 0));
    unsafe {
        if id != 0 {
            let _ = SHChangeNotifyDeregister(id);
        }
        if pidl != 0 {
            ILFree(Some(pidl as *const ITEMIDLIST));
        }
        let _ = KillTimer(Some(window), RECYCLE_TIMER);
    }
    ARMED.set(false);
}

pub(super) fn end(window: HWND) {
    unwatch(window);
    APP.set(None);
    // The bin may change while the bar is off: the next bar's first ask reads it again.
    LAST.lock().unwrap_or_else(|e| e.into_inner()).1 = None;
}

pub(super) fn on_notify(window: HWND, wparam: WPARAM, lparam: LPARAM) {
    unsafe {
        // NewDelivery hands over shared memory that must be locked and unlocked, whatever the event.
        let mut pidls: *mut *mut ITEMIDLIST = std::ptr::null_mut();
        let mut event = 0i32;
        let lock = SHChangeNotification_Lock(HANDLE(wparam.0 as _), lparam.0 as u32, Some(&mut pidls), Some(&mut event));
        if !lock.is_invalid() {
            let _ = SHChangeNotification_Unlock(lock);
        }
    }
    arm(window);
}

pub(super) fn on_timer(window: HWND) {
    let _ = unsafe { KillTimer(Some(window), RECYCLE_TIMER) };
    ARMED.set(false);
    // A big bin takes long to count: never on the taskbar thread.
    if let Some(app) = APP.with_borrow(|a| a.clone()) {
        std::thread::spawn(move || refresh(&app));
    }
}

/// The bin's count: the last one read, or with `fresh` (the panel opening) read again first, so the panel shows what is in the bin
/// even when no notice came (#107); a new count also reaches the button.
#[tauri::command]
pub async fn taskbar_recycle(app: AppHandle, fresh: Option<bool>) -> Option<Recycle> {
    if fresh == Some(true) {
        let _ = tauri::async_runtime::spawn_blocking(move || refresh(&app)).await;
    }
    let last = LAST.lock().unwrap_or_else(|e| e.into_inner()).1;
    match last {
        Some(r) => Some(r),
        None => tauri::async_runtime::spawn_blocking(query).await.ok().flatten(),
    }
}

#[derive(PartialEq, Debug)]
enum Act {
    Open,
    Empty,
}

fn recycle_action(s: &str) -> Option<Act> {
    match s {
        "open" => Some(Act::Open),
        "empty" => Some(Act::Empty),
        _ => None,
    }
}

/// Opens the bin in Explorer, or empties it through Windows' own call, which the red button of Crest's panel alone asks for.
#[tauri::command]
pub async fn taskbar_recycle_do(window: WebviewWindow, app: AppHandle, action: String) -> Result<(), String> {
    bar::from_bar(&window)?;
    match recycle_action(&action).ok_or("unknown")? {
        Act::Open => crate::open_url("shell:RecycleBinFolder"),
        Act::Empty => {
            let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
            let _ = tauri::async_runtime::spawn_blocking(move || {
                // Cancelled or already empty come back as errors: nothing to report.
                let _ = unsafe { SHEmptyRecycleBinW(Some(HWND(owner as _)), PCWSTR::null(), EMPTY_FLAGS) };
                refresh(&app);
            })
            .await;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bin_empties_without_windows_asking_again() {
        use windows::Win32::UI::Shell::{SHERB_NOCONFIRMATION, SHERB_NOPROGRESSUI, SHERB_NOSOUND};
        assert_eq!(EMPTY_FLAGS, SHERB_NOCONFIRMATION);
        // Windows' progress and sound stay.
        assert_eq!(EMPTY_FLAGS & (SHERB_NOPROGRESSUI | SHERB_NOSOUND), 0);
    }

    #[test]
    fn actions_and_changes() {
        assert_eq!(recycle_action("open"), Some(Act::Open));
        assert_eq!(recycle_action("empty"), Some(Act::Empty));
        assert_eq!(recycle_action("rm"), None);
        assert_eq!(recycle_action(""), None);
        let a = Recycle { items: 2, bytes: 10 };
        assert!(!changed(None, None));
        assert!(!changed(Some(a), Some(a)));
        assert!(changed(None, Some(a)));
        assert!(!changed(Some(a), None));
    }

    #[test]
    fn a_count_that_ends_after_a_newer_one_stays_off_the_button() {
        let full = Recycle { items: 4000, bytes: 9_000_000 };
        let empty = Recycle { items: 0, bytes: 0 };
        let mut last = (0, Some(full));
        // Read 2 began after the bin emptied and ends first; read 1, begun on the full bin, ends after it.
        assert!(take(&mut last, 2, Some(empty)));
        assert!(!take(&mut last, 1, Some(full)));
        assert_eq!(last, (2, Some(empty)));
        // A newer read that finds the same count, or fails, sends nothing, and still keeps an older one out.
        assert!(!take(&mut last, 3, Some(empty)));
        assert!(!take(&mut last, 4, None));
        assert!(!take(&mut last, 3, Some(full)));
        assert_eq!(last, (4, Some(empty)));
        assert!(take(&mut last, 5, Some(full)));
    }

    #[test]
    fn a_restarted_explorer_gets_the_bins_watch_again() {
        // The bin's watch is kept by Explorer: a new Explorer knows none, so the bar renews it as Explorer announces its new
        // taskbar (#107), with the appbars and the shell hook.
        let bar = include_str!("mod.rs");
        let created = bar.split("msg == TASKBAR_CREATED.load").nth(1).expect("the TaskbarCreated handler");
        let handler = &created[..created.find("return LRESULT(0);").expect("its end")];
        assert!(handler.contains("recycle::renew(hwnd)"), "TaskbarCreated does not renew the Recycle Bin's watch");
    }

    #[test]
    #[ignore = "registers with the running shell"]
    fn renewing_watches_the_bin_again_and_reads_it() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE};
        unsafe {
            let window = CreateWindowExW(WINDOW_EX_STYLE(0), w!("STATIC"), PCWSTR::null(), WINDOW_STYLE(0), 0, 0, 0, 0, Some(HWND_MESSAGE), None, None, None)
                .expect("a message window");
            watch_bin(window);
            let (first, pidl) = WATCH.get();
            assert!(first != 0 && pidl != 0, "the shell refused the first watch");
            renew(window);
            let (second, kept) = WATCH.get();
            assert!(second != 0 && second != first, "no new watch");
            assert_eq!(kept, pidl);
            // The bin may have changed while no one watched it: a read follows.
            assert!(ARMED.get(), "no read after the renewal");
            // Not end(): it drops the app's handle, which would link Tauri's windows, and with them a call the test binary,
            // without Crest's manifest, cannot load.
            unwatch(window);
            let _ = DestroyWindow(window);
        }
    }
}
