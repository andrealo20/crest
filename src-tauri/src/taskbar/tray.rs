// Adapted from ManagedShell (Apache-2.0, github.com/cairoshell/ManagedShell), src/ManagedShell.WindowsTray/TrayService.cs, NotificationArea.cs and NotifyIcon.cs and src/ManagedShell.AppBar/AppBarManager.cs (the tray window, forwarding to Explorer, the icon list, the clicks and the appbar shared memory).

//! The tray's spy: a hidden window of the class `Shell_TrayWnd` on a thread of its own, kept ahead of Explorer's, so what apps
//! send to the tray (`Shell_NotifyIcon`, `SHAppBarMessage`, in `WM_COPYDATA`) reaches Crest first. Every message goes on to
//! Explorer's own `Shell_TrayWnd`, found by the shell's process, and Explorer's answer goes back to the app: Explorer keeps every
//! icon, so nothing needs giving back however Crest ends. Only the icon position request is Crest's to answer. Another program's
//! own `Shell_TrayWnd` (lumabar, say) does not take the tray from Crest: the spy stays first, and each icon message also goes on
//! to every such window (`others`), so that program keeps its icons as well: a WM_COPYDATA cannot be posted to another process,
//! so each copy waits on that program at most `FORWARD_MS` as a forward to Explorer does, and its answer is dropped. The spy also carries
//! `TaskbandHWND`, so the badges and progress apps report to the taskbar pass Crest too (taskband.rs).
//!
//! A forward waits on Explorer at most `FORWARD_MS`, so no app waits long on a busy Explorer through Crest. Crest's own appbar
//! calls (explorer.rs, auto-hide) are the exception: they wait for Explorer's answer as they did before the spy.
//!
//! The icons that pass are kept for the bars (`apply`), all but Crest's own, with their pictures, which a worker thread makes
//! from a copy of each app's icon. The bars hear the list `EMIT_MS` after it changes, and a click on one reaches its app as from
//! Windows' tray (`taskbar_tray_click`). Without the spy's window there are no icons.
//!
//! The spy runs while a zone holds the tray (`taskbar_tray_on`) and the bar's thread runs (mod.rs). Its thread never waits on the
//! main thread, never takes explorer's lock and holds no lock across a forward, during which the messages sent to it run (an
//! appbar call made under explorer's lock among them). Other threads read its atomics, post to it and take the icons' lock
//! (`STORE`) for short reads and writes, never across a send, an emit or a picture's conversion.

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, HashMap};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Mutex, MutexGuard, Once, OnceLock};
use std::thread::JoinHandle;

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::core::w;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::System::DataExchange::COPYDATASTRUCT;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{SHAllocShared, SHFreeShared, SHLockShared, SHUnlockShared};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, ChangeWindowMessageFilterEx, CopyIcon, CreateWindowExW, DefWindowProcW, DestroyIcon, DestroyWindow, DispatchMessageW,
    FindWindowW, GetMessageW, GetWindowRect, IsWindow, KillTimer, PeekMessageW, PostMessageW, PostThreadMessageW, RegisterClassW,
    RegisterWindowMessageW, SendMessageTimeoutW, SendMessageW, SendNotifyMessageW, SetTimer, SetWindowPos, HICON, HWND_BROADCAST, HWND_TOPMOST,
    MSG, MSGFLT_ALLOW, PM_NOREMOVE, SEND_MESSAGE_TIMEOUT_FLAGS, SMTO_ABORTIFHUNG, SMTO_NORMAL, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WM_APP,
    WM_CLOSE, WM_COPYDATA, WM_TIMER, WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use super::{explorer, taskband};
use super::traywire::{self, Button, IconData, IconKey, IconOp, Msg, ABD_LEN};
use crate::display::window_pid;
use crate::hit_test::HitRect;
use crate::mixer;

/// A forward gives up after this: the app that called `Shell_NotifyIcon` waits for the answer.
pub(super) const FORWARD_MS: u32 = 500;
/// And at once when Explorer hangs.
pub(super) const FORWARD_FLAGS: SEND_MESSAGE_TIMEOUT_FLAGS = SEND_MESSAGE_TIMEOUT_FLAGS(SMTO_ABORTIFHUNG.0 | SMTO_NORMAL.0);
/// The window's check that it is still the first `Shell_TrayWnd`.
const FIRST_TIMER: usize = 1;
const FIRST_MS: u32 = 250;
/// While the spy has no window, the thread looks this often for whether it can have one.
const AGAIN_MS: u32 = 3000;
/// Posted to the thread by `stop`.
const STOP: u32 = WM_APP;
/// The one-shot wait from a change to the bars hearing it: changes meanwhile go with it, so an animated icon reaches the bars
/// at most this often.
const EMIT_TIMER: usize = 2;
const EMIT_MS: u32 = 250;
/// Icons whose window has gone without deleting them (an app that crashed) leave the list this often.
const SWEEP_TIMER: usize = 3;
const SWEEP_MS: u32 = 2000;
/// Posted as a `WM_TIMER` by the worker when a picture changed, as `raise` does: it arms `EMIT_TIMER` on the spy's thread, the
/// only one that may set its window's timers. A timer message is never forwarded (`traywire::forwards`).
const WAKE: usize = 4;

/// The thread's id and the thread, while it runs. Held through a start and a stop, so there is never a second spy.
static THREAD: Mutex<Option<(u32, JoinHandle<()>)>> = Mutex::new(None);
/// A zone of the bar holds the tray (`taskbar_tray_on`).
static WISH: AtomicBool = AtomicBool::new(false);
/// The spy's window, 0 while it has none.
static SPY: AtomicIsize = AtomicIsize::new(0);
/// The window class, registered once: a second `RegisterClassW` fails.
static CLASS: Once = Once::new();
/// For the spy's emits.
pub(super) static APP: OnceLock<AppHandle> = OnceLock::new();
/// The icons, their pictures, the rect last clicked and what the bars last heard.
static STORE: Mutex<Store> = Mutex::new(Store { icons: Vec::new(), images: BTreeMap::new(), clicked: None, sent: Vec::new() });
/// The menu a right click asked for: its app's process, the bar that sent the click and how many of the app's pop-up menus are
/// open. Set by `taskbar_tray_click`, taken by `on_menu` and `on_front` from the bar's thread (mod.rs) when the menu is over.
static MENU: Mutex<Option<Menu>> = Mutex::new(None);

