//! Display: which monitor the notch sits on, its scale, and what it does while other windows fill that monitor.
//!
//! A thread reads the foreground window every 400 ms and classifies it (maximized, borderless or
//! exclusive full screen, see screen_policy.rs). With "also check windows behind" a maximized or
//! borderless window behind it counts too. The rules answer keep, line or hide: Rust hides the
//! window itself and emits `notch://screen` so the frontend can draw the line. `notch://fullscreen`
//! still reports a full-screen foreground for gaming mode. On every new foreground window "always
//! on top" is reapplied in case another app put itself above.
//!
//! The hide hotkey (shell.rs) hides Crest on top of that until it is pressed again, the notch is
//! opened from the tray, or "raise now" runs. Opening on purpose also shows Crest over a "hide" rule
//! until the notch closes; the floating timer hides and shows with the notch.
//!
//! `offset` moves the notch along its edge (dragging), clamped to the monitor. `zoom` is the panel scale:
//! the page is zoomed and the window grown by it, so CSS px times DPI times zoom are device pixels.
//! `edge` and `line` put the window on another screen edge (bottom, left, right).

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};
use windows::Win32::Foundation::{HWND, LPARAM, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::Shell::{SHQueryUserNotificationState, QUNS_RUNNING_D3D_FULL_SCREEN};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindow, GetWindowLongPtrW, GetWindowRect,
    GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, SetWindowPos, GWL_EXSTYLE, GWL_STYLE, GW_OWNER,
    HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_CAPTION, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};
use windows::Win32::UI::WindowsAndMessaging::FindWindowExW;
use windows::core::{w, PCWSTR};

use crate::hit_test::HitState;
use crate::screen_policy::{self, Behavior, Context, Rules};

const POLL: Duration = Duration::from_millis(400);

#[derive(Default)]
pub struct DisplayState {
    config: Mutex<Config>,
    /// Hidden with the hide hotkey.
    user_hidden: AtomicBool,
    /// The rules call for hiding right now.
    rule_hide: AtomicBool,
    /// Opened on purpose (shortcut, tray, second launch, launcher): shown over `rule_hide` until the notch closes.
    opened: AtomicBool,
    /// The window is hidden right now.
    hidden: AtomicBool,
    /// Last behaviour the rules called for (Behavior as u8), for `display_screen`.
    behavior: AtomicU8,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Monitor name ("\\.\DISPLAY2"); None = primary monitor.
    monitor: Option<String>,
    /// Horizontal offset from the center in CSS px.
    #[serde(default)]
    offset: f64,
    /// Window top below the monitor's top edge in CSS px (the frontend computes it).
    #[serde(default)]
    y: f64,
    /// Gaming mode: full screen keeps the style so FPS show.
    #[serde(default)]
    gaming: bool,
    /// A malformed rule is skipped instead of failing the whole call.
    #[serde(default, deserialize_with = "screen_policy::lenient_rules")]
    rules: Rules,
    /// Panel scale: 1.0 or 1.5.
    #[serde(default = "one")]
    zoom: f64,
    /// Screen edge the window hangs from: "top" (default), "bottom", "left" or "right" (src/notch/edge.ts).
    #[serde(default)]
    edge: String,
    /// Where that edge's frame starts, CSS px from the monitor's top (bottom) or left (left, right). On top `y` is used.
    #[serde(default)]
    line: f64,
}

fn one() -> f64 {
    1.0
}

impl Default for Config {
    fn default() -> Self {
        Config { monitor: None, offset: 0.0, y: 0.0, gaming: false, rules: Rules::default(), zoom: 1.0, edge: String::new(), line: 0.0 }
    }
}

/// Only the two scales the settings offer; anything else is 100 %.
fn fit_zoom(z: f64) -> f64 {
    if (z - 1.5).abs() < 0.01 {
        1.5
    } else {
        1.0
    }
}

