//! Crest's bar: the window `taskbar` (tauri.conf.json, page taskbar.html) along the bottom of the primary monitor's work
//! area, or along its top when the settings say so (`top`), as wide as it and much taller than the bar, so menus and name labels
//! have room on the screen's side of the bar. Every other monitor gets a bar of its own from the same template (screens.rs). The
//! page lays the bar at the window's edge on the screen's edge and reports where
//! it draws (`taskbar_hit_rects`); the pointer poll (hit_test.rs) lets clicks through everywhere else. The band the bar takes
//! (its height and gaps) comes off every monitor's work area for the notch (`display_monitors`). A bar that reserves its strip
//! with Windows (reserve.rs) stands on that strip instead, and while any does no band comes off: Windows' work area has it.
//!
//! Only the notch applies the bar's settings (`taskbar_apply`). The bar hides with the hide hotkey and over a full-screen app
//! in front on its monitor (display.rs reads it), whatever the notch's own rules say, and is raised before the notch so the
//! notch stays above it. With "hide when a window touches it" on, the page slides the bar off the screen inside its still window
//! (`taskbar_slid`): the bar then hears it hidden (`taskbar://shown`), as when its window hides, and the notch hears the slide
//! apart from a hide (`bar://shown`).
//!
//! Windows' taskbar hides once the primary's bar has drawn and comes back while the hide hotkey hides Crest and when the bar
//! goes (explorer.rs, `follow`).
//!
//! Async on purpose: creating a window from a sync command deadlocks on Windows.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use windows::Win32::Foundation::RECT;

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
/// How long `take_down` waits for a window to go: 300 steps of 10 ms, 3 s in all.
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
/// The bars stand on the top edge of the work area instead of the bottom, as the notch last applied them.
static TOP: AtomicBool = AtomicBool::new(false);
/// The window once built and placed, 0 otherwise. For threads that must not ask the main thread for it.
static HANDLE: AtomicIsize = AtomicIsize::new(0);

/// The bars whose page has slid them off the screen inside their window (`taskbar_slid`), by label. Held across the emit of a
/// change in what a bar hears (`tell`), so the last change is the one heard last; no Rust listener of that event takes it again.
static SLID: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn slid() -> MutexGuard<'static, Vec<String>> {
    SLID.lock().unwrap_or_else(|e| e.into_inner())
}

/// What a bar hears as its shown state (`taskbar://shown`, `taskbar_hello`): its window shows and its page has not slid it off
/// the screen (`taskbar_slid`). A label that never slid is up.
fn on_screen(shown: bool, slid: &[String], label: &str) -> bool {
    shown && !slid.iter().any(|l| l == label)
}

/// The window in physical px (x, y, width, height) for a work area (x, y, width, height) at `scale`: as wide as the work area
/// and standing on its bottom (hanging from its top for a `top` bar), at most three quarters of its height (a transparent window
/// over the whole monitor would count as a full-screen app to the shell). For a reserving bar the area is `ground`'s, its strip
/// included.
pub(crate) fn bar_rect((x, y, width, height): (i32, i32, u32, u32), scale: f64, top: bool) -> (i32, i32, u32, u32) {
    let tall = (((WINDOW_BAND + ROOM) * scale).round() as u32).min(height * 3 / 4);
    if top { (x, y, width, tall) } else { (x, y + height as i32 - tall as i32, width, tall) }
}

/// The area a bar stands in, physical px (x, y, width, height): the work area, or for a bar reserving `strip` the strip's
/// left and width, from the strip's outer edge to the work area's far one, since Windows has taken the strip off the work area.
/// A strip still on the other edge (the bar just moved, the strip not yet asked again) counts as none.
fn ground(work: (i32, i32, u32, u32), strip: Option<RECT>, top: bool) -> (i32, i32, u32, u32) {
    let bottom = work.1 + work.3 as i32;
    match strip {
        Some(s) if top && s.bottom <= work.1 => (s.left, s.top, (s.right - s.left) as u32, (bottom - s.top) as u32),
        Some(s) if !top && s.top >= bottom => (s.left, work.1, (s.right - s.left) as u32, (s.bottom - work.1) as u32),
        _ => work,
    }
}

/// Whether the bars stand on the top edge.
pub(crate) fn top() -> bool {
    TOP.load(Ordering::SeqCst)
}

