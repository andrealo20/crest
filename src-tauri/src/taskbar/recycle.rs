//! The Recycle Bin's button on the bar: how many items it holds, from Windows' own count, read again when the shell reports a
//! change in the bin (one read 300 ms after the last of a burst, off the taskbar thread). Opening it goes through Explorer, and
//! emptying it through Windows' own call with its confirmation, so nothing is deleted without the user saying yes there.

use std::cell::Cell;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, WPARAM};
use windows::Win32::UI::Shell::Common::ITEMIDLIST;
use windows::Win32::UI::Shell::{
    FOLDERID_RecycleBinFolder, ILFree, SHChangeNotification_Lock, SHChangeNotification_Unlock, SHChangeNotifyDeregister, SHChangeNotifyEntry,
    SHChangeNotifyRegister, SHEmptyRecycleBinW, SHGetKnownFolderIDList, SHQueryRecycleBinW, SHCNE_ALLEVENTS, SHCNRF_InterruptLevel, SHCNRF_NewDelivery,
    SHCNRF_ShellLevel, SHQUERYRBINFO,
};
use windows::Win32::UI::WindowsAndMessaging::{KillTimer, SetTimer, WM_APP};

use super::bar;

/// The shell's change notification for the bin, on the taskbar thread's window.
pub(super) const RECYCLE_MSG: u32 = WM_APP + 4;
/// The one-shot timer that turns a burst of notifications into one read.
pub(super) const RECYCLE_TIMER: usize = 4;
const RECYCLE_MS: u32 = 300;

#[derive(Serialize, Clone, Copy, PartialEq, Debug)]
pub struct Recycle {
    items: i64,
    bytes: i64,
}

/// The last count the bar was sent.
static LAST: Mutex<Option<Recycle>> = Mutex::new(None);

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

fn refresh(app: &AppHandle) {
    let now = query();
    let mut last = LAST.lock().unwrap_or_else(|e| e.into_inner());
    if changed(*last, now) {
        *last = now;
        let _ = app.emit_to(bar::LABEL, "taskbar://recycle", now);
    }
}

/// Watches the bin from the taskbar thread's window; without the registration the button keeps its first count.
pub(super) fn begin(app: AppHandle, window: HWND) {
    unsafe {
        if let Ok(pidl) = SHGetKnownFolderIDList(&FOLDERID_RecycleBinFolder, 0, None) {
            let entry = SHChangeNotifyEntry { pidl, fRecursive: true.into() };
            let sources = SHCNRF_ShellLevel | SHCNRF_InterruptLevel | SHCNRF_NewDelivery;
            let id = SHChangeNotifyRegister(window, sources, SHCNE_ALLEVENTS.0 as i32, RECYCLE_MSG, 1, &entry);
            if id == 0 {
                eprintln!("taskbar: no Recycle Bin notifications");
            }
            WATCH.set((id, pidl as usize));
        }
    }
    APP.set(Some(app.clone()));
    std::thread::spawn(move || refresh(&app));
}

pub(super) fn end(window: HWND) {
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
    APP.set(None);
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
        if !ARMED.get() {
            ARMED.set(SetTimer(Some(window), RECYCLE_TIMER, RECYCLE_MS, None) != 0);
        }
    }
}

pub(super) fn on_timer(window: HWND) {
    let _ = unsafe { KillTimer(Some(window), RECYCLE_TIMER) };
    ARMED.set(false);
    // A big bin takes long to count: never on the taskbar thread.
    if let Some(app) = APP.with_borrow(|a| a.clone()) {
        std::thread::spawn(move || refresh(&app));
    }
}

#[tauri::command]
pub async fn taskbar_recycle() -> Option<Recycle> {
    let last = *LAST.lock().unwrap_or_else(|e| e.into_inner());
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

/// Opens the bin in Explorer, or empties it through Windows' own call: flags 0 keep its confirmation, progress and sound.
#[tauri::command]
pub async fn taskbar_recycle_do(window: WebviewWindow, app: AppHandle, action: String) -> Result<(), String> {
    bar::from_bar(&window)?;
    match recycle_action(&action).ok_or("unknown")? {
        Act::Open => crate::open_url("shell:RecycleBinFolder"),
        Act::Empty => {
            let owner = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
            let _ = tauri::async_runtime::spawn_blocking(move || {
                // Cancelled or already empty come back as errors: nothing to report.
                let _ = unsafe { SHEmptyRecycleBinW(Some(HWND(owner as _)), PCWSTR::null(), 0) };
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
}
