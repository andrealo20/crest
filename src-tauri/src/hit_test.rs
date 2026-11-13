//! Click-through for the transparent notch window.
//!
//! Tauri can only make the whole window click-through, so a thread polls the
//! global cursor position and toggles `set_ignore_cursor_events` depending on
//! whether the cursor is over the hit zone reported by the frontend.
//! The `notch://hover` event replaces pointerenter/leave, because a click-through
//! WebView no longer gets mouse events.
//!
//! The pet's nest beside the notch has a zone of its own: the window takes the pointer there too, without the
//! notch's hover, and `notch://pet-hover` says when the pointer comes onto it and leaves.
//!
//! Focus mode (`passthrough`): the window stays click-through even over the notch,
//! so clicks reach the app below (e.g. browser tabs). Three quick clicks on the notch
//! emit `notch://focus-exit`; only the mouse button is watched for that.
//!
//! On Windows the same poll serves other windows (the bar): each takes the pointer only over the zones its page reports
//! (`track`, `set_zones`), and `taskbar://hover` tells that page when the pointer comes onto one and leaves. Focus mode
//! puts only the notch aside.

// Linux has no pointer to poll (linux/input.rs sets the window's input shape instead), so the polling half of this file is not used there.
#![cfg_attr(target_os = "linux", allow(dead_code))]

#[cfg(windows)]
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};

/// Hit zone in CSS px, relative to the window's top-left corner.
#[derive(Clone, Copy, Default, Deserialize)]
pub struct HitRect {
    pub(crate) x: f64,
    pub(crate) y: f64,
    pub(crate) w: f64,
    pub(crate) h: f64,
}

impl HitRect {
    /// The zone as whole logical px (CSS px times the page's zoom), rounded outwards.
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    fn logical(&self, zoom: f64) -> (i32, i32, i32, i32) {
        let (x0, y0) = ((self.x * zoom).floor(), (self.y * zoom).floor());
        let (x1, y1) = (((self.x + self.w) * zoom).ceil(), ((self.y + self.h) * zoom).ceil());
        (x0 as i32, y0 as i32, (x1 - x0) as i32, (y1 - y0) as i32)
    }

    pub(crate) fn contains(&self, x: f64, y: f64) -> bool {
        x >= self.x && x <= self.x + self.w && y >= self.y && y <= self.y + self.h
    }

    /// Distance from the point to the zone's edge; 0 inside.
    fn distance(&self, x: f64, y: f64) -> f64 {
        let dx = (self.x - x).max(x - (self.x + self.w)).max(0.0);
        let dy = (self.y - y).max(y - (self.y + self.h)).max(0.0);
        dx.hypot(dy)
    }

    /// Larger zone while something is dragged towards the notch, so files are easier
    /// to drop onto the small closed notch (quick drop).
    /// Grows into the screen from the edge the notch hangs from (0 top, 1 bottom, 2 left, 3 right) and along it both ways.
    fn grown(&self, edge: u8) -> HitRect {
        let m = DROP_MARGIN;
        match edge {
            1 => HitRect { x: self.x - m, y: self.y - m, w: self.w + m * 2.0, h: self.h + m },
            2 => HitRect { x: self.x, y: self.y - m, w: self.w + m, h: self.h + m * 2.0 },
            3 => HitRect { x: self.x - m, y: self.y - m, w: self.w + m, h: self.h + m * 2.0 },
            _ => HitRect { x: self.x - m, y: self.y, w: self.w + m * 2.0, h: self.h + m },
        }
    }
}

/// Extra margin of the drop zone in CSS px.
const DROP_MARGIN: f64 = 48.0;
/// Movement (CSS px) after the press before it counts as a drag.
const DRAG_START: f64 = 6.0;

/// A window besides the notch that takes the pointer only over the zones its page reports (the bar).
#[cfg(windows)]
#[derive(Clone)]
struct Zoned {
    label: String,
    hwnd: isize,
    /// In the page's CSS px; see sanitize.
    zones: Vec<HitRect>,
}