/// A work area's top and height (the notch's CSS px) with the bar's band taken off the edge it stands on.
pub(crate) fn band_off(top: bool, (work_top, height): (f64, f64), band: f64) -> (f64, f64) {
    (if top { work_top + band } else { work_top }, height - band)
}

/// The band a bar `height` CSS px tall takes off the work area: the bar alone when docked to the screen's edge, the bar and
/// its gaps otherwise. The height is held to the settings' range; `max` reads NaN as the lowest bar.
fn band_for(height: f64, docked: bool) -> f64 {
    let height = height.max(MIN_HEIGHT).min(MAX_HEIGHT);
    if docked { height } else { height + 2.0 * GAP }
}

/// Turns the bar on or off and sets its height, and whether it is docked to the screen's edge (`None`, from an older
/// caller: not docked), which takes the gaps out of its band, and its edge (`"top"`; anything else, or none, the bottom). The
/// notch only, from the Taskbar settings; the Height slider
/// calls it on every step. One call at a time (`APPLYING`), and the notch sends the next only once this one has returned
/// (store.ts), so they run in their order.
#[tauri::command]
pub async fn taskbar_apply(enabled: bool, height: f64, docked: Option<bool>, edge: Option<String>, app: AppHandle) -> Result<(), String> {
    // To the end of the call, which never awaits.
    let _applying = APPLYING.lock().unwrap_or_else(|e| e.into_inner());
    if !enabled {
        switch_off();
        // Windows' taskbar back before the bar goes. Explorer's lock is free again before the thread is joined below.
        explorer::set_mode(Mode::Off);
        hit_test::untrack(&app.state::<HitState>(), LABEL);
        HANDLE.store(0, Ordering::SeqCst);
        take_down(&app, LABEL);
        // The other monitors' bars go too, the primary's being gone.
        super::screens::sync(&app);
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
    let top = edge.as_deref() == Some("top");
    let moved = TOP.swap(top, Ordering::SeqCst) != top;
    set_band(&app, band_for(height, docked.unwrap_or(false)));
    super::reserve::wish(docked.unwrap_or(false), band_for(height, true), top);
    // The band went to the other edge, maybe at the same size: the notch reads the work area again.
    if moved {
        let _ = app.emit("notch://monitors", ());
    }
    if app.get_webview_window(LABEL).is_some() {
        place(&app);
        return Ok(());
    }
    // A failed build leaves no band for a bar that does not exist, and the notch hears it hidden, so the widgets' sources rest.
    let failed = |e: String| {
        ENABLED.store(false, Ordering::SeqCst);
        set_band(&app, 0.0);
        // It can still hold the last bar's shown state, as an Off runs no `sync`.
        SHOWN.store(false, Ordering::SeqCst);
        tell_now(&app, LABEL);
        Err(e)
    };
    let handle = app.clone();
    let built = build(&app, LABEL, move || {
        hit_test::untrack(&handle.state::<HitState>(), LABEL);
        DRAWN.store(false, Ordering::SeqCst);
        HANDLE.store(0, Ordering::SeqCst);
    });
    let window = match built {
        Ok(window) => window,
        Err(e) => return failed(e),
    };
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
    // A bar built hidden sends no change from `sync`, so the notch and the page hear its state here.
    tell_now(&app, LABEL);
    // The other monitors' bars, now that the primary's is there.
    super::screens::sync(&app);
    Ok(())
}

/// A bar window from the template `LABEL` under `label`, with the notch's WebView2 folder and arguments so it joins its
/// browser process (portable.rs). Alt+F4 never closes it (lib.rs `close_action`); once it is gone `on_destroyed` runs, its
/// glass stops and the notch hears that its panel closed. Options for the bar's look go here, so every monitor's bar gets them.
pub(super) fn build(app: &AppHandle, label: &str, on_destroyed: impl Fn() + Send + 'static) -> Result<WebviewWindow, String> {
    let mut config = app.config().app.windows.iter().find(|w| w.label == LABEL).cloned().ok_or("Taskbar window missing in config")?;
    config.label = label.to_owned();
    // A new page starts up: a slide its window's last page reported on its way out is not this one's.
    forget_slid(label);
    let window = WebviewWindowBuilder::from_config(app, &config)
        .map(|b| b.on_navigation(crate::own_page))
        .map(|b| match crate::portable::data_dir() {
            Some(dir) => b.data_directory(dir),
            None => b,
        })
        .and_then(|b| b.build())
        .map_err(|e| e.to_string())?;
    // Files dropped on its apps are pinned (ownpins.rs `dropped`).
    crate::drop::install_bar(&window);
    // Built during a recording or a screenshot, while Crest is hidden from screen sharing or while the bars' glass is on: as the
    // other windows are.
    crate::capture::exclude_if_capturing(app);
    let (handle, label) = (app.clone(), label.to_owned());
    window.on_window_event(move |event| match event {
        WindowEvent::Destroyed => {
            on_destroyed();
            forget_slid(&label);
            super::preview::clear(&label);
            crate::capture::glass_live::forget(&handle, &label);
            // A bar destroyed with its panel open never reports the close: the notch would keep running what that panel's tool
            // needed. The payload is `taskbar_panel`'s (panel.rs).
            let _ = handle.emit_to("notch", "bar://panel", serde_json::json!({ "label": label, "open": null }));
        }
        // The thumbnails sit where the page's slots were: a move, a new size (the card's own observer does not see the window
        // change) or a new scale gives the page nothing to send others.
        WindowEvent::Moved(_) | WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => super::preview::clear(&label),
        _ => {}
    });
    Ok(window)
}

/// Destroys `label`'s window and waits until it is gone, so what comes next never finds it on its way out: an On would place
/// it as it goes and leave no bar. `destroy` only asks the main thread, so never on it; bounded, so a main thread that does not
/// answer cannot hold the switch.
pub(super) fn take_down(app: &AppHandle, label: &str) {
    if let Some(window) = app.get_webview_window(label) {
        let _ = window.destroy();
        super::tries(std::iter::repeat_n(GONE_STEP, GONE_STEPS), std::thread::sleep, || app.get_webview_window(label).is_none());
    }
}

/// The zones a bar's page draws (the bar, an open menu) in its CSS px. The primary's first report with a zone the poll keeps
/// tells that the bar has drawn, and Windows' taskbar hides; another bar's never does, and a late one from a page closing after
/// Off is never counted, its window no longer being tracked.
#[tauri::command]
pub fn taskbar_hit_rects(rects: Vec<HitRect>, window: WebviewWindow, state: State<'_, HitState>) {
    if hit_test::set_zones(&state, window.label(), rects) > 0 && window.label() == LABEL && ENABLED.load(Ordering::SeqCst) && !DRAWN.swap(true, Ordering::SeqCst) {
        follow(window.app_handle());
    }
}

/// The calling bar's page slid it off the screen inside its window (`down`, useAutoHide.ts) or brought it back up. Down, the bar
/// hears itself hidden, so its widgets rest as when it hides; only a change of what the bar hears is told, a hidden window reads
/// hidden either way. The notch hears each slide of the primary's (`tell_notch`). Sync, so a bar's calls run in their order.
#[tauri::command]
pub fn taskbar_slid(down: bool, window: WebviewWindow) {
    let label = window.label();
    let mut slid = slid();
    let shown = window_shown(label);
    let before = on_screen(shown, &slid, label);
    let was = slid.iter().any(|l| l == label);
    slid.retain(|l| l != label);
    if down {
        slid.push(label.to_owned());
    }
    let after = on_screen(shown, &slid, label);
    if after != before {
        tell(window.app_handle(), label, after);
    }
    // The notch hears the primary's slide itself, a hidden window's too: it tells a slide from a hide.
    if label == LABEL && was != down {
        tell_notch(window.app_handle(), shown, &slid);
    }
}

/// Shows the bar unless the hide hotkey or a full-screen app on its monitor hides it, and the other monitors' bars each the
/// same way; only acts on a change. Only through `show` and `hide`: a raw ShowWindow would leave tao's visible flag stale. The
/// hotkey also brings Windows' taskbar back while it hides Crest.
pub(crate) fn sync(app: &AppHandle) {
    let user_hidden = display::user_hidden(app);
    if USER_HIDDEN.swap(user_hidden, Ordering::SeqCst) != user_hidden && DRAWN.load(Ordering::SeqCst) {
        follow(app);
    }
    super::screens::sync_shown(app);
    let show = HANDLE.load(Ordering::SeqCst) != 0 && !user_hidden && !FULLSCREEN.load(Ordering::SeqCst);
    if SHOWN.swap(show, Ordering::SeqCst) == show {
        return;
    }
    showed(app, LABEL, show);
    let Some(window) = app.get_webview_window(LABEL) else { return };
    if !show {
        let _ = window.hide();
        return;
    }
    reveal(app, window);
}

/// Shows a bar. Shown first, then click-through, as the notch and the mirrors are: click-through fails on a window that was
/// never shown. One task on the main thread, so the pointer poll's own call, which takes the pointer over on its next pass,
/// lands after both.
pub(super) fn reveal(app: &AppHandle, window: WebviewWindow) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        // Every show of every bar comes through here, so no thread can show a new bar before this.
        display::keep_out_of_alt_tab(&window);
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
        // A registration needs the hide done.
        super::reserve::refresh();
    });
}

