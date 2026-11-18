//! Windows' own Start and its Win+X menu, opened from the bar's Start button (Windows only).
//!
//! The button sends the Windows key, or Win+X for a right click, once Explorer's process may take the front: no taskbar window
//! is looked for, so it works with Windows' taskbar hidden, and Windows picks where Start opens. A click on the bar brings the
//! bar to the front, which closes Start before the click arrives: Windows says when Start shows and hides (`IAppVisibility`),
//! and a click that comes just after it hid only leaves it closed and gives the keyboard back to the app that had it (tasks.rs
//! `release`).
//!
//! While the bar runs, one MTA thread holds the visibility sink (`begin`, `end`), advised again for a restarted Explorer
//! (`rearm`) and every `RETRY_MS` while it cannot be. The sink runs on a COM thread: it only stores Start's state, so it never
//! waits.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::thread::JoinHandle;
use std::time::Instant;

use windows::core::{implement, BOOL};
use windows::Win32::Foundation::{CloseHandle, HANDLE, WAIT_EVENT, WAIT_OBJECT_0, WAIT_TIMEOUT};
use windows::Win32::Graphics::Gdi::HMONITOR;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForMultipleObjects, INFINITE};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN, VK_X,
};
use windows::Win32::UI::Shell::{AppVisibility, IAppVisibility, IAppVisibilityEvents, IAppVisibilityEvents_Impl, MONITOR_APP_VISIBILITY};
use windows::Win32::UI::WindowsAndMessaging::AllowSetForegroundWindow;

use super::{explorer, tasks};

/// A click this soon after Start hid came while it showed: the click on the bar hid it on its way.
const JUST_CLOSED_MS: u64 = 500;
/// `CLOSED_AT` before Start has hidden once in this run.
const NEVER: u64 = u64::MAX;
/// Start is watched again this often while it cannot be (no Explorer yet at sign-in, say).
const RETRY_MS: u32 = 30_000;

/// Start shows now, as the sink last heard.
static OPEN: AtomicBool = AtomicBool::new(false);
/// When Start last hid, in ms since `BASE`.
static CLOSED_AT: AtomicU64 = AtomicU64::new(NEVER);
static BASE: LazyLock<Instant> = LazyLock::new(Instant::now);
/// The visibility thread's stop event and the thread, while it runs.
static THREAD: Mutex<Option<(isize, JoinHandle<()>)>> = Mutex::new(None);
/// The thread's re-arm event while it runs, else 0: read without a lock by the taskbar thread (`rearm`).
static REARM: AtomicIsize = AtomicIsize::new(0);

#[derive(Debug, PartialEq)]
enum Click {
    Open,
    Close,
}

/// A click on the Start button opens Start, unless Start shows or that click has just hidden it: then it only stays closed.
fn start_click(visible: bool, closed_ms_ago: Option<u64>) -> Click {
    if visible || closed_ms_ago.is_some_and(|ms| ms <= JUST_CLOSED_MS) { Click::Close } else { Click::Open }
}

/// Each key down in order, then up in reverse, so a chord lets go of its last key first. Virtual keys, so the keyboard
/// layout does not matter.
fn keys(vks: &[VIRTUAL_KEY]) -> Vec<INPUT> {
    let key = |vk, flags| INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, dwFlags: flags, ..Default::default() } } };
    vks.iter().map(|&vk| key(vk, KEYBD_EVENT_FLAGS(0))).chain(vks.iter().rev().map(|&vk| key(vk, KEYEVENTF_KEYUP))).collect()
}

/// Start shows now.
pub(crate) fn open() -> bool {
    OPEN.load(Ordering::SeqCst)
}

fn now_ms() -> u64 {
    BASE.elapsed().as_millis() as u64
}

/// How long ago Start hid, in ms; None until it has hidden once in this run.
fn closed_ms_ago() -> Option<u64> {
    Some(CLOSED_AT.load(Ordering::SeqCst)).filter(|&at| at != NEVER).map(|at| now_ms().saturating_sub(at))
}

