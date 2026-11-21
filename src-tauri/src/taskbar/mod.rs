//! Crest's own taskbar (Windows only).
//!
//! While the bar's window exists, one thread keeps a hidden top-level window, WinEvent hooks and a shell hook: a taskbar Windows
//! shows again is hidden again while Crest hides them (explorer.rs `on_show`), and so are a restarted Explorer's new ones, which
//! it announces with the `TaskbarCreated` broadcast. The same events keep the bar's list of open windows (tasks.rs). A new work
//! area (auto-hide turned on or off, an appbar) places the bar again at once. Only top-level windows get broadcasts, so the
//! window is not message-only. The thread never waits for explorer's lock: what finds it taken is done again by a short timer
//! (`defer`, `retry`). The docked bars' appbars live on this thread too (reserve.rs): every change to them comes as a posted
//! `REAPPBAR`, never from inside a call. The tray's spy (tray.rs) has a thread of its own, which runs only while this one does.

pub(crate) mod bar;
pub(crate) mod bluetooth;
pub(crate) mod explorer;
pub(crate) mod front;
pub(crate) mod panel;
pub(crate) mod pins;
pub(crate) mod preview;
pub(crate) mod reserve;
pub(crate) mod screens;
pub(crate) mod start;
pub(crate) mod tasks;
pub(crate) mod tray;
pub(crate) mod traywire;
pub(crate) mod widgets;
pub(crate) mod wifi;

use std::cell::RefCell;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, Once};
use std::thread::JoinHandle;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DeregisterShellHookWindow, DestroyWindow, DispatchMessageW, GetMessageW, KillTimer, PostMessageW, PostQuitMessage, RegisterClassW,
    RegisterShellHookWindow, RegisterWindowMessageW, SetTimer, CHILDID_SELF, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE,
    EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUPOPUPEND, EVENT_SYSTEM_MENUPOPUPSTART, EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, MSG,
    OBJID_WINDOW, SPI_SETWORKAREA, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_APP, WM_CLOSE, WM_DESTROY, WM_SETTINGCHANGE, WM_TIMER, WNDCLASSW,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

use crate::launcher::{self, LauncherState};

/// The thread's window and the thread, while it runs.
static THREAD: Mutex<Option<(isize, JoinHandle<()>)>> = Mutex::new(None);
/// The message of Explorer's `TaskbarCreated` broadcast.
static TASKBAR_CREATED: AtomicU32 = AtomicU32::new(0);
/// The message of the shell hook (`RegisterShellHookWindow`).
static SHELLHOOK: AtomicU32 = AtomicU32::new(0);
/// The window class, registered once: a second `RegisterClassW` fails (error 1410).
static CLASS: Once = Once::new();
/// `retry`'s one-shot timer on the thread's window, with an id of its own.
const RETRY_TIMER: usize = 1;
const RETRY_MS: u32 = 50;
/// Posted by `relist`: the windows are listed again, with their pins once the Start list is read, for the bars there are now.
const RELIST: u32 = WM_APP;
/// Posted by `autohide_missed`: arms `AUTOHIDE_TIMER`, which only the window's own thread can.
const AUTOHIDE: u32 = WM_APP + 1;
/// Posted by `stop` with the window as its wparam (`stops`): the window goes, and the loop with it. A WM_CLOSE from outside, or
/// another program's broadcast of the same number, never ends the thread.
const STOP: u32 = WM_APP + 2;
/// Posted by `reserve::refresh`, the work area, `TaskbarCreated` and the appbars' own callbacks, with reserve.rs' flags as the
/// wparam: the docked bars' appbars are brought in line (`reserve::reconcile`).
const REAPPBAR: u32 = WM_APP + 3;
/// Auto-hide a hide could not set is tried again this often while it is still to do (`try_autohide`).
const AUTOHIDE_TIMER: usize = 3;
const AUTOHIDE_MS: u32 = 5000;
/// The waits before each read of the Start list: none, then longer after each read that failed or came back empty (a sign-in
/// where the shell is not ready yet), and none after the last.
const START_LIST: [Duration; 4] = [Duration::ZERO, Duration::from_secs(5), Duration::from_secs(20), Duration::from_secs(60)];