/// The bar no longer counts as on: no draw or hotkey still on its way hides Windows' taskbar again.
pub(crate) fn switch_off() {
    ENABLED.store(false, Ordering::SeqCst);
    DRAWN.store(false, Ordering::SeqCst);
}

/// Puts the shown bars back on top of the other topmost windows. Callers raise the notch after them.
pub(crate) fn raise(app: &AppHandle) {
    if SHOWN.load(Ordering::SeqCst) {
        if let Some(window) = app.get_webview_window(LABEL) {
            display::raise_topmost(&window);
        }
    }
    super::screens::raise(app);
}

/// A full-screen app came to or left the front of the bar's monitor.
pub(crate) fn set_fullscreen(app: &AppHandle, on: bool) {
    if FULLSCREEN.swap(on, Ordering::SeqCst) != on {
        sync(app);
    }
}

/// The bar along its edge of the primary monitor's work area, and the other bars along theirs.
pub(crate) fn place(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(LABEL) {
        if let Ok(Some(monitor)) = window.primary_monitor() {
            put(&window, &monitor);
        }
    }
    super::screens::place(app);
}

/// Along the bar's edge of `monitor`'s work area, or on the strip the bar reserves (`ground`, `bar_rect`).
pub(super) fn put(window: &WebviewWindow, monitor: &tauri::Monitor) {
    let area = monitor.work_area();
    let work = (area.position.x, area.position.y, area.size.width, area.size.height);
    let (x, y, width, height) = bar_rect(ground(work, super::reserve::strip(window.label()), top()), monitor.scale_factor(), top());
    // Twice, as display::put does: moved onto a monitor with another scale, the window takes its size only after the first move.
    for _ in 0..2 {
        let _ = window.set_position(PhysicalPosition::new(x, y));
        let _ = window.set_size(PhysicalSize::new(width, height));
    }
}

