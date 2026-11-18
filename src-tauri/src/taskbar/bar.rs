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
//! Windows' taskbar hides once the bar has drawn and comes back while the hide hotkey hides Crest and when the bar goes
//! (explorer.rs, `follow`).
//!
//! Async on purpose: creating a window from a sync command deadlocks on Windows.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WebviewWindowBuilder, WindowEvent};

use super::explorer::{self, Mode};
use crate::display;
use crate::hit_test::{self, HitRect, HitState};

pub(super) const LABEL: &str = "taskbar";
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
/// How long an Off waits for its window to go: 300 steps of 10 ms, 3 s in all.
const GONE_STEP: Duration = Duration::from_millis(10);
const GONE_STEPS: usize = 300;

/// Held through each `taskbar_apply`, so an On never finds the window an Off is taking down, nor starts the thread before that
/// Off has stopped it.
static APPLYING: Mutex<()> = Mutex::new(());
/// The notch has the bar on. Set before the window is built, so a build sees Crest quitting meanwhile (`shutdown`).
static ENABLED: AtomicBool = AtomicBool::new(false);
/// The page has reported its bar: the bar has drawn.
static DRAWN: AtomicBool = AtomicBool::new(false);
/// An app covers the bar's monitor in full screen (display.rs).
static FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// What the last `sync` did.
static SHOWN: AtomicBool = AtomicBool::new(false);
/// The hide hotkey's state as the last `sync` saw it.
static USER_HIDDEN: AtomicBool = AtomicBool::new(false);
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

/// The band a bar `height` CSS px tall takes off the work area: the bar alone when docked to the screen's edge, the bar and
/// its gaps otherwise. The height is held to the settings' range; `max` reads NaN as the lowest bar.
fn band_for(height: f64, docked: bool) -> f64 {
    let height = height.max(MIN_HEIGHT).min(MAX_HEIGHT);
    if docked { height } else { height + 2.0 * GAP }
}

/// Turns the bar on or off and sets its height, and whether it is docked to the screen's edge (`None`, from an older
/// caller: not docked), which takes the gaps out of its band. The notch only, from the Taskbar settings; the Height slider
/// calls it on every step. One call at a time (`APPLYING`), and the notch sends the next only once this one has returned
/// (store.ts), so they run in their order.
#[tauri::command]
pub async fn taskbar_apply(enabled: bool, height: f64, docked: Option<bool>, app: AppHandle) -> Result<(), String> {
    // To the end of the call, which never awaits.
    let _applying = APPLYING.lock().unwrap_or_else(|e| e.into_inner());
    if !enabled {
        switch_off();
        // Windows' taskbar back before the bar goes. Explorer's lock is free again before the thread is joined below.
        explorer::set_mode(Mode::Off);
        hit_test::untrack(&app.state::<HitState>(), LABEL);
        HANDLE.store(0, Ordering::SeqCst);
        if let Some(window) = app.get_webview_window(LABEL) {
            let _ = window.destroy();
            // `destroy` only asks the main thread. An On after this call must find no window, or it would place this one as it
            // goes and leave no bar; bounded, so a main thread that does not answer cannot hold the switch.
            super::tries(std::iter::repeat_n(GONE_STEP, GONE_STEPS), std::thread::sleep, || app.get_webview_window(LABEL).is_none());
        }
        set_band(&app, 0.0);
        super::stop();
        return Ok(());
    }
    // The Store build has no uninstall step that gives Windows' taskbar back: it never turns the bar on, whatever a restored
    // backup says. Off above works as everywhere.
    if cfg!(feature = "store") {
        return Ok(());
    }
    ENABLED.store(true, Ordering::SeqCst);
    set_band(&app, band_for(height, docked.unwrap_or(false)));
    if app.get_webview_window(LABEL).is_some() {
        place(&app);
        return Ok(());
    }
    // A failed build leaves no band for a bar that does not exist.
    let failed = |e: String| {
        ENABLED.store(false, Ordering::SeqCst);
        set_band(&app, 0.0);
        Err(e)
    };
    let Some(config) = app.config().app.windows.iter().find(|w| w.label == LABEL).cloned() else {
        return failed("Taskbar window missing in config".into());
    };
    // The notch's WebView2 folder and arguments, so the bar joins its browser process (portable.rs).
    let built = WebviewWindowBuilder::from_config(&app, &config)
        .map(|b| b.on_navigation(crate::own_page))
        .map(|b| match crate::portable::data_dir() {
            Some(dir) => b.data_directory(dir),
            None => b,
        })
        .and_then(|b| b.build());
    let window = match built {
        Ok(window) => window,
        Err(e) => return failed(e.to_string()),
    };
    // Built during a recording or a screenshot, or while Crest is hidden from screen sharing: as the other windows are.
    crate::capture::exclude_if_capturing(&app);
    let handle = app.clone();
    window.on_window_event(move |event| match event {
        // Alt+F4 on the bar: it stays until the notch turns it off.
        WindowEvent::CloseRequested { api, .. } => api.prevent_close(),
        WindowEvent::Destroyed => {
            hit_test::untrack(&handle.state::<HitState>(), LABEL);
            crate::capture::glass_live::forget(&handle, LABEL);
            DRAWN.store(false, Ordering::SeqCst);
            HANDLE.store(0, Ordering::SeqCst);
            // A bar destroyed with its panel open never reports the close: the notch would keep running what that panel needed
            // and, docked at the bottom, keep stepping aside for a panel that is gone. The payload is `taskbar_panel`'s (panel.rs).
            let _ = handle.emit_to("notch", "bar://panel", serde_json::json!({ "label": LABEL, "open": null }));
        }
        _ => {}
    });
    place(&app);
    let Ok(hwnd) = window.hwnd().map(|h| h.0 as isize) else {
        let _ = window.destroy();
        return failed("no window handle".into());
    };
    // Turned off while it was being built: Crest is quitting (`shutdown`).
    if !ENABLED.load(Ordering::SeqCst) {
        let _ = window.destroy();
        return Ok(());
    }
    // After every way out above, so a build that fails has no thread to stop.
    super::start(&app);
    // Taken once here: the poll must not ask the main thread for it.
    hit_test::track(&app.state::<HitState>(), LABEL, hwnd);
    // A new window starts hidden; `sync` shows it unless the hide hotkey or a full-screen app keeps it hidden.
    SHOWN.store(false, Ordering::SeqCst);
    HANDLE.store(hwnd, Ordering::SeqCst);
    sync(&app);
    Ok(())
}

