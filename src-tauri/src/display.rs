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
//! opened from the tray, or "raise now" runs.
//!
//! `offset` moves the notch sideways (dragging), clamped to the monitor. `zoom` is the panel scale:
//! the page is zoomed and the window grown by it, so CSS px times DPI times zoom are device pixels.

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
    HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, WS_CAPTION, WS_EX_TOOLWINDOW,
};

use crate::hit_test::HitState;
use crate::screen_policy::{self, Behavior, Context, Rules};

const POLL: Duration = Duration::from_millis(400);
/// The window's size at 100 % (tauri.conf.json).
const WINDOW_W: f64 = 760.0;
const WINDOW_H: f64 = 560.0;

#[derive(Default)]
pub struct DisplayState {
    config: Mutex<Config>,
    /// Hidden with the hide hotkey.
    user_hidden: AtomicBool,
    /// The rules call for hiding right now.
    rule_hide: AtomicBool,
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
    #[serde(default)]
    rules: Rules,
    /// Panel scale: 1.0 or 1.5.
    #[serde(default = "one")]
    zoom: f64,
}

fn one() -> f64 {
    1.0
}

impl Default for Config {
    fn default() -> Self {
        Config { monitor: None, offset: 0.0, y: 0.0, gaming: false, rules: Rules::default(), zoom: 1.0 }
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
        (cur.monitor != config.monitor || cur.offset != config.offset || cur.y != config.y, cur.zoom != config.zoom)
    };
    let zoom = config.zoom;
    *state.config.lock().unwrap() = config;
    if zoomed {
        let _ = window.set_zoom(zoom);
        let _ = window.set_size(LogicalSize::new(WINDOW_W * zoom, WINDOW_H * zoom));
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
    unhide(&app);
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
        if !titled || owned || !candidate(hwnd) {
            continue;
        }
        let pid = window_pid(hwnd);
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

/// Opening from the tray, the open hotkey or a second launch brings back a Crest hidden with the hotkey.
pub fn unhide(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    if state.user_hidden.swap(false, Ordering::Relaxed) {
        sync(app);
    }
}

/// Shows or hides the window to match the hotkey and the rules; only acts on a change.
fn sync(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    let hide = state.user_hidden.load(Ordering::Relaxed) || state.rule_hide.load(Ordering::Relaxed);
    if state.hidden.swap(hide, Ordering::Relaxed) == hide {
        return;
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
pub fn place(window: &WebviewWindow, state: &DisplayState) -> tauri::Result<()> {
    let (wanted, offset, y, zoom) = {
        let c = state.config.lock().unwrap();
        (c.monitor.clone(), c.offset, c.y, c.zoom)
    };
    let monitors = window.available_monitors()?;
    let monitor = wanted
        .and_then(|name| monitors.into_iter().find(|m| m.name() == Some(&name)))
        .or(window.primary_monitor()?);
    let Some(monitor) = monitor else { return Ok(()) };
    // Set twice: when moving to a monitor with different scaling, the window size
    // only updates after the first move.
    for _ in 0..2 {
        let size = window.outer_size()?;
        let factor = monitor.scale_factor() * zoom;
        let free = (monitor.size().width as i32 - size.width as i32).max(0);
        let shift = ((offset * factor) as i32).clamp(-free / 2, free / 2);
        let x = monitor.position().x + free / 2 + shift;
        let top = ((y * factor) as i32).clamp(0, (monitor.size().height as i32 - size.height as i32).max(0));
        window.set_position(PhysicalPosition::new(x, monitor.position().y + top))?;
    }
    Ok(())
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
            let bg = (rules.background && fg.context == Context::Desktop)
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
    let (name, path) = known.describe(hwnd, pid);
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
        if !maximized && !(full && !caption) {
            continue;
        }
        let pid = window_pid(hwnd);
        if pid == own_pid {
            continue;
        }
        let (name, path) = known.describe(hwnd, pid);
        return Some(Seen { context: screen_policy::classify(false, full, caption, maximized), name, path });
    }
    None
}

/// Visible, not minimized, not a tool window, not cloaked, not the desktop or taskbar.
fn candidate(hwnd: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() || is_desktop(hwnd) {
            return false;
        }
        if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
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
    unsafe {
        if hwnd == GetDesktopWindow() || hwnd == GetShellWindow() {
            return true;
        }
        let mut buf = [0u16; 64];
        let len = GetClassNameW(hwnd, &mut buf).max(0) as usize;
        let class = String::from_utf16_lossy(&buf[..len]);
        matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
    }
}
