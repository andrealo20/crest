//! Display: which monitor the notch sits on, its scale, and what it does while other windows fill that monitor.
//!
//! A thread reads the foreground window every 400 ms and classifies it (maximized, borderless or
//! exclusive full screen, see screen_policy.rs). With "also check windows behind" a maximized or
//! borderless window behind it counts too. The rules answer keep, line or hide: Rust hides the
//! window itself and emits `notch://screen` so the frontend can draw the line. `notch://fullscreen`
//! still reports a full-screen foreground for gaming mode. On every new foreground window "always
//! on top" is reapplied in case another app put itself above. Crest's bars (Windows) get the full-screen reading of the window
//! in front of their own monitors (taskbar/front.rs) and are raised before the notch.
//!
//! The hide hotkey (shell.rs) hides Crest on top of that until it is pressed again, the notch is
//! opened from the tray, Crest is launched again or "raise now" runs. Opening on purpose also shows Crest over a "hide" rule
//! until the notch closes; the floating timer hides and shows with the notch, and also hides while a window on its own monitor
//! calls for the line or hiding (until another window comes to front after it was opened).
//!
//! "Behind other windows" (`behind`) turns that around: the notch rests at the bottom of the z-order, on the desktop, and comes on top
//! only while it is opened on purpose and not kept open, or an indicator shows (`rests_below`); its copies stay under every window.
//!
//! `offset` moves the notch along its edge (dragging), clamped to the monitor. `zoom` is the panel scale:
//! the page is zoomed and the window grown by it. Windows' Text size makes WebView2 draw the page larger again
//! (text_scale.rs) and the window grows with it too, so CSS px times DPI times zoom times Text size are device pixels.
//! `edge` and `line` put the window on another screen edge (bottom, left, right).
//!
//! `mode` "follow" or "all" (mirror.rs): the frontend picks `monitor` from where the pointer is, and with "all" sends a `spot`
//! (line and window top) for every monitor, where mirror.rs places a closed-only copy of the notch.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};
use std::sync::Mutex;
#[cfg(windows)]
use std::thread;
#[cfg(windows)]
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri::{AppHandle, LogicalSize, Manager, PhysicalPosition, State, WebviewWindow};
#[cfg(windows)]
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
#[cfg(windows)]
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, HMONITOR, MONITORINFO, MONITOR_DEFAULTTONEAREST};
#[cfg(windows)]
use windows::Win32::System::Threading::GetCurrentProcessId;
#[cfg(windows)]
use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SHQueryUserNotificationState, SetWindowSubclass, QUNS_RUNNING_D3D_FULL_SCREEN};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetAncestor, GetClassNameW, GetCursorPos, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindow, GetWindowLongPtrW,
    GetWindowRect, GetWindowTextLengthW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, IsZoomed, SetWindowLongPtrW, SetWindowPos, WindowFromPoint,
    GA_ROOT, GWL_EXSTYLE, GWL_STYLE, GW_OWNER, HWND_BOTTOM, HWND_TOPMOST, STYLESTRUCT, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SWP_NOZORDER, WINDOWPOS, WM_NCDESTROY, WM_STYLECHANGING, WM_WINDOWPOSCHANGING, WS_CAPTION, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TRANSPARENT, WS_THICKFRAME,
};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::FindWindowExW;
#[cfg(windows)]
use windows::core::{w, PCWSTR};

use crate::hit_test::HitState;
#[cfg(windows)]
use crate::screen_policy::Context;
use crate::screen_policy::{self, Behavior, Rules};

#[cfg(windows)]
const POLL: Duration = Duration::from_millis(400);

#[derive(Default)]
pub struct DisplayState {
    config: Mutex<Config>,
    /// Hidden with the hide hotkey.
    user_hidden: AtomicBool,
    /// The rules call for hiding right now.
    rule_hide: AtomicBool,
    /// Opened on purpose (shortcut, tray, launcher): shown over `rule_hide` until the notch closes.
    opened: AtomicBool,
    /// The window is hidden right now.
    hidden: AtomicBool,
    /// Shown for an indicator while the rules or the hotkey keep it hidden (`display_alert`); `sync` drops it on any change.
    revealed: AtomicBool,
    /// Last behaviour the rules called for (Behavior as u8), for `display_screen`.
    behavior: AtomicU8,
    /// An app covers the notch's monitor in fullscreen right now, for `display_fullscreen`.
    fullscreen: AtomicBool,
    /// The monitors (HMONITOR) of other screens where a window calls for hiding or the line, so their mirrors hide.
    pub(crate) mirror_block: Mutex<Vec<isize>>,
    /// A window on the floating timer's monitor calls for the line or hiding, so the timer hides like the notch.
    timer_block: AtomicBool,
    /// The floating timer is hidden right now.
    timer_hidden: AtomicBool,
    /// The foreground window (HWND) when the timer was opened: the rules leave the timer alone until another window comes to front.
    timer_grace: AtomicIsize,
}

impl DisplayState {
    /// Undoes the hide hotkey and nothing else: a "hide" rule keeps its say, since the notch did not open. True when it was hidden.
    fn come_back(&self) -> bool {
        self.user_hidden.swap(false, Ordering::Relaxed)
    }

    /// Hidden by the hotkey, or by a rule the notch was not opened over.
    fn hides(&self) -> bool {
        self.user_hidden.load(Ordering::Relaxed) || (self.rule_hide.load(Ordering::Relaxed) && !self.opened.load(Ordering::Relaxed))
    }
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    /// Monitor name ("\\.\DISPLAY2"); None = primary monitor.
    pub(crate) monitor: Option<String>,
    /// "follow" (the notch goes where the pointer is) or "all" (a mirror on every other monitor); empty = the chosen monitor.
    #[serde(default)]
    pub(crate) mode: String,
    /// With "all": where the window goes on each monitor, worked out by the frontend from that monitor's size and taskbar.
    #[serde(default)]
    pub(crate) spots: Vec<Spot>,
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
    /// Panel scale, 0.8 to 2.0 (fit_zoom).
    #[serde(default = "one")]
    pub(crate) zoom: f64,
    /// Screen edge the window hangs from: "top" (default), "bottom", "left" or "right" (src/notch/edge.ts).
    #[serde(default)]
    edge: String,
    /// Where that edge's frame starts, CSS px from the monitor's top (bottom) or left (left, right). On top `y` is used.
    #[serde(default)]
    line: f64,
    /// The window's length along that edge in CSS px, longer than `ALONG` for a wide closed notch (src/notch/collapsed.ts windowAlong); see `fit_along`.
    #[serde(default)]
    along: f64,
    /// "Behind other windows" (the Window page): the notch rests under every window, on the desktop (`rests_below`).
    #[serde(default)]
    behind: bool,
}

/// `line` and `y` of Config for one monitor.
#[derive(Clone, Debug, PartialEq, Deserialize)]
pub struct Spot {
    pub monitor: String,
    pub line: f64,
    pub y: f64,
}

fn one() -> f64 {
    1.0
}

impl Default for Config {
    fn default() -> Self {
        Config {
            monitor: None,
            mode: String::new(),
            spots: Vec::new(),
            offset: 0.0,
            y: 0.0,
            gaming: false,
            rules: Rules::default(),
            zoom: 1.0,
            edge: String::new(),
            line: 0.0,
            along: 0.0,
            behind: false,
        }
    }
}

