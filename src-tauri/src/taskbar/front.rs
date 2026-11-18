//! The window in front of each bar's monitor, read by the display poll every 400 ms (display.rs `spawn`).
//!
//! Only that window counts, never one behind it: the app in front when it is on that monitor (a dialog counts as its app); none
//! on the monitor where the desktop was clicked; otherwise the monitor's frontmost window that has a button and is not
//! minimized. Start, search, the quick settings, the notification centre and the calendar have no button, so they never count;
//! the poll's foreground is never a bar, so a click on a bar never counts either.
//!
//! Each bar hides over a full-screen app in front of its own monitor (`screens::set_fullscreen`). While "hide when a window
//! touches it" is on (`taskbar_auto_hide`), each bar is also sent that window's frame in its CSS px when it changes
//! (`taskbar://front`): the page knows the bar's shape and decides whether the frame touches it. A bar with another monitor
//! below it is sent none, so it never slides away: the pointer would pass to that monitor instead of stopping at the edge.
//!
//! On the display poll's thread: Win32 reads only, and no lock held across `set_fullscreen` or an emit.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, WebviewWindow};
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, MonitorFromPoint, HDC, HMONITOR, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN};
use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, GetWindowRect, IsIconic, GA_ROOTOWNER};

use super::{screens, tasks};
use crate::display;

/// "Hide when a window touches it" is on. The notch applies it, as it does the bar's other settings (`taskbar_auto_hide`).
static AUTO_HIDE: AtomicBool = AtomicBool::new(false);
/// What each bar was last sent, by label (`taskbar_front`). Held only to read or write it, never across an emit.
static SENT: LazyLock<Mutex<HashMap<String, Option<Rect>>>> = LazyLock::new(Mutex::default);

/// A window's frame in a bar window's CSS px, from that window's top-left.
#[derive(Clone, Copy, PartialEq, Debug, Serialize)]
pub struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// The foreground window as the rule sees it.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Fg {
    /// The desktop (`display::is_desktop`), which spans every monitor.
    Desktop,
    /// The listed window it stands for: itself, or the app whose dialog it is.
    Listed(isize),
    /// Anything without a button: a Crest window, Start and the other shell flyouts, a tool window.
    Other,
}

impl Fg {
    fn of(hwnd: HWND, own: u32) -> Fg {
        if display::is_desktop(hwnd) {
            return Fg::Desktop;
        }
        if tasks::listable(hwnd, own) {
            return Fg::Listed(hwnd.0 as isize);
        }
        // A dialog stands for the app that has the button, as for the bars' mark of the window in front (tasks.rs `active_of`).
        let owner = unsafe { GetAncestor(hwnd, GA_ROOTOWNER) };
        if tasks::listable(owner, own) { Fg::Listed(owner.0 as isize) } else { Fg::Other }
    }
}

/// The window in front of a monitor: the app in front when it is on this monitor (`fg_here`); none on the pointer's monitor
/// when the desktop is in front, since the desktop spans them all and that is where it was clicked; otherwise the first of
/// `stack`, this monitor's windows with a button and not minimized, front to back.
fn front(fg: Fg, fg_here: bool, pointer_here: bool, stack: &[isize]) -> Option<isize> {
    match fg {
        Fg::Listed(id) if fg_here => Some(id),
        Fg::Desktop if pointer_here => None,
        _ => stack.first().copied(),
    }
}

/// Another monitor shares part of this one's bottom edge: there the pointer passes on to it instead of stopping at the edge,
/// so a bar that slid away could not be brought back.
fn below(monitor: RECT, all: &[RECT]) -> bool {
    all.iter().any(|o| o.top == monitor.bottom && o.left < monitor.right && o.right > monitor.left)
}

/// A frame in physical px as the bar window's CSS px: from the window's top-left `origin`, at `scale` (its DPI / 96).
fn in_bar(frame: RECT, (x, y): (i32, i32), scale: f64) -> Rect {
    // From `a` to `b`, in CSS px.
    let css = |a: i32, b: i32| (f64::from(b) - f64::from(a)) / scale;
    Rect { x: css(x, frame.left), y: css(y, frame.top), w: css(frame.left, frame.right), h: css(frame.top, frame.bottom) }
}