/// The window's logical size at 100 %: as on top (tauri.conf.json), and on a side edge as deep as long so the widest panel fits across.
const ALONG: f64 = 760.0;
const DEPTH: f64 = 560.0;
const SIDE_DEPTH: f64 = 760.0;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    name: String,
    primary: bool,
    width: u32,
    height: u32,
    /// Work area (without taskbar) in CSS px: top below the monitor's top edge, and height.
    work_top: f64,
    work_height: f64,
    /// The work area's left edge from the monitor's left, and its width (a taskbar on the left or right), in CSS px.
    work_left: f64,
    work_width: f64,
}

#[tauri::command]
pub fn display_monitors(window: WebviewWindow, state: State<'_, DisplayState>) -> Vec<MonitorInfo> {
    let zoom = state.config.lock().unwrap().zoom;
    let primary = window.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let name = m.name().cloned().unwrap_or_default();
            let scale = m.scale_factor() * zoom;
            let wa = m.work_area();
            MonitorInfo {
                primary: primary.as_deref() == Some(name.as_str()),
                width: (m.size().width as f64 / scale) as u32,
                height: (m.size().height as f64 / scale) as u32,
                work_top: (wa.position.y - m.position().y) as f64 / scale,
                work_height: wa.size.height as f64 / scale,
                work_left: (wa.position.x - m.position().x) as f64 / scale,
                work_width: wa.size.width as f64 / scale,
                name,
            }
        })
        .collect()
}

#[tauri::command]
pub fn display_apply(mut config: Config, window: WebviewWindow, state: State<'_, DisplayState>, hit: State<'_, HitState>) {
    config.zoom = fit_zoom(config.zoom);
    let (moved, zoomed) = {
        let cur = state.config.lock().unwrap();
        (
            cur.monitor != config.monitor || cur.offset != config.offset || cur.y != config.y || cur.edge != config.edge || cur.line != config.line,
            cur.zoom != config.zoom,
        )
    };
    let zoom = config.zoom;
    hit.set_edge(&config.edge);
    *state.config.lock().unwrap() = config;
    // The window's size follows the edge and the zoom in `place`.
    if zoomed {
        let _ = window.set_zoom(zoom);
        hit.set_zoom(zoom);
    }
    if moved || zoomed {
        let _ = place(&window, &state);
    }
}

/// What the rules call for right now ("normal" | "line" | "hide"), for the frontend's start.
#[tauri::command]
pub fn display_screen(state: State<'_, DisplayState>) -> &'static str {
    behavior_from(state.behavior.load(Ordering::Relaxed)).as_str()
}

/// "Raise now": shows Crest if the hide hotkey hid it and puts it on top of the topmost windows.
#[tauri::command]
pub fn display_raise(app: AppHandle) {
    // Not `unhide`: nothing opens here, so a "hide" rule keeps its say.
    if app.state::<DisplayState>().user_hidden.swap(false, Ordering::Relaxed) {
        sync(&app);
    }
    let Some(window) = app.get_webview_window("notch") else { return };
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
    }
}

#[derive(Serialize)]
pub struct RunningApp {
    name: String,
    path: String,
}

/// Apps with a visible window, for adding an app rule. Each executable once.
#[tauri::command]
pub async fn display_apps() -> Vec<RunningApp> {
    let own = unsafe { GetCurrentProcessId() };
    let mut seen = std::collections::HashSet::new();
    let mut apps = Vec::new();
    for hwnd in top_windows() {
        let titled = unsafe { GetWindowTextLengthW(hwnd) } > 0;
        let owned = unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|o| !o.is_invalid());
        if !titled || owned || !candidate(hwnd) || has_ex_style(hwnd, WS_EX_TOOLWINDOW.0) {
            continue;
        }
        let pid = app_pid(hwnd);
        if pid == own {
            continue;
        }
        let Some(path) = crate::mixer::process_path(pid) else { continue };
        if seen.insert(path.to_lowercase()) {
            apps.push(RunningApp { name: exe_name(&path), path });
        }
    }
    apps.sort_by_key(|a| a.name.to_lowercase());
    apps
}