/// The work area has changed (the taskbar thread, mod.rs): the bars move now, and the notch reads the monitors again (an
/// edge's taskbar line, the capsule's work area, the copies on other monitors), not at the mirror's check up to a second
/// later. Posted to the main thread, which that thread never waits on.
pub(super) fn work_area_changed(app: &AppHandle) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        place(&handle);
        let _ = handle.emit("notch://monitors", ());
    });
}

/// The band the bar takes off every monitor's work area (its height and gaps), CSS px; 0 while it is off, and 0 while any bar
/// reserves its strip: the notch then reads Windows' work area, which already lacks the strip.
pub(crate) fn band() -> f64 {
    if super::reserve::active() {
        return 0.0;
    }
    f64::from_bits(BAND.load(Ordering::SeqCst))
}

/// Whether `label` is a bar's window: the primary's or another monitor's (screens.rs).
pub(crate) fn is_bar_label(label: &str) -> bool {
    label == LABEL || label.starts_with("taskbar-")
}

/// For the commands only a bar may call: `command_allowed` lets the notch call every command, this refuses it too.
pub(crate) fn from_bar(window: &WebviewWindow) -> Result<(), String> {
    if is_bar_label(window.label()) { Ok(()) } else { Err("denied".into()) }
}

/// The calling bar takes the keyboard after one of its Windows keys (keys.rs): a plain `SetForegroundWindow`, which Windows allows
/// just after a hotkey went to Crest and refuses otherwise. Never tao's `set_focus`, which taps Alt into the app in front.
#[tauri::command]
pub fn taskbar_focus(window: WebviewWindow) -> Result<(), String> {
    from_bar(&window)?;
    let hwnd = window.hwnd().map_err(|_| "failed")?;
    if unsafe { windows::Win32::UI::WindowsAndMessaging::SetForegroundWindow(windows::Win32::Foundation::HWND(hwnd.0)) }.as_bool() { Ok(()) } else { Err("refused".into()) }
}