/// Every bar's full screen and, while the option is on, the frame of the window in front of its monitor, from one read of the
/// windows (display.rs `spawn`, every 400 ms). `foreground` is the window in front as the notch's rules read it, never a bar.
pub(crate) fn poll(app: &AppHandle, foreground: HWND) {
    let bars = screens::all();
    if bars.is_empty() {
        return;
    }
    let own = unsafe { GetCurrentProcessId() };
    let fg = Fg::of(foreground, own);
    let fg_on = tasks::monitor_of(foreground);
    // The app a dialog stands for is in front on its own window's monitor, whose bar marks it as in front (tasks.rs `for_monitor`).
    let listed_on = match fg {
        Fg::Listed(id) => tasks::monitor_of(HWND(id as _)),
        _ => fg_on,
    };
    let pointer = pointer_monitor();
    // Windows says it of the foreground only.
    let exclusive = unsafe { SHQueryUserNotificationState() }.is_ok_and(|s| s == QUNS_RUNNING_D3D_FULL_SCREEN);
    let bars: Vec<(String, HWND, isize)> = bars.into_iter().map(|(label, hwnd)| (label, HWND(hwnd as _), tasks::monitor_of(HWND(hwnd as _)))).collect();
    // Each bar's monitor's windows with a button and not minimized, front to back, from one pass over the z-order.
    let mut stacks: HashMap<isize, Vec<isize>> = bars.iter().map(|&(_, _, m)| (m, Vec::new())).collect();
    for hwnd in display::top_windows() {
        if tasks::listable(hwnd, own) && !unsafe { IsIconic(hwnd) }.as_bool() {
            if let Some(stack) = stacks.get_mut(&tasks::monitor_of(hwnd)) {
                stack.push(hwnd.0 as isize);
            }
        }
    }
    let auto_hide = AUTO_HIDE.load(Ordering::SeqCst);
    let monitors = if auto_hide { monitors() } else { Vec::new() };
    let mut rects = Vec::new();
    for (label, bar, m) in &bars {
        let ahead = front(fg, listed_on == *m, pointer == Some(*m), &stacks[m]);
        let monitor = HMONITOR(*m as _);
        // The foreground counts with Windows' exclusive full screen, which speaks of it only; the window in front, if another, without.
        let full = (fg_on == *m && display::fills(foreground, monitor, exclusive))
            || ahead.is_some_and(|w| w != foreground.0 as isize && display::fills(HWND(w as _), monitor, false));
        screens::set_fullscreen(app, label, full);
        if auto_hide {
            rects.push((label.clone(), rect_for(ahead, *bar, *m, &monitors)));
        }
    }
    if auto_hide {
        send(app, rects);
    }
}

/// What a bar is sent while the option is on: the frame of the window in front of its monitor, in the bar's CSS px. None
/// without one, and on a monitor with another below it. The bar's place and scale are read as the pointer poll reads them
/// (hit_test.rs `geometry`), never from the main thread.
fn rect_for(ahead: Option<isize>, bar: HWND, monitor: isize, monitors: &[(isize, RECT)]) -> Option<Rect> {
    let ahead = HWND(ahead? as _);
    let &(_, here) = monitors.iter().find(|&&(m, _)| m == monitor)?;
    if below(here, &monitors.iter().map(|&(_, rect)| rect).collect::<Vec<_>>()) {
        return None;
    }
    let mut origin = RECT::default();
    unsafe { GetWindowRect(bar, &mut origin) }.ok()?;
    let dpi = unsafe { GetDpiForWindow(bar) };
    (dpi > 0).then(|| in_bar(display::frame_rect(ahead), (origin.left, origin.top), f64::from(dpi) / 96.0))
}