/// Hide hotkey: hides Crest, or shows it again.
pub fn toggle_user_hidden(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    let now = !state.user_hidden.load(Ordering::Relaxed);
    state.user_hidden.store(now, Ordering::Relaxed);
    sync(app);
}

/// Opening from the tray, the open hotkey, a second launch or the launcher brings back a Crest hidden with
/// the hotkey, and shows it over a "hide" rule until the notch closes again.
pub fn unhide(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    state.user_hidden.store(false, Ordering::Relaxed);
    state.opened.store(true, Ordering::Relaxed);
    sync(app);
}

/// The notch closed (keyboard_focus(false) in lib.rs): the rules hide it again.
pub fn closed(app: &AppHandle) {
    if app.state::<DisplayState>().opened.swap(false, Ordering::Relaxed) {
        sync(app);
    }
}

/// Hidden by a rule or the hotkey; the hit-test thread rests meanwhile.
pub fn is_hidden(app: &AppHandle) -> bool {
    app.state::<DisplayState>().hidden.load(Ordering::Relaxed)
}

/// Shows or hides the window (and the floating timer with it) to match the hotkey and the rules; only acts on a change.
fn sync(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    let rule_hide = state.rule_hide.load(Ordering::Relaxed) && !state.opened.load(Ordering::Relaxed);
    let hide = state.user_hidden.load(Ordering::Relaxed) || rule_hide;
    if state.hidden.swap(hide, Ordering::Relaxed) == hide {
        return;
    }
    // The timer window exists only while it is open (timer_window.rs destroys it on close).
    if let Some(timer) = app.get_webview_window("timer") {
        let _ = if hide { timer.hide() } else { timer.show() };
    }
    let Some(window) = app.get_webview_window("notch") else { return };
    if hide {
        let _ = window.hide();
    } else {
        let _ = window.show();
        let _ = window.set_always_on_top(true);
        // Let the click-through state be set again after show() (the poll caches the old one).
        app.state::<HitState>().refresh();
    }
}

/// Centered on the chosen monitor (primary otherwise), `y` CSS px below its top edge (clamped to the monitor).
/// Off the top edge the window's own edge goes on `line`, centred along that edge, and on a side edge it is as deep as long.
pub fn place(window: &WebviewWindow, state: &DisplayState) -> tauri::Result<()> {
    let (wanted, offset, y, zoom, edge, line) = {
        let c = state.config.lock().unwrap();
        (c.monitor.clone(), c.offset, c.y, c.zoom, c.edge.clone(), c.line)
    };
    let side = edge == "left" || edge == "right";
    let monitors = window.available_monitors()?;
    let monitor = wanted
        .and_then(|name| monitors.into_iter().find(|m| m.name() == Some(&name)))
        .or(window.primary_monitor()?);
    let Some(monitor) = monitor else { return Ok(()) };
    // Set twice: when moving to a monitor with different scaling, the window size
    // only updates after the first move.
    for _ in 0..2 {
        let mut size = window.outer_size()?;
        // Only resized when the orientation or the zoom changes, so the top edge at 100 % keeps its window as it was.
        let (lw, lh) = (if side { SIDE_DEPTH } else { ALONG } * zoom, if side { ALONG } else { DEPTH } * zoom);
        let dpi = window.scale_factor()?;
        if (size.width as f64 - lw * dpi).abs() > 2.0 || (size.height as f64 - lh * dpi).abs() > 2.0 {
            window.set_size(LogicalSize::new(lw, lh))?;
            size = window.outer_size()?;
        }
        let monitor_px = (monitor.size().width as i32, monitor.size().height as i32);
        let at = Placement { edge: &edge, offset, y, line, scale: monitor.scale_factor() * zoom };
        let (x, top) = at.position(monitor_px, (size.width as i32, size.height as i32));
        window.set_position(PhysicalPosition::new(monitor.position().x + x, monitor.position().y + top))?;
    }
    Ok(())
}

/// The widest panel along its edge in CSS px (panelSize.ts MAX_SIZE), kept on the monitor when the notch is moved.
const PANEL_ALONG: f64 = 740.0;

