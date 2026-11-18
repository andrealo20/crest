//! The window in front of each bar's monitor, read by the display poll every 400 ms (display.rs `spawn`).
//!
//! Only that window counts, never one behind it: the app in front when it is on that monitor (a dialog counts as its app); none
//! on the monitor where the pointer was when the desktop came to the front; otherwise the monitor's frontmost window that has a
//! button and is not minimized. Start, search, the quick settings, the notification centre, the calendar and Crest's own
//! windows have no button: while one of them is in front, the rule keeps the foreground that came before it (`Seen`), so it
//! leaves every bar as it was. The poll's foreground is never a bar, so a click on a bar never counts either.
//!
//! Each bar hides over a full-screen app in front of its own monitor (`screens::set_fullscreen`). While "hide when a window
//! touches it" is on (`taskbar_auto_hide`), each bar is also sent that window's frame in its CSS px when it changes
//! (`taskbar://front`): the page knows the bar's shape and decides whether the frame touches it. A bar the pointer could not
//! bring back is sent none, so it never slides away (`stays_up`): one whose work area ends above its monitor's bottom edge,
//! or with another monitor below it. The settings say when a bar stays up (`taskbar_slide_blocked`). While the option is on,
//! each bar is also told when one of Windows' own surfaces holds it up (`taskbar://hold`, `held`): Start, Win+X, the calendar,
//! the notification centre, an app's tray menu.
//!
//! On the display poll's thread: Win32 reads only, and no lock held across `set_fullscreen` or an emit.

use std::cell::Cell;
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

use super::{screens, start, tasks};
use crate::display;

/// "Hide when a window touches it" is on. The notch applies it, as it does the bar's other settings (`taskbar_auto_hide`).
static AUTO_HIDE: AtomicBool = AtomicBool::new(false);
/// What each bar was last sent, by label (`taskbar_front`). Held only to read or write it, never across an emit.
static SENT: LazyLock<Mutex<HashMap<String, Option<Rect>>>> = LazyLock::new(Mutex::default);
/// What the bars were last sent as `taskbar://hold`; false again once the option is off.
static HELD: AtomicBool = AtomicBool::new(false);

thread_local! {
    /// What the rule keeps between polls (`Seen`), on the display poll's thread, the only one that polls.
    static SEEN: Cell<Seen> = const { Cell::new(Seen { fg: None, desktop_on: None }) };
}

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

/// What the rule keeps between polls: the last foreground that was not `Other`, and the monitor the pointer was on when the
/// desktop came to the front.
#[derive(Clone, Copy, PartialEq, Debug, Default)]
struct Seen {
    fg: Option<Fg>,
    desktop_on: Option<isize>,
}

impl Seen {
    /// After a poll that finds `now` in front with the pointer on `pointer`. A surface without a button keeps what came before
    /// it; the desktop takes the pointer's monitor as it comes to the front, and keeps it through such surfaces until an app
    /// comes to the front.
    fn next(self, now: Fg, pointer: Option<isize>) -> Seen {
        match now {
            Fg::Other => self,
            Fg::Desktop if self.fg == Some(Fg::Desktop) => self,
            Fg::Desktop => Seen { fg: Some(now), desktop_on: pointer },
            Fg::Listed(_) => Seen { fg: Some(now), desktop_on: None },
        }
    }
}

/// The window in front of a monitor for the foreground the rule keeps: the app when it is on this monitor (`fg_here`); none on
/// the monitor where the desktop came to the front (`desktop_here`), since the desktop spans them all; otherwise the first of
/// `stack`, this monitor's windows with a button and not minimized, front to back.
fn front(fg: Fg, fg_here: bool, desktop_here: bool, stack: &[isize]) -> Option<isize> {
    match fg {
        Fg::Listed(id) if fg_here => Some(id),
        Fg::Desktop if desktop_here => None,
        _ => stack.first().copied(),
    }
}

/// Windows' own surfaces hold the bars up, as their own menus do: Start while it shows, or a window in front with no button
/// (`other`) that is not Crest's, such as Win+X, the calendar, the notification centre or an app's tray menu.
fn held(start_open: bool, other: bool, crest: bool) -> bool {
    start_open || (other && !crest)
}