/// Sends each bar its rect when it differs from what it was last sent; the record keeps only the bars there are now. Nothing
/// if the option was turned off meanwhile, so the record stays as `taskbar_auto_hide` left it: empty.
fn send(app: &AppHandle, rects: Vec<(String, Option<Rect>)>) {
    let changed: Vec<(String, Option<Rect>)> = {
        let mut sent = sent();
        if !AUTO_HIDE.load(Ordering::SeqCst) {
            return;
        }
        let changed = rects.iter().filter(|(label, rect)| sent.get(label) != Some(rect)).cloned().collect();
        *sent = rects.into_iter().collect();
        changed
    };
    for (label, rect) in changed {
        let _ = app.emit_to(label, "taskbar://front", rect);
    }
}

/// Every monitor's handle and rect in physical px. Without a DC, the rect Windows passes is the monitor's (`rcMonitor`).
fn monitors() -> Vec<(isize, RECT)> {
    unsafe extern "system" fn each(monitor: HMONITOR, _: HDC, rect: *mut RECT, list: LPARAM) -> BOOL {
        (*(list.0 as *mut Vec<(isize, RECT)>)).push((monitor.0 as isize, *rect));
        true.into()
    }
    let mut list: Vec<(isize, RECT)> = Vec::new();
    let _ = unsafe { EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut list as *mut Vec<(isize, RECT)> as isize)) };
    list
}

/// The monitor under the pointer; None while the pointer cannot be read (a secure desktop).
fn pointer_monitor() -> Option<isize> {
    let mut point = POINT::default();
    unsafe { GetCursorPos(&mut point) }.ok()?;
    Some(unsafe { MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST) }.0 as isize)
}

fn sent() -> MutexGuard<'static, HashMap<String, Option<Rect>>> {
    SENT.lock().unwrap_or_else(|e| e.into_inner())
}

/// Turns "hide when a window touches it" on or off: the notch only, as it applies the bar's other settings. On a change the
/// record is cleared, so the next poll sends every bar its rect again.
#[tauri::command]
pub fn taskbar_auto_hide(on: bool) {
    // Under the record's lock, so a poll that read the option before this never fills the record again after it.
    let mut sent = sent();
    if AUTO_HIDE.swap(on, Ordering::SeqCst) != on {
        sent.clear();
    }
}

/// What the calling bar was last sent, for a page that has just loaded: None before the first poll and while the option is
/// off. `taskbar://front` brings each change.
#[tauri::command]
pub fn taskbar_front(window: WebviewWindow) -> Option<Rect> {
    sent().get(window.label()).copied().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_in_front_of_a_monitor() {
        let stack = [7, 8];
        assert_eq!(front(Fg::Listed(5), true, false, &stack), Some(5)); // the app in front, here
        assert_eq!(front(Fg::Listed(5), false, true, &stack), Some(7)); // in front on another monitor: this one's top window
        assert_eq!(front(Fg::Desktop, true, true, &stack), None); // the desktop clicked here
        assert_eq!(front(Fg::Desktop, false, false, &stack), Some(7)); // the desktop clicked on another monitor
        assert_eq!(front(Fg::Other, true, true, &stack), Some(7)); // Start, a flyout or the bar itself: as before it came
        assert_eq!(front(Fg::Other, true, true, &[]), None);
    }

    #[test]
    fn a_bar_with_a_monitor_below_never_slides_away() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        let (top, laptop) = (r(0, -1080, 1920, 0), r(320, 0, 1760, 900));
        assert!(below(top, &[top, laptop])); // an external monitor above a laptop
        assert!(!below(laptop, &[top, laptop]));
        assert!(!below(r(0, 0, 1920, 1080), &[r(0, 0, 1920, 1080), r(1920, 0, 3840, 1080)])); // side by side
        assert!(!below(top, &[top, r(1920, 0, 2560, 900)])); // below the line, but past its right edge
    }

    #[test]
    fn a_frame_in_the_bars_css_px() {
        let frame = RECT { left: 100, top: 1000, right: 1100, bottom: 2100 };
        assert_eq!(in_bar(frame, (0, 1200), 2.0), Rect { x: 50.0, y: -100.0, w: 500.0, h: 550.0 });
    }
}