struct Menu {
    owner: u32,
    bar: String,
    open: u32,
}

thread_local! {
    /// Explorer's tray the spy last announced itself to with `TaskbarCreated`, 0 for none.
    static ANNOUNCED: Cell<isize> = const { Cell::new(0) };
    /// `EMIT_TIMER` is set.
    static ARMED: Cell<bool> = const { Cell::new(false) };
    /// The worker's queue, while the spy's thread runs.
    static WORKER: RefCell<Option<Sender<(IconKey, Option<Copied>)>>> = const { RefCell::new(None) };
    /// The icon message being copied to another program's tray. The messages sent to the spy run while it waits, so a tray that
    /// passes icons on to the first `Shell_TrayWnd`, which the spy is, would hand each copy straight back, copied back again until
    /// the stack ran out. Only the same bytes are that echo: another app's message arriving meanwhile goes its way as usual.
    static COPYING: RefCell<Option<Vec<u8>>> = const { RefCell::new(None) };
}

struct Store {
    icons: Vec<Entry>,
    /// PNGs by a hash of their bytes, the `img` of the icons that show them.
    images: BTreeMap<String, Vec<u8>>,
    /// In physical screen px: the answer to the icon position request.
    clicked: Option<RECT>,
    sent: Vec<TrayIcon>,
}

/// An icon as the store keeps it.
struct Entry {
    key: IconKey,
    /// What the page knows it by (`traywire::identity`).
    id: String,
    owner_pid: u32,
    hwnd: u32,
    uid: u32,
    callback: u32,
    version: u32,
    tip: String,
    hidden: bool,
    img_key: Option<String>,
}

/// An icon on the list the bars get. `key` tells it apart from every other icon while it lives (clicks, the page's list); `id`
/// names it across restarts, for the choice to keep it visible, and two instances of one program can share it; `img` keys its
/// picture (`taskbar_tray_images`).
#[derive(Serialize, Clone, PartialEq)]
pub struct TrayIcon {
    id: String,
    key: String,
    tip: String,
    img: Option<String>,
}

/// The tray for the bars: no icons while the spy has no window.
#[derive(Serialize)]
pub struct TrayState {
    icons: Vec<TrayIcon>,
}

/// A copy of an app's icon, destroyed when dropped: on every path, converted, replaced by a newer one or left in a queue.
pub(super) struct Copied(pub(super) HICON);

// An icon handle is the window manager's, usable from any thread.
unsafe impl Send for Copied {}

impl Drop for Copied {
    fn drop(&mut self) {
        let _ = unsafe { DestroyIcon(self.0) };
    }
}

fn thread() -> MutexGuard<'static, Option<(u32, JoinHandle<()>)>> {
    THREAD.lock().unwrap_or_else(|e| e.into_inner())
}

fn store() -> MutexGuard<'static, Store> {
    STORE.lock().unwrap_or_else(|e| e.into_inner())
}

fn menu() -> MutexGuard<'static, Option<Menu>> {
    MENU.lock().unwrap_or_else(|e| e.into_inner())
}

/// A window handle from the payload, 32 bits from 32- and 64-bit apps alike: widened with its sign, as Windows does.
fn handle(v: u32) -> HWND {
    HWND(v as i32 as isize as _)
}

/// Whether the spy should run: the tray is wanted and the bar's thread runs.
fn wanted() -> bool {
    WISH.load(Ordering::SeqCst) && super::running()
}

/// Starts the spy unless it runs, if it is `wanted` (mod.rs `start`, once the bar's thread runs, and `taskbar_tray_on`).
pub(crate) fn start(app: &AppHandle) {
    let mut thread = thread();
    if thread.is_some() || !wanted() {
        return;
    }
    APP.get_or_init(|| app.clone());
    let (ready, id) = channel();
    let handle = std::thread::spawn(move || unsafe { run(ready) });
    match id.recv() {
        Ok(id) => *thread = Some((id, handle)),
        Err(_) => {
            let _ = handle.join();
        }
    }
}

/// Ends the spy unless it is still `wanted` (mod.rs `stop`, after the bar's thread is let go, and `taskbar_tray_on`). Waits for
/// a forward under way, at most `FORWARD_MS`.
pub(crate) fn stop() {
    let mut thread = thread();
    if wanted() {
        return;
    }
    if let Some((id, handle)) = thread.take() {
        let _ = unsafe { PostThreadMessageW(id, STOP, WPARAM(0), LPARAM(0)) };
        let _ = handle.join();
    }
}

/// Whether `hwnd` is the spy's window (explorer.rs `appbar_taskbar`, under explorer's lock: an atomic, never a wait).
pub(crate) fn is_spy(hwnd: HWND) -> bool {
    let spy = SPY.load(Ordering::SeqCst);
    spy != 0 && hwnd.0 as isize == spy
}

/// Puts the spy ahead of Explorer's tray now rather than at its next check (explorer.rs `on_show`): its check's tick, posted,
/// so the caller never waits on the spy's thread, which may be in a forward.
pub(crate) fn raise() {
    let spy = SPY.load(Ordering::SeqCst);
    if spy != 0 {
        let _ = unsafe { PostMessageW(Some(HWND(spy as _)), WM_TIMER, WPARAM(FIRST_TIMER), LPARAM(0)) };
    }
}

/// Whether a zone of the bar holds the tray, which the notch sends whether the bar is on or off; Rust adds whether the bar's
/// thread runs (`wanted`), so turning the bar off stops the spy in mod.rs `stop`, after Windows' taskbar is back. Off the async
/// runtime's threads, as a stop waits for a forward.
#[tauri::command]
pub async fn taskbar_tray_on(on: bool, app: AppHandle) {
    WISH.store(on, Ordering::SeqCst);
    let _ = tauri::async_runtime::spawn_blocking(move || {
        if on {
            start(&app)
        } else {
            // Under SCAN no appbar call of Crest's (a re-hide) is on its way to be lost as the spy goes; the spy never takes it.
            explorer::locked(stop)
        }
    })
    .await;
}