/// Where the window goes on its monitor; CSS px values, `scale` = monitor DPI x zoom.
struct Placement<'a> {
    edge: &'a str,
    offset: f64,
    y: f64,
    line: f64,
    scale: f64,
}

impl Placement<'_> {
    /// The window's top-left in physical px from the monitor's top-left, for a `window` (w, h) on a `monitor` (w, h).
    /// The hanging edge stays on `line` (or `y` on top) and the window is centred along the edge even when it is larger
    /// than the monitor (a big scale on a small screen), so the notch never leaves its edge; the offset along the edge
    /// is clamped so the widest panel stays on the monitor.
    fn position(&self, (mw, mh): (i32, i32), (w, h): (i32, i32)) -> (i32, i32) {
        let line = (self.line * self.scale).round() as i32;
        let side = self.edge == "left" || self.edge == "right";
        let (m_along, w_along) = if side { (mh, h) } else { (mw, w) };
        let free = (m_along - (PANEL_ALONG * self.scale).round() as i32).max(0);
        let along = (m_along - w_along) / 2 + ((self.offset * self.scale) as i32).clamp(-free / 2, free / 2);
        match self.edge {
            "bottom" => (along, line - h),
            "left" => (line, along),
            "right" => (line - w, along),
            _ => (along, ((self.y * self.scale) as i32).min(mh - h).max(0)),
        }
    }
}

pub fn spawn(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || {
        let Ok(own) = window.hwnd() else { return };
        let mut last_fullscreen = false;
        let mut last_behavior: Option<Behavior> = None;
        let mut last_foreground = HWND::default();
        let (mut front, mut behind) = (Known::default(), Known::default());
        loop {
            thread::sleep(POLL);
            let state = app.state::<DisplayState>();
            let (rules, gaming) = {
                let c = state.config.lock().unwrap();
                (c.rules.clone(), c.gaming)
            };
            let foreground = unsafe { GetForegroundWindow() };
            let monitor = unsafe { MonitorFromWindow(own, MONITOR_DEFAULTTONEAREST) };
            let fg = read_foreground(foreground, own, monitor, &mut front);
            // Looked up only where it can matter: nothing in front fills the monitor.
            let bg = (rules.background_matters() && fg.context == Context::Desktop)
                .then(|| read_background(foreground, own, monitor, &mut behind))
                .flatten();

            let fullscreen = fg.context.is_fullscreen();
            if fullscreen != last_fullscreen {
                last_fullscreen = fullscreen;
                let _ = app.emit("notch://fullscreen", fullscreen);
            }
            let behavior = screen_policy::decide(
                &rules,
                (fg.context, &fg.name, &fg.path),
                bg.as_ref().map(|b| (b.context, b.name.as_str(), b.path.as_str())),
                gaming,
            );
            if last_behavior != Some(behavior) {
                last_behavior = Some(behavior);
                state.behavior.store(behavior as u8, Ordering::Relaxed);
                state.rule_hide.store(behavior == Behavior::Hide, Ordering::Relaxed);
                let _ = app.emit("notch://screen", behavior.as_str());
                sync(&app);
            }
            // New foreground window: reapply "on top" in case it covered us.
            if !state.hidden.load(Ordering::Relaxed) && foreground != last_foreground {
                let _ = window.set_always_on_top(true);
            }
            last_foreground = foreground;
        }
    });
}

fn behavior_from(v: u8) -> Behavior {
    match v {
        1 => Behavior::Line,
        2 => Behavior::Hide,
        _ => Behavior::Normal,
    }
}

/// One window as the rules see it.
struct Seen {
    context: Context,
    name: String,
    path: String,
}

impl Seen {
    fn desktop() -> Seen {
        Seen { context: Context::Desktop, name: String::new(), path: String::new() }
    }
}

/// The last window's app, so the executable is read once per window instead of every poll.
#[derive(Default)]
struct Known {
    hwnd: isize,
    pid: u32,
    name: String,
    path: String,
}

