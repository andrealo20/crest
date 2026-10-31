//! Display: which monitor the notch sits on and whether it hides during fullscreen.
//!
//! A thread checks the foreground window every 400 ms. If it covers the notch's whole
//! monitor (game, video, presentation, borderless too), the window is hidden, otherwise
//! shown again. In "always" mode only "always on top" is reapplied in case another
//! app put itself above.
//!
//! Gaming mode "in fullscreen": the notch stays visible instead; Rust emits
//! `notch://fullscreen` and the frontend shows FPS and load.
//! `offset` moves the notch sideways (dragging), clamped to the monitor.
//! `edge` and `line` put the window on another screen edge (bottom, left, right).

use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowRect, IsZoomed};

use crate::hit_test::HitState;

const POLL: Duration = Duration::from_millis(400);

#[derive(Default)]
pub struct DisplayState(Mutex<Config>);

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// true = hide during fullscreen.
    hide_fullscreen: bool,
    /// Monitor name ("\\.\DISPLAY2"); None = primary monitor.
    monitor: Option<String>,
    /// Horizontal offset from the center in CSS px.
    #[serde(default)]
    offset: f64,
    /// Window top below the monitor's top edge in CSS px (the frontend computes it).
    #[serde(default)]
    y: f64,
    /// Gaming mode "in fullscreen": don't hide, just report.
    #[serde(default)]
    gaming: bool,
    /// Screen edge the window hangs from: "top" (default), "bottom", "left" or "right" (src/notch/edge.ts).
    #[serde(default)]
    edge: String,
    /// Where that edge's frame starts, CSS px from the monitor's top (bottom) or left (left, right). On top `y` is used.
    #[serde(default)]
    line: f64,
}

/// The window's logical size: as on top (tauri.conf.json), and on a side edge as deep as long so the widest panel fits across.
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
pub fn display_monitors(window: WebviewWindow) -> Vec<MonitorInfo> {
    let primary = window.primary_monitor().ok().flatten().and_then(|m| m.name().cloned());
    window
        .available_monitors()
        .unwrap_or_default()
        .into_iter()
        .map(|m| {
            let name = m.name().cloned().unwrap_or_default();
            let scale = m.scale_factor();
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
pub fn display_apply(config: Config, window: WebviewWindow, state: State<'_, DisplayState>) {
    let moved = {
        let cur = state.0.lock().unwrap();
        cur.monitor != config.monitor || cur.offset != config.offset || cur.y != config.y || cur.edge != config.edge || cur.line != config.line
    };
    *state.0.lock().unwrap() = config;
    if moved {
        let _ = place(&window, &state);
    }
}

/// Centered on the chosen monitor (primary otherwise), `y` CSS px below its top edge (clamped to the monitor).
/// Off the top edge the window's own edge goes on `line`, centred along that edge, and on a side edge it is as deep as long.
pub fn place(window: &WebviewWindow, state: &DisplayState) -> tauri::Result<()> {
    let (wanted, offset, y, edge, line) = {
        let c = state.0.lock().unwrap();
        (c.monitor.clone(), c.offset, c.y, c.edge.clone(), c.line)
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
        // Only resized when it changes between a horizontal and a vertical edge, so the top edge keeps its window as it was.
        if (size.height as f64 >= size.width as f64 * 0.9) != side {
            window.set_size(LogicalSize::new(if side { SIDE_DEPTH } else { ALONG }, if side { ALONG } else { DEPTH }))?;
            size = window.outer_size()?;
        }
        let scale = monitor.scale_factor();
        let (mw, mh) = (monitor.size().width as i32, monitor.size().height as i32);
        let (w, h) = (size.width as i32, size.height as i32);
        let free_x = (mw - w).max(0);
        let free_y = (mh - h).max(0);
        let line = (line * scale) as i32;
        let (x, top) = match edge.as_str() {
            "bottom" => (free_x / 2 + shift(offset, scale, free_x), (line - h).clamp(0, free_y)),
            "left" => (line.clamp(0, free_x), free_y / 2 + shift(offset, scale, free_y)),
            "right" => ((line - w).clamp(0, free_x), free_y / 2 + shift(offset, scale, free_y)),
            _ => (free_x / 2 + shift(offset, scale, free_x), ((y * scale) as i32).clamp(0, free_y)),
        };
        window.set_position(PhysicalPosition::new(monitor.position().x + x, monitor.position().y + top))?;
    }
    Ok(())
}

/// The offset along the edge in physical px, kept within the monitor.
fn shift(offset: f64, scale: f64, free: i32) -> i32 {
    ((offset * scale) as i32).clamp(-free / 2, free / 2)
}

pub fn spawn(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || {
        let Ok(own) = window.hwnd() else { return };
        let mut hidden = false;
        let mut last_fullscreen = false;
        let mut last_foreground = HWND::default();
        loop {
            thread::sleep(POLL);
            let state = app.state::<DisplayState>();
            let (hide_fullscreen, gaming) = {
                let c = state.0.lock().unwrap();
                (c.hide_fullscreen, c.gaming)
            };
            let foreground = unsafe { GetForegroundWindow() };
            let fullscreen = foreground != own && covers_monitor(foreground, own);
            if fullscreen != last_fullscreen {
                last_fullscreen = fullscreen;
                let _ = app.emit("notch://fullscreen", fullscreen);
            }
            let hide = hide_fullscreen && !gaming && fullscreen;

            if hide != hidden {
                hidden = hide;
                if hidden {
                    let _ = window.hide();
                } else {
                    let _ = window.show();
                    let _ = window.set_always_on_top(true);
                    // Let the click-through state be set again after show() (the poll caches the old one).
                    app.state::<HitState>().refresh();
                }
            }
            // New foreground window: reapply "on top" in case it covered us.
            if !hidden && foreground != last_foreground {
                let _ = window.set_always_on_top(true);
            }
            last_foreground = foreground;
        }
    });
}

/// Does `hwnd` cover the whole monitor the notch (`own`) is on?
fn covers_monitor(hwnd: HWND, own: HWND) -> bool {
    // Maximized windows aren't fullscreen, but with an auto-hiding taskbar they
    // cover the whole monitor too.
    if hwnd.is_invalid() || is_desktop(hwnd) || unsafe { IsZoomed(hwnd) }.as_bool() {
        return false;
    }
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor != MonitorFromWindow(own, MONITOR_DEFAULTTONEAREST) {
            return false;
        }
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        let mut rect = RECT::default();
        if !GetMonitorInfoW(monitor, &mut info).as_bool() || GetWindowRect(hwnd, &mut rect).is_err() {
            return false;
        }
        let m = info.rcMonitor;
        rect.left <= m.left && rect.top <= m.top && rect.right >= m.right && rect.bottom >= m.bottom
    }
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