/// The tray for a bar page that has just loaded; `taskbar://tray` brings each change.
#[tauri::command]
pub fn taskbar_tray() -> TrayState {
    TrayState { icons: visible(&store().icons) }
}

/// The icons' pictures by their `img` key, as PNG data URLs; None for a key no icon shows any more.
#[tauri::command]
pub async fn taskbar_tray_images(keys: Vec<String>) -> HashMap<String, Option<String>> {
    tauri::async_runtime::spawn_blocking(move || {
        let found: Vec<(String, Option<Vec<u8>>)> = {
            let store = store();
            keys.into_iter().map(|key| (key.clone(), store.images.get(&key).cloned())).collect()
        };
        found.into_iter().map(|(key, png)| (key, png.map(data_url))).collect()
    })
    .await
    .unwrap_or_default()
}

/// A click on the icon `key` (`TrayIcon.key`) at `rect`, in the calling bar's CSS px, or the pointer resting on it ("hover")
/// and leaving it ("leave"): its app gets the messages Windows' tray sends, and the rect answers its position request. Never waits: the messages are notifications. Errors: gone (no such icon
/// shown, or its window is no more), unknown-button.
#[tauri::command]
pub fn taskbar_tray_click(key: String, button: String, rect: HitRect, window: WebviewWindow) -> Result<(), String> {
    let button = match button.as_str() {
        "left" => Button::Left,
        "right" => Button::Right,
        "double" => Button::Double,
        "hover" => Button::Hover,
        "leave" => Button::Leave,
        _ => return Err("unknown-button".into()),
    };
    // A sync command runs on the main thread, where the handle is read without a wait; the bar's place and DPI come from Win32.
    let bar = window.hwnd().map_err(|e| e.to_string())?;
    let rect = unsafe { on_screen(bar, rect) }.ok_or("gone")?;
    let (hwnd, uid, callback, version, owner) = {
        let mut store = store();
        let e = by_key(&store.icons, &key).ok_or("gone")?;
        let found = (handle(e.hwnd), e.uid, e.callback, e.version, e.owner_pid);
        store.clicked = Some(rect);
        found
    };
    // Gone, or its handle reused by another process since the icon was added.
    if window_pid(hwnd) != owner {
        return Err("gone".into());
    }
    if button == Button::Right {
        *menu() = Some(Menu { owner, bar: window.label().to_owned(), open: 0 });
    }
    let (x, y) = ((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    unsafe {
        // So the app may bring its window or menu forward, as Windows' tray lets it; a rest on the icon brings nothing forward.
        if !matches!(button, Button::Hover | Button::Leave) {
            let _ = AllowSetForegroundWindow(owner);
        }
        for msg in traywire::click_messages(button, version) {
            let (wparam, lparam) = traywire::callback_args(version, uid, msg, x, y);
            let _ = SendNotifyMessageW(hwnd, callback, WPARAM(wparam), LPARAM(lparam));
        }
    }
    Ok(())
}

/// A Win32 pop-up menu shown or closed (mod.rs): once the last one of the app a right click waits on has closed, submenus
/// included, that bar hears `taskbar://menu-end`. An app that draws its menu as a window of its own fires none of these.
pub(super) fn on_menu(start: bool, hwnd: HWND) {
    let pid = window_pid(hwnd);
    let bar = {
        let mut menu = menu();
        let over = menu.as_mut().is_some_and(|m| m.owner == pid && menu_closed(&mut m.open, start));
        if over {
            menu.take().map(|m| m.bar)
        } else {
            None
        }
    };
    end_menu(bar);
}

/// A window other than a bar came to the front (tasks.rs): one of another process (the desktop, another app) means the menu is
/// over too. The app's own windows do not: its menu takes the front to show.
pub(super) fn on_front(hwnd: HWND) {
    let pid = window_pid(hwnd);
    let bar = {
        let mut menu = menu();
        if menu.as_ref().is_some_and(|m| m.owner != pid) {
            menu.take().map(|m| m.bar)
        } else {
            None
        }
    };
    end_menu(bar);
}

/// Whether `pid` is the app a right click waits on for its menu: its windows come to the front to show it, and the bar
/// raised over them would cover it (display.rs, #91).
pub(crate) fn menu_of(pid: u32) -> bool {
    menu().as_ref().is_some_and(|m| m.owner == pid)
}

/// Whether a pop-up menu shown (`start`) or closed leaves none of the app's open, counting them in `open`.
fn menu_closed(open: &mut u32, start: bool) -> bool {
    if start {
        *open += 1;
        return false;
    }
    *open = open.saturating_sub(1);
    *open == 0
}

fn end_menu(bar: Option<String>) {
    if let (Some(app), Some(bar)) = (APP.get(), bar) {
        let _ = app.emit_to(bar.as_str(), "taskbar://menu-end", ());
    }
}

/// `r`, in the CSS px of the bar `bar`, in physical screen px, from the bar's place and DPI as Win32 has them (hit_test.rs
/// `geometry`): Tauri's getters wait for the main thread.
unsafe fn on_screen(bar: HWND, r: HitRect) -> Option<RECT> {
    let mut at = RECT::default();
    unsafe { GetWindowRect(bar, &mut at) }.ok()?;
    let dpi = unsafe { GetDpiForWindow(bar) };
    // The page's px are its DPI times Windows' Text size (text_scale.rs).
    let k = dpi as f64 / 96.0 * crate::text_scale::get();
    let px = |v: f64| (v * k).round() as i32;
    (dpi > 0).then(|| RECT { left: at.left + px(r.x), top: at.top + px(r.y), right: at.left + px(r.x + r.w), bottom: at.top + px(r.y + r.h) })
}

/// Whether a `Shell_TrayWnd` there, by its process and whether it is the spy, belongs to another program than Explorer (the
/// `shell` process) and Crest. Without a shell none is known to: a restarting Explorer has its tray before its desktop.
/// Of every top-level `Shell_TrayWnd`, as (window, process, the spy), those of another program than Explorer and Crest, which
/// get a copy of each icon message. None while the shell is not known (Explorer restarting: its new tray is there before its
/// desktop window), so a new Explorer tray is never taken for another program's.
fn others(trays: &[(isize, u32, bool)], shell: u32) -> Vec<isize> {
    if shell == 0 {
        return Vec::new();
    }
    trays.iter().filter(|&&(_, pid, spy)| !spy && pid != shell).map(|&(hwnd, _, _)| hwnd).collect()
}

fn other_trays() -> Vec<isize> {
    let trays: Vec<(isize, u32, bool)> =
        explorer::windows_of(w!("Shell_TrayWnd")).into_iter().map(|hwnd| (hwnd.0 as isize, window_pid(hwnd), is_spy(hwnd))).collect();
    others(&trays, explorer::shell_pid())
}

unsafe fn run(ready: Sender<u32>) {
    unsafe {
        let mut msg = MSG::default();
        // The thread's queue, before `stop` can post to it.
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
        if ready.send(GetCurrentThreadId()).is_err() {
            return;
        }
        // The icons' pictures are made off this thread, which answers apps that wait.
        let (queue, pictures) = channel();
        let worker = std::thread::spawn(move || convert(pictures));
        WORKER.set(Some(queue));
        let again = SetTimer(None, 0, AGAIN_MS, None);
        appear();
        while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
            if msg.hwnd.is_invalid() {
                if msg.message == STOP {
                    break;
                }
                if msg.message == WM_TIMER && SPY.load(Ordering::SeqCst) == 0 {
                    appear();
                }
                continue;
            }
            DispatchMessageW(&msg);
        }
        let _ = KillTimer(None, again);
        let spy = SPY.load(Ordering::SeqCst);
        if spy != 0 {
            vanish(HWND(spy as _));
        }
        // The worker ends once its queue is empty; with no icon left, what it still makes is dropped.
        WORKER.take();
        let _ = worker.join();
        publish();
    }
}

/// The window; it checks at once that it is first.
unsafe fn appear() {
    publish();
    let Some(spy) = (unsafe { window() }) else { return };
    SPY.store(spy.0 as isize, Ordering::SeqCst);
    unsafe {
        // Low-integrity apps (a sandboxed browser) reach it too, as they reach Explorer's.
        let _ = ChangeWindowMessageFilterEx(spy, WM_COPYDATA, MSGFLT_ALLOW, None);
        let _ = SetTimer(Some(spy), FIRST_TIMER, FIRST_MS, None);
        let _ = SetTimer(Some(spy), SWEEP_TIMER, SWEEP_MS, None);
        taskband::appear(spy);
        keep_first(spy);
    }
}

/// The window goes, and with it the icons: the bars hear so. Apps that announced their icons to it hear `TaskbarCreated` and
/// add them again to the tray now first, so an icon whose forward timed out reaches Explorer after all.
unsafe fn vanish(spy: HWND) {
    unsafe { taskband::vanish(spy) };
    let _ = unsafe { DestroyWindow(spy) };
    SPY.store(0, Ordering::SeqCst);
    ARMED.set(false);
    {
        let mut store = store();
        store.icons.clear();
        store.images.clear();
        store.clicked = None;
    }
    publish();
    if ANNOUNCED.replace(0) != 0 {
        announce();
        taskband::tell_buttons();
    }
}

/// Apps add their icons again to the first `Shell_TrayWnd` when they hear this, as after an Explorer restart. A notify: no wait
/// on any window, and the spy's own copy is not forwarded (`traywire::forwards`).
fn announce() {
    let msg = unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) };
    if msg != 0 {
        let _ = unsafe { SendNotifyMessageW(HWND_BROADCAST, msg, WPARAM(0), LPARAM(0)) };
    }
}