impl Known {
    fn describe(&mut self, hwnd: HWND, pid: u32) -> (String, String) {
        if self.hwnd != hwnd.0 as isize || self.pid != pid {
            let path = crate::mixer::process_path(pid).unwrap_or_default();
            *self = Known { hwnd: hwnd.0 as isize, pid, name: exe_name(&path), path };
        }
        (self.name.clone(), self.path.clone())
    }
}

fn read_foreground(hwnd: HWND, own: HWND, monitor: HMONITOR, known: &mut Known) -> Seen {
    if hwnd.is_invalid() || hwnd == own || !candidate(hwnd) || unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) } != monitor {
        return Seen::desktop();
    }
    let pid = window_pid(hwnd);
    if pid == unsafe { GetCurrentProcessId() } {
        return Seen::desktop();
    }
    let Some(m) = monitor_rect(monitor) else { return Seen::desktop() };
    let (name, path) = known.describe(hwnd, app_pid(hwnd));
    // The notification state is global; with the foreground window on our monitor, it is this window.
    let exclusive = unsafe { SHQueryUserNotificationState() }.is_ok_and(|s| s == QUNS_RUNNING_D3D_FULL_SCREEN);
    let context = screen_policy::classify(exclusive, covers(frame_rect(hwnd), m), has_caption(hwnd), unsafe { IsZoomed(hwnd) }.as_bool());
    Seen { context, name, path }
}

/// A maximized or frameless full-monitor window on our monitor behind the foreground one (a browser left
/// maximized behind another app, a borderless game in the background). Skips tool and cloaked windows
/// (other virtual desktops) and our own.
fn read_background(foreground: HWND, own: HWND, monitor: HMONITOR, known: &mut Known) -> Option<Seen> {
    let m = monitor_rect(monitor)?;
    let own_pid = unsafe { GetCurrentProcessId() };
    // EnumWindows runs from the top of the z-order, so the first match is the frontmost one.
    for hwnd in top_windows() {
        if hwnd == foreground || hwnd == own || !candidate(hwnd) || unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) } != monitor {
            continue;
        }
        let maximized = unsafe { IsZoomed(hwnd) }.as_bool();
        let caption = has_caption(hwnd);
        let full = covers(frame_rect(hwnd), m);
        // Tool windows, click-through and never-activated windows are overlays (dimmers, recording frames), not apps.
        if (!maximized && !(full && !caption)) || has_ex_style(hwnd, WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0) {
            continue;
        }
        let pid = window_pid(hwnd);
        if pid == own_pid {
            continue;
        }
        let (name, path) = known.describe(hwnd, app_pid(hwnd));
        return Some(Seen { context: screen_policy::classify(false, full, caption, maximized), name, path });
    }
    None
}

/// Visible, not minimized, not cloaked, not the desktop or taskbar.
fn candidate(hwnd: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || is_desktop(hwnd) {
            return false;
        }
        let mut cloaked = 0u32;
        let ok = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4).is_ok();
        !(ok && cloaked != 0)
    }
}

fn top_windows() -> Vec<HWND> {
    unsafe extern "system" fn collect(hwnd: HWND, list: LPARAM) -> windows::core::BOOL {
        (*(list.0 as *mut Vec<HWND>)).push(hwnd);
        true.into()
    }
    let mut list: Vec<HWND> = Vec::new();
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut list as *mut Vec<HWND> as isize)) };
    list
}

fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

/// The app behind a window: a UWP app's frame belongs to ApplicationFrameHost, its CoreWindow child to the app.
fn app_pid(hwnd: HWND) -> u32 {
    if class_name(hwnd) == "ApplicationFrameWindow" {
        if let Ok(core) = unsafe { FindWindowExW(Some(hwnd), None, w!("Windows.UI.Core.CoreWindow"), PCWSTR::null()) } {
            if !core.is_invalid() {
                return window_pid(core);
            }
        }
    }
    window_pid(hwnd)
}

fn has_ex_style(hwnd: HWND, bits: u32) -> bool {
    unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & bits != 0 }
}

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) }.max(0) as usize;
    String::from_utf16_lossy(&buf[..len])
}

