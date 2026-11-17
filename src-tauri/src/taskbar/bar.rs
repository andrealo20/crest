//! Crest's bar: the window `taskbar` (tauri.conf.json, page taskbar.html) along the bottom of the primary monitor's work
//! area, as wide as it and much taller than the bar, so menus and name labels have room above the bar. The page lays the bar
//! at the window's bottom and reports where it draws (`taskbar_hit_rects`); the pointer poll (hit_test.rs) lets clicks
//! through everywhere else. The band the bar takes (its height and gaps) comes off the primary's work area for the notch
//! (`display_monitors`).
//!
//! Only the notch applies the bar's settings (`taskbar_apply`). The bar hides with the hide hotkey and over a full-screen app
//! in front on its monitor (display.rs reads it), whatever the notch's own rules say, and is raised before the notch so the
//! notch stays above it.
//!
//! Async on purpose: creating a window from a sync command deadlocks on Windows.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use crate::display;
use crate::hit_test::{self, HitRect, HitState};

const LABEL: &str = "taskbar";
/// Room between the bar and the screen's edges, CSS px.
const GAP: f64 = 4.0;
/// The heights the settings offer for the bar, CSS px.
const MIN_HEIGHT: f64 = 32.0;
const MAX_HEIGHT: f64 = 64.0;
/// The tallest bar with its gaps. The window is this and `ROOM` tall whatever the bar's own height; the page lays the bar
/// at its bottom.
const WINDOW_BAND: f64 = MAX_HEIGHT + 2.0 * GAP;
/// Above the bar, for its menus and labels: the tallest panel and a margin, CSS px.
const ROOM: f64 = 560.0;

/// Held while the window is being built, so a second call does not build a second one.
static OPENING: AtomicBool = AtomicBool::new(false);
/// The notch has the bar on. Set before the window is built, so a build sees an Off that came meanwhile.
static ENABLED: AtomicBool = AtomicBool::new(false);
/// The page has reported its bar: the bar has drawn.
static DRAWN: AtomicBool = AtomicBool::new(false);
/// An app covers the bar's monitor in full screen (display.rs).
static FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// What the last `sync` did.
static SHOWN: AtomicBool = AtomicBool::new(false);
/// The band the bar takes off the work area, CSS px, as f64 bits; 0 while it is off.
static BAND: AtomicU64 = AtomicU64::new(0);
/// The window once built and placed, 0 otherwise. For threads that must not ask the main thread for it.
static HANDLE: AtomicIsize = AtomicIsize::new(0);

/// The window in physical px (x, y, width, height) for a work area (x, y, width, height) at `scale`: as wide as the work area
/// and standing on its bottom, at most three quarters of its height (a transparent window over the whole monitor would
/// count as a full-screen app to the shell).
pub(crate) fn bar_rect((x, y, width, height): (i32, i32, u32, u32), scale: f64) -> (i32, i32, u32, u32) {
    let tall = (((WINDOW_BAND + ROOM) * scale).round() as u32).min(height * 3 / 4);
    (x, y + height as i32 - tall as i32, width, tall)
}

/// Turns the bar on or off and sets its height. The notch only, from the Taskbar settings; the Height slider calls it on
/// every step.
#[tauri::command]
pub async fn taskbar_apply(enabled: bool, height: f64, app: AppHandle) -> Result<(), String> {
    if !enabled {
        ENABLED.store(false, Ordering::SeqCst);
        DRAWN.store(false, Ordering::SeqCst);
        hit_test::untrack(&app.state::<HitState>(), LABEL);
        HANDLE.store(0, Ordering::SeqCst);
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.destroy();
        }
        set_band(&app, 0.0);
        return Ok(());
    }
    ENABLED.store(true, Ordering::SeqCst);
    // `max` reads NaN as the lowest bar.
    set_band(&app, height.max(MIN_HEIGHT).min(MAX_HEIGHT) + 2.0 * GAP);
    if app.get_webview_window(LABEL).is_some() {
        place(&app);
        return Ok(());
    }
    // A build is running: it shows the bar.
    if OPENING.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let _opening = Opening;
    let config = app.config().app.windows.iter().find(|w| w.label == LABEL).cloned().ok_or("Taskbar window missing in config")?;
    // The notch's WebView2 folder and arguments, so the bar joins its browser process (portable.rs).
    let window = WebviewWindowBuilder::from_config(&app, &config)
        .map(|b| b.on_navigation(crate::own_page))
        .map(|b| match crate::portable::data_dir() {
            Some(dir) => b.data_directory(dir),
            None => b,
        })
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())?;
    // Built during a recording or a screenshot, or while Crest is hidden from screen sharing: as the other windows are.
    crate::capture::exclude_if_capturing(&app);
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        // Alt+F4 on the bar: it stays until the notch turns it off.
        WindowEvent::CloseRequested { api, .. } => api.prevent_close(),
        WindowEvent::Destroyed => {
            hit_test::untrack(&handle.state::<HitState>(), LABEL);
            DRAWN.store(false, Ordering::SeqCst);
            HANDLE.store(0, Ordering::SeqCst);
        }
        _ => {}
    });
    place(&app);
    let Ok(hwnd) = window.hwnd().map(|h| h.0 as isize) else {
        let _ = window.destroy();
        return Err("no window handle".into());
    };
    // Turned off while it was being built.
    if !ENABLED.load(Ordering::SeqCst) {
        let _ = window.destroy();
        return Ok(());
    }
    // Taken once here: the poll must not ask the main thread for it.
    hit_test::track(&app.state::<HitState>(), LABEL, hwnd);
    // A new window starts hidden; `sync` shows it unless the hide hotkey or a full-screen app keeps it hidden.
    SHOWN.store(false, Ordering::SeqCst);
    HANDLE.store(hwnd, Ordering::SeqCst);
    sync(&app);
    Ok(())
}