#[derive(Default)]
pub struct HitState {
    rect: Mutex<HitRect>,
    /// The pet's nest, while it shows.
    pet: Mutex<Option<HitRect>>,
    /// While true (e.g. typing), the window stays clickable.
    pinned: Mutex<bool>,
    /// Set after show(): reapply click-through on the next poll.
    refresh: AtomicBool,
    /// Focus mode: always click-through, no hover.
    passthrough: AtomicBool,
    /// Panel scale (the page's zoom) as f64 bits; 0 = 1.0.
    zoom: AtomicU64,
    /// The screen edge the notch hangs from, for the drop zone (see HitRect::grown).
    edge: AtomicU8,
    /// The windows besides the notch, one per label.
    #[cfg(windows)]
    zoned: Mutex<Vec<Zoned>>,
}

impl HitState {
    pub fn refresh(&self) {
        self.refresh.store(true, Ordering::Relaxed);
    }

    /// The notch is kept open (its pin).
    pub(crate) fn kept_open(&self) -> bool {
        *self.pinned.lock().unwrap()
    }

    pub fn set_edge(&self, edge: &str) {
        self.edge.store(match edge { "bottom" => 1, "left" => 2, "right" => 3, _ => 0 }, Ordering::Relaxed);
    }

    pub fn set_zoom(&self, zoom: f64) {
        self.zoom.store(zoom.to_bits(), Ordering::Relaxed);
        self.refresh();
    }

    /// The parts of the window that take the pointer, as (x, y, w, h) in logical px; None = all of it (pinned).
    /// Linux sets this as the window's input shape instead of polling the pointer (linux/input.rs).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    pub(crate) fn input_zones(&self) -> Option<Vec<(i32, i32, i32, i32)>> {
        if *self.pinned.lock().unwrap() {
            return None;
        }
        let zoom = self.zoom();
        let mut zones = vec![self.rect.lock().unwrap().logical(zoom)];
        zones.extend(self.pet.lock().unwrap().map(|p| p.logical(zoom)));
        Some(zones)
    }

    fn zoom(&self) -> f64 {
        let z = f64::from_bits(self.zoom.load(Ordering::Relaxed));
        if z > 0.0 { z } else { 1.0 }
    }
}

/// Linux has no pointer to poll (Wayland hides it from a client), so the zones are the window's input shape.
#[cfg(target_os = "linux")]
fn apply_zones(window: &WebviewWindow, state: &HitState) {
    crate::linux::input::apply(window, state.input_zones());
}

#[cfg(not(target_os = "linux"))]
fn apply_zones(_: &WebviewWindow, _: &HitState) {}

#[tauri::command]
pub fn set_hit_rect(rect: HitRect, window: WebviewWindow, state: State<'_, HitState>) {
    *state.rect.lock().unwrap() = rect;
    apply_zones(&window, &state);
}

#[tauri::command]
pub fn set_pet_rect(rect: Option<HitRect>, window: WebviewWindow, state: State<'_, HitState>) {
    *state.pet.lock().unwrap() = rect;
    apply_zones(&window, &state);
}

#[tauri::command]
pub fn set_passthrough(on: bool, state: State<'_, HitState>) {
    state.passthrough.store(on, Ordering::Relaxed);
}

/// Kept open (the pin in the notch's header); with Behind on, kept open it rests under the windows again (display.rs `restack`).
#[tauri::command]
pub fn set_pinned(pinned: bool, window: WebviewWindow, state: State<'_, HitState>, app: AppHandle) {
    *state.pinned.lock().unwrap() = pinned;
    apply_zones(&window, &state);
    crate::display::restack(&app);
}

/// Lets the pointer through `label`'s window except over the zones its page reports, none until it reports. The caller
/// takes `hwnd`: the poll must not ask the main thread for it (see geometry). A window built again under the label
/// replaces the old one.
#[cfg(windows)]
pub(crate) fn track(state: &HitState, label: &str, hwnd: isize) {
    let mut zoned = state.zoned.lock().unwrap();
    zoned.retain(|z| z.label != label);
    zoned.push(Zoned { label: label.to_owned(), hwnd, zones: Vec::new() });
}

#[cfg(windows)]
pub(crate) fn untrack(state: &HitState, label: &str) {
    state.zoned.lock().unwrap().retain(|z| z.label != label);
}

