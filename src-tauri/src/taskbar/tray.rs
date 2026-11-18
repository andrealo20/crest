// Adapted from ManagedShell (Apache-2.0, github.com/cairoshell/ManagedShell), src/ManagedShell.WindowsTray/TrayService.cs and src/ManagedShell.AppBar/AppBarManager.cs (the tray window, forwarding to Explorer and the appbar shared memory).

//! The tray's spy: a hidden window of the class `Shell_TrayWnd` on a thread of its own, kept ahead of Explorer's, so what apps
//! send to the tray (`Shell_NotifyIcon`, `SHAppBarMessage`, in `WM_COPYDATA`) reaches Crest first. Every message goes on to
//! Explorer's own `Shell_TrayWnd`, found by the shell's process, and Explorer's answer goes back to the app: Explorer keeps every
//! icon, so nothing needs giving back however Crest ends. Only the icon position request is Crest's to answer. Another program's
//! own `Shell_TrayWnd` (lumabar, say) wins: while one is there, ahead of the spy or behind, the spy has no window, and looks again
//! every few seconds.
//!
//! A forward waits on Explorer at most `FORWARD_MS`, so no app waits long on a busy Explorer through Crest. Crest's own appbar
//! calls (explorer.rs, auto-hide) are the exception: they wait for Explorer's answer as they did before the spy.
//!
//! The spy runs while the tray is wanted (`taskbar_tray_on`) and the bar's thread runs (mod.rs). Its thread never waits on the
//! main thread, never takes explorer's lock and holds no lock across a forward, during which the messages sent to it run (an
//! appbar call made under explorer's lock among them). Other threads only read its atomics and post to it.

use std::cell::Cell;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, MutexGuard, Once};
use std::thread::JoinHandle;

use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::COPYDATASTRUCT;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Shell::{SHAllocShared, SHFreeShared, SHLockShared, SHUnlockShared};
use windows::Win32::UI::WindowsAndMessaging::{
    ChangeWindowMessageFilterEx, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, FindWindowW, GetMessageW, KillTimer,
    PeekMessageW, PostMessageW, PostThreadMessageW, RegisterClassW, RegisterWindowMessageW, SendMessageTimeoutW, SendMessageW, SendNotifyMessageW,
    SetTimer,
    SetWindowPos, HWND_BROADCAST, HWND_TOPMOST, MSG, MSGFLT_ALLOW, PM_NOREMOVE, SEND_MESSAGE_TIMEOUT_FLAGS, SMTO_ABORTIFHUNG, SMTO_NORMAL,
    SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WM_APP, WM_COPYDATA, WM_TIMER, WNDCLASSW, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_POPUP,
};

use super::explorer;
use super::traywire::{self, Msg, ABD_LEN};
use crate::display::window_pid;

/// A forward gives up after this: the app that called `Shell_NotifyIcon` waits for the answer.
const FORWARD_MS: u32 = 500;
/// And at once when Explorer hangs.
const FORWARD_FLAGS: SEND_MESSAGE_TIMEOUT_FLAGS = SEND_MESSAGE_TIMEOUT_FLAGS(SMTO_ABORTIFHUNG.0 | SMTO_NORMAL.0);
/// The window's check that it is still the first `Shell_TrayWnd`.
const FIRST_TIMER: usize = 1;
const FIRST_MS: u32 = 250;
/// While the spy has no window, the thread looks this often for whether it can have one.
const AGAIN_MS: u32 = 3000;
/// Posted to the thread by `stop`.
const STOP: u32 = WM_APP;

/// The thread's id and the thread, while it runs. Held through a start and a stop, so there is never a second spy.
static THREAD: Mutex<Option<(u32, JoinHandle<()>)>> = Mutex::new(None);
/// The notch wants the tray (`taskbar_tray_on`).
static WISH: AtomicBool = AtomicBool::new(false);
/// The spy's window, 0 while it has none.
static SPY: AtomicIsize = AtomicIsize::new(0);
/// Another program's tray is there, so the spy has no window.
static YIELDED: AtomicBool = AtomicBool::new(false);
/// The window class, registered once: a second `RegisterClassW` fails.
static CLASS: Once = Once::new();