/// Every `FIRST_MS` and on `raise`: the spy goes ahead of every other `Shell_TrayWnd` again, another program's included. Once
/// first, it announces itself once to each Explorer tray (the first, and a restarted Explorer's), so apps add their icons
/// through it.
unsafe fn keep_first(spy: HWND) {
    unsafe {
        if FindWindowW(w!("Shell_TrayWnd"), None).ok() != Some(spy) {
            // Explorer's window stays where it is: only the spy moves.
            let _ = SetWindowPos(spy, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            return;
        }
    }
    if let Some(explorer) = explorer::explorer_tray() {
        if ANNOUNCED.replace(explorer.0 as isize) != explorer.0 as isize {
            announce();
            taskband::announce_buttons();
        }
    }
}

/// Hidden for good: never shown, no size, no taskbar button.
unsafe fn window() -> Option<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        CLASS.call_once(|| {
            let class = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: instance.into(), lpszClassName: w!("Shell_TrayWnd"), ..Default::default() };
            if RegisterClassW(&class) == 0 {
                eprintln!("tray: window class failed: {}", windows::core::Error::from_thread());
            }
        });
        CreateWindowExW(WS_EX_TOPMOST | WS_EX_TOOLWINDOW, w!("Shell_TrayWnd"), w!(""), WS_POPUP, 0, 0, 0, 0, None, None, Some(instance.into()), None)
            .inspect_err(|e| eprintln!("tray: window failed: {e}"))
            .ok()
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_TIMER && matches!(wparam.0, FIRST_TIMER | EMIT_TIMER | SWEEP_TIMER | WAKE) {
        match wparam.0 {
            FIRST_TIMER => unsafe { keep_first(hwnd) },
            EMIT_TIMER => {
                let _ = unsafe { KillTimer(Some(hwnd), EMIT_TIMER) };
                ARMED.set(false);
                publish();
            }
            SWEEP_TIMER => sweep(hwnd),
            _ => arm(hwnd),
        }
        return LRESULT(0);
    }
    if msg == WM_COPYDATA {
        return LRESULT(unsafe { copy_data(hwnd, wparam, lparam) });
    }
    // ManagedShell posts this one on rather than send it: a synchronous forward of it is what its fix avoids. Nothing waits.
    if traywire::posts(msg) {
        if let Some(to) = explorer::explorer_tray() {
            let _ = unsafe { PostMessageW(Some(to), msg, wparam, lparam) };
        }
        return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) };
    }
    if traywire::forwards(msg) {
        return LRESULT(forward(msg, wparam, lparam, false));
    }
    // Only `vanish` ends the window, else `SPY` names a dead one; WM_SYSCOMMAND's SC_CLOSE comes here too, through DefWindowProcW.
    if msg == WM_CLOSE {
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// What an app sent in `WM_COPYDATA` (traywire.rs). An icon message is kept before it goes on; the position request is answered
/// with the rect last clicked, 0 before any click.
unsafe fn copy_data(spy: HWND, wparam: WPARAM, lparam: LPARAM) -> isize {
    let Some(data) = (unsafe { (lparam.0 as *const COPYDATASTRUCT).as_ref() }) else { return 0 };
    let bytes = if data.lpData.is_null() { &[][..] } else { unsafe { std::slice::from_raw_parts(data.lpData as *const u8, data.cbData as usize) } };
    match traywire::parse(data.dwData, bytes) {
        Msg::GetRect { corner, .. } => store().clicked.map_or(0, |rect| traywire::rect_reply(corner, rect)),
        Msg::AppBar => {
            // Crest's own auto-hide calls wait on Explorer as before the spy: its safety net reads a timeout's 0 as an answer.
            let wait = traywire::waits_for_explorer(bytes, std::process::id());
            unsafe { appbar(wparam, bytes, wait) }.unwrap_or_else(|| forward(WM_COPYDATA, wparam, lparam, wait))
        }
        Msg::Icon(op, icon) => {
            // A copy handed back (COPYING): the message it copies goes on to Explorer once the copy returns.
            if COPYING.with_borrow(|c| c.as_deref() == Some(bytes)) {
                return 1;
            }
            keep(spy, op, icon);
            // Another program's tray keeps its icons too; Explorer's answer is the one that goes back.
            let outer = COPYING.replace(Some(bytes.to_vec()));
            for other in other_trays() {
                let _ = send(HWND(other as _), WM_COPYDATA, wparam, lparam, false);
            }
            COPYING.set(outer);
            forward(WM_COPYDATA, wparam, lparam, false)
        }
        Msg::Other => forward(WM_COPYDATA, wparam, lparam, false),
    }
}

/// An icon message into the store. The app may destroy its icon once its call returns, so the picture is copied here and made
/// into a PNG on the worker; a handle that cannot be copied leaves the picture there is, and 0 takes it away.
fn keep(spy: HWND, op: IconOp, data: IconData) {
    let owner = window_pid(handle(data.hwnd));
    let picture = data.hicon.filter(|_| matches!(op, IconOp::Add | IconOp::Modify));
    let asked = data.key.clone();
    let (changed, key) = {
        let mut store = store();
        let changed = apply(&mut store.icons, op, data, owner, std::process::id());
        prune(&mut store);
        (changed, find(&store.icons, &asked).map(|i| store.icons[i].key.clone()))
    };
    if changed {
        arm(spy);
    }
    let (Some(key), Some(picture)) = (key, picture) else { return };
    let copy = match picture {
        0 => None,
        // Sign-extended as a window handle (`handle`).
        h => match unsafe { CopyIcon(HICON(h as i32 as isize as _)) } {
            Ok(copy) => Some(Copied(copy)),
            Err(_) => return,
        },
    };
    // A worker that has ended hands the copy back in the error, which drops and destroys it.
    WORKER.with_borrow(|worker| worker.as_ref().map(|w| w.send((key, copy))));
}

/// Applies an icon message to the icons, as Windows' tray does: an add or a change of an icon it does not have adds it, if its
/// window is there and is not Crest's (`own_pid`) nor Windows' own (`windows_own`); a version is kept for the clicks. Whether what
/// the bars show changed.
fn apply(icons: &mut Vec<Entry>, op: IconOp, data: IconData, owner_pid: u32, own_pid: u32) -> bool {
    let before = visible(icons);
    match (op, find(icons, &data.key)) {
        (IconOp::Delete, Some(at)) => {
            icons.remove(at);
        }
        (IconOp::SetVersion, Some(at)) => icons[at].version = data.version.unwrap_or(icons[at].version),
        (IconOp::Add | IconOp::Modify, at) => {
            let at = match at {
                // A GUID icon added again from Crest's own window becomes Crest's: it leaves, as one never stays.
                Some(at) if data.hwnd != 0 && owner_pid == own_pid => {
                    icons.remove(at);
                    return before != visible(icons);
                }
                // Its window again, as ManagedShell refreshes it: a GUID icon may come back from a new window and id.
                Some(at) if data.hwnd != 0 => {
                    let e = &mut icons[at];
                    (e.hwnd, e.uid) = (data.hwnd, data.uid);
                    if owner_pid != 0 {
                        e.owner_pid = owner_pid;
                    }
                    at
                }
                Some(at) => at,
                None if owner_pid == 0 || owner_pid == own_pid || windows_own(&data.key) => return false,
                None => {
                    let guid = match data.key {
                        IconKey::Guid(g) => Some(g),
                        IconKey::Id { .. } => None,
                    };
                    // Read once, as the icon is added; only an icon without a GUID is named by its exe.
                    let exe = if guid.is_none() { mixer::process_path(owner_pid).unwrap_or_default() } else { String::new() };
                    icons.push(Entry {
                        key: data.key.clone(),
                        id: traywire::identity(guid, &exe, data.uid),
                        owner_pid,
                        hwnd: data.hwnd,
                        uid: data.uid,
                        callback: 0,
                        version: 0,
                        tip: String::new(),
                        hidden: false,
                        img_key: None,
                    });
                    icons.len() - 1
                }
            };
            let e = &mut icons[at];
            if let Some(callback) = data.callback {
                e.callback = callback;
            }
            if let Some(tip) = data.tip {
                e.tip = tip;
            }
            if let Some(hidden) = data.hidden {
                e.hidden = hidden;
            }
        }
        _ => {}
    }
    before != visible(icons)
}

/// Windows' own volume, network and power icons (`7820AE73`..`75`, as ManagedShell lists them): on some versions (23H2) Explorer
/// still sends them to the tray, where a click reaches nothing, and Stato shows the same with its own panels (#99).
fn windows_own(key: &IconKey) -> bool {
    const SUFFIX: (u16, u16, [u8; 8]) = (0x23E3, 0x4229, [0x82, 0xC1, 0xE4, 0x1C, 0xB6, 0x7D, 0x5B, 0x9C]);
    matches!(key, IconKey::Guid(g) if (0x7820_AE73..=0x7820_AE75).contains(&g.data1) && (g.data2, g.data3, g.data4) == SUFFIX)
}

/// The stored icon a message names: by its GUID when it has one, else by its window and id, which a GUID icon keeps too.
fn find(icons: &[Entry], key: &IconKey) -> Option<usize> {
    icons.iter().position(|e| match key {
        IconKey::Id { hwnd, uid } => e.hwnd == *hwnd && e.uid == *uid,
        guid => e.key == *guid,
    })
}

/// What the bars show: the icons their apps do not hide.
fn visible(icons: &[Entry]) -> Vec<TrayIcon> {
    let shown = icons.iter().filter(|e| !e.hidden);
    shown.map(|e| TrayIcon { id: e.id.clone(), key: key_text(&e.key), tip: e.tip.clone(), img: e.img_key.clone() }).collect()
}

/// An icon's key as the page has it: its GUID, else its window and id, so no two icons there share one.
fn key_text(key: &IconKey) -> String {
    match key {
        IconKey::Guid(g) => format!("g:{}", traywire::identity(Some(*g), "", 0)),
        IconKey::Id { hwnd, uid } => format!("w:{hwnd}:{uid}"),
    }
}

/// The icon a click names by its key, among those the bars show.
fn by_key<'a>(icons: &'a [Entry], key: &str) -> Option<&'a Entry> {
    icons.iter().find(|e| !e.hidden && key_text(&e.key) == key)
}

