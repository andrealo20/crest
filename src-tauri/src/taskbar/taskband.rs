// Adapted from ManagedShell (Apache-2.0, github.com/cairoshell/ManagedShell), src/ManagedShell.WindowsTasks/TasksService.cs and ApplicationWindow.cs (the TaskbandHWND property, the taskbar list's message numbers, the progress and overlay payloads and the TaskbarButtonCreated broadcast).

//! The badges and progress apps report to the taskbar. An app's `ITaskbarList3` finds the first `Shell_TrayWnd`, reads its
//! window property `TaskbandHWND` and sends `WM_USER+n` to that window. While the tray's spy (tray.rs) is that first window, it
//! carries the property, pointing at the proxy, a hidden child of the spy: the proxy keeps the progress and the overlay icon with
//! its text, then passes the very same message on to Explorer's own taskband (`MSTaskSwWClass`, the `TaskbandHWND` of
//! Explorer's `Shell_TrayWnd`) and returns its answer, so Windows' taskbar stays current for when it shows again. This is not a
//! documented API: whatever fails here fails silently and the message still goes on. Explorer's own property is never touched,
//! so a Crest that ends however it ends leaves Windows as it was. Nothing is written to disk.
//!
//! Runs on the spy's thread, with tray.rs' rules: it never waits on the main thread, every forward is capped at
//! `tray::FORWARD_MS`, an icon becomes a PNG only in the proxy's timer, when no app waits, and `DECOR` is held only for short
//! reads and writes, never across a send, an emit or a conversion.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, MutexGuard, Once, OnceLock};

use serde::Serialize;
use tauri::Emitter;
use windows::core::w;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Shell::{SHLockShared, SHUnlockShared};
use windows::Win32::UI::WindowsAndMessaging::{
    ChangeWindowMessageFilterEx, CopyIcon, CreateWindowExW, DefWindowProcW, DestroyWindow, GetPropW, KillTimer, RegisterClassW, RegisterWindowMessageW,
    RemovePropW, SendNotifyMessageW, SetPropW, SetTimer, HICON, MSGFLT_ALLOW, WM_CLOSE, WM_TIMER, WM_USER, WNDCLASSW, WS_CHILD, WS_EX_TOOLWINDOW,
};

use super::tray::{self, Copied};
use super::{explorer, tasks};
use crate::display::{class_name, top_windows, window_pid};
use crate::mixer;

/// The one-shot wait from a change to the bars hearing it, as the tray's.
const DECOR_TIMER: usize = 1;
const DECOR_MS: u32 = 250;
/// Windows that went without clearing their badge leave this often.
const SWEEP_TIMER: usize = 2;
const SWEEP_MS: u32 = 2000;
/// The longest overlay text kept, in UTF-16 units.
const TIP_UNITS: usize = 260;
/// The first registered message number.
const REGISTERED: u32 = 0xC000;

/// The proxy window, 0 while there is none.
static PROXY: AtomicIsize = AtomicIsize::new(0);
static CLASS: Once = Once::new();
static DECOR: Mutex<Store> = Mutex::new(Store { entries: Vec::new(), images: BTreeMap::new(), sent: Vec::new() });

thread_local! {
    /// Overlay icons copied in a handler, by window, made into PNGs at the next `DECOR_TIMER`.
    static PENDING: RefCell<Vec<(isize, Copied)>> = const { RefCell::new(Vec::new()) };
    /// `DECOR_TIMER` is set.
    static ARMED: Cell<bool> = const { Cell::new(false) };
}

struct Store {
    entries: Vec<Entry>,
    /// PNGs by `tray::png_key`, the `overlay` of the entries that show them.
    images: BTreeMap<String, Vec<u8>>,
    sent: Vec<Decor>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum State {
    Normal,
    Paused,
    Error,
    Indeterminate,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            State::Normal => "normal",
            State::Paused => "paused",
            State::Error => "error",
            State::Indeterminate => "indeterminate",
        }
    }
}

/// What one window reported, with the process it had then.
struct Entry {
    hwnd: isize,
    pid: u32,
    progress: Option<(State, f64)>,
    overlay: Option<String>,
    tip: String,
}

/// A window's decorations as the bars get them (`taskbar://decor`): `overlay` keys a picture (`taskbar_decor_images`).
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Decor {
    id: isize,
    progress: Option<Progress>,
    overlay: Option<String>,
    tip: String,
}

/// `state`: "normal", "paused", "error" or "indeterminate"; `value` from 0 to 1.
#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Progress {
    state: &'static str,
    value: f64,
}