/// The zones the bar's page draws (the bar, an open menu) in its CSS px. A report with a zone tells that the bar has drawn;
/// a late one from a page closing after Off is never counted, its window no longer being tracked.
#[tauri::command]
pub fn taskbar_hit_rects(rects: Vec<HitRect>, window: WebviewWindow, state: State<'_, HitState>) {
    let drawn = !rects.is_empty();
    if hit_test::set_zones(&state, window.label(), rects) && drawn && ENABLED.load(Ordering::SeqCst) {
        DRAWN.store(true, Ordering::SeqCst);
    }
}

/// Shows the bar unless the hide hotkey or a full-screen app on its monitor hides it; only acts on a change. Only through
/// `show` and `hide`: a raw ShowWindow would leave tao's visible flag stale.
pub(crate) fn sync(app: &AppHandle) {
    let show = HANDLE.load(Ordering::SeqCst) != 0 && !display::user_hidden(app) && !FULLSCREEN.load(Ordering::SeqCst);
    if SHOWN.swap(show, Ordering::SeqCst) == show {
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if !show {
        let _ = window.hide();
        return;
    }
    // Click-through before it shows: the poll only takes it over on its next pass.
    let _ = window.set_ignore_cursor_events(true);
    let _ = window.show();
    display::raise_topmost(&window);
    // The notch goes back above the bar.
    if !display::is_hidden(app) {
        if let Some(notch) = app.get_webview_window("notch") {
            display::raise_topmost(&notch);
        }
    }
}

/// Puts the shown bar back on top of the other topmost windows. Callers raise the notch after it.
pub(crate) fn raise(app: &AppHandle) {
    if !SHOWN.load(Ordering::SeqCst) {
        return;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        display::raise_topmost(&window);
    }
}

/// A full-screen app came to or left the front of the bar's monitor.
pub(crate) fn set_fullscreen(app: &AppHandle, on: bool) {
    if FULLSCREEN.swap(on, Ordering::SeqCst) != on {
        sync(app);
    }
}

/// Along the bottom of the primary monitor's work area (`bar_rect`).
pub(crate) fn place(app: &AppHandle) {
    let Some(window) = app.get_webview_window(LABEL) else { return };
    let Ok(Some(monitor)) = window.primary_monitor() else { return };
    let area = monitor.work_area();
    let work = (area.position.x, area.position.y, area.size.width, area.size.height);
    let (x, y, width, height) = bar_rect(work, monitor.scale_factor());
    // Twice, as display::put does: moved onto a monitor with another scale, the window takes its size only after the first move.
    for _ in 0..2 {
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(width, height));
    }
}

/// The band the bar takes off the primary's work area (its height and gaps), CSS px; 0 while it is off.
pub(crate) fn band() -> f64 {
    f64::from_bits(BAND.load(Ordering::SeqCst))
}

/// The bar's window, 0 while there is none.
pub(crate) fn hwnd() -> isize {
    HANDLE.load(Ordering::SeqCst)
}

/// A new band changes the primary's work area for the notch, which reads the monitors again.
fn set_band(app: &AppHandle, band: f64) {
    if f64::from_bits(BAND.swap(band.to_bits(), Ordering::SeqCst)) != band {
        let _ = app.emit("notch://monitors", ());
    }
}

/// Gives OPENING back on every way out of a build, a failed one included.
struct Opening;

impl Drop for Opening {
    fn drop(&mut self) {
        OPENING.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bar_window_sits_on_the_work_area_bottom() {
        assert_eq!(bar_rect((0, 0, 1920, 1080), 1.0), (0, 448, 1920, 632));
        assert_eq!(bar_rect((0, 0, 2560, 1440), 1.5), (0, 492, 2560, 948));
        assert_eq!(bar_rect((0, 0, 3840, 2160), 2.0), (0, 896, 3840, 1264));
        assert_eq!(bar_rect((0, 0, 1920, 1032), 1.0), (0, 400, 1920, 632)); // Windows' taskbar still reserving its band
        assert_eq!(bar_rect((64, 0, 1856, 1080), 1.0), (64, 448, 1856, 632)); // an appbar on the left
    }

    #[test]
    fn the_bar_window_never_covers_its_monitor() {
        assert_eq!(bar_rect((0, 0, 1366, 768), 1.0), (0, 192, 1366, 576)); // capped at three quarters
    }
}