/// The zones `label`'s page reports, and how many of them it keeps (see sanitize); 0, and ignored, for a window not tracked
/// (a page still reporting as it closes).
#[cfg(windows)]
pub(crate) fn set_zones(state: &HitState, label: &str, rects: Vec<HitRect>) -> usize {
    let mut zoned = state.zoned.lock().unwrap();
    let Some(z) = zoned.iter_mut().find(|z| z.label == label) else { return 0 };
    z.zones = sanitize(rects);
    z.zones.len()
}

/// A page's report as the poll uses it: at most 8 zones, each with finite values and a positive size.
#[cfg(windows)]
fn sanitize(rects: Vec<HitRect>) -> Vec<HitRect> {
    let valid = |r: &HitRect| [r.x, r.y, r.w, r.h].iter().all(|v| v.is_finite()) && r.w > 0.0 && r.h > 0.0;
    rects.into_iter().filter(valid).take(8).collect()
}

/// Whether the point is in any of the zones, edges included, and its distance to the nearest one (infinite with none).
#[cfg(windows)]
fn over(zones: &[HitRect], x: f64, y: f64) -> (bool, f64) {
    let near = zones.iter().map(|z| z.distance(x, y)).fold(f64::INFINITY, f64::min);
    (zones.iter().any(|z| z.contains(x, y)), near)
}

/// ~60 Hz is plenty: hover delays are 180–220 ms anyway.
const POLL: Duration = Duration::from_millis(16);
/// Cursor far away from the notch (and no button held): poll slower. Reaching the
/// notch from `FAR` px away within one slow poll would take a very fast flick, and
/// the next poll near the notch is fast again.
const POLL_FAR: Duration = Duration::from_millis(50);
const FAR: f64 = 160.0;
/// Leaving focus mode: this many clicks on the notch, each within the double-click time of the one before, as the page counts the
/// clicks that enter it. Windows' own setting; elsewhere the usual default.
const EXIT_CLICKS: u32 = 3;
#[cfg(not(windows))]
const CLICK_GAP: Duration = Duration::from_millis(500);

fn double_click_gap() -> Duration {
    #[cfg(windows)]
    {
        use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
        Duration::from_millis(u64::from(unsafe { GetDoubleClickTime() }))
    }
    #[cfg(not(windows))]
    CLICK_GAP
}

/// Counts the clicks that leave focus mode: true on the `EXIT_CLICKS`th, each at most `gap` after the one before, then it starts over.
/// A slower click starts a new count.
struct Clicks {
    count: u32,
    last: Option<Instant>,
    gap: Duration,
}

impl Clicks {
    fn new(gap: Duration) -> Self {
        Self { count: 0, last: None, gap }
    }

    fn click(&mut self, at: Instant) -> bool {
        let quick = self.last.is_some_and(|last| at.saturating_duration_since(last) <= self.gap);
        self.count = if quick { self.count + 1 } else { 1 };
        self.last = Some(at);
        if self.count < EXIT_CLICKS {
            return false;
        }
        self.count = 0;
        true
    }
}

/// The cursor relative to the window's top-left corner in physical px, and the window's scale.
///
/// On Windows straight from the system, as tao reads them: Tauri's getters wait for the main thread, and a drag out of
/// the Shelf holds that thread in the modal OLE loop until the drop. The poll stood still, the window kept the pointer
/// over its whole area and swallowed drops meant for the app below the panel (issue #22).
#[cfg(windows)]
fn geometry(hwnd: isize) -> Option<(f64, f64, f64)> {
    use windows::Win32::Foundation::{HWND, POINT, RECT};
    use windows::Win32::UI::HiDpi::GetDpiForWindow;
    use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, GetWindowRect};
    let hwnd = HWND(hwnd as _);
    let (mut cursor, mut rect) = (POINT::default(), RECT::default());
    unsafe {
        GetCursorPos(&mut cursor).ok()?;
        GetWindowRect(hwnd, &mut rect).ok()?;
        let dpi = GetDpiForWindow(hwnd);
        (dpi > 0).then(|| ((cursor.x - rect.left) as f64, (cursor.y - rect.top) as f64, dpi as f64 / 96.0))
    }
}