thread_local! {
    /// The thread's window and app, and what found explorer's lock taken there (`defer`).
    static PENDING: RefCell<Pending> = RefCell::default();
}

#[derive(Default)]
struct Pending {
    window: HWND,
    app: Option<AppHandle>,
    /// `retry`'s timer is armed: SetTimer succeeded.
    armed: bool,
    /// Taskbars Windows showed.
    shown: Vec<HWND>,
    /// Explorer made its taskbars anew.
    created: bool,
    /// Auto-hide is to try again (`try_autohide`).
    autohide: bool,
    /// The appbars' flags still to reconcile (`reappbar`), 0 for none.
    appbar: usize,
}

/// Starts the thread unless it runs (`taskbar_apply`, once it has built the bar's window); returns once its window exists.
pub(crate) fn start(app: &AppHandle) {
    let mut thread = THREAD.lock().unwrap_or_else(|e| e.into_inner());
    if thread.is_some() {
        return;
    }
    let (ready, window) = channel();
    let handle = {
        let app = app.clone();
        std::thread::spawn(move || unsafe { run(ready, app) })
    };
    match window.recv() {
        Ok(window) => *thread = Some((window, handle)),
        // No window: the thread has ended.
        Err(_) => {
            let _ = handle.join();
            return;
        }
    }
    drop(thread);
    start::begin();
    pins::watch(app);
    // The tray's spy, if the tray is wanted, now that the bar is on.
    tray::start(app);
    // Pins come from the Start list, which nothing may have read yet; it is read off the thread, which must not wait on the shell,
    // and again a few times while it fails (`START_LIST`), or every pinned app would show twice for the whole session.
    let app = app.clone();
    std::thread::spawn(move || {
        if tries(START_LIST, std::thread::sleep, || launcher::apps(&app.state::<LauncherState>(), false).is_ok()) {
            relist();
            // The notch's ask at the bar's start fails without the list: it asks again (store.ts `followPins` takes one at a time).
            pins::tell(&app);
        }
    });
}

/// The windows are listed again on the running thread (`RELIST`): the Start list has been read, or the bars have changed.
pub(crate) fn relist() {
    post_to_thread(RELIST, 0);
}

/// A hide could not turn auto-hide on (explorer.rs `missed`): the running thread arms its timer (`AUTOHIDE`). Called under
/// explorer's lock, which only waits here for `THREAD`, held briefly.
pub(crate) fn autohide_missed() {
    post_to_thread(AUTOHIDE, 0);
}

fn post_to_thread(msg: u32, wparam: usize) {
    // Only to the thread running now: a window handle kept from before may belong to another app by then.
    if let Some((window, _)) = THREAD.lock().unwrap_or_else(|e| e.into_inner()).as_ref() {
        let _ = unsafe { PostMessageW(Some(HWND(*window as _)), msg, WPARAM(wparam), LPARAM(0)) };
    }
}

/// The thread runs: the bar is on.
fn running() -> bool {
    THREAD.lock().unwrap_or_else(|e| e.into_inner()).is_some()
}

/// Ends the thread: its window closes, and that ends its loop. Never while holding explorer's lock, which the thread takes.
/// Both callers have given Windows' taskbar back first (bar.rs `taskbar_apply` off, `shutdown`).
pub(crate) fn stop() {
    let Some((window, thread)) = THREAD.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
    // The tray's spy goes with the bar, after that restore, whose appbar call reached Explorer through it.
    tray::stop();
    let _ = unsafe { PostMessageW(Some(HWND(window as _)), STOP, WPARAM(window as usize), LPARAM(0)) };
    let _ = thread.join();
    // The helpers went with the thread; Windows' work area no longer lacks their strips.
    reserve::clear();
    start::end(true);
    pins::unwatch();
    tasks::clear();
}