/// Pictures no icon shows any more go.
fn prune(store: &mut Store) {
    let icons = &store.icons;
    store.images.retain(|key, _| icons.iter().any(|e| e.img_key.as_ref() == Some(key)));
}

/// The worker: the latest picture of each icon queued, PNG'd outside any lock, each copy destroyed as it is dropped.
fn convert(pictures: Receiver<(IconKey, Option<Copied>)>) {
    while let Ok(first) = pictures.recv() {
        // An icon queued twice keeps its latest picture; the older copy is dropped here.
        let latest: HashMap<IconKey, Option<Copied>> = std::iter::once(first).chain(pictures.try_iter()).collect();
        for (key, copy) in latest {
            let png = match &copy {
                Some(icon) => match unsafe { mixer::icon_to_png(icon.0) } {
                    Some(png) => Some(png),
                    // A picture that cannot be read leaves the one there is.
                    None => continue,
                },
                None => None,
            };
            drop(copy);
            if picture(&key, png) {
                let spy = SPY.load(Ordering::SeqCst);
                if spy != 0 {
                    let _ = unsafe { PostMessageW(Some(HWND(spy as _)), WM_TIMER, WPARAM(WAKE), LPARAM(0)) };
                }
            }
        }
    }
}

/// The icon `key` shows `png`, kept under a hash of its bytes; none for None. Whether its picture changed. An icon gone
/// meanwhile takes none.
fn picture(key: &IconKey, png: Option<Vec<u8>>) -> bool {
    let img = png.as_deref().map(png_key);
    let mut guard = store();
    let store = &mut *guard;
    let Some(e) = store.icons.iter_mut().find(|e| e.key == *key) else { return false };
    if e.img_key == img {
        return false;
    }
    e.img_key = img.clone();
    if let (Some(img), Some(png)) = (img, png) {
        store.images.entry(img).or_insert(png);
    }
    prune(store);
    true
}