/// Another monitor shares part of this one's bottom edge: there the pointer passes on to it instead of stopping at the edge,
/// so a bar that slid away could not be brought back.
fn below(monitor: RECT, all: &[RECT]) -> bool {
    all.iter().any(|o| o.top == monitor.bottom && o.left < monitor.right && o.right > monitor.left)
}

/// The pointer could not bring a bar on this monitor back, so it never slides away. The bar's window stands on the work
/// area's bottom: where that ends above the monitor's bottom edge (another appbar there, or a band Windows' taskbar still
/// keeps), the strip that brings it back floats above the edge, where the pointer does not stop; and with another monitor
/// below (`below`) the pointer passes on to it.
fn stays_up(monitor: RECT, work: RECT, all: &[RECT]) -> bool {
    work.bottom < monitor.bottom || below(monitor, all)
}

/// How many of `monitors`, each bar's monitor and work area, keep their bar up (`stays_up`) among `all` the monitors.
fn blocked_count(monitors: &[(RECT, RECT)], all: &[RECT]) -> usize {
    monitors.iter().filter(|&&(monitor, work)| stays_up(monitor, work, all)).count()
}

/// A frame in physical px as the bar window's CSS px: from the window's top-left `origin`, at `scale` (its DPI / 96).
fn in_bar(frame: RECT, (x, y): (i32, i32), scale: f64) -> Rect {
    // From `a` to `b`, in CSS px.
    let css = |a: i32, b: i32| (f64::from(b) - f64::from(a)) / scale;
    Rect { x: css(x, frame.left), y: css(y, frame.top), w: css(frame.left, frame.right), h: css(frame.top, frame.bottom) }
}

