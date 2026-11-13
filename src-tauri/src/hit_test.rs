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

use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Deserialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
#[cfg(windows)]
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON};
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_SWAPBUTTON};

/// Hit zone in CSS px, relative to the window's top-left corner.
#[derive(Clone, Copy, Default, Deserialize)]
pub struct HitRect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl HitRect {
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

#[derive(Default)]
pub struct HitState {
    rect: Mutex<HitRect>,
    /// The pet's nest, while it shows.
    pet: Mutex<Option<HitRect>>,
    /// While true (e.g. typing), the window stays clickable.
    pinned: Mutex<bool>,
    /// Set after show(): reapply click-through on the next poll.
    refresh: AtomicBool,
    /// Panel scale (the page's zoom) as f64 bits; 0 = 1.0.
    zoom: AtomicU64,
    /// The screen edge the notch hangs from, for the drop zone (see HitRect::grown).
    edge: AtomicU8,
}

impl HitState {
    pub fn refresh(&self) {
        self.refresh.store(true, Ordering::Relaxed);
    }

    pub fn set_edge(&self, edge: &str) {
        self.edge.store(match edge { "bottom" => 1, "left" => 2, "right" => 3, _ => 0 }, Ordering::Relaxed);
    }

    pub fn set_zoom(&self, zoom: f64) {
        self.zoom.store(zoom.to_bits(), Ordering::Relaxed);
        self.refresh();
    }

    fn zoom(&self) -> f64 {
        let z = f64::from_bits(self.zoom.load(Ordering::Relaxed));
        if z > 0.0 { z } else { 1.0 }
    }
}

#[tauri::command]
pub fn set_hit_rect(rect: HitRect, state: State<'_, HitState>) {
    *state.rect.lock().unwrap() = rect;
}

#[tauri::command]
pub fn set_pet_rect(rect: Option<HitRect>, state: State<'_, HitState>) {
    *state.pet.lock().unwrap() = rect;
}

#[tauri::command]
pub fn set_pinned(pinned: bool, state: State<'_, HitState>) {
    *state.pinned.lock().unwrap() = pinned;
}

/// ~60 Hz is plenty: hover delays are 180–220 ms anyway.
const POLL: Duration = Duration::from_millis(16);
/// Cursor far away from the notch (and no button held): poll slower. Reaching the
/// notch from `FAR` px away within one slow poll would take a very fast flick, and
/// the next poll near the notch is fast again.
const POLL_FAR: Duration = Duration::from_millis(50);
const FAR: f64 = 160.0;

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

/// Another app's window under the pointer, asked while Crest still lets the pointer through: WindowFromPoint skips a
/// click-through window, so it answers with the one below.
#[cfg(windows)]
fn window_below() -> Option<isize> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::{GetAncestor, GetCursorPos, GetWindowThreadProcessId, WindowFromPoint, GA_ROOT};
    let (mut cursor, mut pid) = (POINT::default(), 0);
    unsafe {
        GetCursorPos(&mut cursor).ok()?;
        let below = WindowFromPoint(cursor);
        // Whose it is by the window it sits in: the WebView inside the timer or a copy of the notch is another process's window.
        GetWindowThreadProcessId(GetAncestor(below, GA_ROOT), Some(&mut pid));
        (pid != 0 && pid != std::process::id()).then_some(below.0 as isize)
    }
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
        let mut far = false;

        loop {
            thread::sleep(if far { POLL_FAR } else { POLL });
            far = false;
            let state = app.state::<HitState>();
            if state.refresh.swap(false, Ordering::Relaxed) {
                last_ignore = None;
            }
            // Hidden by a rule or the hotkey, or the screen is off (standby.rs): nothing to hit; show() sets `refresh` again.
            if crate::display::is_hidden(&app) || crate::standby::asleep() {
                far = true;
                continue;
            }
            #[cfg(windows)]
            let geometry = geometry(hwnd);
            #[cfg(not(windows))]
            let geometry = geometry(&window);
            let Some((dx, dy, scale)) = geometry else { continue };

            // The hit rect is in the zoomed page's CSS px.
            let scale = scale * state.zoom();
            let x = dx / scale;
            let y = dy / scale;
            let rect = *state.rect.lock().unwrap();
            // GetAsyncKeyState reads the physical buttons: a left-handed mouse has its primary button on the right.
            #[cfg(windows)]
            let dragging = unsafe {
                let primary = if GetSystemMetrics(SM_SWAPBUTTON) != 0 { VK_RBUTTON } else { VK_LBUTTON };
                GetAsyncKeyState(primary.0 as i32) as u16 & 0x8000 != 0
            };
            #[cfg(target_os = "macos")]
            let dragging = crate::macos::left_button_down();
            // Edge distance to the hit zone; a held button keeps the fast poll (drags).
            let pet = *state.pet.lock().unwrap();
            let near = rect.distance(x, y).min(pet.map_or(f64::INFINITY, |p| p.distance(x, y)));
            far = !dragging && !was_down && near > FAR;

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
                // Asked before the window takes the pointer, since after that the point is Crest's own. Not during a drag,
                // which the app below is still following.
                #[cfg(windows)]
                let below = if !ignore && !dragging && (inside || on_pet) { window_below() } else { None };
                #[cfg(windows)]
                set_click_through(hwnd, ignore);
                let _ = window.set_ignore_cursor_events(ignore);
                // Sent once the window holds the pointer: the app below looks at what is under the pointer when it reads this.
                #[cfg(windows)]
                if let Some(below) = below {
                    tell_mouse_left(below);
                }
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
    fn distance_is_zero_inside_and_euclidean_outside_the_corner() {
        assert_eq!(R.distance(50.0, 15.0), 0.0);
        assert_eq!(R.distance(0.0, 15.0), 10.0);
        assert_eq!(R.distance(113.0, 34.0), 5.0);
    }
}