/// The bar's window, 0 while there is none.
pub(crate) fn hwnd() -> isize {
    HANDLE.load(Ordering::SeqCst)
}

/// Whether `label`'s window shows, slid or not: the primary's as the last `sync` left it, another's as `screens::sync_shown` did.
/// False for a label with no bar.
fn window_shown(label: &str) -> bool {
    if label == LABEL { SHOWN.load(Ordering::SeqCst) } else { super::screens::shown(label) }
}

/// What `label`'s bar hears now (`on_screen`), for its page that has just loaded (`taskbar_hello`).
pub(crate) fn shown(label: &str) -> bool {
    on_screen(window_shown(label), &slid(), label)
}

/// `label`'s window showed or hid: its bar hears it, unless its page has slid it off the screen.
pub(super) fn showed(app: &AppHandle, label: &str, show: bool) {
    // Owned windows do not hide with their owner: the thumbnails go on the main thread, where they live.
    if !show {
        let l = label.to_owned();
        let _ = app.run_on_main_thread(move || super::preview::clear(&l));
    }
    let slid = slid();
    // Slid, the bar reads hidden whether its window shows or not: nothing changes for it.
    if on_screen(true, &slid, label) {
        tell(app, label, show);
    }
    // The notch hears the primary's window either way: hidden while slid, the sources stop at once.
    if label == LABEL {
        tell_notch(app, show, &slid);
    }
}

/// Tells `label`'s bar what it hears now, changed or not: for a bar just built, whose `sync` sent no change.
fn tell_now(app: &AppHandle, label: &str) {
    let slid = slid();
    let shown = window_shown(label);
    tell(app, label, on_screen(shown, &slid, label));
    if label == LABEL {
        tell_notch(app, shown, &slid);
    }
}

/// A bar shows or hides for its page (`on_screen`), under `SLID`: to that bar alone, which pauses its widgets and closes its panel.
/// Another monitor's bar hears only its own, so the primary hiding never closes that bar's panel.
fn tell(app: &AppHandle, label: &str, show: bool) {
    let _ = app.emit_to(label, "taskbar://shown", show);
}

/// What the notch hears of the primary's bar (`bar://shown`): whether its window shows and whether its page slid it off the
/// screen, apart, so the notch keeps the widgets' sources through a short slide and stops them at once on a hide.
fn notch_hears(shown: bool, slid: &[String]) -> serde_json::Value {
    serde_json::json!({ "shown": shown, "slid": slid.iter().any(|l| l == LABEL) })
}

/// Tells the notch the primary's state (`notch_hears`), under `SLID` as `tell` is.
fn tell_notch(app: &AppHandle, shown: bool, slid: &[String]) {
    let _ = app.emit_to("notch", "bar://shown", notch_hears(shown, slid));
}

/// A bar's window was built or destroyed: no page of it has slid it.
fn forget_slid(label: &str) {
    slid().retain(|l| l != label);
}