/// The click-through bits tao sets for `set_ignore_cursor_events`, written from here. tao posts that change to the main
/// thread too, and the modal OLE loop of a drag out doesn't run it until the drop; a style set from another thread only
/// waits for the window thread to take WM_STYLECHANGING, which that loop does deliver. tao's own call still follows, so
/// its flags stay in step and its next style write keeps the same bits.
#[cfg(windows)]
fn set_click_through(hwnd: isize, on: bool) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT};
    let hwnd = HWND(hwnd as _);
    let bits = (WS_EX_TRANSPARENT | WS_EX_LAYERED).0 as isize;
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let next = if on { style | bits } else { style & !bits };
        if next != style {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, next);
        }
    }
}

/// The window under the pointer, and whether it is one of Crest's own. Whose it is comes from the window it sits in: the
/// WebView inside the notch, the timer or a copy of the notch is another process's window. While Crest lets the pointer
/// through, WindowFromPoint skips its click-through window and answers with the one below.
#[cfg(windows)]
fn under_pointer() -> Option<(isize, bool)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT};
    let (mut cursor, mut pid) = (POINT::default(), 0);
    unsafe {
        GetCursorPos(&mut cursor).ok()?;
        let at = WindowFromPoint(cursor);
        GetWindowThreadProcessId(GetAncestor(at, GA_ROOT), Some(&mut pid));
        (pid != 0).then_some((at.0 as isize, pid == std::process::id()))
    }
}

/// Whether any mouse button is held: the app under the pointer may be following a drag with any of them.
#[cfg(windows)]
fn button_down() -> bool {
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON};
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|key| unsafe { GetAsyncKeyState(key.0 as i32) } as u16 & 0x8000 != 0)
}

/// Tells the window Crest took the pointer from that the mouse left it, as Windows does when the pointer moves onto
/// another window. Windows only tells a window that asked, and a Chromium browser (Edge, Chrome) stops asking once it has
/// read such a notice with the pointer back over itself, which happens when Crest takes the pointer and lets it go within
/// a few milliseconds. From then on it kept a favourite's tooltip on screen for as long as Crest held the pointer (issue #40).
#[cfg(windows)]
fn tell_mouse_left(hwnd: isize) {
    use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::PostMessageW;
    const WM_MOUSELEAVE: u32 = 0x02A3;
    // Refused for a window of an app that runs as administrator, which then keeps what it shows.
    let _ = unsafe { PostMessageW(Some(HWND(hwnd as _)), WM_MOUSELEAVE, WPARAM(0), LPARAM(0)) };
}

/// Lets the pointer through the window (`ignore`) or has it take the pointer, after `last` (None: not known). Taking it
/// with the pointer over what the window draws (`on_surface`, not only pinned) takes it from the app below.
#[cfg(windows)]
fn let_through(window: &WebviewWindow, hwnd: isize, ignore: bool, last: Option<bool>, on_surface: bool) {
    // Asked before the window takes the pointer, since after that the point is Crest's own. Only when Crest takes
    // it from an app (not at the first pass or after a refresh), and not with a button held, which that app may be
    // following as a drag.
    let below = if last == Some(true) && !ignore && !button_down() && on_surface {
        under_pointer().filter(|&(_, ours)| !ours).map(|(below, _)| below)
    } else {
        None
    };
    set_click_through(hwnd, ignore);
    let _ = window.set_ignore_cursor_events(ignore);
    // Sent once the window holds the pointer: the app below looks at what is under the pointer when it reads this.
    // Only if Crest holds it now: under a window that covers Crest (Task View, a game bar) that app keeps the pointer.
    if let Some(below) = below {
        if under_pointer().is_some_and(|(_, ours)| ours) {
            tell_mouse_left(below);
        }
    }
}