/// Only the scales the settings offer (src/features/window/panelSize.ts PANEL_SCALES); anything else is 100 %.
fn fit_zoom(z: f64) -> f64 {
    [0.8, 0.9, 1.1, 1.25, 1.5, 1.75, 2.0].into_iter().find(|s| (z - s).abs() < 0.01).unwrap_or(1.0)
}

/// The window's logical size at 100 %: as on top (tauri.conf.json), and on a side edge as deep as long so the widest panel fits across.
const ALONG: f64 = 760.0;
const DEPTH: f64 = 560.0;
const SIDE_DEPTH: f64 = 760.0;
/// The longest window along the edge: the widest closed notch the settings allow (8000) and the room around it.
const MAX_ALONG: f64 = 8060.0;

/// The window's length along its edge at 100 %: `ALONG`, or what a wider closed notch asks for, up to `MAX_ALONG`.
fn fit_along(along: f64) -> f64 {
    if along.is_finite() {
        along.clamp(ALONG, MAX_ALONG)
    } else {
        ALONG
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonitorInfo {
    name: String,
    primary: bool,
    /// Size in CSS px, not rounded: the scale (DPI x panel scale x Text size) rarely divides it, and a rounded size left the
    /// right or bottom edge's notch a pixel short of the screen's edge.
    width: f64,
    height: f64,
    /// Work area (without taskbar and Crest's bar) in CSS px: top below the monitor's top edge, and height.
    work_top: f64,
    work_height: f64,
    /// The work area's left edge from the monitor's left, and its width (a taskbar on the left or right), in CSS px.
    work_left: f64,
    work_width: f64,
}

/// The name each monitor goes by, in the order given. A Mac names a display by its model, so two of one model share a name:
/// the later one (by position, left to right) gets a number, and the first keeps the plain name it was saved under.
/// `monitors`: name, x and y of each.
fn unique_names(monitors: &[(String, i32, i32)]) -> Vec<String> {
    let mut order: Vec<usize> = (0..monitors.len()).collect();
    order.sort_by_key(|&i| (monitors[i].1, monitors[i].2));
    let mut names = vec![String::new(); monitors.len()];
    for (at, &i) in order.iter().enumerate() {
        let same = order[..at].iter().filter(|&&j| monitors[j].0 == monitors[i].0).count();
        names[i] = if same == 0 { monitors[i].0.clone() } else { format!("{} ({})", monitors[i].0, same + 1) };
    }
    names
}

/// The monitors with the name `unique_names` gives each.
fn named_monitors(window: &WebviewWindow) -> Vec<(String, tauri::Monitor)> {
    let monitors = window.available_monitors().unwrap_or_default();
    let keys: Vec<_> = monitors.iter().map(|m| (m.name().cloned().unwrap_or_default(), m.position().x, m.position().y)).collect();
    unique_names(&keys).into_iter().zip(monitors).collect()
}

#[tauri::command]
pub fn display_monitors(window: WebviewWindow, state: State<'_, DisplayState>) -> Vec<MonitorInfo> {
    let zoom = state.config.lock().unwrap().zoom * crate::text_scale::get();
    let primary = window.primary_monitor().ok().flatten().map(|m| *m.position());
    // Crest's bar stands on every monitor's work area and takes its band off each, on the bar's edge, in the notch's CSS px.
    #[cfg(windows)]
    let (band, top) = (crate::taskbar::bar::band() / zoom, crate::taskbar::bar::top());
    named_monitors(&window)
        .into_iter()
        .map(|(name, m)| {
            let scale = m.scale_factor() * zoom;
            let wa = m.work_area();
            let primary = primary == Some(*m.position());
            let (work_top, work_height) = ((wa.position.y - m.position().y) as f64 / scale, wa.size.height as f64 / scale);
            #[cfg(windows)]
            let (work_top, work_height) = crate::taskbar::bar::band_off(top, (work_top, work_height), band);
            MonitorInfo {
                primary,
                width: m.size().width as f64 / scale,
                height: m.size().height as f64 / scale,
                work_top,
                work_height,
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
    let (moved, zoomed, mirrored, behind) = {
        let cur = state.config.lock().unwrap();
        (
            cur.monitor != config.monitor || cur.offset != config.offset || cur.y != config.y || cur.edge != config.edge || cur.line != config.line || cur.along != config.along,
            cur.zoom != config.zoom,
            cur.mode != config.mode || cur.spots != config.spots,
            cur.behind != config.behind,
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
    if moved || zoomed || mirrored {
        crate::mirror::wake(window.app_handle());
    }
    if behind {
        restack(window.app_handle());
    }
}

/// The page's own scale changed (another monitor, or Windows' Text size): with a new Text size the window and the copies on the
/// other monitors grow or shrink with it, so the page keeps its size in CSS px and the hit test its units (text_scale.rs). A notch
/// hanging from an edge stays on it until the page has read the monitors again at the new size (`notch://monitors`) and sent new
/// places; the offset and a floating capsule's top are the page's own px and move with the Text size, as everything it draws grows.
#[tauri::command]
pub fn display_rescale(window: WebviewWindow, state: State<'_, DisplayState>) {
    let Some((old, new)) = crate::text_scale::refresh() else { return };
    follow_text_scale(&mut state.config.lock().unwrap(), old / new);
    let _ = place(&window, &state);
    crate::mirror::wake(window.app_handle());
    crate::timer_window::follow_text_size(window.app_handle());
    // The bars' windows and the strip they keep are sized in their pages' px too.
    #[cfg(windows)]
    {
        crate::taskbar::bar::place(window.app_handle());
        crate::taskbar::reserve::refresh();
    }
    let _ = window.emit("notch://monitors", ());
}

/// The lines the page sent for the window and the copies are CSS px at the Text size of then: `k` (old / new factor) keeps them on
/// the same device px. On top the page sends a hanging notch's line as the window's top too (follow.ts spotFor), so a top equal to
/// its line goes with it. A floating capsule's top comes without a line: it is the page's own px, sent again only when it changes,
/// so a converted copy would make the capsule jump at its next drag.
fn follow_text_scale(c: &mut Config, k: f64) {
    follow(&mut c.line, &mut c.y, k);
    for spot in &mut c.spots {
        follow(&mut spot.line, &mut spot.y, k);
    }
}

fn follow(line: &mut f64, y: &mut f64, k: f64) {
    if *y == *line {
        *y *= k;
    }
    *line *= k;
}

/// What the rules call for right now ("normal" | "line" | "hide"), for the frontend's start.
#[tauri::command]
pub fn display_screen(state: State<'_, DisplayState>) -> &'static str {
    behavior_from(state.behavior.load(Ordering::Relaxed)).as_str()
}

/// Whether an app covers the notch's monitor in fullscreen right now, for the frontend's start (the event may have come before it listened).
#[tauri::command]
pub fn display_fullscreen(state: State<'_, DisplayState>) -> bool {
    state.fullscreen.load(Ordering::Relaxed)
}

/// While an indicator shows everywhere (status alerts), brings out the window that a rule or the hotkey keeps hidden, and hides it again
/// after. It neither activates the window nor takes the pointer, so the app in front, a game or a video, keeps both: `hidden` stays true
/// meanwhile, the hit-test thread rests and the window stays click-through. `sync` takes over whenever the reason to hide changes.
/// With Behind on, a notch in sight but under the windows comes on top for the indicator the same way, and goes back under after.
#[tauri::command]
pub fn display_alert(app: AppHandle, on: bool) {
    let state = app.state::<DisplayState>();
    let Some(window) = app.get_webview_window("notch") else { return };
    if on {
        if state.revealed.load(Ordering::Relaxed) {
            return;
        }
        if state.hidden.load(Ordering::Relaxed) {
            state.revealed.store(true, Ordering::Relaxed);
            show_quietly(&window);
        } else if state.config.lock().unwrap().behind {
            state.revealed.store(true, Ordering::Relaxed);
            restack(&app);
        }
    } else if state.revealed.swap(false, Ordering::Relaxed) {
        if state.hidden.load(Ordering::Relaxed) {
            hide_quietly(&window);
        } else {
            restack(&app);
        }
    }
}

/// Hidden the way `show_quietly` showed it. tao keeps its own visible flag, which that raw show never set: its hide() would find the
/// window already hidden and do nothing, leaving the notch over the game or the hidden state until the reason to hide changed.
#[cfg(windows)]
fn hide_quietly(window: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
    }
}

#[cfg(not(windows))]
fn hide_quietly(window: &WebviewWindow) {
    let _ = window.hide();
}

/// Shown without activation and click-through, on top of the other topmost windows: an indicator over the app in front.
#[cfg(windows)]
fn show_quietly(window: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNOACTIVATE};
    let _ = window.set_ignore_cursor_events(true);
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
    }
    raise_topmost(window);
}

/// The Mac has no status alerts.
#[cfg(not(windows))]
fn show_quietly(_window: &WebviewWindow) {}

/// "Raise now": shows Crest if the hide hotkey hid it and puts it on top of the topmost windows, or with Behind on back under every
/// window (`restack`).
#[tauri::command]
pub fn display_raise(app: AppHandle) {
    bring_back(&app);
    // The bar first, so the notch stays above it.
    #[cfg(windows)]
    crate::taskbar::bar::raise(&app);
    restack(&app);
}

/// Puts the window on top of the other topmost windows. `set_always_on_top(true)` does nothing on a window that is already topmost.
#[cfg(windows)]
pub(crate) fn raise_topmost(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { SetWindowPos(hwnd, Some(HWND_TOPMOST), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
    }
}

/// "Behind other windows" is on (Config `behind`): the copies on the other monitors stay under every window (`stack`).
static BEHIND: AtomicBool = AtomicBool::new(false);
/// The notch rests under every window right now (`rests_below`): its subclass holds it at the bottom of the z-order whatever tries to
/// raise it (`below_proc`), and the hit test lets the pointer open it only where no window covers it (`covered`).
static BOTTOM: AtomicBool = AtomicBool::new(false);

/// Whether the notch rests under every window: with Behind on, unless it was opened on purpose (the shortcut, the tray, the Launcher)
/// and is not kept open, or an indicator brings it out for a moment (`display_alert`).
pub(crate) fn rests_below(behind: bool, opened: bool, kept: bool, revealed: bool) -> bool {
    behind && !revealed && !(opened && !kept)
}

/// Puts the notch where Behind wants it now (`rests_below`): at the bottom under every window, or on top of the topmost ones, and the
/// copies with it. A hidden window is left alone: `sync` stacks it as it shows it.
pub(crate) fn restack(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    let behind = state.config.lock().unwrap().behind;
    let revealed = state.revealed.load(Ordering::Relaxed);
    let below = rests_below(behind, state.opened.load(Ordering::Relaxed), app.state::<HitState>().kept_open(), revealed);
    BEHIND.store(behind, Ordering::Relaxed);
    BOTTOM.store(below, Ordering::Relaxed);
    if let Some(window) = app.get_webview_window("notch") {
        if !state.hidden.load(Ordering::Relaxed) || revealed {
            #[cfg(windows)]
            if below {
                to_bottom(&window);
            } else {
                raise_topmost(&window);
            }
            #[cfg(target_os = "macos")]
            if below {
                crate::macos::sink(&window);
            } else {
                let _ = window.set_always_on_top(true);
                crate::macos::raise(&window);
            }
        }
    }
    #[cfg(windows)]
    crate::mirror::restack(app);
}

/// Under every window, the topmost flag dropped with it (HWND_BOTTOM does both).
#[cfg(windows)]
fn to_bottom(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        let _ = unsafe { SetWindowPos(hwnd, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
    }
}

/// A copy on another monitor: under every window while Behind is on, else on top of the topmost ones.
#[cfg(windows)]
pub(crate) fn stack(window: &WebviewWindow) {
    if BEHIND.load(Ordering::Relaxed) {
        to_bottom(window);
    } else {
        raise_topmost(window);
    }
}

/// While the notch rests below (`BOTTOM`), any move of it in the z-order goes to the bottom instead: a click activates it, which
/// would bring it up, and so would a raise of Crest's own or of tao's.
#[cfg(windows)]
unsafe extern "system" fn below_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _: usize, _: usize) -> LRESULT {
    if msg == WM_WINDOWPOSCHANGING && BOTTOM.load(Ordering::Relaxed) {
        let pos = unsafe { &mut *(lparam.0 as *mut WINDOWPOS) };
        if pos.flags.0 & SWP_NOZORDER.0 == 0 {
            pos.hwndInsertAfter = HWND_BOTTOM;
        }
    } else if msg == WM_NCDESTROY {
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(below_proc), BELOW_SUBCLASS) };
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(windows)]
const BELOW_SUBCLASS: usize = 2;

/// Gives the notch's window `below_proc`, on the window's own thread, where SetWindowSubclass has to run.
#[cfg(windows)]
pub(crate) fn keep_below(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = hwnd.0 as isize;
    let _ = window.run_on_main_thread(move || {
        if !unsafe { SetWindowSubclass(HWND(hwnd as _), Some(below_proc), BELOW_SUBCLASS, 0) }.as_bool() {
            eprintln!("below subclass: SetWindowSubclass failed");
        }
    });
}

/// With the notch resting below, whether another window is over the pointer, so the pointer is no hover for the notch: what is under it
/// is neither the notch (skipped while it lets clicks through) nor the desktop behind it.
#[cfg(windows)]
pub(crate) fn covered(notch: isize) -> bool {
    let mut p = POINT::default();
    if !BOTTOM.load(Ordering::Relaxed) || unsafe { GetCursorPos(&mut p) }.is_err() {
        return false;
    }
    let root = unsafe { GetAncestor(WindowFromPoint(p), GA_ROOT) };
    if root.is_invalid() || root.0 as isize == notch {
        return false;
    }
    let mut class = [0u16; 16];
    let n = unsafe { GetClassNameW(root, &mut class) }.max(0) as usize;
    !matches!(String::from_utf16_lossy(&class[..n]).as_str(), "Progman" | "WorkerW")
}

/// A tool window and not an app window: out of Alt+Tab, Task View and the taskbar. Every other bit stays as tao and hit_test.rs
/// set it, so click-through, NOACTIVATE and topmost do not change, and the notch and the bars still take the keyboard.
#[cfg(windows)]
fn out_of_alt_tab(ex: u32) -> u32 {
    (ex | WS_EX_TOOLWINDOW.0) & !WS_EX_APPWINDOW.0
}

/// tao rebuilds the whole ex style from its own flags (APPWINDOW, never TOOLWINDOW) at every show, hide and click-through
/// change, and set_click_through writes it from the poll thread. Both send WM_STYLECHANGING on the window's thread before the
/// write lands, and nothing in tao, wry or tauri handles it, so the style is fixed up here. tao reads the ex style back only to
/// size the frame, and these windows are undecorated: TOOLWINDOW changes only the caption height, which they have none of.
#[cfg(windows)]
unsafe extern "system" fn alt_tab_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM, _: usize, _: usize) -> LRESULT {
    if msg == WM_STYLECHANGING && wparam.0 as i32 == GWL_EXSTYLE.0 {
        let style = unsafe { &mut *(lparam.0 as *mut STYLESTRUCT) };
        style.styleNew = out_of_alt_tab(style.styleNew);
    } else if msg == WM_NCDESTROY {
        let _ = unsafe { RemoveWindowSubclass(hwnd, Some(alt_tab_proc), ALT_TAB_SUBCLASS) };
    }
    unsafe { DefSubclassProc(hwnd, msg, wparam, lparam) }
}

#[cfg(windows)]
const ALT_TAB_SUBCLASS: usize = 1;

/// On the window's own thread: SetWindowSubclass refuses any other. Twice is harmless, the same proc and id only replace the
/// ref data and the style is already forced.
#[cfg(windows)]
fn subclass_out_of_alt_tab(hwnd: HWND) {
    if !unsafe { SetWindowSubclass(hwnd, Some(alt_tab_proc), ALT_TAB_SUBCLASS, 0) }.as_bool() {
        eprintln!("alt-tab subclass: SetWindowSubclass failed");
        return;
    }
    let ex = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32;
    if out_of_alt_tab(ex) != ex {
        unsafe {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, out_of_alt_tab(ex) as isize);
            let _ = SetWindowPos(hwnd, None, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED);
        }
    }
}

/// Keeps one of Crest's windows other than settings out of Alt+Tab and Task View (#78). Called before the window's first show:
/// on the main thread it runs at once, from another thread it is queued in the same order as any show() that thread sends later.
#[cfg(windows)]
pub(crate) fn keep_out_of_alt_tab(window: &WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else { return };
    let hwnd = hwnd.0 as isize;
    let _ = window.run_on_main_thread(move || subclass_out_of_alt_tab(HWND(hwnd as _)));
}

#[derive(Serialize)]
pub struct RunningApp {
    name: String,
    path: String,
}

/// Apps with a visible window, for adding an app rule. Each executable once.
#[cfg(windows)]
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

/// App rules need the foreground window's app, which the Mac does not read yet: nothing to pick from.
#[cfg(not(windows))]
#[tauri::command]
pub async fn display_apps() -> Vec<RunningApp> {
    Vec::new()
}

/// Hide hotkey: hides Crest, or shows it again.
pub fn toggle_user_hidden(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    let now = !state.user_hidden.load(Ordering::Relaxed);
    state.user_hidden.store(now, Ordering::Relaxed);
    sync(app);
}

/// "Raise now" and a second launch (which opens the settings window, not the notch): bring back a Crest hidden with the
/// hotkey. Not `unhide`: nothing opens, so a "hide" rule keeps its say.
pub fn bring_back(app: &AppHandle) {
    if app.state::<DisplayState>().come_back() {
        sync(app);
    }
}

/// Opening from the tray, the open hotkey or the launcher brings back a Crest hidden with the hotkey, and shows it
/// over a "hide" rule until the notch closes again.
pub fn unhide(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    state.user_hidden.store(false, Ordering::Relaxed);
    state.opened.store(true, Ordering::Relaxed);
    sync(app);
    restack(app);
}

/// The notch closed (keyboard_focus(false) in lib.rs): the rules hide it again.
pub fn closed(app: &AppHandle) {
    if app.state::<DisplayState>().opened.swap(false, Ordering::Relaxed) {
        sync(app);
        restack(app);
    }
}

/// Hidden with the hide hotkey (the mirrors hide with it; a rule only hides the notch on its own monitor).
pub fn user_hidden(app: &AppHandle) -> bool {
    app.state::<DisplayState>().user_hidden.load(Ordering::Relaxed)
}

/// Hidden by a rule or the hotkey; the hit-test thread rests meanwhile.
pub fn is_hidden(app: &AppHandle) -> bool {
    app.state::<DisplayState>().hidden.load(Ordering::Relaxed)
}

/// Shows or hides the floating timer: hidden with the notch, and while a window on its own monitor calls for the line or
/// hiding (`screen_policy::timer_hides`). Only acts on a change.
fn sync_timer(app: &AppHandle) {
    // The timer window exists only while it is open (timer_window.rs destroys it on close).
    let Some(timer) = app.get_webview_window("timer") else { return };
    let state = app.state::<DisplayState>();
    let hide = screen_policy::timer_hides(state.hides(), state.timer_block.load(Ordering::Relaxed), state.opened.load(Ordering::Relaxed));
    if state.timer_hidden.swap(hide, Ordering::Relaxed) == hide {
        return;
    }
    if hide {
        let _ = timer.hide();
    } else {
        // Queued ahead of this show from any thread, in case it comes before the one timer_window_open queued after build().
        #[cfg(windows)]
        keep_out_of_alt_tab(&timer);
        let _ = timer.show();
    }
}

/// The timer was just opened (or opened again) and shown: it stays in sight, whatever the rules say, until another window
/// comes to front.
pub fn timer_opened(app: &AppHandle) {
    let state = app.state::<DisplayState>();
    state.timer_hidden.store(false, Ordering::Relaxed);
    state.timer_block.store(false, Ordering::Relaxed);
    #[cfg(windows)]
    state.timer_grace.store(unsafe { GetForegroundWindow() }.0 as isize, Ordering::Relaxed);
}

/// Shows or hides the window (and the floating timer with it) to match the hotkey and the rules; only acts on a change.
fn sync(app: &AppHandle) {
    // The bar follows the hotkey on its own, whatever the notch does (taskbar/bar.rs).
    #[cfg(windows)]
    crate::taskbar::bar::sync(app);
    // The timer has its own rule reading on top of the notch's (`sync_timer`), so it is checked on every call.
    sync_timer(app);
    let state = app.state::<DisplayState>();
    let hide = state.hides();
    if state.hidden.swap(hide, Ordering::Relaxed) == hide {
        return;
    }
    // Shown or hidden for good now: an indicator's reveal is over either way.
    state.revealed.store(false, Ordering::Relaxed);
    crate::mirror::wake(app);
    // Hiding the window does not hide the page, so the Camera tool learns it here.
    let _ = app.emit("notch://hidden", hide);
    let Some(window) = app.get_webview_window("notch") else { return };
    if hide {
        let _ = window.hide();
    } else {
        let _ = window.show();
        restack(app);
        // Let the click-through state be set again after show() (the poll caches the old one).
        app.state::<HitState>().refresh();
    }
}

/// Centered on the chosen monitor (primary otherwise), `y` CSS px below its top edge (clamped to the monitor).
/// Off the top edge the window's own edge goes on `line`, centred along that edge, and on a side edge it is as deep as long.
pub fn place(window: &WebviewWindow, state: &DisplayState) -> tauri::Result<()> {
    let c = state.config();
    put(window, c.monitor.as_deref(), &c, c.line, c.y)
}

impl DisplayState {
    pub(crate) fn config(&self) -> Config {
        self.config.lock().unwrap().clone()
    }
}

/// `place` for any window: on `wanted` (the primary monitor when it is missing), with `line` and `y` for that monitor and the rest of `c`.
pub(crate) fn put(window: &WebviewWindow, wanted: Option<&str>, c: &Config, line: f64, y: f64) -> tauri::Result<()> {
    // Text size zooms the page as the panel scale does (text_scale.rs).
    let (offset, zoom, edge, along) = (c.offset, c.zoom * crate::text_scale::get(), c.edge.as_str(), fit_along(c.along));
    let side = edge == "left" || edge == "right";
    let monitor = wanted
        .and_then(|name| named_monitors(window).into_iter().find(|(n, _)| n == name).map(|(_, m)| m))
        .or(window.primary_monitor()?);
    let Some(monitor) = monitor else { return Ok(()) };
    // Set twice: when moving to a monitor with different scaling, the window size
    // only updates after the first move.
    for _ in 0..2 {
        let mut size = window.outer_size()?;
        // Only resized when the orientation, the zoom or the closed notch's length changes, so the top edge at 100 % keeps its window as it was.
        let (lw, lh) = (if side { SIDE_DEPTH } else { along } * zoom, if side { along } else { DEPTH } * zoom);
        let dpi = window.scale_factor()?;
        if (size.width as f64 - lw * dpi).abs() > 2.0 || (size.height as f64 - lh * dpi).abs() > 2.0 {
            window.set_size(LogicalSize::new(lw, lh))?;
            size = window.outer_size()?;
        }
        let monitor_px = (monitor.size().width as i32, monitor.size().height as i32);
        let at = Placement { edge, offset, y, line, keep: kept_along(along), scale: monitor.scale_factor() * zoom };
        let (x, top) = at.position(monitor_px, (size.width as i32, size.height as i32));
        window.set_position(PhysicalPosition::new(monitor.position().x + x, monitor.position().y + top))?;
    }
    Ok(())
}

/// The widest panel along its edge in CSS px (panelSize.ts MAX_SIZE), kept on the monitor when the notch is moved.
const PANEL_ALONG: f64 = 740.0;

/// What stays on the monitor when a window this long is moved along its edge: the widest panel, or a wider closed notch with its hover nudge,
/// which a longer window holds with the same margin as `ALONG` holds the panel.
fn kept_along(along: f64) -> f64 {
    fit_along(along) - (ALONG - PANEL_ALONG)
}

/// Where the window goes on its monitor; CSS px values, `scale` = monitor DPI x zoom x Text size.
struct Placement<'a> {
    edge: &'a str,
    offset: f64,
    y: f64,
    line: f64,
    /// The length along the edge kept on the monitor (`kept_along`).
    keep: f64,
    scale: f64,
}

impl Placement<'_> {
    /// The window's top-left in physical px from the monitor's top-left, for a `window` (w, h) on a `monitor` (w, h).
    /// The hanging edge stays on `line` (or `y` on top) and the window is centred along the edge even when it is larger
    /// than the monitor (a big scale on a small screen), so the notch never leaves its edge; the offset along the edge
    /// is clamped so the widest panel (or a wider closed notch) stays on the monitor.
    fn position(&self, (mw, mh): (i32, i32), (w, h): (i32, i32)) -> (i32, i32) {
        let line = (self.line * self.scale).round() as i32;
        let side = self.edge == "left" || self.edge == "right";
        let (m_along, w_along) = if side { (mh, h) } else { (mw, w) };
        let free = (m_along - (self.keep * self.scale).round() as i32).max(0);
        let along = (m_along - w_along) / 2 + ((self.offset * self.scale) as i32).clamp(-free / 2, free / 2);
        match self.edge {
            "bottom" => (along, line - h),
            "left" => (line, along),
            "right" => (line - w, along),
            _ => (along, ((self.y * self.scale) as i32).min(mh - h).max(0)),
        }
    }
}

#[cfg(windows)]
pub fn spawn(app: AppHandle, window: WebviewWindow) {
    thread::spawn(move || {
        let Ok(own) = window.hwnd() else { return };
        let mut last_fullscreen = false;
        let mut last_behavior: Option<Behavior> = None;
        let mut last_foreground = HWND::default();
        // The window the rules read (`ruled_front`).
        let mut ruled = HWND::default();
        let (mut front, mut behind) = (Known::default(), Known::default());
        // What each other monitor's window was last known as: its frontmost window and the one behind it.
        let mut aside: std::collections::HashMap<isize, (Known, Known)> = Default::default();
        loop {
            thread::sleep(POLL);
            // Screen off or suspending (standby.rs): the windows and monitors are not read until it is back.
            if crate::standby::asleep() {
                continue;
            }
            let state = app.state::<DisplayState>();
            let (rules, gaming, mirrors) = {
                let c = state.config.lock().unwrap();
                (c.rules.clone(), c.gaming, c.mode == "all")
            };
            let foreground = unsafe { GetForegroundWindow() };
            ruled = ruled_front(foreground, crate::taskbar::screens::is_bar(foreground.0 as isize), ruled);
            let monitor = unsafe { MonitorFromWindow(own, MONITOR_DEFAULTTONEAREST) };
            let fg = read_foreground(ruled, own, monitor, &mut front);
            // Looked up only where it can matter: nothing in front fills the monitor.
            let bg = (rules.background_matters() && fg.context == Context::Desktop)
                .then(|| read_background(ruled, own, monitor, &mut behind))
                .flatten();

            let fullscreen = fg.context.is_fullscreen();
            if fullscreen != last_fullscreen {
                last_fullscreen = fullscreen;
                state.fullscreen.store(fullscreen, Ordering::Relaxed);
                let _ = app.emit("notch://fullscreen", fullscreen);
            }
            // Each bar hides over a full-screen app in front of its own monitor, whatever the notch's rules say.
            crate::taskbar::front::poll(&app, foreground, ruled);
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
            // With mirrors, the windows on another monitor answer for the mirror there, read like the notch's own screen.
            let mut block = Vec::new();
            if mirrors {
                for m in crate::mirror::monitors(&app).into_iter().filter(|&m| m != monitor.0 as isize) {
                    let (near, far) = aside.entry(m).or_default();
                    let elsewhere = HMONITOR(m as *mut _);
                    let seen = read_foreground(ruled, own, elsewhere, near);
                    let back = (rules.background_matters() && seen.context == Context::Desktop).then(|| read_background(ruled, own, elsewhere, far)).flatten();
                    let rule = screen_policy::decide(&rules, (seen.context, &seen.name, &seen.path), back.as_ref().map(|b| (b.context, b.name.as_str(), b.path.as_str())), gaming);
                    if rule != Behavior::Normal {
                        block.push(m);
                    }
                }
            }
            // The floating timer hides like the notch while a window on its own monitor calls for the line or hiding. A timer just
            // opened is left in sight until another window comes to front (`timer_opened`).
            let timer = app.get_webview_window("timer").and_then(|t| t.hwnd().ok());
            let grace = state.timer_grace.load(Ordering::Relaxed);
            if grace != 0 && (timer.is_none() || grace != foreground.0 as isize) {
                state.timer_grace.store(0, Ordering::Relaxed);
            }
            let timer_block = match timer {
                Some(t) if state.timer_grace.load(Ordering::Relaxed) == 0 => {
                    let on = unsafe { MonitorFromWindow(t, MONITOR_DEFAULTTONEAREST) };
                    if on == monitor {
                        behavior != Behavior::Normal
                    } else if mirrors {
                        block.contains(&(on.0 as isize))
                    } else {
                        let (near, far) = aside.entry(on.0 as isize).or_default();
                        let seen = read_foreground(ruled, own, on, near);
                        let back = (rules.background_matters() && seen.context == Context::Desktop).then(|| read_background(ruled, own, on, far)).flatten();
                        screen_policy::decide(&rules, (seen.context, &seen.name, &seen.path), back.as_ref().map(|b| (b.context, b.name.as_str(), b.path.as_str())), gaming) != Behavior::Normal
                    }
                }
                _ => false,
            };
            if state.timer_block.swap(timer_block, Ordering::Relaxed) != timer_block {
                sync_timer(&app);
            }
            if std::mem::replace(&mut *state.mirror_block.lock().unwrap(), block.clone()) != block {
                crate::mirror::wake(&app);
            }
            // New foreground window: reapply "on top" in case it covered us, the bar first so the notch stays above it. Not for
            // the app whose tray menu a right click opened: it comes to the front to show the menu, which must stay above the bar.
            if foreground != last_foreground && !crate::taskbar::tray::menu_of(window_pid(foreground)) {
                crate::taskbar::bar::raise(&app);
                // Resting under the windows with Behind on, it stays there.
                if !state.hidden.load(Ordering::Relaxed) && !BOTTOM.load(Ordering::Relaxed) {
                    raise_topmost(&window);
                }
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

#[cfg(windows)]
/// One window as the rules see it.
struct Seen {
    context: Context,
    name: String,
    path: String,
}

#[cfg(windows)]
impl Seen {
    fn desktop() -> Seen {
        Seen { context: Context::Desktop, name: String::new(), path: String::new() }
    }
}

#[cfg(windows)]
/// The last window's app, so the executable is read once per window instead of every poll.
#[derive(Default)]
struct Known {
    hwnd: isize,
    pid: u32,
    name: String,
    path: String,
}

#[cfg(windows)]
impl Known {
    fn describe(&mut self, hwnd: HWND, pid: u32) -> (String, String) {
        if self.hwnd != hwnd.0 as isize || self.pid != pid {
            let path = crate::mixer::process_path(pid).unwrap_or_default();
            *self = Known { hwnd: hwnd.0 as isize, pid, name: exe_name(&path), path };
        }
        (self.name.clone(), self.path.clone())
    }
}

#[cfg(windows)]
/// The window the rules read: the one in front, unless that is one of Crest's bars (`is_bar`), which a click on it or one of its
/// menus brings to front. The rules then stay on the window in front `before` it, as the bars' lists do (tasks.rs).
fn ruled_front(foreground: HWND, is_bar: bool, before: HWND) -> HWND {
    if is_bar { before } else { foreground }
}

#[cfg(windows)]
fn read_foreground(hwnd: HWND, own: HWND, monitor: HMONITOR, known: &mut Known) -> Seen {
    if hwnd.is_invalid() || hwnd == own || !candidate(hwnd) || unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) } != monitor {
        return Seen::desktop();
    }
    let pid = window_pid(hwnd);
    if pid == unsafe { GetCurrentProcessId() } {
        return Seen::desktop();
    }
    let Some((m, work)) = monitor_rect(monitor) else { return Seen::desktop() };
    let (name, path) = known.describe(hwnd, app_pid(hwnd));
    // The notification state is global; with the foreground window on our monitor, it is this window.
    let exclusive = unsafe { SHQueryUserNotificationState() }.is_ok_and(|s| s == QUNS_RUNNING_D3D_FULL_SCREEN);
    let frame = frame_rect(hwnd);
    let mut context = screen_policy::classify(exclusive, covers(frame, m), has_caption(hwnd), unsafe { IsZoomed(hwnd) }.as_bool(), within(frame, work), has_resize_frame(hwnd));
    // A window that is not maximized but reaches up under the notch (snapped to a half or a quarter, or dragged to the top)
    // follows the maximized rule too, so its title bar and buttons are not left under the notch.
    if context == Context::Desktop && under_notch(frame, own, m) {
        context = Context::Maximized;
    }
    Seen { context, name, path }
}

#[cfg(windows)]
/// Whether a window fills `monitor` as a full-screen app, for Crest's bars (taskbar/front.rs): `read_foreground`'s reading
/// without the rules' names. False for an invalid window, one of Crest's, one that is not a `candidate` or one on another
/// monitor. `exclusive` is Windows' exclusive full screen, which it reports of the foreground only.
pub(crate) fn fills(hwnd: HWND, monitor: HMONITOR, exclusive: bool) -> bool {
    if hwnd.is_invalid() || !candidate(hwnd) || unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) } != monitor || window_pid(hwnd) == unsafe { GetCurrentProcessId() } {
        return false;
    }
    let Some((m, work)) = monitor_rect(monitor) else { return false };
    let frame = frame_rect(hwnd);
    screen_policy::classify(exclusive, covers(frame, m), has_caption(hwnd), unsafe { IsZoomed(hwnd) }.as_bool(), within(frame, work), has_resize_frame(hwnd)).is_fullscreen()
}

#[cfg(windows)]
/// A maximized or frameless full-monitor window on our monitor behind the foreground one (a browser left
/// maximized behind another app, a borderless game in the background). Skips tool and cloaked windows
/// (other virtual desktops) and our own.
fn read_background(foreground: HWND, own: HWND, monitor: HMONITOR, known: &mut Known) -> Option<Seen> {
    let (m, work) = monitor_rect(monitor)?;
    let own_pid = unsafe { GetCurrentProcessId() };
    // EnumWindows runs from the top of the z-order, so the first match is the frontmost one.
    for hwnd in top_windows() {
        if hwnd == foreground || hwnd == own || !candidate(hwnd) || unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) } != monitor {
            continue;
        }
        let maximized = unsafe { IsZoomed(hwnd) }.as_bool();
        let caption = has_caption(hwnd);
        let frame = frame_rect(hwnd);
        let full = covers(frame, m);
        // Tool windows, click-through and never-activated windows are overlays (dimmers, recording frames), not apps.
        if (!maximized && !(full && !caption)) || has_ex_style(hwnd, WS_EX_TOOLWINDOW.0 | WS_EX_TRANSPARENT.0 | WS_EX_NOACTIVATE.0) {
            continue;
        }
        let pid = window_pid(hwnd);
        if pid == own_pid {
            continue;
        }
        let (name, path) = known.describe(hwnd, app_pid(hwnd));
        return Some(Seen { context: screen_policy::classify(false, full, caption, maximized, within(frame, work), has_resize_frame(hwnd)), name, path });
    }
    None
}