fn thread() -> MutexGuard<'static, Option<(isize, JoinHandle<()>)>> {
    THREAD.lock().unwrap_or_else(|e| e.into_inner())
}

/// Starts watching Start unless the thread runs (mod.rs `start`). Without the watch every click opens Start.
pub(crate) fn begin() {
    let mut thread = thread();
    if thread.is_some() {
        return;
    }
    let Ok(stop) = (unsafe { CreateEventW(None, true, false, None) }) else { return };
    let Ok(rearm) = (unsafe { CreateEventW(None, false, false, None) }) else {
        let _ = unsafe { CloseHandle(stop) };
        return;
    };
    // As numbers: a HANDLE does not cross threads.
    let (stop, rearm) = (stop.0 as isize, rearm.0 as isize);
    REARM.store(rearm, Ordering::SeqCst);
    *thread = Some((stop, std::thread::spawn(move || watch(HANDLE(stop as _), HANDLE(rearm as _)))));
}

/// Explorer made its taskbars anew (mod.rs `TaskbarCreated`): the thread watches Start again, on the new Explorer. It only sets
/// an event, so the taskbar thread never waits; that thread has ended before `end` closes the event (mod.rs `stop`).
pub(crate) fn rearm() {
    let rearm = REARM.load(Ordering::SeqCst);
    if rearm != 0 {
        let _ = unsafe { SetEvent(HANDLE(rearm as _)) };
    }
}

/// Stops watching Start: the thread lets go of the sink and ends. With `join` false, at Crest's exit (mod.rs `shutdown`), it
/// is only told to: its `Unadvise` may wait on a hung Explorer, and Windows' taskbar is back by then.
pub(crate) fn end(join: bool) {
    let Some((stop, thread)) = thread().take() else { return };
    let stop = HANDLE(stop as _);
    let _ = unsafe { SetEvent(stop) };
    if !join {
        // The events stay open: the thread may still wait on them.
        return;
    }
    let _ = thread.join();
    let _ = unsafe { CloseHandle(stop) };
    let _ = unsafe { CloseHandle(HANDLE(REARM.swap(0, Ordering::SeqCst) as _)) };
    // Nothing hears Start any more: a bar built later must not find it still showing.
    OPEN.store(false, Ordering::SeqCst);
}

/// The visibility thread: the sink is advised until the stop event is set, then unadvised, all COM released before COM ends.
/// A re-arm unadvises it and advises it again on a new object; one not advised is tried again every `RETRY_MS`.
fn watch(stop: HANDLE, rearm: HANDLE) {
    let com = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }.is_ok();
    {
        let sink: IAppVisibilityEvents = Sink.into();
        let mut advised = None;
        loop {
            if advised.is_none() {
                advised = advise(&sink);
            }
            let woke = unsafe { WaitForMultipleObjects(&[stop, rearm], false, if advised.is_some() { INFINITE } else { RETRY_MS }) };
            if woke == WAIT_EVENT(WAIT_OBJECT_0.0 + 1) {
                unadvise(advised.take());
                // What the old Explorer said no longer holds; `advise` reads it again.
                OPEN.store(false, Ordering::SeqCst);
            } else if woke != WAIT_TIMEOUT {
                // The stop event, or a failed wait, which would fail again at once.
                break;
            }
        }
        unadvise(advised);
    }
    if com {
        unsafe { CoUninitialize() };
    }
}

/// Watches Start with `sink`, then reads whether it shows now: the sink hears only changes. None when it cannot be watched;
/// until it is, every click opens Start.
fn advise(sink: &IAppVisibilityEvents) -> Option<(IAppVisibility, u32)> {
    let advised = unsafe { CoCreateInstance::<_, IAppVisibility>(&AppVisibility, None, CLSCTX_INPROC_SERVER) }
        .and_then(|visibility| unsafe { visibility.Advise(sink) }.map(|cookie| (visibility, cookie)))
        .inspect_err(|e| eprintln!("taskbar: Start's visibility not watched, every click opens it: {e}"))
        .ok()?;
    if let Ok(visible) = unsafe { advised.0.IsLauncherVisible() } {
        OPEN.store(visible.as_bool(), Ordering::SeqCst);
    }
    Some(advised)
}