/// One pass over the windows besides the notch; `last` holds whether the pointer was on a zone of each, by hwnd. Returns
/// the distance to the nearest zone of any of them, in CSS px.
#[cfg(windows)]
fn poll_zoned(app: &AppHandle, state: &HitState, last: &mut HashMap<isize, bool>) -> f64 {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::IsWindowVisible;
    // A copy, so no Win32 call runs under the lock: set_zones takes it on the main thread, and a style change from here
    // waits for that thread (set_click_through).
    let zoned = state.zoned.lock().unwrap().clone();
    last.retain(|hwnd, _| zoned.iter().any(|z| z.hwnd == *hwnd));
    let mut near = f64::INFINITY;
    for z in zoned {
        let hwnd = HWND(z.hwnd as _);
        // Hidden, or gone with its handle now another process's: forgotten, so a window shown again with the pointer
        // resting on it takes the pointer at once, as the notch does after `refresh`.
        if crate::display::window_pid(hwnd) != std::process::id() || !unsafe { IsWindowVisible(hwnd) }.as_bool() {
            last.remove(&z.hwnd);
            continue;
        }
        let Some((dx, dy, scale)) = geometry(z.hwnd) else { continue };
        // The bars' pages are drawn at Windows' Text size too: without it a bottom bar took no click above 100 %.
        let (x, y) = to_page(dx, dy, scale, 1.0, crate::text_scale::get());
        let (inside, distance) = over(&z.zones, x, y);
        near = near.min(distance);
        let was = last.get(&z.hwnd).copied();
        // Only on a change: every call goes through the event loop.
        if was != Some(inside) {
            let Some(window) = app.get_webview_window(&z.label) else { continue };
            let_through(&window, z.hwnd, !inside, was.map(|w| !w), inside);
            let _ = app.emit_to(&z.label, "taskbar://hover", inside);
            last.insert(z.hwnd, inside);
        }
    }
    near
}

/// The pointer, `dx` and `dy` device px from the window's top-left corner, in the page's CSS px: the monitor's scale, the
/// panel scale and Windows' Text size all make a CSS px bigger (text_scale.rs).
fn to_page(dx: f64, dy: f64, device: f64, zoom: f64, text: f64) -> (f64, f64) {
    let scale = device * zoom * text;
    (dx / scale, dy / scale)
}

#[cfg(not(windows))]
fn geometry(window: &WebviewWindow) -> Option<(f64, f64, f64)> {
    let (Ok(cursor), Ok(origin), Ok(scale)) = (window.cursor_position(), window.outer_position(), window.scale_factor()) else {
        return None;
    };
    Some((cursor.x - origin.x as f64, cursor.y - origin.y as f64, scale))
}