#[cfg(windows)]
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

#[cfg(windows)]
pub(crate) fn top_windows() -> Vec<HWND> {
    unsafe extern "system" fn collect(hwnd: HWND, list: LPARAM) -> windows::core::BOOL {
        (*(list.0 as *mut Vec<HWND>)).push(hwnd);
        true.into()
    }
    let mut list: Vec<HWND> = Vec::new();
    let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut list as *mut Vec<HWND> as isize)) };
    list
}

#[cfg(windows)]
pub(crate) fn window_pid(hwnd: HWND) -> u32 {
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    pid
}

#[cfg(windows)]
/// The app behind a window: a UWP app's frame belongs to ApplicationFrameHost, its CoreWindow child to the app.
pub(crate) fn app_pid(hwnd: HWND) -> u32 {
    if class_name(hwnd) == "ApplicationFrameWindow" {
        if let Ok(core) = unsafe { FindWindowExW(Some(hwnd), None, w!("Windows.UI.Core.CoreWindow"), PCWSTR::null()) } {
            if !core.is_invalid() {
                return window_pid(core);
            }
        }
    }
    window_pid(hwnd)
}

#[cfg(windows)]
fn has_ex_style(hwnd: HWND, bits: u32) -> bool {
    unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & bits != 0 }
}