thread_local! {
    /// Explorer's tray the spy last announced itself to with `TaskbarCreated`, 0 for none.
    static ANNOUNCED: Cell<isize> = const { Cell::new(0) };
}

fn thread() -> MutexGuard<'static, Option<(u32, JoinHandle<()>)>> {
    THREAD.lock().unwrap_or_else(|e| e.into_inner())
}

/// Whether the spy should run: the tray is wanted and the bar's thread runs.
fn wanted() -> bool {
    WISH.load(Ordering::SeqCst) && super::running()
}

/// Starts the spy unless it runs, if it is `wanted` (mod.rs `start`, once the bar's thread runs, and `taskbar_tray_on`).
pub(crate) fn start(_app: &AppHandle) {
    let mut thread = thread();
    if thread.is_some() || !wanted() {
        return;
    }
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

/// Another program's tray is there, so Crest has none of the icons.
// Read by the tray's state for the bars, which comes in a later commit; drop this then.
#[allow(dead_code)]
pub(crate) fn yielded() -> bool {
    YIELDED.load(Ordering::SeqCst)
}

/// Puts the spy ahead of Explorer's tray now rather than at its next check (explorer.rs `on_show`): its check's tick, posted,
/// so the caller never waits on the spy's thread, which may be in a forward.
pub(crate) fn raise() {
    let spy = SPY.load(Ordering::SeqCst);
    if spy != 0 {
        let _ = unsafe { PostMessageW(Some(HWND(spy as _)), WM_TIMER, WPARAM(FIRST_TIMER), LPARAM(0)) };
    }
}

/// The notch shows the tray on a bar or no longer does: the spy runs while that holds and the bar is on. Off the async
/// runtime's threads, as a stop waits for a forward.
#[tauri::command]
pub async fn taskbar_tray_on(on: bool, app: AppHandle) {
    WISH.store(on, Ordering::SeqCst);
    let _ = tauri::async_runtime::spawn_blocking(move || if on { start(&app) } else { stop() }).await;
}

/// Whether a `Shell_TrayWnd` there, by its process and whether it is the spy, belongs to another program than Explorer (the
/// `shell` process) and Crest. Without a shell none is known to: a restarting Explorer has its tray before its desktop.
fn other_tray(trays: &[(u32, bool)], shell: u32) -> bool {
    shell != 0 && trays.iter().any(|&(pid, spy)| !spy && pid != shell)
}

fn other_program() -> bool {
    let trays: Vec<(u32, bool)> = explorer::windows_of(w!("Shell_TrayWnd")).into_iter().map(|hwnd| (window_pid(hwnd), is_spy(hwnd))).collect();
    other_tray(&trays, explorer::shell_pid())
}

unsafe fn run(ready: Sender<u32>) {
    unsafe {
        let mut msg = MSG::default();
        // The thread's queue, before `stop` can post to it.
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
        if ready.send(GetCurrentThreadId()).is_err() {
            return;
        }
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
        YIELDED.store(false, Ordering::SeqCst);
    }
}

/// The window, unless another program's tray is there; then it checks at once that it is first.
unsafe fn appear() {
    let other = other_program();
    YIELDED.store(other, Ordering::SeqCst);
    if other {
        return;
    }
    let Some(spy) = (unsafe { window() }) else { return };
    SPY.store(spy.0 as isize, Ordering::SeqCst);
    unsafe {
        // Low-integrity apps (a sandboxed browser) reach it too, as they reach Explorer's.
        let _ = ChangeWindowMessageFilterEx(spy, WM_COPYDATA, MSGFLT_ALLOW, None);
        let _ = SetTimer(Some(spy), FIRST_TIMER, FIRST_MS, None);
        keep_first(spy);
    }
}

/// The window goes. Apps that announced their icons to it hear `TaskbarCreated` and add them again to the tray now first, so an
/// icon whose forward timed out reaches Explorer after all.
unsafe fn vanish(spy: HWND) {
    let _ = unsafe { DestroyWindow(spy) };
    SPY.store(0, Ordering::SeqCst);
    if ANNOUNCED.replace(0) != 0 {
        announce();
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

/// Every `FIRST_MS` and on `raise`: the spy leaves the tray to another program's `Shell_TrayWnd` whenever one is there, ahead of
/// it or behind, and otherwise goes ahead of every other `Shell_TrayWnd` again. Once first, it announces itself once to each
/// Explorer tray (the first, and a restarted Explorer's), so apps add their icons through it.
unsafe fn keep_first(spy: HWND) {
    if other_program() {
        YIELDED.store(true, Ordering::SeqCst);
        unsafe { vanish(spy) };
        return;
    }
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
    if msg == WM_TIMER && wparam.0 == FIRST_TIMER {
        unsafe { keep_first(hwnd) };
        return LRESULT(0);
    }
    if msg == WM_COPYDATA {
        return LRESULT(unsafe { copy_data(wparam, lparam) });
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
    unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
}

/// What an app sent in `WM_COPYDATA` (traywire.rs). The icon store reads an icon message here first and the position request is
/// answered from the icon last clicked, both in a later commit; until then the request gets 0.
unsafe fn copy_data(wparam: WPARAM, lparam: LPARAM) -> isize {
    let Some(data) = (unsafe { (lparam.0 as *const COPYDATASTRUCT).as_ref() }) else { return 0 };
    let bytes = if data.lpData.is_null() { &[][..] } else { unsafe { std::slice::from_raw_parts(data.lpData as *const u8, data.cbData as usize) } };
    match traywire::parse(data.dwData, bytes) {
        Msg::GetRect { .. } => 0,
        Msg::AppBar => {
            // Crest's own auto-hide calls wait on Explorer as before the spy: its safety net reads a timeout's 0 as an answer.
            let wait = traywire::waits_for_explorer(bytes, std::process::id());
            unsafe { appbar(wparam, bytes, wait) }.unwrap_or_else(|| forward(WM_COPYDATA, wparam, lparam, wait))
        }
        Msg::Icon(..) | Msg::Other => forward(WM_COPYDATA, wparam, lparam, false),
    }
}

/// Explorer's answer to `msg`, 0 when there is no Explorer or it does not answer in time (`send`).
fn forward(msg: u32, wparam: WPARAM, lparam: LPARAM, wait: bool) -> isize {
    explorer::explorer_tray().and_then(|to| send(to, msg, wparam, lparam, wait)).unwrap_or(0)
}

/// Sends to Explorer's tray, waiting at most `FORWARD_MS` and not at all on a hung Explorer: its answer, None without one. With
/// `wait`, for as long as Explorer takes; the messages apps send to the spy meanwhile still run, each with the cap.
fn send(to: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, wait: bool) -> Option<isize> {
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

    #[test]
    fn crest_leaves_the_tray_to_another_program() {
        // (pid, is the spy) of every top-level Shell_TrayWnd; shell pid 10, Crest 20.
        assert!(!other_tray(&[(10, false)], 10));
        assert!(!other_tray(&[(10, false), (20, true)], 10));
        assert!(other_tray(&[(30, false), (10, false)], 10));
    }

    #[test]
    fn without_a_shell_no_other_program_is_known() {
        // Explorer restarting: its new tray is there before its desktop window.
        assert!(!other_tray(&[(30, false), (20, true)], 0));
    }

    #[test]
    fn a_forward_never_waits_long() {
        assert!(FORWARD_MS <= 500);
        assert_eq!(FORWARD_FLAGS, SMTO_ABORTIFHUNG | SMTO_NORMAL);
    }
}