/// A picture's key: a hash of its PNG's bytes.
pub(super) fn png_key(png: &[u8]) -> String {
    let mut hash = DefaultHasher::new();
    png.hash(&mut hash);
    format!("{:016x}", hash.finish())
}

/// A PNG as a data URL, for the page.
pub(super) fn data_url(png: Vec<u8>) -> String {
    format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png))
}

/// Sets the one-shot `EMIT_TIMER` unless it is set.
fn arm(spy: HWND) {
    if !ARMED.replace(true) && unsafe { SetTimer(Some(spy), EMIT_TIMER, EMIT_MS, None) } == 0 {
        ARMED.set(false);
    }
}

/// Every `SWEEP_MS`: icons whose window is no more leave.
fn sweep(spy: HWND) {
    let gone = {
        let mut store = store();
        let gone = drop_gone(&mut store.icons, |hwnd| unsafe { IsWindow(Some(handle(hwnd))) }.as_bool());
        prune(&mut store);
        gone
    };
    if gone {
        arm(spy);
    }
}

/// The icons whose window is not `alive` leave; whether any did.
fn drop_gone(icons: &mut Vec<Entry>, alive: impl Fn(u32) -> bool) -> bool {
    let before = icons.len();
    icons.retain(|e| alive(e.hwnd));
    icons.len() != before
}

/// Every bar hears the tray when it differs from what they last heard. On the spy's thread only, so nothing is sent while the
/// spy is stopped, and after the lock.
fn publish() {
    let Some(app) = APP.get() else { return };
    let state = {
        let mut store = store();
        let now = visible(&store.icons);
        if store.sent == now {
            return;
        }
        store.sent = now.clone();
        TrayState { icons: now }
    };
    for (label, _) in super::screens::all() {
        let _ = app.emit_to(label, "taskbar://tray", &state);
    }
}

/// Explorer's answer to `msg`, 0 when there is no Explorer or it does not answer in time (`send`).
fn forward(msg: u32, wparam: WPARAM, lparam: LPARAM, wait: bool) -> isize {
    explorer::explorer_tray().and_then(|to| send(to, msg, wparam, lparam, wait)).unwrap_or(0)
}