/// "C:\…\Game.exe" → "Game".
fn exe_name(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string()
}

fn has_caption(hwnd: HWND) -> bool {
    unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 & WS_CAPTION.0 != 0 }
}

/// The visible frame (without the invisible resize borders), else the window rect.
fn frame_rect(hwnd: HWND) -> RECT {
    let mut rect = RECT::default();
    unsafe {
        if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut rect as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).is_err() {
            let _ = GetWindowRect(hwnd, &mut rect);
        }
    }
    rect
}

fn monitor_rect(monitor: HMONITOR) -> Option<RECT> {
    let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool().then_some(info.rcMonitor)
}

/// Covers the whole monitor, give or take 2 px.
fn covers(r: RECT, m: RECT) -> bool {
    r.left <= m.left + 2 && r.top <= m.top + 2 && r.right >= m.right - 2 && r.bottom >= m.bottom - 2
}

/// Desktop and taskbar never count as fullscreen.
fn is_desktop(hwnd: HWND) -> bool {
    if unsafe { hwnd == GetDesktopWindow() || hwnd == GetShellWindow() } {
        return true;
    }
    matches!(class_name(hwnd).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}
#[cfg(test)]
mod tests {
    use super::*;

    /// 1920 x 1080 at 100, 125 and 150 % Windows scaling, panel scale 1 and 1.5, on every edge, hanging from the screen edge.
    #[test]
    fn the_notch_stays_on_its_edge_and_centred_even_when_the_window_is_larger_than_the_monitor() {
        let (mw, mh) = (1920, 1080);
        for dpi in [1.0, 1.25, 1.5] {
            for zoom in [1.0, 1.5] {
                let scale = dpi * zoom;
                for edge in ["top", "bottom", "left", "right"] {
                    let side = edge == "left" || edge == "right";
                    let w = ((if side { SIDE_DEPTH } else { ALONG }) * zoom * dpi).round() as i32;
                    let h = ((if side { ALONG } else { DEPTH }) * zoom * dpi).round() as i32;
                    let line = match edge {
                        "bottom" => mh as f64 / scale,
                        "right" => mw as f64 / scale,
                        _ => 0.0,
                    };
                    let at = |offset: f64| Placement { edge, offset, y: 0.0, line, scale }.position((mw, mh), (w, h));
                    let case = format!("{edge} at {dpi} x {zoom}");
                    let (x, top) = at(0.0);
                    match edge {
                        "top" => assert_eq!(top, 0, "{case}"),
                        "bottom" => assert!((top + h - mh).abs() <= 1, "{case}: bottom edge at {}", top + h),
                        "left" => assert_eq!(x, 0, "{case}"),
                        _ => assert!((x + w - mw).abs() <= 1, "{case}: right edge at {}", x + w),
                    }
                    let (along, m_along, w_along) = if side { (top, mh, h) } else { (x, mw, w) };
                    assert_eq!(along, (m_along - w_along) / 2, "{case}: centred");
                    // Pushed far either way, the widest panel (centred in the window) stays on the monitor when it fits at all.
                    let panel = PANEL_ALONG * scale;
                    for push in [-10_000.0, 10_000.0] {
                        let (x, top) = at(push);
                        let centre = (if side { top + h / 2 } else { x + w / 2 }) as f64;
                        if panel <= m_along as f64 {
                            assert!(centre - panel / 2.0 >= -1.0 && centre + panel / 2.0 <= m_along as f64 + 1.0, "{case}: pushed {push}");
                        } else {
                            assert_eq!(if side { top } else { x }, (m_along - w_along) / 2, "{case}: no room, stays centred");
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn the_capsule_top_stays_on_the_monitor() {
        let at = |y: f64| Placement { edge: "top", offset: 0.0, y, line: 0.0, scale: 1.0 }.position((1920, 1080), (760, 560));
        assert_eq!(at(100.0).1, 100);
        assert_eq!(at(5000.0).1, 520);
        assert_eq!(at(-50.0).1, 0);
    }
}