#[cfg(windows)]
pub(crate) fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let len = unsafe { GetClassNameW(hwnd, &mut buf) }.max(0) as usize;
    String::from_utf16_lossy(&buf[..len])
}

#[cfg(windows)]
/// "C:\…\Game.exe" → "Game".
fn exe_name(path: &str) -> String {
    let file = path.rsplit(['\\', '/']).next().unwrap_or(path);
    file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string()
}

#[cfg(windows)]
fn has_caption(hwnd: HWND) -> bool {
    unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 & WS_CAPTION.0 != 0 }
}

#[cfg(windows)]
fn has_resize_frame(hwnd: HWND) -> bool {
    unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 & WS_THICKFRAME.0 != 0 }
}

#[cfg(windows)]
/// The visible frame (without the invisible resize borders), else the window rect.
pub(crate) fn frame_rect(hwnd: HWND) -> RECT {
    let mut rect = RECT::default();
    unsafe {
        if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut rect as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).is_err() {
            let _ = GetWindowRect(hwnd, &mut rect);
        }
    }
    rect
}

#[cfg(windows)]
/// The monitor's rect and its work area (`rcMonitor`, `rcWork`).
pub(crate) fn monitor_rect(monitor: HMONITOR) -> Option<(RECT, RECT)> {
    let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
    unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool().then_some((info.rcMonitor, info.rcWork))
}