/// The zones the bar's page draws (the bar, an open menu) in its CSS px. The first report with a zone the poll keeps tells
/// that the bar has drawn, and Windows' taskbar hides; a late one from a page closing after Off is never counted, its window
/// no longer being tracked.
#[tauri::command]
pub fn taskbar_hit_rects(rects: Vec<HitRect>, window: WebviewWindow, state: State<'_, HitState>) {
    if hit_test::set_zones(&state, window.label(), rects) > 0 && ENABLED.load(Ordering::SeqCst) && !DRAWN.swap(true, Ordering::SeqCst) {
        follow(window.app_handle());
    }
}

/// Shows the bar unless the hide hotkey or a full-screen app on its monitor hides it; only acts on a change. Only through
/// `show` and `hide`: a raw ShowWindow would leave tao's visible flag stale. The hotkey also brings Windows' taskbar back
/// while it hides Crest.
pub(crate) fn sync(app: &AppHandle) {
    let user_hidden = display::user_hidden(app);
    if USER_HIDDEN.swap(user_hidden, Ordering::SeqCst) != user_hidden && DRAWN.load(Ordering::SeqCst) {
        follow(app);
    }
    let show = HANDLE.load(Ordering::SeqCst) != 0 && !user_hidden && !FULLSCREEN.load(Ordering::SeqCst);
    if SHOWN.swap(show, Ordering::SeqCst) == show {
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if !show {
        let _ = window.hide();
        return;
    }
    // Shown first, then click-through, as the notch and the mirrors are: click-through fails on a window that was never shown.
    // One task on the main thread, so the pointer poll's own call, which takes the pointer over on its next pass, lands after both.
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        let _ = window.show();
        let _ = window.set_ignore_cursor_events(true);
        display::raise_topmost(&window);
        // The notch goes back above the bar.
        if !display::is_hidden(&handle) {
            if let Some(notch) = handle.get_webview_window("notch") {
                display::raise_topmost(&notch);
            }
        }
    });
}

/// Hides Windows' taskbar once the bar has drawn, and shows it while the hide hotkey hides Crest (`explorer::wanted`). On a
/// thread of its own: the first hide starts a process, writes a file and waits on Explorer, and callers run on the main
/// thread. The bar's state is read under explorer's lock, so an Off that came meanwhile always wins.
fn follow(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        explorer::set_mode_with(|| explorer::wanted(ENABLED.load(Ordering::SeqCst) && DRAWN.load(Ordering::SeqCst), display::user_hidden(&app)));
    });
}

/// The bar no longer counts as on: no draw or hotkey still on its way hides Windows' taskbar again.
pub(crate) fn switch_off() {
    ENABLED.store(false, Ordering::SeqCst);
    DRAWN.store(false, Ordering::SeqCst);
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

/// The work area has changed (the taskbar thread, mod.rs): the bar and a notch on the bottom edge move now, not at the mirror's
/// check up to a second later. Posted to the main thread, which that thread never waits on.
pub(super) fn work_area_changed(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        place(&handle);
        let _ = handle.emit("notch://monitors", ());
    });
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

    #[test]
    fn the_band_has_no_gaps_when_the_bar_is_docked() {
        assert_eq!(band_for(44.0, false), 52.0);
        assert_eq!(band_for(44.0, true), 44.0);
        assert_eq!(band_for(100.0, true), 64.0);
        assert_eq!(band_for(f64::NAN, false), 40.0);
    }

    #[test]
    fn an_off_waits_for_its_window_to_go_three_seconds_at_most() {
        let off = |looks_until_gone: usize| {
            let (mut waited, mut looks) = (Duration::ZERO, 0);
            let gone = super::super::tries(std::iter::repeat_n(GONE_STEP, GONE_STEPS), |step| waited += step, || {
                looks += 1;
                looks >= looks_until_gone
            });
            (gone, waited)
        };
        assert_eq!(off(1), (true, GONE_STEP)); // the main thread took it down at once
        assert_eq!(off(50), (true, GONE_STEP * 50));
        assert_eq!(off(usize::MAX), (false, Duration::from_secs(3))); // a main thread that does not answer
    }
}