/// Sends to Explorer's tray, waiting at most `FORWARD_MS` and not at all on a hung Explorer: its answer, None without one. With
/// `wait`, for as long as Explorer takes; the messages apps send to the spy meanwhile still run, each with the cap.
pub(super) fn send(to: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, wait: bool) -> Option<isize> {
    if wait {
        return Some(unsafe { SendMessageW(to, msg, Some(wparam), Some(lparam)) }.0);
    }
    let mut answer = 0usize;
    let sent = unsafe { SendMessageTimeoutW(to, msg, wparam, lparam, FORWARD_FLAGS, FORWARD_MS, Some(&mut answer)) };
    (sent.0 != 0).then_some(answer as isize)
}

/// An appbar call that answers in shared memory (`traywire::appbar_shared`): that memory was made for Crest's process, so Explorer
/// gets a copy made for its own and its answer is copied back. None when the call is another or no copy could be made: it goes
/// on as it came, as without the spy.
unsafe fn appbar(wparam: WPARAM, bytes: &[u8], wait: bool) -> Option<isize> {
    let (handle, pid) = traywire::appbar_shared(bytes)?;
    let to = explorer::explorer_tray()?;
    let explorer = window_pid(to);
    unsafe {
        let mine = SHLockShared(HANDLE(handle as usize as _), pid);
        if mine.is_null() {
            return None;
        }
        let copy = SHAllocShared(Some(mine.cast_const()), ABD_LEN as u32, explorer);
        let answer = if copy.is_invalid() {
            None
        } else {
            let payload = traywire::reshare(bytes, copy.0 as usize as u64, explorer);
            let data = COPYDATASTRUCT { dwData: 0, cbData: payload.len() as u32, lpData: payload.as_ptr() as *mut _ };
            let answer = send(to, WM_COPYDATA, wparam, LPARAM(&data as *const COPYDATASTRUCT as isize), wait);
            // Without an answer Explorer may still read the copy later, when it gets to the message: it keeps it.
            if answer.is_some() {
                let back = SHLockShared(copy, explorer);
                if !back.is_null() {
                    std::ptr::copy_nonoverlapping(back as *const u8, mine as *mut u8, ABD_LEN);
                    let _ = SHUnlockShared(back);
                }
                let _ = SHFreeShared(copy, explorer);
            }
            Some(answer.unwrap_or(0))
        };
        let _ = SHUnlockShared(mine);
        answer
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use traywire::{click_messages, Button};
    use windows::core::GUID;
    use windows::Win32::UI::Shell::NIN_SELECT;

    const APP: u32 = 10;
    const CREST: u32 = 20;

    #[test]
    fn a_menu_is_over_when_its_last_popup_closes() {
        let mut open = 0;
        assert!(!menu_closed(&mut open, true));
        // A submenu opens and closes: the menu is still there.
        assert!(!menu_closed(&mut open, true));
        assert!(!menu_closed(&mut open, false));
        assert!(menu_closed(&mut open, false));
        // A close without a start seen (the menu was already open) ends it too.
        assert!(menu_closed(&mut open, false));
    }

    #[test]
    fn only_the_app_whose_menu_is_waited_on_keeps_the_bar_below() {
        assert!(!menu_of(APP));
        *menu() = Some(Menu { owner: APP, bar: "taskbar".into(), open: 0 });
        assert!(menu_of(APP) && !menu_of(APP + 1));
        *menu() = None;
        assert!(!menu_of(APP));
    }

    /// What an app sends for its icon 7 of window 0x1234.
    fn icon(tip: Option<&str>, hidden: Option<bool>) -> IconData {
        let key = IconKey::Id { hwnd: 0x1234, uid: 7 };
        IconData { key, hwnd: 0x1234, uid: 7, flags: 0, callback: Some(0x401), hicon: None, tip: tip.map(Into::into), hidden, version: None }
    }

    #[test]
    fn an_icon_is_added_changed_and_removed() {
        let mut icons = Vec::new();
        assert!(apply(&mut icons, IconOp::Add, icon(Some("Disk"), None), APP, CREST));
        assert_eq!((icons.len(), icons[0].tip.as_str(), icons[0].callback, icons[0].owner_pid), (1, "Disk", 0x401, APP));
        assert!(apply(&mut icons, IconOp::Modify, icon(Some("Disk full"), None), APP, CREST));
        assert_eq!((icons.len(), icons[0].tip.as_str()), (1, "Disk full"));
        // The same tip again changes nothing the bars show.
        assert!(!apply(&mut icons, IconOp::Modify, icon(Some("Disk full"), None), APP, CREST));
        assert!(apply(&mut icons, IconOp::Delete, icon(None, None), APP, CREST));
        assert!(icons.is_empty());
    }

    #[test]
    fn a_change_to_an_unknown_icon_adds_it() {
        let mut icons = Vec::new();
        assert!(apply(&mut icons, IconOp::Modify, icon(Some("Late"), None), APP, CREST));
        assert_eq!((icons.len(), icons[0].tip.as_str()), (1, "Late"));
        // A deletion of an icon never added changes nothing.
        let mut none = Vec::new();
        assert!(!apply(&mut none, IconOp::Delete, icon(None, None), APP, CREST));
        assert!(none.is_empty());
    }

    #[test]
    fn crests_own_icons_are_left_out() {
        let mut icons = Vec::new();
        assert!(!apply(&mut icons, IconOp::Add, icon(Some("Crest"), None), CREST, CREST));
        assert!(!apply(&mut icons, IconOp::Modify, icon(Some("Crest"), None), CREST, CREST));
        assert!(icons.is_empty());
    }

    #[test]
    fn windows_own_volume_network_and_power_icons_are_left_out() {
        let sca = |n: u32| IconKey::Guid(GUID::from_values(n, 0x23E3, 0x4229, [0x82, 0xC1, 0xE4, 0x1C, 0xB6, 0x7D, 0x5B, 0x9C]));
        let mut icons = Vec::new();
        for n in [0x7820_AE73, 0x7820_AE74, 0x7820_AE75] {
            assert!(!apply(&mut icons, IconOp::Add, IconData { key: sca(n), ..icon(Some("Network"), None) }, APP, CREST));
        }
        assert!(icons.is_empty());
        // The rest of the family (Location, 77) and an app's own GUID stay.
        assert!(apply(&mut icons, IconOp::Add, IconData { key: sca(0x7820_AE77), ..icon(Some("Location"), None) }, APP, CREST));
        let app = IconKey::Guid(GUID::from_values(0x7820_AE74, 2, 3, [4, 5, 6, 7, 8, 9, 10, 11]));
        assert!(apply(&mut icons, IconOp::Add, IconData { key: app, ..icon(Some("Sync"), None) }, APP, CREST));
    }

    #[test]
    fn an_icon_the_app_hides_leaves_the_list() {
        let mut icons = Vec::new();
        // Kept, for when it shows, but not on the list.
        assert!(!apply(&mut icons, IconOp::Add, icon(Some("Quiet"), Some(true)), APP, CREST));
        assert_eq!(icons.len(), 1);
        assert!(visible(&icons).is_empty());
        assert!(apply(&mut icons, IconOp::Modify, icon(None, Some(false)), APP, CREST));
        assert_eq!(visible(&icons).len(), 1);
        assert!(apply(&mut icons, IconOp::Modify, icon(None, Some(true)), APP, CREST));
        assert!(visible(&icons).is_empty());
    }

    #[test]
    fn a_version_change_is_kept_for_its_clicks() {
        let mut icons = Vec::new();
        apply(&mut icons, IconOp::Add, icon(Some("V"), None), APP, CREST);
        assert_eq!(icons[0].version, 0);
        let set = IconData { version: Some(4), ..icon(None, None) };
        // Nothing the bars show changes.
        assert!(!apply(&mut icons, IconOp::SetVersion, set, APP, CREST));
        assert_eq!(icons[0].version, 4);
        assert_eq!(click_messages(Button::Left, icons[0].version).last(), Some(&NIN_SELECT));
    }

    #[test]
    fn two_icons_of_one_program_and_id_keep_apart_by_their_key() {
        // Two instances of one program, each with its icon 7: one remembered choice, two icons.
        let mut icons = Vec::new();
        apply(&mut icons, IconOp::Add, icon(Some("First"), None), APP, CREST);
        let second = IconData { key: IconKey::Id { hwnd: 0x5678, uid: 7 }, hwnd: 0x5678, ..icon(Some("Second"), None) };
        apply(&mut icons, IconOp::Add, second, APP, CREST);
        let shown = visible(&icons);
        assert_eq!(shown[0].id, shown[1].id);
        assert_ne!(shown[0].key, shown[1].key);
        let guid = GUID::from_values(1, 2, 3, [4, 5, 6, 7, 8, 9, 10, 11]);
        assert_eq!(key_text(&IconKey::Guid(guid)), "g:{00000001-0002-0003-0405-060708090a0b}");
        assert_eq!(key_text(&IconKey::Id { hwnd: 0x5678, uid: 7 }), "w:22136:7");
    }

    #[test]
    fn a_click_finds_its_icon_by_key_and_never_a_hidden_one() {
        let mut icons = Vec::new();
        apply(&mut icons, IconOp::Add, icon(Some("First"), None), APP, CREST);
        let second = IconData { key: IconKey::Id { hwnd: 0x5678, uid: 7 }, hwnd: 0x5678, ..icon(Some("Second"), None) };
        apply(&mut icons, IconOp::Add, second, APP, CREST);
        let keys: Vec<String> = visible(&icons).into_iter().map(|i| i.key).collect();
        assert_eq!(by_key(&icons, &keys[1]).map(|e| e.tip.as_str()), Some("Second"));
        assert_eq!(by_key(&icons, &keys[0]).map(|e| e.tip.as_str()), Some("First"));
        apply(&mut icons, IconOp::Modify, icon(None, Some(true)), APP, CREST);
        assert!(by_key(&icons, &keys[0]).is_none());
        assert!(by_key(&icons, "w:1:1").is_none());
    }

    #[test]
    fn a_guid_icon_added_again_from_a_new_window_answers_there() {
        let guid = IconKey::Guid(GUID::from_values(1, 2, 3, [4, 5, 6, 7, 8, 9, 10, 11]));
        let mut icons = Vec::new();
        apply(&mut icons, IconOp::Add, IconData { key: guid.clone(), ..icon(Some("Sync"), None) }, APP, CREST);
        let key = visible(&icons)[0].key.clone();
        // The app restarted: the same GUID from window 0x5678, id 9, while 0x1234 is gone.
        let again = IconData { key: guid.clone(), hwnd: 0x5678, uid: 9, ..icon(None, None) };
        apply(&mut icons, IconOp::Add, again.clone(), APP + 1, CREST);
        assert!(!drop_gone(&mut icons, |hwnd| hwnd != 0x1234));
        assert_eq!((icons.len(), icons[0].hwnd, icons[0].uid, icons[0].owner_pid), (1, 0x5678, 9, APP + 1));
        // The page keeps its key, which follows the GUID.
        assert_eq!(visible(&icons)[0].key, key);
        // Moved to a window of Crest's, it is Crest's own and leaves.
        assert!(apply(&mut icons, IconOp::Modify, again, CREST, CREST));
        assert!(icons.is_empty());
    }

    #[test]
    fn crest_keeps_the_tray_and_copies_the_icons_to_another_programs() {
        // (window, pid, is the spy) of every top-level Shell_TrayWnd; shell pid 10, Crest 20, lumabar 30.
        assert!(others(&[(1, 10, false)], 10).is_empty());
        assert!(others(&[(1, 10, false), (2, 20, true)], 10).is_empty());
        assert_eq!(others(&[(3, 30, false), (2, 20, true), (1, 10, false)], 10), vec![3]);
    }

    #[test]
    fn without_a_shell_no_other_program_is_known() {
        // Explorer restarting: its new tray is there before its desktop window.
        assert!(others(&[(3, 30, false), (2, 20, true)], 0).is_empty());
    }

    #[test]
    fn a_forward_never_waits_long() {
        assert!(FORWARD_MS <= 500);
        assert_eq!(FORWARD_FLAGS, SMTO_ABORTIFHUNG | SMTO_NORMAL);
    }
}