/// Crest quits (`RunEvent::Exit`, sign-out and an installer's close included): Windows' taskbar comes back, then the thread ends.
/// The main thread waits for explorer's lock here: no holder of it waits on the main thread, only on Explorer or the guard.
pub(crate) fn shutdown() {
    // First, so no draw or hotkey still on its way hides Windows' taskbar again after it came back.
    bar::switch_off();
    explorer::set_mode(explorer::Mode::Off);
    // Whatever an earlier Off left (no Explorer then, the appbar calls answered by another program) is tried again at every exit.
    explorer::restore();
    // Not joined: Start's watch may wait on a hung Explorer, and the main thread must not.
    start::end(false);
    stop();
}

unsafe fn run(ready: Sender<isize>, app: AppHandle) {
    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        TASKBAR_CREATED.store(RegisterWindowMessageW(w!("TaskbarCreated")), Ordering::SeqCst);
        SHELLHOOK.store(RegisterWindowMessageW(w!("SHELLHOOK")), Ordering::SeqCst);
        if let Some(window) = window() {
            PENDING.with_borrow_mut(|pending| {
                pending.window = window;
                pending.app = Some(app.clone());
            });
            let others = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
            let hooks = [
                SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, None, Some(on_event), 0, 0, others),
                SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, None, Some(on_event), 0, 0, others),
                SetWinEventHook(EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED, None, Some(on_event), 0, 0, others),
                SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, None, Some(on_event), 0, 0, others),
                SetWinEventHook(EVENT_SYSTEM_MENUPOPUPSTART, EVENT_SYSTEM_MENUPOPUPEND, None, Some(on_menu), 0, 0, others),
                // Crest's own windows too: one of them in front means no app is.
                SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_event), 0, 0, WINEVENT_OUTOFCONTEXT),
            ];
            if hooks.iter().any(|hook| hook.is_invalid()) {
                eprintln!("taskbar: a WinEvent hook failed");
            }
            listen(window);
            tasks::begin(app, window);
            let _ = ready.send(window.0 as isize);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                DispatchMessageW(&msg);
            }
            for hook in hooks {
                let _ = UnhookWinEvent(hook);
            }
        }
        if com {
            CoUninitialize();
        }
    }
}

/// The shell hook, for the flash and ghost-window codes only (tasks.rs), again after Explorer restarts. Without it the list
/// still works, without those.
fn listen(window: HWND) {
    unsafe {
        let _ = DeregisterShellHookWindow(window);
        if !RegisterShellHookWindow(window).as_bool() {
            eprintln!("taskbar: shell hook failed, no flashing or ghost windows");
        }
    }
}

/// Hidden for good: never shown, no taskbar button, never activated.
unsafe fn window() -> Option<HWND> {
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        CLASS.call_once(|| {
            let class = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: instance.into(), lpszClassName: w!("CrestTaskbar"), ..Default::default() };
            if RegisterClassW(&class) == 0 {
                eprintln!("taskbar: window class failed: {}", windows::core::Error::from_thread());
            }
        });
        let style = WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
        CreateWindowExW(style, w!("CrestTaskbar"), w!(""), WS_POPUP, 0, 0, 0, 0, None, None, Some(instance.into()), None)
            .inspect_err(|e| eprintln!("taskbar: window failed: {e}"))
            .ok()
    }
}