fn unadvise(advised: Option<(IAppVisibility, u32)>) {
    if let Some((visibility, cookie)) = advised {
        let _ = unsafe { visibility.Unadvise(cookie) };
    }
}

/// Runs on a COM thread: it only stores Start's state, never waits.
#[implement(IAppVisibilityEvents)]
struct Sink;

impl IAppVisibilityEvents_Impl for Sink_Impl {
    fn AppVisibilityOnMonitorChanged(&self, _: HMONITOR, _: MONITOR_APP_VISIBILITY, _: MONITOR_APP_VISIBILITY) -> windows::core::Result<()> {
        Ok(())
    }

    fn LauncherVisibilityChange(&self, visible: BOOL) -> windows::core::Result<()> {
        let visible = visible.as_bool();
        // Before `OPEN`, so a click that reads Start hidden also reads when.
        if !visible {
            CLOSED_AT.store(now_ms(), Ordering::SeqCst);
        }
        OPEN.store(visible, Ordering::SeqCst);
        // No release here: it would land mid-click, and the bar item clicked would find an app already in front. The Start
        // button's own click gives the keyboard back (`taskbar_shell`).
        Ok(())
    }
}

/// The Start button: "start" opens Windows' Start, unless that click hid it (`start_click`): then the keyboard goes back to
/// the app (tasks.rs `release`), the click being handled. "winx" opens its Win+X menu. Sync, on the main thread: nothing waits.
#[tauri::command]
pub fn taskbar_shell(action: String) -> Result<(), String> {
    let vks: &[VIRTUAL_KEY] = match action.as_str() {
        "start" if start_click(open(), closed_ms_ago()) == Click::Close => {
            tasks::release();
            return Ok(());
        }
        "start" => &[VK_LWIN],
        "winx" => &[VK_LWIN, VK_X],
        _ => return Err("unknown".into()),
    };
    let inputs = keys(vks);
    // Start and the menu are Explorer's: it may take the front from Crest.
    let _ = unsafe { AllowSetForegroundWindow(explorer::shell_pid()) };
    // Fewer sent: another program's input in between, or a window that blocks it (UIPI).
    if (unsafe { SendInput(&inputs, size_of::<INPUT>() as i32) } as usize) < inputs.len() {
        return Err("failed".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(inputs: &[INPUT]) -> Vec<(VIRTUAL_KEY, KEYBD_EVENT_FLAGS)> {
        inputs.iter().map(|i| unsafe { (i.Anonymous.ki.wVk, i.Anonymous.ki.dwFlags) }).collect()
    }

    #[test]
    fn a_click_while_start_was_just_open_only_closes_it() {
        assert_eq!(start_click(true, None), Click::Close);
        assert_eq!(start_click(false, Some(120)), Click::Close);
        assert_eq!(start_click(false, Some(JUST_CLOSED_MS + 1)), Click::Open);
        assert_eq!(start_click(false, None), Click::Open);
    }

    #[test]
    fn the_windows_key_goes_down_then_up() {
        assert_eq!(pairs(&keys(&[VK_LWIN])), [(VK_LWIN, KEYBD_EVENT_FLAGS(0)), (VK_LWIN, KEYEVENTF_KEYUP)]);
    }

    #[test]
    fn win_x_lets_go_of_x_before_the_windows_key() {
        assert_eq!(
            pairs(&keys(&[VK_LWIN, VK_X])),
            [(VK_LWIN, KEYBD_EVENT_FLAGS(0)), (VK_X, KEYBD_EVENT_FLAGS(0)), (VK_X, KEYEVENTF_KEYUP), (VK_LWIN, KEYEVENTF_KEYUP)]
        );
    }
}