#[cfg(windows)]
/// Covers the whole monitor, give or take 2 px.
fn covers(r: RECT, m: RECT) -> bool {
    r.left <= m.left + 2 && r.top <= m.top + 2 && r.right >= m.right - 2 && r.bottom >= m.bottom - 2
}

#[cfg(windows)]
/// `screen_policy::under_notch` for this window and the notch's own window (`own`), whose size never changes with its look.
fn under_notch(frame: RECT, own: HWND, m: RECT) -> bool {
    let mut notch = RECT::default();
    if unsafe { GetWindowRect(own, &mut notch) }.is_err() {
        return false;
    }
    let edges = |r: RECT| (r.left, r.top, r.right, r.bottom);
    let dpi = unsafe { windows::Win32::UI::HiDpi::GetDpiForWindow(own) }.max(96) as i32;
    screen_policy::under_notch(edges(frame), edges(notch), edges(m), UNDER_NOTCH_BAND * dpi / 96)
}

#[cfg(windows)]
/// How far below the top edge, in CSS px at 100 %, a window's top counts as under the notch: about the closed notch's height.
const UNDER_NOTCH_BAND: i32 = 40;

#[cfg(windows)]
/// Inside the work area, give or take 2 px.
fn within(r: RECT, work: RECT) -> bool {
    r.left >= work.left - 2 && r.top >= work.top - 2 && r.right <= work.right + 2 && r.bottom <= work.bottom + 2
}