/// `stop`'s own STOP: it names the window it is posted to, as no program broadcasting the same number does.
fn stops(msg: u32, wparam: WPARAM, window: HWND) -> bool {
    msg == STOP && wparam.0 == window.0 as usize
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // `stop`'s STOP ends here; the loop ends only on WM_QUIT.
    if stops(msg, wparam, hwnd) {
        let _ = unsafe { DestroyWindow(hwnd) };
        return LRESULT(0);
    }
    // Something else asking it to close (WM_SYSCOMMAND's SC_CLOSE comes here too, through DefWindowProcW): the bar stays.
    if msg == WM_CLOSE {
        return LRESULT(0);
    }
    if msg == WM_DESTROY {
        unsafe {
            let _ = KillTimer(Some(hwnd), RETRY_TIMER);
            let _ = KillTimer(Some(hwnd), tasks::LIST_TIMER);
            let _ = KillTimer(Some(hwnd), AUTOHIDE_TIMER);
            let _ = DeregisterShellHookWindow(hwnd);
            PostQuitMessage(0);
        }
        return LRESULT(0);
    }
    if msg == WM_TIMER && wparam.0 == RETRY_TIMER {
        retry(hwnd);
        return LRESULT(0);
    }
    if msg == WM_TIMER && wparam.0 == tasks::LIST_TIMER {
        tasks::on_timer(hwnd);
        return LRESULT(0);
    }
    if msg == WM_TIMER && wparam.0 == AUTOHIDE_TIMER {
        try_autohide(hwnd);
        return LRESULT(0);
    }
    if msg == RELIST {
        tasks::arm();
        return LRESULT(0);
    }
    if msg == AUTOHIDE {
        let _ = unsafe { SetTimer(Some(hwnd), AUTOHIDE_TIMER, AUTOHIDE_MS, None) };
        return LRESULT(0);
    }
    if msg == REAPPBAR {
        reappbar(wparam.0);
        return LRESULT(0);
    }
    // Auto-hide turned on or off, an appbar came or went: the bar moves with the work area now, not at the mirror's next check.
    if msg == WM_SETTINGCHANGE && wparam.0 == SPI_SETWORKAREA.0 as usize {
        if let Some(app) = PENDING.with_borrow(|pending| pending.app.clone()) {
            bar::work_area_changed(&app);
        }
        // A taskbar that came or went moves the work area: Explorer's may answer the appbar calls now.
        try_autohide(hwnd);
        // Posted, never run here: a broadcast can come while this thread waits inside an appbar call.
        post_to_thread(REAPPBAR, reserve::ASK);
        return LRESULT(0);
    }
    if msg != 0 && msg == SHELLHOOK.load(Ordering::SeqCst) {
        tasks::on_shell(wparam.0 as u32, lparam.0);
        return LRESULT(0);
    }
    if msg != 0 && msg == TASKBAR_CREATED.load(Ordering::SeqCst) {
        if !explorer::on_taskbar_created() {
            defer(|pending| pending.created = true);
        }
        try_autohide(hwnd);
        // A restarted Explorer knows no appbar: each kept one registers again, posted as above.
        post_to_thread(REAPPBAR, reserve::ASK | reserve::RENEW);
        listen(hwnd);
        start::rearm();
        tasks::arm();
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// A window event of another process, or any window brought to front: a window itself shown goes to explorer.rs, and every
/// window event to the list (tasks.rs).
unsafe extern "system" fn on_event(_: HWINEVENTHOOK, event: u32, hwnd: HWND, object: i32, child: i32, _: u32, _: u32) {
    if object != OBJID_WINDOW.0 || child != CHILDID_SELF as i32 {
        return;
    }
    if event == EVENT_OBJECT_SHOW && !explorer::on_show(hwnd) {
        defer(|pending| {
            if !pending.shown.contains(&hwnd) {
                pending.shown.push(hwnd);
            }
        });
    }
    tasks::on_event(event, hwnd);
}

/// A pop-up menu of another process shown or closed, for the tray icon whose menu a right click opened (tray.rs).
unsafe extern "system" fn on_menu(_: HWINEVENTHOOK, event: u32, hwnd: HWND, _: i32, _: i32, _: u32, _: u32) {
    tray::on_menu(event == EVENT_SYSTEM_MENUPOPUPSTART, hwnd);
}

/// Keeps what found explorer's lock taken, and arms `retry` unless it is armed (a timer armed again would only come later).
fn defer(keep: impl FnOnce(&mut Pending)) {
    PENDING.with_borrow_mut(|pending| {
        keep(pending);
        if !pending.armed {
            // Armed only when SetTimer succeeded: a failed one is tried again with the next deferral.
            pending.armed = unsafe { SetTimer(Some(pending.window), RETRY_TIMER, RETRY_MS, None) } != 0;
        }
    });
}

/// Tries after each wait in turn until a try succeeds; whether one did. `sleep` is `thread::sleep` (the tests count the waits).
fn tries(waits: impl IntoIterator<Item = Duration>, mut sleep: impl FnMut(Duration), mut attempt: impl FnMut() -> bool) -> bool {
    waits.into_iter().any(|wait| {
        sleep(wait);
        attempt()
    })
}

/// Does again what found explorer's lock taken, deciding from the mode it reads now, so a hide still never lands after a
/// restore. What finds the lock taken again waits for the next round.
fn retry(window: HWND) {
    let _ = unsafe { KillTimer(Some(window), RETRY_TIMER) };
    let (shown, created, autohide, appbar) = PENDING.with_borrow_mut(|pending| {
        pending.armed = false;
        (
            std::mem::take(&mut pending.shown),
            std::mem::take(&mut pending.created),
            std::mem::take(&mut pending.autohide),
            std::mem::take(&mut pending.appbar),
        )
    });
    if created && !explorer::on_taskbar_created() {
        defer(|pending| pending.created = true);
    }
    if autohide {
        try_autohide(window);
    }
    for hwnd in shown {
        if !explorer::on_show(hwnd) {
            defer(|pending| pending.shown.push(hwnd));
        }
    }
    // Last, once the taskbars are hidden again and auto-hide is set.
    if appbar != 0 {
        reappbar(appbar);
    }
}

/// Brings the docked bars' appbars in line (`reserve::reconcile`), or keeps `flags` for `retry` while explorer's lock is taken.
fn reappbar(flags: usize) {
    let Some(app) = PENDING.with_borrow(|pending| pending.app.clone()) else { return };
    if !reserve::reconcile(&app, flags) {
        defer(|pending| pending.appbar |= flags);
    }
}

/// Tries again the auto-hide a hide could not set (explorer.rs `retry_autohide`), and stops its timer once nothing is left
/// to try. A taken lock defers it, as the rest.
fn try_autohide(window: HWND) {
    if !explorer::retry_autohide() {
        defer(|pending| pending.autohide = true);
    } else if !explorer::missed() {
        let _ = unsafe { KillTimer(Some(window), AUTOHIDE_TIMER) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failed_start_list_is_read_again_less_often_and_not_for_ever() {
        let run = |reads: &[bool]| {
            let (mut waited, mut reads) = (Vec::new(), reads.iter());
            let read = tries(START_LIST, |wait| waited.push(wait.as_secs()), || *reads.next().unwrap());
            (read, waited)
        };
        assert_eq!(run(&[true]), (true, vec![0])); // read at once
        assert_eq!(run(&[false, false, true]), (true, vec![0, 5, 20])); // a sign-in where the shell was not ready yet
        assert_eq!(run(&[false; 4]), (false, vec![0, 5, 20, 60])); // then left: the windows keep no pins
    }

    #[test]
    fn only_stops_own_message_ends_the_thread() {
        let window = HWND(0x1234 as _);
        assert!(stops(STOP, WPARAM(0x1234), window)); // `stop`, naming the window it posts to
        assert!(!stops(STOP, WPARAM(0), window)); // another program's broadcast of WM_APP + 2
        assert!(!stops(STOP, WPARAM(0x5678), window));
        assert!(!stops(WM_CLOSE, WPARAM(0x1234), window));
    }
}