/// What the proxy does with a message.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Op {
    /// `SetProgressValue`: wParam the window, lParam the value scaled to 0..0xFFFE.
    Progress,
    /// `SetProgressState`: lParam a `TBPFLAG`.
    ProgressState,
    /// `SetOverlayIcon`'s icon: lParam an `HICON`, 0 removes the overlay.
    OverlayIcon,
    /// `SetOverlayIcon`'s text: lParam a shared block with a UTF-16 string.
    OverlayTip,
    /// Everything else in the range, unknown messages included: only passed on.
    Forward,
}

fn decor() -> MutexGuard<'static, Store> {
    DECOR.lock().unwrap_or_else(|e| e.into_inner())
}

/// The op of a message in the taskbar list's range, None outside it.
fn decode(msg: u32) -> Option<Op> {
    if !(WM_USER..REGISTERED).contains(&msg) {
        return None;
    }
    Some(match msg - WM_USER {
        64 => Op::Progress,
        65 => Op::ProgressState,
        79 => Op::OverlayIcon,
        85 => Op::OverlayTip,
        _ => Op::Forward,
    })
}

/// Whether the proxy passes `msg` on: the taskbar list's range, or the shell hook message (`AddTab`, `DeleteTab`).
fn forwards(msg: u32, shellhook: u32) -> bool {
    (WM_USER..REGISTERED).contains(&msg) || (shellhook != 0 && msg == shellhook)
}

/// The progress value as a fraction: 16 bits over `0xFFFE`, clamped.
fn fraction(raw: isize) -> f64 {
    ((raw as u32 & 0xFFFF) as f64 / 0xFFFE as f64).clamp(0.0, 1.0)
}

/// `TBPF_NOPROGRESS` (0) clears, a known flag sets the state and keeps the value, an unknown one keeps what is there.
fn apply_state(p: &mut Option<(State, f64)>, flag: isize) {
    let value = p.map_or(0.0, |(_, v)| v);
    let state = match flag {
        0 => {
            *p = None;
            return;
        }
        1 => State::Indeterminate,
        2 => State::Normal,
        4 => State::Error,
        8 => State::Paused,
        _ => return,
    };
    *p = Some((state, value));
}

/// A value with no progress or an indeterminate one turns it normal, as `ITaskbarList3::SetProgressValue` documents.
fn apply_value(p: &mut Option<(State, f64)>, raw: isize) {
    let state = match *p {
        None | Some((State::Indeterminate, _)) => State::Normal,
        Some((s, _)) => s,
    };
    *p = Some((state, fraction(raw)));
}

/// Entries whose window is no more, or now has another process, leave, and so do those with nothing left.
fn keep_live(entries: &mut Vec<Entry>, alive: impl Fn(isize, u32) -> bool) {
    entries.retain(|e| alive(e.hwnd, e.pid) && (e.progress.is_some() || e.overlay.is_some() || !e.tip.is_empty()));
}

/// What the bars get: only the windows with a progress or an overlay to show.
fn listed(entries: &[Entry]) -> Vec<Decor> {
    let shown = entries.iter().filter(|e| e.progress.is_some() || e.overlay.is_some());
    shown
        .map(|e| Decor {
            id: e.hwnd,
            progress: e.progress.map(|(s, value)| Progress { state: s.name(), value }),
            overlay: e.overlay.clone(),
            tip: e.tip.clone(),
        })
        .collect()
}

/// A window handle from wParam: 32 significant bits widened with their sign, as `tray::handle`.
fn handle(v: usize) -> isize {
    v as u32 as i32 as isize
}

fn shellhook() -> u32 {
    static HOOK: OnceLock<u32> = OnceLock::new();
    *HOOK.get_or_init(|| unsafe { RegisterWindowMessageW(w!("SHELLHOOK")) })
}

/// The proxy and the property on the spy (tray.rs `appear`). Any failure leaves no proxy and no property.
pub(super) unsafe fn appear(spy: HWND) {
    if PROXY.load(Ordering::SeqCst) != 0 {
        return;
    }
    let Some(proxy) = (unsafe { window(spy) }) else { return };
    unsafe {
        // Low-integrity apps (a sandboxed browser) reach it too, as they reach Explorer's.
        let hook = shellhook();
        for m in (WM_USER + 50..=WM_USER + 90).chain((hook != 0).then_some(hook)) {
            let _ = ChangeWindowMessageFilterEx(proxy, m, MSGFLT_ALLOW, None);
        }
        if let Err(e) = SetPropW(spy, w!("TaskbandHWND"), Some(HANDLE(proxy.0))) {
            eprintln!("taskband: property failed: {e}");
            let _ = DestroyWindow(proxy);
            return;
        }
        PROXY.store(proxy.0 as isize, Ordering::SeqCst);
        let _ = SetTimer(Some(proxy), SWEEP_TIMER, SWEEP_MS, None);
    }
}

