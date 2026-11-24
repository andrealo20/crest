//! Windows' search panel (SearchHost's CoreWindow), which reaches into the taskbar's strip, where its search box sits, so over a
//! bar there it covers the bar: while it shows, each bar on its monitor whose band it reaches is told to step aside
//! (`taskbar://aside`), and to come back once it hides. Lifting or shrinking the panel instead cuts its top or its search box,
//! since Windows lays it out for the whole height. Heard from the taskbar thread's window events (mod.rs `on_event`): Windows
//! uncloaks the panel to show it and cloaks it to hide it.

use std::cell::RefCell;
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO};
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowRect, IsWindowVisible, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, EVENT_OBJECT_SHOW, EVENT_OBJECT_UNCLOAKED,
};

use super::{bar, reserve, screens, tasks};
use crate::display;

/// The panel's window class; SearchHost's process tells it from Start's and the other shell surfaces' (`is_search_host`).
const PANEL_CLASS: &str = "Windows.UI.Core.CoreWindow";

/// The panel while it shows, 0 otherwise.
static OPEN: AtomicIsize = AtomicIsize::new(0);
/// The bars last told to step aside, by label; held only to read or write it, never across an emit.
static ASIDE: Mutex<Vec<String>> = Mutex::new(Vec::new());

thread_local! {
    /// For the emits, on the taskbar thread, where the window events arrive.
    static APP: RefCell<Option<AppHandle>> = const { RefCell::new(None) };
}

fn aside() -> MutexGuard<'static, Vec<String>> {
    ASIDE.lock().unwrap_or_else(|e| e.into_inner())
}

/// On the taskbar thread, before its window events are heard (mod.rs `run`).
pub(super) fn begin(app: AppHandle) {
    APP.with_borrow_mut(|a| *a = Some(app));
}

/// A window shown, uncloaked, hidden, cloaked or destroyed (mod.rs `on_event`): the panel showing tells the bars it reaches to
/// step aside, the same window going tells them to come back. Any other window costs a class name read at most.
pub(super) fn on_event(event: u32, hwnd: HWND) {
    let h = hwnd.0 as isize;
    if event == EVENT_OBJECT_UNCLOAKED || event == EVENT_OBJECT_SHOW {
        if h != 0 && OPEN.load(Ordering::SeqCst) != h && is_panel(hwnd) && shows(hwnd) {
            OPEN.store(h, Ordering::SeqCst);
            tell(Some(hwnd));
        }
    } else if (event == EVENT_OBJECT_CLOAKED || event == EVENT_OBJECT_HIDE || event == EVENT_OBJECT_DESTROY) && h != 0 && OPEN.load(Ordering::SeqCst) == h {
        OPEN.store(0, Ordering::SeqCst);
        tell(None);
    }
}

/// SearchHost's CoreWindow: the class first, which is cheap, then the process's image.
fn is_panel(hwnd: HWND) -> bool {
    let class = display::class_name(hwnd);
    class == PANEL_CLASS && crate::mixer::process_path(display::window_pid(hwnd)).is_some_and(|path| is_search_host(&class, &path))
}

/// Visible and not cloaked: Windows keeps the panel's window and cloaks it while it is closed.
fn shows(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    let read = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, size_of::<u32>() as u32) };
    unsafe { IsWindowVisible(hwnd) }.as_bool() && (read.is_err() || cloaked == 0)
}

/// Whether a window of class `class` whose process runs `path` is Windows' search panel.
pub(super) fn is_search_host(class: &str, path: &str) -> bool {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    class == PANEL_CLASS && file.eq_ignore_ascii_case("SearchHost.exe")
}

/// Whether the panel at `panel` covers a bar whose band is `band` px along the `top` or bottom edge of `monitor`, all in physical
/// px: the two overlap by a pixel at least. No band yet covers nothing.
pub(super) fn steps_aside(panel: RECT, monitor: RECT, band: i32, top: bool) -> bool {
    if band <= 0 {
        return false;
    }
    let (from, to) = if top { (monitor.top, monitor.top + band) } else { (monitor.bottom - band, monitor.bottom) };
    panel.left < monitor.right && panel.right > monitor.left && panel.top < to && panel.bottom > from
}

/// Tells each bar whether the panel (None once it went) covers its band, only when that changes for it.
fn tell(panel: Option<HWND>) {
    let Some(app) = APP.with_borrow(|a| a.clone()) else { return };
    let at = panel.and_then(|h| {
        let mut r = RECT::default();
        unsafe { GetWindowRect(h, &mut r) }.ok().map(|_| (r, tasks::monitor_of(h)))
    });
    let (band, top) = (bar::band_css(), bar::top());
    let wanted: Vec<(String, bool)> = screens::all()
        .into_iter()
        .map(|(label, hwnd)| {
            let hwnd = HWND(hwnd as _);
            let covers = at.is_some_and(|(rect, on)| {
                on == tasks::monitor_of(hwnd)
                    && monitor_rect(on).is_some_and(|monitor| steps_aside(rect, monitor, reserve::band_px(band * crate::text_scale::get(), unsafe { GetDpiForWindow(hwnd) }), top))
            });
            (label, covers)
        })
        .collect();
    let changed: Vec<(String, bool)> = {
        let mut sent = aside();
        let changed = wanted.into_iter().filter(|(label, covers)| sent.contains(label) != *covers).collect::<Vec<_>>();
        for (label, covers) in &changed {
            sent.retain(|l| l != label);
            if *covers {
                sent.push(label.clone());
            }
        }
        changed
    };
    for (label, covers) in changed {
        let _ = app.emit_to(label.as_str(), "taskbar://aside", covers);
    }
}

fn monitor_rect(monitor: isize) -> Option<RECT> {
    let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe { GetMonitorInfoW(HMONITOR(monitor as _), &mut info) }.as_bool().then_some(info.rcMonitor)
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Foundation::RECT;

    const SCREEN: RECT = RECT { left: 0, top: 0, right: 2880, bottom: 1800 };

    #[test]
    fn only_searchhosts_panel_counts() {
        let host = r"C:\Windows\SystemApps\MicrosoftWindows.Client.CBS_cw5n1h2txyewy\SearchHost.exe";
        assert!(is_search_host("Windows.UI.Core.CoreWindow", host));
        assert!(is_search_host("Windows.UI.Core.CoreWindow", r"C:\x\searchhost.EXE"));
        assert!(!is_search_host("Windows.UI.Core.CoreWindow", r"C:\Windows\SystemApps\StartMenuExperienceHost.exe"));
        assert!(!is_search_host("Shell_TrayWnd", host));
    }

    #[test]
    fn a_bar_steps_aside_while_the_panel_reaches_its_band() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        // The panel as Windows opens it over a hidden taskbar: down to the screen's edge, over a bottom bar of 96 px.
        assert!(steps_aside(r(933, 0, 2649, 1800), SCREEN, 96, false));
        // Ending above the band (a reserved strip keeps it there), it covers nothing.
        assert!(!steps_aside(r(933, 0, 2649, 1704), SCREEN, 96, false));
        // A bar at the top: only when the panel comes up into its band.
        assert!(steps_aside(r(582, 72, 2298, 1800), SCREEN, 96, true));
        assert!(!steps_aside(r(582, 120, 2298, 1800), SCREEN, 96, true));
        // Beside the monitor, or no band yet: nothing.
        assert!(!steps_aside(r(2880, 0, 4000, 1800), SCREEN, 96, false));
        assert!(!steps_aside(r(933, 0, 2649, 1800), SCREEN, 0, false));
    }
}
