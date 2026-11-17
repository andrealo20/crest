//! Crest's own taskbar (Windows only).
//!
//! While the bar's window exists, one thread keeps a hidden top-level window and a WinEvent hook: a taskbar Windows shows
//! again is hidden again while Crest hides them (explorer.rs `on_show`), and so are a restarted Explorer's new ones, which it
//! announces with the `TaskbarCreated` broadcast. Only top-level windows get broadcasts, so the window is not message-only.
//! The thread never waits for explorer's lock: what finds it taken is done again by a short timer (`defer`, `retry`).

pub(crate) mod bar;
pub(crate) mod explorer;

use std::cell::RefCell;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, Once};
use std::thread::JoinHandle;

use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, KillTimer, PostMessageW, PostQuitMessage, RegisterClassW, RegisterWindowMessageW, SetTimer,
    CHILDID_SELF, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, EVENT_OBJECT_SHOW, MSG, OBJID_WINDOW, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_CLOSE,
    WM_DESTROY, WM_TIMER, WNDCLASSW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP,
};

/// The thread's window and the thread, while it runs.
static THREAD: Mutex<Option<(isize, JoinHandle<()>)>> = Mutex::new(None);
/// The message of Explorer's `TaskbarCreated` broadcast.
static TASKBAR_CREATED: AtomicU32 = AtomicU32::new(0);
/// The window class, registered once: a second `RegisterClassW` fails (error 1410).
static CLASS: Once = Once::new();
/// `retry`'s one-shot timer on the thread's window, with an id of its own.
const RETRY_TIMER: usize = 1;
const RETRY_MS: u32 = 50;

thread_local! {
    /// The thread's window, and what found explorer's lock taken there (`defer`).
    static PENDING: RefCell<Pending> = RefCell::default();
}

#[derive(Default)]
struct Pending {
    window: HWND,
    /// Taskbars Windows showed.
    shown: Vec<HWND>,
    /// Explorer made its taskbars anew.
    created: bool,
}

/// Starts the thread unless it runs (`taskbar_apply`, once it has built the bar's window); returns once its window exists.
pub(crate) fn start() {
    let mut thread = THREAD.lock().unwrap_or_else(|e| e.into_inner());
    if thread.is_some() {
        return;
    }
    let (ready, window) = channel();
    let handle = std::thread::spawn(move || unsafe { run(ready) });
    match window.recv() {
        Ok(window) => *thread = Some((window, handle)),
        // No window: the thread has ended.
        Err(_) => {
            let _ = handle.join();
        }
    }
}

/// Ends the thread: its window closes, and that ends its loop. Never while holding explorer's lock, which the thread takes.
pub(crate) fn stop() {
    let Some((window, thread)) = THREAD.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
    let _ = unsafe { PostMessageW(Some(HWND(window as _)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
    let _ = thread.join();
}

/// Crest quits (`RunEvent::Exit`, sign-out and an installer's close included): Windows' taskbar comes back, then the thread ends.
/// The main thread waits for explorer's lock here: no holder of it waits on the main thread, only on Explorer or the guard.
pub(crate) fn shutdown() {
    // First, so no draw or hotkey still on its way hides Windows' taskbar again after it came back.
    bar::switch_off();
    explorer::set_mode(explorer::Mode::Off);
    // Whatever an earlier Off left (no Explorer then, the appbar calls answered by another program) is tried again at every exit.
    explorer::restore();
    stop();
}

unsafe fn run(ready: Sender<isize>) {
    unsafe {
        let com = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
        TASKBAR_CREATED.store(RegisterWindowMessageW(w!("TaskbarCreated")), Ordering::SeqCst);
        if let Some(window) = window() {
            PENDING.with_borrow_mut(|pending| pending.window = window);
            let hook = SetWinEventHook(EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, None, Some(on_event), 0, 0, WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS);
            if hook.is_invalid() {
                eprintln!("taskbar: WinEvent hook failed");
            }
            let _ = ready.send(window.0 as isize);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                DispatchMessageW(&msg);
            }
            let _ = UnhookWinEvent(hook);
        }
        if com {
            CoUninitialize();
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

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // `stop`'s WM_CLOSE ends here, through DefWindowProcW; the loop ends only on WM_QUIT.
    if msg == WM_DESTROY {
        let _ = unsafe { KillTimer(Some(hwnd), RETRY_TIMER) };
        unsafe { PostQuitMessage(0) };
        return LRESULT(0);
    }
    if msg == WM_TIMER && wparam.0 == RETRY_TIMER {
        retry(hwnd);
        return LRESULT(0);
    }
    if msg != 0 && msg == TASKBAR_CREATED.load(Ordering::SeqCst) {
        if !explorer::on_taskbar_created() {
            defer(|pending| pending.created = true);
        }
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// A window shown, hidden or destroyed outside Crest; only a window itself shown counts here.
unsafe extern "system" fn on_event(_: HWINEVENTHOOK, event: u32, hwnd: HWND, object: i32, child: i32, _: u32, _: u32) {
    if event == EVENT_OBJECT_SHOW && object == OBJID_WINDOW.0 && child == CHILDID_SELF as i32 && !explorer::on_show(hwnd) {
        defer(|pending| {
            if !pending.shown.contains(&hwnd) {
                pending.shown.push(hwnd);
            }
        });
    }
}

/// Keeps what found explorer's lock taken, and arms `retry` if nothing waited yet (a timer armed again would only come later).
fn defer(keep: impl FnOnce(&mut Pending)) {
    PENDING.with_borrow_mut(|pending| {
        let armed = pending.created || !pending.shown.is_empty();
        keep(pending);
        if !armed {
            let _ = unsafe { SetTimer(Some(pending.window), RETRY_TIMER, RETRY_MS, None) };
        }
    });
}

/// Does again what found explorer's lock taken, deciding from the mode it reads now, so a hide still never lands after a
/// restore. What finds the lock taken again waits for the next round.
fn retry(window: HWND) {
    let _ = unsafe { KillTimer(Some(window), RETRY_TIMER) };
    let (shown, created) = PENDING.with_borrow_mut(|pending| (std::mem::take(&mut pending.shown), std::mem::take(&mut pending.created)));
    if created && !explorer::on_taskbar_created() {
        defer(|pending| pending.created = true);
    }
    for hwnd in shown {
        if !explorer::on_show(hwnd) {
            defer(|pending| pending.shown.push(hwnd));
        }
    }
}