#[cfg(windows)]
/// Desktop and taskbar never count as fullscreen.
pub(crate) fn is_desktop(hwnd: HWND) -> bool {
    if unsafe { hwnd == GetDesktopWindow() || hwnd == GetShellWindow() } {
        return true;
    }
    matches!(class_name(hwnd).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn behind_rests_under_the_windows_unless_opened_on_purpose_and_not_kept_open_or_an_indicator_shows() {
        assert!(!rests_below(false, false, false, false));
        assert!(rests_below(true, false, false, false));
        // Opened with the shortcut, the tray or the Launcher: on top until it closes, or until it is kept open.
        assert!(!rests_below(true, true, false, false));
        assert!(rests_below(true, true, true, false));
        // An indicator brings it out for its moment.
        assert!(!rests_below(true, false, false, true));
        assert!(!rests_below(true, true, true, true));
        // Off, nothing rests below.
        assert!(!rests_below(false, true, true, true));
    }

    #[test]
    fn a_new_text_size_keeps_a_hanging_edge_on_its_line() {
        // What the page sends at Text size 100 % (follow.ts spotFor), and what keeps each window on the same device px at 125 %
        // until the page sends what it measures at the new size.
        let at_125 = |line: f64, y: f64| {
            let mut c = Config { line, y, spots: vec![Spot { monitor: "B".into(), line, y }], ..Default::default() };
            follow_text_scale(&mut c, 1.0 / 1.25);
            assert_eq!(c.spots, vec![Spot { monitor: "B".into(), line: c.line, y: c.y }], "the copies follow the same rule");
            (c.line, c.y)
        };
        // Bottom edge: the line is the work area's bottom, and the top is unused.
        assert_eq!(at_125(1032.0, 0.0), (825.6, 0.0));
        // Top edge, hanging from a 40 px taskbar on top: the line is sent as the window's top too.
        assert_eq!(at_125(40.0, 40.0), (32.0, 32.0));
        // A floating capsule: no line, and a top in the page's own px that the page sends again only when it changes. Converted
        // here, the capsule would jump back at its next drag.
        assert_eq!(at_125(0.0, 194.0), (0.0, 194.0));
    }

    #[test]
    fn a_second_launch_leaves_the_rules_their_say() {
        let state = DisplayState::default();
        state.user_hidden.store(true, Ordering::Relaxed);
        state.rule_hide.store(true, Ordering::Relaxed);
        assert!(state.come_back(), "the hide hotkey's hiding is undone");
        assert!(!state.user_hidden.load(Ordering::Relaxed));
        // Nothing opened, so a "hide" rule still hides the notch.
        assert!(state.hides());
        assert!(!state.come_back(), "nothing left to undo");
    }

    #[test]
    fn monitors_of_one_model_get_distinct_names_and_the_first_keeps_its_own() {
        let named = |list: &[(&str, i32, i32)]| unique_names(&list.iter().map(|(n, x, y)| (n.to_string(), *x, *y)).collect::<Vec<_>>());
        assert_eq!(named(&[("Monitor #1", 0, 0), ("Monitor #2", 1920, 0)]), ["Monitor #1", "Monitor #2"]);
        // The order given is kept; the numbering follows the position, left to right.
        assert_eq!(named(&[("Monitor #7", 2560, 0), ("Monitor #7", 0, 0), ("Monitor #7", -2560, 0)]), ["Monitor #7 (3)", "Monitor #7 (2)", "Monitor #7"]);
        assert!(named(&[]).is_empty());
    }

    /// 1920 x 1080 at 100, 125 and 150 % Windows scaling, panel scale from 0.8 to 2, on every edge, hanging from the screen edge,
    /// with the usual window and one lengthened for a wide closed notch.
    #[test]
    fn only_the_offered_panel_scales_are_kept() {
        assert_eq!(fit_zoom(1.25), 1.25);
        assert_eq!(fit_zoom(0.8), 0.8);
        assert_eq!(fit_zoom(2.0), 2.0);
        assert_eq!(fit_zoom(1.3), 1.0);
        assert_eq!(fit_zoom(f64::NAN), 1.0);
        assert_eq!(fit_zoom(5.0), 1.0);
    }

    #[test]
    fn the_notch_stays_on_its_edge_and_centred_even_when_the_window_is_larger_than_the_monitor() {
        let (mw, mh) = (1920, 1080);
        for wanted in [0.0, 1400.0] {
            let length = fit_along(wanted);
            for dpi in [1.0, 1.25, 1.5] {
                for zoom in [0.8, 1.0, 1.25, 1.5, 2.0] {
                    let scale = dpi * zoom;
                    for edge in ["top", "bottom", "left", "right"] {
                        let side = edge == "left" || edge == "right";
                        let w = ((if side { SIDE_DEPTH } else { length }) * zoom * dpi).round() as i32;
                        let h = ((if side { length } else { DEPTH }) * zoom * dpi).round() as i32;
                        let line = match edge {
                            "bottom" => mh as f64 / scale,
                            "right" => mw as f64 / scale,
                            _ => 0.0,
                        };
                        let at = |offset: f64| Placement { edge, offset, y: 0.0, line, keep: kept_along(wanted), scale }.position((mw, mh), (w, h));
                        let case = format!("{edge} at {dpi} x {zoom}, {length} long");
                        let (x, top) = at(0.0);
                        match edge {
                            "top" => assert_eq!(top, 0, "{case}"),
                            "bottom" => assert!((top + h - mh).abs() <= 1, "{case}: bottom edge at {}", top + h),
                            "left" => assert_eq!(x, 0, "{case}"),
                            _ => assert!((x + w - mw).abs() <= 1, "{case}: right edge at {}", x + w),
                        }
                        let (along, m_along, w_along) = if side { (top, mh, h) } else { (x, mw, w) };
                        assert_eq!(along, (m_along - w_along) / 2, "{case}: centred");
                        // Pushed far either way, the widest panel or closed notch (centred in the window) stays on the monitor when it fits at all.
                        let panel = kept_along(wanted) * scale;
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
    }

    #[test]
    fn the_window_is_as_long_as_before_unless_a_wide_closed_notch_needs_more() {
        assert_eq!(fit_along(0.0), ALONG);
        assert_eq!(kept_along(0.0), PANEL_ALONG);
        assert_eq!(fit_along(f64::NAN), ALONG);
        assert_eq!(fit_along(1400.0), 1400.0);
        assert_eq!(kept_along(1400.0), 1380.0);
        assert_eq!(fit_along(1e9), MAX_ALONG);
    }

    #[test]
    fn the_capsule_top_stays_on_the_monitor() {
        let at = |y: f64| Placement { edge: "top", offset: 0.0, y, line: 0.0, keep: PANEL_ALONG, scale: 1.0 }.position((1920, 1080), (760, 560));
        assert_eq!(at(100.0).1, 100);
        assert_eq!(at(5000.0).1, 520);
        assert_eq!(at(-50.0).1, 0);
    }

    #[cfg(windows)]
    #[test]
    fn a_frame_over_the_taskbar_band_is_outside_the_work_area() {
        let rect = |left, top, right, bottom| RECT { left, top, right, bottom };
        let work = rect(0, 0, 1920, 1032);
        assert!(within(rect(0, 0, 1920, 1032), work));
        assert!(within(rect(-2, -2, 1922, 1034), work), "give or take 2 px");
        assert!(!within(rect(0, 0, 1920, 1080), work));
        assert!(within(rect(0, 0, 1920, 1080), rect(0, 0, 1920, 1080)), "auto-hide: the work area is the monitor");
    }

    #[cfg(windows)]
    #[test]
    fn the_bar_in_front_leaves_the_rules_on_the_window_before_it() {
        let h = |n: isize| HWND(n as _);
        assert_eq!(ruled_front(h(7), false, h(5)), h(7)); // an app in front
        assert_eq!(ruled_front(h(9), true, h(7)), h(7)); // a bar clicked, or one of its menus open
        assert_eq!(ruled_front(h(0), false, h(7)), h(0)); // nothing in front
    }

    // The ex styles tao and hit_test give a bar or the notch while click-through (read on the PC), the notch taking the pointer,
    // a mirror and the timer, each with the style it should end up with.
    #[cfg(windows)]
    const STYLES: [(u32, u32); 4] = [(0xC0138, 0x801B8), (0x40118, 0x198), (0x080C0138, 0x080801B8), (0x08040118, 0x08000198)];

    #[cfg(windows)]
    #[test]
    fn crest_windows_become_tool_windows_and_keep_their_other_bits() {
        use windows::Win32::UI::WindowsAndMessaging::{WS_EX_ACCEPTFILES, WS_EX_LAYERED, WS_EX_TOPMOST, WS_EX_WINDOWEDGE};
        let kept = (WS_EX_TRANSPARENT | WS_EX_LAYERED | WS_EX_NOACTIVATE | WS_EX_TOPMOST | WS_EX_ACCEPTFILES | WS_EX_WINDOWEDGE).0;
        for (ex, out) in STYLES {
            assert_eq!(out_of_alt_tab(ex), out, "{ex:#x}");
            assert_eq!(out_of_alt_tab(out), out, "{ex:#x} twice");
            assert_eq!(out & kept, ex & kept, "{ex:#x}: click-through, focus and topmost as tao and hit_test set them");
        }
    }

    /// tao writes the whole ex style at every show, hide and click-through change, and set_click_through reads and writes it
    /// back from the poll thread: the subclass keeps the window a tool window through both.
    #[cfg(windows)]
    #[test]
    fn a_subclassed_window_stays_out_of_alt_tab_whatever_is_written() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{CreateWindowExW, DestroyWindow, WS_EX_LAYERED, WS_POPUP};
        let (tool, app, through) = (WS_EX_TOOLWINDOW.0 as isize, WS_EX_APPWINDOW.0 as isize, (WS_EX_TRANSPARENT | WS_EX_LAYERED).0 as isize);
        // SetWindowLong cannot set WS_EX_TOPMOST and the system may adjust WINDOWEDGE: only these bits are compared.
        let bits = |hwnd| unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } & (tool | app | through);
        let hwnd = unsafe { CreateWindowExW(WS_EX_APPWINDOW, w!("STATIC"), w!("Crest Alt+Tab test"), WS_POPUP, 0, 0, 10, 10, None, None, None, None) }.unwrap();
        subclass_out_of_alt_tab(hwnd);
        assert_eq!(bits(hwnd), tool, "forced at once");
        unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, app | through) };
        assert_eq!(bits(hwnd), tool | through, "tao's whole style");
        let style = unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) };
        unsafe { SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style & !through) };
        assert_eq!(bits(hwnd), tool, "set_click_through's read-modify-write");
        unsafe { DestroyWindow(hwnd) }.unwrap();
    }
}