/// Every bar's full screen and, while the option is on, the frame of the window in front of its monitor, from one read of the
/// windows (display.rs `spawn`, every 400 ms). `foreground` is the window in front as the notch's rules read it, never a bar;
/// `raw` is the one Windows says is in front, which may be a bar or null.
pub(crate) fn poll(app: &AppHandle, raw: HWND, foreground: HWND) {
    let bars = screens::all();
    if bars.is_empty() {
        // The bars are off: what came before them is forgotten, and the hold, so bars built later hear it on its next change.
        SEEN.set(Seen::default());
        HELD.store(false, Ordering::SeqCst);
        return;
    }
    let own = unsafe { GetCurrentProcessId() };
    let seen = SEEN.get().next(Fg::of(foreground, own), pointer_monitor());
    SEEN.set(seen);
    // Before any app or the desktop has been in front, `front` falls back to each monitor's top window.
    let fg = seen.fg.unwrap_or(Fg::Other);
    let fg_on = tasks::monitor_of(foreground);
    // The app a dialog stands for is in front on its own window's monitor, whose bar marks it as in front (tasks.rs `for_monitor`).
    let listed_on = match fg {
        Fg::Listed(id) => tasks::monitor_of(HWND(id as _)),
        _ => fg_on,
    };
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
    let hold = auto_hide && {
        // A null foreground (nothing active) holds nothing, or the bars would stay up as long as it lasts; Start is heard on its own.
        let other = !raw.is_invalid() && Fg::of(raw, own) == Fg::Other && !screens::is_bar(raw.0 as isize);
        held(start::open(), other, display::window_pid(raw) == own)
    };
    // Each bar on a change, before the frames, so a bar under a surface never starts to slide; false once the option is off.
    if HELD.swap(hold, Ordering::SeqCst) != hold {
        for (label, _, _) in &bars {
            let _ = app.emit_to(label.as_str(), "taskbar://hold", hold);
        }
    }
    let monitors = if auto_hide { monitors() } else { Vec::new() };
    let mut rects = Vec::new();
    for (label, bar, m) in &bars {
        let ahead = front(fg, listed_on == *m, seen.desktop_on == Some(*m), &stacks[m]);
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
/// without one, and where the bar stays up (`stays_up`). The bar's place and scale are read as the pointer poll reads them
/// (hit_test.rs `geometry`), never from the main thread.
fn rect_for(ahead: Option<isize>, bar: HWND, monitor: isize, monitors: &[(isize, RECT, RECT)]) -> Option<Rect> {
    let ahead = HWND(ahead? as _);
    let &(_, here, work) = monitors.iter().find(|&&(m, _, _)| m == monitor)?;
    if stays_up(here, work, &monitors.iter().map(|&(_, rect, _)| rect).collect::<Vec<_>>()) {
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

/// Every monitor's handle, rect and work area in physical px (`rcMonitor`, `rcWork`). One Windows cannot read is left out,
/// so its bar stays up.
fn monitors() -> Vec<(isize, RECT, RECT)> {
    unsafe extern "system" fn each(monitor: HMONITOR, _: HDC, _: *mut RECT, list: LPARAM) -> BOOL {
        if let Some((rect, work)) = display::monitor_rect(monitor) {
            (*(list.0 as *mut Vec<(isize, RECT, RECT)>)).push((monitor.0 as isize, rect, work));
        }
        true.into()
    }
    let mut list: Vec<(isize, RECT, RECT)> = Vec::new();
    let _ = unsafe { EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut list as *mut Vec<(isize, RECT, RECT)> as isize)) };
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

/// How many bars could not slide away with "hide when a window touches it" on (`stays_up`), for the settings' note; 0 while
/// the bar is off. The monitors are read off the main thread.
#[tauri::command]
pub async fn taskbar_slide_blocked() -> usize {
    let count = || {
        let read = monitors();
        let all: Vec<RECT> = read.iter().map(|&(_, rect, _)| rect).collect();
        let bars: Vec<(RECT, RECT)> = screens::all()
            .into_iter()
            .filter_map(|(_, hwnd)| {
                let m = tasks::monitor_of(HWND(hwnd as _));
                read.iter().find(|&&(h, _, _)| h == m).map(|&(_, rect, work)| (rect, work))
            })
            .collect();
        blocked_count(&bars, &all)
    };
    tauri::async_runtime::spawn_blocking(count).await.unwrap_or(0)
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
    fn start_and_the_notch_leave_the_bars_as_they_were() {
        let (m1, m2) = (Some(1), Some(2));
        let app = Seen::default().next(Fg::Listed(5), m1);
        assert_eq!(app.next(Fg::Other, m2), app); // Start over an app: still the app
        let desktop = app.next(Fg::Desktop, m1);
        assert_eq!(desktop, Seen { fg: Some(Fg::Desktop), desktop_on: m1 }); // the desktop clicked on m1
        assert_eq!(desktop.next(Fg::Desktop, m2), desktop); // the pointer moved to m2: still m1
        assert_eq!(desktop.next(Fg::Other, m2), desktop); // then Start: still the desktop on m1
        assert_eq!(desktop.next(Fg::Listed(5), m1).next(Fg::Desktop, m2).desktop_on, m2); // an app, then the desktop from m2
        assert_eq!(Seen::default().next(Fg::Other, m1), Seen::default()); // nothing before: each monitor's top window
    }

    #[test]
    fn start_and_windows_menus_hold_the_bar_but_crest_windows_do_not() {
        assert!(held(true, false, false)); // Start open
        assert!(held(false, true, false)); // a window with no button, not Crest's
        assert!(!held(false, true, true)); // a Crest window
        assert!(!held(false, false, false)); // an app with a button, or the desktop
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
    fn a_bar_above_its_monitors_bottom_edge_never_slides_away() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        let screen = r(0, 0, 1920, 1080);
        assert!(!stays_up(screen, screen, &[screen])); // the work area down to the bottom edge: the bar may slide away
        assert!(!stays_up(screen, r(64, 0, 1920, 1080), &[screen])); // an appbar on the left leaves the bottom edge as it is
        assert!(stays_up(screen, r(0, 0, 1920, 1032), &[screen])); // a band kept at the bottom: the strip would float above the edge
        let (top, laptop) = (r(0, -1080, 1920, 0), r(320, 0, 1760, 900));
        assert!(stays_up(top, top, &[top, laptop])); // another monitor below
    }

    #[test]
    fn a_monitor_that_cannot_slide_is_counted() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        let (free, banded) = (r(0, 0, 1920, 1080), r(1920, 0, 3840, 1080));
        // The second's work area ends above its bottom edge.
        assert_eq!(blocked_count(&[(free, free), (banded, r(1920, 0, 3840, 1032))], &[free, banded]), 1);
    }

    #[test]
    fn a_frame_in_the_bars_css_px() {
        let frame = RECT { left: 100, top: 1000, right: 1100, bottom: 2100 };
        assert_eq!(in_bar(frame, (0, 1200), 2.0), Rect { x: 50.0, y: -100.0, w: 500.0, h: 550.0 });
    }
}