pub fn spawn(app: AppHandle, window: WebviewWindow) {
    // Taken here on the main thread; the poll must not ask it again (see geometry).
    #[cfg(windows)]
    let Ok(hwnd) = window.hwnd().map(|h| h.0 as isize) else { return };
    thread::spawn(move || {
        // `None` forces a defined state on the first pass.
        let mut last_inside: Option<bool> = None;
        let mut last_on_pet = false;
        let mut last_ignore: Option<bool> = None;
        let mut was_down = false;
        // Where the current press started; None = button up or the press began near the notch.
        let mut drag_from: Option<(f64, f64)> = None;
        let mut drag_active = false;
        let mut clicks = Clicks::new(double_click_gap());
        let mut far = false;
        #[cfg(windows)]
        let mut zoned_inside = HashMap::new();

        loop {
            thread::sleep(if far { POLL_FAR } else { POLL });
            far = false;
            let state = app.state::<HitState>();
            if state.refresh.swap(false, Ordering::Relaxed) {
                last_ignore = None;
            }
            // The screen is off (standby.rs): nothing to hit.
            if crate::standby::asleep() {
                far = true;
                continue;
            }
            // The other windows before the notch, whose pass below ends early in places.
            #[cfg(windows)]
            let zoned_near = poll_zoned(&app, &state, &mut zoned_inside);
            #[cfg(not(windows))]
            let zoned_near = f64::INFINITY;
            // Hidden by a rule or the hotkey: no notch to hit; show() sets `refresh` again.
            if crate::display::is_hidden(&app) {
                far = zoned_near > FAR;
                continue;
            }
            #[cfg(windows)]
            let geometry = geometry(hwnd);
            #[cfg(not(windows))]
            let geometry = geometry(&window);
            let Some((dx, dy, scale)) = geometry else { continue };

            // The hit rect is in the zoomed page's CSS px.
            let (x, y) = to_page(dx, dy, scale, state.zoom(), crate::text_scale::get());
            let rect = *state.rect.lock().unwrap();
            // GetAsyncKeyState reads the physical buttons: a left-handed mouse has its primary button on the right.
            #[cfg(windows)]
            let dragging = unsafe {
                let primary = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
                GetAsyncKeyState(primary.0 as i32) as u16 & 0x8000 != 0
            };
            #[cfg(any(target_os = "macos", target_os = "linux"))]
            let dragging = crate::native::left_button_down();
            let passthrough = state.passthrough.load(Ordering::Relaxed);
            // Edge distance to the nearest hit zone, the other windows' too; a held button keeps the fast poll (drags,
            // triple click in focus mode).
            let pet = *state.pet.lock().unwrap();
            let near = rect.distance(x, y).min(pet.map_or(f64::INFINITY, |p| p.distance(x, y))).min(zoned_near);
            far = !dragging && !was_down && near > FAR;

            if passthrough {
                // Only count clicks (button edges), never swallow them.
                if dragging && !was_down && rect.contains(x, y) && clicks.click(Instant::now()) {
                    let _ = window.emit("notch://focus-exit", ());
                }
                was_down = dragging;
                if last_ignore != Some(true) {
                    #[cfg(windows)]
                    set_click_through(hwnd, true);
                    let _ = window.set_ignore_cursor_events(true);
                    last_ignore = Some(true);
                }
                if last_inside != Some(false) {
                    let _ = window.emit("notch://hover", false);
                    last_inside = Some(false);
                }
                continue;
            }
            // Grow the zone only for a real drag that started away from the notch (a file
            // from Explorer). A plain click right below the notch must reach the app
            // underneath; growing on every press swallowed those clicks (issue #7).
            if dragging && !was_down {
                drag_from = (!rect.grown(state.edge.load(Ordering::Relaxed)).contains(x, y)).then_some((x, y));
                drag_active = false;
            } else if !dragging {
                drag_from = None;
                drag_active = false;
            }
            if let Some((fx, fy)) = drag_from {
                drag_active |= (x - fx).hypot(y - fy) > DRAG_START;
            }
            was_down = dragging;

            let inside = if drag_active { rect.grown(state.edge.load(Ordering::Relaxed)) } else { rect }.contains(x, y);
            let on_pet = !inside && pet.is_some_and(|p| p.contains(x, y));
            // Resting under the other windows (Behind), a window over the notch takes the pointer: no hover opens it beneath.
            // shortcut: Windows only; on a Mac a notch under a window can still open beneath it, as it has no such check yet.
            #[cfg(windows)]
            let (inside, on_pet) = if (inside || on_pet) && crate::display::covered(hwnd) { (false, false) } else { (inside, on_pet) };
            let ignore = !inside && !on_pet && !*state.pinned.lock().unwrap();
            if (on_pet && !last_on_pet) || (inside && last_inside != Some(true)) {
                crate::remember_foreground(&window);
            }
            if on_pet != last_on_pet {
                let _ = window.emit("notch://pet-hover", on_pet);
                last_on_pet = on_pet;
            }

            // Only call on change: every call goes through the event loop.
            if last_ignore != Some(ignore) {
                #[cfg(windows)]
                let_through(&window, hwnd, ignore, last_ignore, inside || on_pet);
                #[cfg(not(windows))]
                let _ = window.set_ignore_cursor_events(ignore);
                last_ignore = Some(ignore);
            }
            if last_inside != Some(inside) {
                // Where the pointer came in, in the page's px: the page saw no pointermove while the window let it through,
                // and the part under it decides the tool the hover opens (Notch.tsx).
                if inside {
                    let _ = window.emit("notch://hover-at", (x, y));
                }
                let _ = window.emit("notch://hover", inside);
                last_inside = Some(inside);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const R: HitRect = HitRect { x: 10.0, y: 0.0, w: 100.0, h: 30.0 };

    #[test]
    fn the_leaving_clicks_take_the_double_click_time() {
        // Clicks 480 ms apart enter focus mode under Windows' default 500 ms, so they must leave it too.
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut c = Clicks::new(Duration::from_millis(500));
        assert!(!c.click(ms(0)) && !c.click(ms(480)) && c.click(ms(960)));
    }

    #[test]
    fn three_quick_clicks_leave_focus_mode() {
        let t0 = Instant::now();
        let ms = |n| t0 + Duration::from_millis(n);
        let mut c = Clicks::new(Duration::from_millis(450));
        assert!(!c.click(ms(0)) && !c.click(ms(300)) && c.click(ms(600)));
        // A slow click starts the count again.
        assert!(!c.click(ms(2000)) && !c.click(ms(2500)) && !c.click(ms(3200)));
    }

    #[test]
    fn contains_includes_the_edges() {
        assert!(R.contains(10.0, 0.0) && R.contains(110.0, 30.0) && R.contains(50.0, 15.0));
        assert!(!R.contains(9.9, 15.0) && !R.contains(50.0, 30.1));
    }

    #[test]
    fn empty_rect_holds_only_its_point() {
        let r = HitRect::default();
        assert!(r.contains(0.0, 0.0) && !r.contains(0.1, 0.0));
    }

    #[test]
    fn the_dock_and_the_pin_take_the_pointer_at_text_size_125() {
        // Issue #61: the Media tool (520 x 232 CSS px) hangs from the top of the 760 px wide page, centred, with the hit zone's
        // 16 px at the sides and 12 px below. At 200 % with Windows' Text size at 125 % a CSS px is 2.5 device px.
        let rect = HitRect { x: 104.0, y: 0.0, w: 552.0, h: 244.0 };
        let (x, y) = to_page(2.5 * 380.0, 2.5 * 220.0, 2.0, 1.0, 1.25);
        assert!(rect.contains(x, y), "the Dock, 12 px above the panel's bottom: {x}, {y}");
        let (x, y) = to_page(2.5 * 614.0, 2.5 * 30.0, 2.0, 1.0, 1.25);
        assert!(rect.contains(x, y), "the pin, 26 px in from the panel's right edge: {x}, {y}");
    }

    #[test]
    fn the_panel_scale_and_the_text_size_both_divide_the_pointer() {
        assert_eq!(to_page(300.0, 150.0, 1.5, 1.0, 1.0), (200.0, 100.0));
        assert_eq!(to_page(300.0, 150.0, 1.0, 1.25, 1.2), (200.0, 100.0));
    }

    #[test]
    fn distance_is_zero_inside_and_euclidean_outside_the_corner() {
        assert_eq!(R.distance(50.0, 15.0), 0.0);
        assert_eq!(R.distance(0.0, 15.0), 10.0);
        assert_eq!(R.distance(113.0, 34.0), 5.0);
    }

    #[cfg(windows)]
    #[test]
    fn a_window_takes_the_pointer_only_over_its_zones() {
        let bar = HitRect { x: 8.0, y: 568.0, w: 1904.0, h: 64.0 };
        let menu = HitRect { x: 300.0, y: 380.0, w: 220.0, h: 170.0 };
        assert!(over(&[bar, menu], 400.0, 450.0).0); // in the menu
        let (inside, d) = over(&[bar, menu], 600.0, 450.0);
        assert!(!inside && (d - 80.0).abs() < 1e-9); // right of the menu
        assert!(over(&[bar, menu], 400.0, 600.0).0); // on the bar
        let (inside, d) = over(&[], 1.0, 1.0);
        assert!(!inside && d.is_infinite()); // no zones: never takes the pointer, never keeps the fast poll
    }

    #[cfg(windows)]
    #[test]
    fn a_page_reports_few_finite_zones() {
        let r = |w: f64| HitRect { x: 0.0, y: 0.0, w, h: 10.0 };
        assert_eq!(sanitize(vec![r(1.0); 10]).len(), 8);
        assert_eq!(sanitize(vec![r(f64::NAN), r(f64::INFINITY), r(-5.0), r(0.0), r(2.0)]).len(), 1);
    }

    #[cfg(windows)]
    #[test]
    fn only_a_tracked_window_keeps_its_zones() {
        let state = HitState::default();
        let bar = HitRect { x: 0.0, y: 0.0, w: 100.0, h: 40.0 };
        assert_eq!(set_zones(&state, "taskbar", vec![bar]), 0);
        track(&state, "taskbar", 1);
        track(&state, "taskbar", 2); // a new window under the same label replaces the old one
        assert_eq!(set_zones(&state, "taskbar", vec![HitRect::default()]), 0); // nothing drawn: not the bar's first draw
        assert_eq!(set_zones(&state, "taskbar", vec![bar, HitRect::default()]), 1);
        let zoned = state.zoned.lock().unwrap().clone();
        assert!(zoned.len() == 1 && zoned[0].hwnd == 2 && zoned[0].zones.len() == 1);
        untrack(&state, "taskbar");
        assert_eq!(set_zones(&state, "taskbar", vec![bar]), 0); // a late report from a page that closed
    }
}