/// The property and the proxy go, with every decoration: the bars hear so (tray.rs `vanish`, before the spy goes).
pub(super) unsafe fn vanish(spy: HWND) {
    let proxy = PROXY.swap(0, Ordering::SeqCst);
    if proxy == 0 {
        return;
    }
    unsafe {
        let _ = RemovePropW(spy, w!("TaskbandHWND"));
        let _ = DestroyWindow(HWND(proxy as _));
    }
    ARMED.set(false);
    // Each copy destroys its icon as it is dropped.
    PENDING.take();
    {
        let mut store = decor();
        store.entries.clear();
        store.images.clear();
    }
    publish();
}

/// Apps that hear this report their progress and overlay again, now through the spy (tray.rs `keep_first`, once the spy is first
/// for an Explorer tray). A notify to each window with a button: no wait on any app.
pub(super) fn announce_buttons() {
    if PROXY.load(Ordering::SeqCst) != 0 {
        tell_buttons();
    }
}

/// The same notify once the spy is gone (tray.rs `vanish`): apps report again to Explorer, whose copy of a block made for Crest
/// (thumbnail buttons, tooltips, the overlay's text) may have been lost on the way.
pub(super) fn tell_buttons() {
    let msg = unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) };
    if msg == 0 {
        return;
    }
    let own = std::process::id();
    for hwnd in top_windows().into_iter().filter(|&hwnd| tasks::listable(hwnd, own)) {
        let _ = unsafe { SendNotifyMessageW(hwnd, msg, WPARAM(0), LPARAM(0)) };
    }
}