/// A new band changes every monitor's work area for the notch, which reads the monitors again.
fn set_band(app: &AppHandle, band: f64) {
    if f64::from_bits(BAND.swap(band.to_bits(), Ordering::SeqCst)) != band {
        let _ = app.emit("notch://monitors", ());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_notch_hears_the_primary_bars_slide_apart_from_its_window() {
        let slid = |labels: &[&str]| labels.iter().map(|l| l.to_string()).collect::<Vec<_>>();
        assert_eq!(notch_hears(true, &slid(&[LABEL])), serde_json::json!({ "shown": true, "slid": true })); // slid away: the sources stay a while
        assert_eq!(notch_hears(false, &slid(&[LABEL])), serde_json::json!({ "shown": false, "slid": true })); // hidden while slid: a hide all the same
        assert_eq!(notch_hears(true, &slid(&["taskbar-1"])), serde_json::json!({ "shown": true, "slid": false })); // another bar's slide is its own
        assert_eq!(notch_hears(false, &[]), serde_json::json!({ "shown": false, "slid": false }));
    }

    #[test]
    fn the_bar_window_sits_on_the_work_area_bottom() {
        assert_eq!(bar_rect((0, 0, 1920, 1080), 1.0, false), (0, 448, 1920, 632));
        assert_eq!(bar_rect((0, 0, 2560, 1440), 1.5, false), (0, 492, 2560, 948));
        assert_eq!(bar_rect((0, 0, 3840, 2160), 2.0, false), (0, 896, 3840, 1264));
        assert_eq!(bar_rect((0, 0, 1920, 1032), 1.0, false), (0, 400, 1920, 632)); // Windows' taskbar still reserving its band
        assert_eq!(bar_rect((64, 0, 1856, 1080), 1.0, false), (64, 448, 1856, 632)); // an appbar on the left
    }

    #[test]
    fn the_bar_window_never_covers_its_monitor() {
        assert_eq!(bar_rect((0, 0, 1366, 768), 1.0, false), (0, 192, 1366, 576)); // capped at three quarters
    }

    #[test]
    fn a_reserving_bar_stands_on_its_strip_not_on_the_work_area() {
        let s = |left, top, right, bottom| RECT { left, top, right, bottom };
        assert_eq!(ground((0, 0, 1920, 1080), None, false), (0, 0, 1920, 1080));
        assert_eq!(ground((0, 0, 1920, 1036), Some(s(0, 1036, 1920, 1080)), false), (0, 0, 1920, 1080));
        // The window's bottom on the screen's edge, not one band above it.
        assert_eq!(bar_rect(ground((0, 0, 1920, 1036), Some(s(0, 1036, 1920, 1080)), false), 1.0, false), (0, 448, 1920, 632));
        assert_eq!(ground((64, 0, 1856, 1036), Some(s(64, 1036, 1920, 1080)), false), (64, 0, 1856, 1080)); // a side appbar narrows both
    }

    #[test]
    fn a_top_bar_hangs_from_the_work_area_top_or_its_strip() {
        let s = |left, top, right, bottom| RECT { left, top, right, bottom };
        assert_eq!(bar_rect((0, 0, 1920, 1080), 1.0, true), (0, 0, 1920, 632));
        assert_eq!(bar_rect((0, 48, 1920, 1032), 1.0, true), (0, 48, 1920, 632)); // another appbar on top
        assert_eq!(bar_rect((0, 0, 1366, 768), 1.0, true), (0, 0, 1366, 576));
        // Windows took the strip off the work area's top: the window starts on the screen's edge again.
        assert_eq!(ground((0, 44, 1920, 1036), Some(s(0, 0, 1920, 44)), true), (0, 0, 1920, 1080));
        assert_eq!(bar_rect(ground((0, 44, 1920, 1036), Some(s(0, 0, 1920, 44)), true), 1.0, true), (0, 0, 1920, 632));
        assert_eq!(ground((64, 44, 1856, 1036), Some(s(64, 0, 1920, 44)), true), (64, 0, 1856, 1080)); // a side appbar narrows both
    }

    #[test]
    fn a_strip_on_the_other_edge_is_ignored() {
        let s = |left, top, right, bottom| RECT { left, top, right, bottom };
        assert_eq!(ground((0, 0, 1920, 1036), Some(s(0, 1036, 1920, 1080)), true), (0, 0, 1920, 1036));
        assert_eq!(ground((0, 44, 1920, 1036), Some(s(0, 0, 1920, 44)), false), (0, 44, 1920, 1036));
    }

    #[test]
    fn the_band_comes_off_the_edge_the_bar_stands_on() {
        assert_eq!(band_off(false, (0.0, 1080.0), 52.0), (0.0, 1028.0));
        assert_eq!(band_off(true, (0.0, 1080.0), 52.0), (52.0, 1028.0));
    }

    #[test]
    fn only_bars_reach_the_networks_and_devices() {
        assert!(is_bar_label("taskbar") && is_bar_label("taskbar-2"));
        assert!(!is_bar_label("notch") && !is_bar_label("settings") && !is_bar_label("taskbarx") && !is_bar_label(""));
    }

    #[test]
    fn a_bar_is_on_screen_while_its_window_shows_and_it_has_not_slid() {
        let slid = ["taskbar-1".to_owned()];
        assert!(on_screen(true, &[], LABEL));
        assert!(!on_screen(false, &[], LABEL)); // hidden: the hotkey, a full-screen app
        assert!(!on_screen(true, &slid, "taskbar-1")); // slid off the screen inside its shown window
        assert!(!on_screen(false, &slid, "taskbar-1"));
        assert!(on_screen(true, &slid, LABEL)); // another bar's slide is its own
        assert!(on_screen(true, &slid, "taskbar-9")); // a label that never slid
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