unsafe fn window(spy: HWND) -> Option<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        CLASS.call_once(|| {
            let class = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: instance.into(), lpszClassName: w!("CrestTaskband"), ..Default::default() };
            if RegisterClassW(&class) == 0 {
                eprintln!("taskband: window class failed: {}", windows::core::Error::from_thread());
            }
        });
        CreateWindowExW(WS_EX_TOOLWINDOW, w!("CrestTaskband"), w!(""), WS_CHILD, 0, 0, 0, 0, Some(spy), None, Some(instance.into()), None)
            .inspect_err(|e| eprintln!("taskband: window failed: {e}"))
            .ok()
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_TIMER && matches!(wparam.0, DECOR_TIMER | SWEEP_TIMER) {
        if wparam.0 == DECOR_TIMER {
            let _ = unsafe { KillTimer(Some(hwnd), DECOR_TIMER) };
            ARMED.set(false);
        }
        flush();
        return LRESULT(0);
    }
    let hook = shellhook();
    if forwards(msg, hook) {
        if msg != hook {
            // Before the forward, while the app still waits in its SendMessage and its icon and shared block are alive.
            unsafe { read(hwnd, decode(msg).unwrap_or(Op::Forward), wparam, lparam) };
        }
        let answer = forward(msg, wparam, lparam);
        // `DeleteTab` and `AddTab` change `ITaskList_Deleted` without any WinEvent (tasks.rs `eligible`).
        if msg == hook {
            super::relist();
        }
        return answer;
    }
    // Only `vanish` ends the window, as the spy's.
    if msg == WM_CLOSE {
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// Keeps what Crest shows of a message, for a window that is still there.
unsafe fn read(proxy: HWND, op: Op, wparam: WPARAM, lparam: LPARAM) {
    if op == Op::Forward {
        return;
    }
    let id = handle(wparam.0);
    let pid = window_pid(HWND(id as _));
    if pid == 0 {
        return;
    }
    // Read before the lock: a shared block is mapped from another process. Never for a sender below medium integrity, which
    // could name a section of Crest's own and have it shown.
    let tip = match op {
        Op::OverlayTip if crate::notify_wire::pid_token(pid).is_some_and(|(_, level)| level >= 0x2000) => {
            Some(unsafe { shared_tip(lparam.0, [std::process::id(), pid]) }.unwrap_or_default())
        }
        Op::OverlayTip => Some(String::new()),
        _ => None,
    };
    let icon = handle(lparam.0 as usize);
    if op == Op::OverlayIcon && icon != 0 {
        // The app may destroy its icon once its call returns; a copy that fails leaves the picture there is.
        let Ok(copy) = (unsafe { CopyIcon(HICON(icon as _)) }) else { return };
        PENDING.with_borrow_mut(|p| p.push((id, Copied(copy))));
    }
    {
        let mut store = decor();
        let at = match store.entries.iter().position(|e| e.hwnd == id) {
            // A handle reused by another process starts afresh.
            Some(at) if store.entries[at].pid != pid => {
                store.entries[at] = Entry { hwnd: id, pid, progress: None, overlay: None, tip: String::new() };
                at
            }
            Some(at) => at,
            None => {
                store.entries.push(Entry { hwnd: id, pid, progress: None, overlay: None, tip: String::new() });
                store.entries.len() - 1
            }
        };
        let e = &mut store.entries[at];
        match op {
            Op::Progress => apply_value(&mut e.progress, lparam.0),
            Op::ProgressState => apply_state(&mut e.progress, lparam.0),
            Op::OverlayTip => e.tip = tip.unwrap_or_default(),
            Op::OverlayIcon if icon == 0 => {
                e.overlay = None;
                e.tip.clear();
                PENDING.with_borrow_mut(|p| p.retain(|(w, _)| *w != id));
            }
            _ => {}
        }
    }
    arm(proxy);
}

/// The string in a shared block, cut at `TIP_UNITS`: mapped for each process of `pids` in turn (Crest's, as the app makes the
/// block for the process of the `TaskbandHWND` it found, then the sender's),
/// the first that maps it wins. A view is at least a page, so the read stays inside it.
unsafe fn shared_tip(block: isize, pids: [u32; 2]) -> Option<String> {
    if block == 0 {
        return Some(String::new());
    }
    pids.into_iter().find_map(|pid| unsafe {
        let view = SHLockShared(HANDLE(block as _), pid);
        if view.is_null() {
            return None;
        }
        let units = std::slice::from_raw_parts(view as *const u16, TIP_UNITS);
        let tip = String::from_utf16_lossy(&units[..units.iter().position(|&u| u == 0).unwrap_or(TIP_UNITS)]);
        let _ = SHUnlockShared(view);
        Some(tip)
    })
}

/// Explorer's taskband: the `TaskbandHWND` of Explorer's own `Shell_TrayWnd`, only a `MSTaskSwWClass` of the shell's process.
/// Looked up for each message, so a restarted Explorer is followed.
fn target() -> Option<HWND> {
    let tray = explorer::explorer_tray()?;
    let band = HWND(unsafe { GetPropW(tray, w!("TaskbandHWND")) }.0);
    (!band.is_invalid() && window_pid(band) == explorer::shell_pid() && class_name(band) == "MSTaskSwWClass").then_some(band)
}

/// Explorer's answer, 0 without one, what ManagedShell returns for everything.
fn forward(msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    LRESULT(target().and_then(|to| tray::send(to, msg, wparam, lparam, false)).unwrap_or(0))
}

fn arm(proxy: HWND) {
    if !ARMED.replace(true) && unsafe { SetTimer(Some(proxy), DECOR_TIMER, DECOR_MS, None) } == 0 {
        ARMED.set(false);
    }
}

/// In the proxy's timers: the latest icon of each window becomes its overlay's PNG, windows gone leave, then the bars hear.
fn flush() {
    // A window's later copy replaces its earlier one, which is dropped and destroyed here.
    let latest: HashMap<isize, Copied> = PENDING.take().into_iter().collect();
    let pngs: Vec<(isize, Vec<u8>)> = latest.into_iter().filter_map(|(id, icon)| unsafe { mixer::icon_to_png(icon.0) }.map(|png| (id, png))).collect();
    {
        let mut guard = decor();
        let store = &mut *guard;
        for (id, png) in pngs {
            if let Some(e) = store.entries.iter_mut().find(|e| e.hwnd == id) {
                let key = tray::png_key(&png);
                store.images.entry(key.clone()).or_insert(png);
                e.overlay = Some(key);
            }
        }
        keep_live(&mut store.entries, |id, pid| window_pid(HWND(id as _)) == pid);
        let entries = &store.entries;
        store.images.retain(|key, _| entries.iter().any(|e| e.overlay.as_ref() == Some(key)));
    }
    publish();
}

/// Every bar hears the decorations when they differ from what they last heard. On the spy's thread only, after the lock.
fn publish() {
    let Some(app) = tray::APP.get() else { return };
    let list = {
        let mut store = decor();
        let now = listed(&store.entries);
        if store.sent == now {
            return;
        }
        store.sent = now.clone();
        now
    };
    for (label, _) in super::screens::all() {
        let _ = app.emit_to(label, "taskbar://decor", &list);
    }
}

/// The decorations for a bar page that has just loaded; `taskbar://decor` brings each change.
#[tauri::command]
pub fn taskbar_decor() -> Vec<Decor> {
    decor().sent.clone()
}

/// The overlays' pictures by their key, as PNG data URLs; None for a key no window shows any more.
#[tauri::command]
pub async fn taskbar_decor_images(keys: Vec<String>) -> HashMap<String, Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let found: Vec<(String, Option<Vec<u8>>)> = {
            let store = decor();
            keys.into_iter().map(|key| (key.clone(), store.images.get(&key).cloned())).collect()
        };
        found.into_iter().map(|(key, png)| (key, png.map(tray::data_url))).collect()
    })
    .await
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(hwnd: isize, progress: Option<(State, f64)>, overlay: Option<&str>) -> Entry {
        Entry { hwnd, pid: 10, progress, overlay: overlay.map(Into::into), tip: String::new() }
    }

    #[test]
    fn decodes_the_taskbar_list_messages() {
        assert_eq!(decode(WM_USER + 64), Some(Op::Progress));
        assert_eq!(decode(WM_USER + 65), Some(Op::ProgressState));
        assert_eq!(decode(WM_USER + 79), Some(Op::OverlayIcon));
        assert_eq!(decode(WM_USER + 85), Some(Op::OverlayTip));
        for n in [50, 76, 78, 80, 81, 99] {
            assert_eq!(decode(WM_USER + n), Some(Op::Forward));
        }
        assert_eq!(decode(WM_USER - 1), None);
        assert_eq!(decode(0xC000), None);
    }

    #[test]
    fn only_taskband_traffic_is_forwarded() {
        assert!(forwards(WM_USER + 64, 0xC123) && forwards(0xC123, 0xC123));
        assert!(!forwards(WM_TIMER, 0xC123) && !forwards(0xC124, 0xC123));
        // A shell hook message that could not be registered matches nothing, WM_NULL least of all.
        assert!(!forwards(0, 0));
    }

    #[test]
    fn progress_scales_to_a_fraction() {
        assert_eq!(fraction(0), 0.0);
        assert!((fraction(0x7FFF) - 0.5).abs() < 0.001);
        assert_eq!(fraction(0xFFFE), 1.0);
        assert_eq!(fraction(0xFFFF), 1.0);
    }

    #[test]
    fn a_value_turns_no_progress_into_normal() {
        let mut p = None;
        apply_value(&mut p, 0xFFFE);
        assert_eq!(p, Some((State::Normal, 1.0)));
        let mut p = Some((State::Indeterminate, 0.0));
        apply_value(&mut p, 0);
        assert_eq!(p, Some((State::Normal, 0.0)));
        for s in [State::Paused, State::Error] {
            let mut p = Some((s, 0.0));
            apply_value(&mut p, 0xFFFE);
            assert_eq!(p, Some((s, 1.0)));
        }
    }

    #[test]
    fn a_state_keeps_the_value_and_no_progress_clears_it() {
        let mut p = Some((State::Normal, 0.4));
        apply_state(&mut p, 8);
        assert_eq!(p, Some((State::Paused, 0.4)));
        apply_state(&mut p, 4);
        assert_eq!(p, Some((State::Error, 0.4)));
        // An unknown flag keeps what is there.
        apply_state(&mut p, 0x40);
        assert_eq!(p, Some((State::Error, 0.4)));
        apply_state(&mut p, 0);
        assert_eq!(p, None);
        apply_state(&mut p, 1);
        assert_eq!(p, Some((State::Indeterminate, 0.0)));
    }

    #[test]
    fn gone_and_empty_entries_leave_and_only_shown_ones_are_listed() {
        let mut entries = vec![
            entry(1, Some((State::Normal, 0.5)), None),
            entry(2, None, Some("k")),
            entry(3, None, None),
            Entry { tip: "3 unread".into(), ..entry(4, None, None) },
        ];
        // Window 2's handle now belongs to another process.
        keep_live(&mut entries, |hwnd, pid| hwnd != 2 && pid == 10);
        assert_eq!(entries.iter().map(|e| e.hwnd).collect::<Vec<_>>(), [1, 4]);
        // A text waiting for its icon is kept but not listed.
        let list = listed(&entries);
        assert_eq!(list, [Decor { id: 1, progress: Some(Progress { state: "normal", value: 0.5 }), overlay: None, tip: String::new() }]);
    }

    #[test]
    fn a_handle_from_wparam_keeps_32_bits_with_their_sign() {
        assert_eq!(handle(0x1234), 0x1234);
        assert_eq!(handle(0xFFFF_FFFF_8000_0000), -0x8000_0000);
        assert_eq!(handle(0x1_0000_1234), 0x1234);
    }
}
