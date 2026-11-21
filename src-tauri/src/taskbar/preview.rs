//! The window previews over the bar's card (design part B, fallback 2B). One small Win32 popup per thumbnail, owned by the bar
//! and made, moved and destroyed on the main thread by a sync command, so no thread of its own. The popups are layered and
//! click-through as find.rs's highlight, so the pointer reaches the bar's page below them, and always out of captures: where
//! that cannot be set, the slot gets no thumbnail at all. DWM composes the live thumbnail on the GPU; the page draws the card.

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::sync::Once;

use serde::{Deserialize, Serialize};
use tauri::{PhysicalPosition, WebviewWindow};
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DwmQueryThumbnailSourceSize, DwmRegisterThumbnail, DwmSetWindowAttribute, DwmUnregisterThumbnail, DwmUpdateThumbnailProperties,
    DWMWA_EXTENDED_FRAME_BOUNDS, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUNDSMALL, DWM_THUMBNAIL_PROPERTIES, DWM_TNP_RECTDESTINATION, DWM_TNP_RECTSOURCE,
    DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE, DWM_WINDOW_CORNER_PREFERENCE,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindow, GetWindowRect, IsIconic, IsWindowVisible, RegisterClassW, SetLayeredWindowAttributes,
    SetWindowDisplayAffinity, SetWindowPos, GW_HWNDPREV, HTTRANSPARENT, HWND_TOPMOST, LWA_ALPHA, MA_NOACTIVATE, SWP_NOACTIVATE, SWP_NOZORDER, SWP_SHOWWINDOW,
    WDA_EXCLUDEFROMCAPTURE, WINDOW_EX_STYLE, WM_ERASEBKGND, WM_MOUSEACTIVATE, WM_NCHITTEST, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT, WS_POPUP,
};

use super::{bar, tasks};

/// A thumbnail's box in the card, CSS px of the bar's page, and the listed window it shows.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq)]
pub struct Slot {
    id: isize,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// Where a thumbnail shows, CSS px of the bar's page: inside its slot, with its window's proportions.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Shown {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// A cap at the trust boundary, not a layout: above the most tiles the card lays out (56 on an 8K screen at 100%).
const MAX_SLOTS: usize = 64;
/// Layered and transparent: mouse input passes to whatever lies below, across threads and processes, so WebView2's input
/// window under the card keeps the pointer (`HTTRANSPARENT` alone only reaches windows of the same thread).
const POPUP_EX: WINDOW_EX_STYLE = WINDOW_EX_STYLE(WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0 | WS_EX_TOPMOST.0 | WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0);
const CLASS: PCWSTR = w!("CrestPreview");
static REGISTER: Once = Once::new();

/// One thumbnail: its popup and DWM's handle.
struct Thumb {
    hwnd: isize,
    thumb: isize,
}

thread_local! {
    /// The thumbnails each bar shows, by its label, by window. Main thread only, and never borrowed across a Win32 call: creating,
    /// moving and destroying a window dispatch messages on this thread, which can reach a handler that calls `clear`. Each user
    /// takes its label's map out in one borrow and puts it back in another.
    static SHOWN: RefCell<HashMap<String, HashMap<isize, Thumb>>> = RefCell::default();
}

/// The page's slots as Rust takes them, one entry per slot sent: finite, of a positive size, the first of each window, at most
/// `MAX_SLOTS`; None for any other, so the answers keep the page's order.
fn sanitize(slots: Vec<Slot>) -> Vec<Option<Slot>> {
    let mut seen = HashSet::new();
    let ok = |s: &Slot| [s.x, s.y, s.w, s.h].iter().all(|v| v.is_finite()) && s.w > 0.0 && s.h > 0.0;
    slots.into_iter().map(|s| (ok(&s) && seen.len() < MAX_SLOTS && seen.insert(s.id)).then_some(s)).collect()
}

/// Whether a slot lies wholly inside the bar's client area (`view`, CSS px). The card always lies in the bar's window, so a box
/// outside it is a fault, never a live copy over another app or monitor.
fn inside(slot: &Slot, (vw, vh): (f64, f64)) -> bool {
    slot.x >= 0.0 && slot.y >= 0.0 && slot.x + slot.w <= vw && slot.y + slot.h <= vh
}

/// A source of `source` px in a box (x, y, w, h), physical px: its proportions kept, centred, never larger than the window.
fn fit((bx, by, bw, bh): (i32, i32, i32, i32), (sw, sh): (i32, i32)) -> Option<(i32, i32, i32, i32)> {
    if bw <= 0 || bh <= 0 || sw <= 0 || sh <= 0 {
        return None;
    }
    let k = (bw as f64 / sw as f64).min(bh as f64 / sh as f64).min(1.0);
    let (w, h) = ((sw as f64 * k).round() as i32, (sh as f64 * k).round() as i32);
    (w > 0 && h > 0).then_some((bx + (bw - w) / 2, by + (bh - h) / 2, w, h))
}

/// The window a thumbnail's `popup` goes under: the one just above the bar (`above_bar`), so it sits right above the bar and under
/// any window that covers the bar's card, as a topmost Picture-in-Picture; the top of the topmost band when nothing is above the
/// bar; None when the popup is already that window, where it stays.
fn insert_after(above_bar: Option<isize>, popup: isize) -> Option<isize> {
    match above_bar {
        Some(h) if h == popup => None,
        Some(h) => Some(h),
        None => Some(HWND_TOPMOST.0 as isize),
    }
}

/// The windows shown before that a new set no longer names, in order.
fn gone(old: &[isize], new: &[isize]) -> Vec<isize> {
    old.iter().copied().filter(|id| !new.contains(id)).collect()
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    // Extras behind POPUP_EX's pass-through: never hit, never activated, nothing painted under the thumbnail.
    match msg {
        WM_NCHITTEST => LRESULT(HTTRANSPARENT as isize),
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_ERASEBKGND => LRESULT(1),
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

/// Draws the calling bar's card's thumbnails in `slots` and answers, per slot in order, where each shows, or null where none
/// does. Each call is the whole set: `[]` takes them all away. Only a listed window, of the process it was listed with, on this
/// bar's monitor, in a box inside this bar's window, while it shows. Sync: on the main thread, where the popups live.
#[tauri::command]
pub fn taskbar_preview(window: WebviewWindow, slots: Vec<Slot>) -> Result<Vec<Option<Shown>>, String> {
    bar::from_bar(&window)?;
    let label = window.label().to_owned();
    let slots = sanitize(slots);
    let owner = window.hwnd().map_err(|_| "failed")?;
    // A call that raced the bar's hiding draws nothing: owned windows do not hide with their owner.
    if !unsafe { IsWindowVisible(owner) }.as_bool() {
        clear(&label);
        return Ok(vec![None; slots.len()]);
    }
    let monitor = tasks::monitor_of(owner);
    let scale = window.scale_factor().map_err(|_| "failed")?;
    let origin = window.inner_position().map_err(|_| "failed")?;
    let size = window.inner_size().map_err(|_| "failed")?;
    let view = (size.width as f64 / scale, size.height as f64 / scale);
    let mut thumbs = SHOWN.with_borrow_mut(|m| m.remove(&label)).unwrap_or_default();
    let ids: Vec<isize> = slots.iter().flatten().map(|s| s.id).collect();
    for id in gone(&thumbs.keys().copied().collect::<Vec<_>>(), &ids) {
        if let Some(t) = thumbs.remove(&id) {
            drop_thumb(t);
        }
    }
    let answers = slots
        .iter()
        .map(|slot| {
            let slot = slot.as_ref()?;
            let source = HWND(slot.id as _);
            // A minimized window has no live picture: DWM would compose only its minimized caption. Its iconic bitmap is its own
            // app's to give the shell (DwmSetIconicThumbnail takes only a window of the calling process), so the page shows the icon.
            let wanted = inside(slot, view) && tasks::previewable(slot.id, monitor) && !unsafe { IsIconic(source) }.as_bool();
            let thumb = match (thumbs.remove(&slot.id), wanted) {
                (Some(t), true) => t,
                (Some(t), false) => return drop_thumb(t),
                (None, true) => make(owner, source)?,
                (None, false) => return None,
            };
            match place(&thumb, owner, source, slot, origin, scale) {
                Some(shown) => {
                    thumbs.insert(slot.id, thumb);
                    Some(shown)
                }
                None => drop_thumb(thumb),
            }
        })
        .collect();
    if !thumbs.is_empty() {
        SHOWN.with_borrow_mut(|m| m.insert(label, thumbs));
    }
    Ok(answers)
}

/// A popup over the bar (`owner`) with `source`'s thumbnail registered in it, or None, with no popup left, when any step fails:
/// no thumbnail ever shows that captures would see.
fn make(owner: HWND, source: HWND) -> Option<Thumb> {
    unsafe {
        let instance = GetModuleHandleW(None).ok()?;
        REGISTER.call_once(|| {
            RegisterClassW(&WNDCLASSW { lpfnWndProc: Some(proc), hInstance: instance.into(), lpszClassName: CLASS, ..Default::default() });
        });
        let hwnd = CreateWindowExW(POPUP_EX, CLASS, w!("Crest preview"), WS_POPUP, 0, 0, 1, 1, Some(owner), None, Some(instance.into()), None).ok()?;
        let thumb = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA).and_then(|_| SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE)).and_then(|_| {
            let corner = DWMWCP_ROUNDSMALL;
            let _ = DwmSetWindowAttribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &corner as *const _ as *const _, size_of::<DWM_WINDOW_CORNER_PREFERENCE>() as u32);
            DwmRegisterThumbnail(hwnd, source)
        });
        match thumb {
            Ok(thumb) => Some(Thumb { hwnd: hwnd.0 as isize, thumb }),
            Err(_) => {
                let _ = DestroyWindow(hwnd);
                None
            }
        }
    }
}

/// Moves a thumbnail's popup onto its slot (`origin`: the bar's client area on the screen, physical px) right above the bar
/// (`owner`) and composes the source in it, answering where it shows in CSS px; None on any failure or when the source measures nothing.
fn place(t: &Thumb, owner: HWND, source: HWND, slot: &Slot, origin: PhysicalPosition<i32>, scale: f64) -> Option<Shown> {
    let (frame, size) = visible_frame(source, t.thumb)?;
    let px = |v: f64| (v * scale).round() as i32;
    let (x, y, w, h) = fit((origin.x + px(slot.x), origin.y + px(slot.y), px(slot.w), px(slot.h)), size)?;
    let props = DWM_THUMBNAIL_PROPERTIES {
        dwFlags: DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_SOURCECLIENTAREAONLY | if frame.is_some() { DWM_TNP_RECTSOURCE } else { 0 },
        rcDestination: RECT { left: 0, top: 0, right: w, bottom: h },
        rcSource: frame.unwrap_or_default(),
        fVisible: true.into(),
        fSourceClientAreaOnly: false.into(),
        ..Default::default()
    };
    unsafe {
        // The thumbnail first, then the popup shows: never an empty popup for a frame.
        DwmUpdateThumbnailProperties(t.thumb, &props).ok()?;
        // Created topmost, the popup would sit at the top of the topmost band, over a window that covers the card.
        let above = GetWindow(owner, GW_HWNDPREV).ok().map(|h| h.0 as isize);
        let (after, keep) = match insert_after(above, t.hwnd) {
            Some(h) => (Some(HWND(h as _)), SWP_NOACTIVATE),
            None => (None, SWP_NOACTIVATE | SWP_NOZORDER),
        };
        SetWindowPos(HWND(t.hwnd as _), after, x, y, w, h, keep | SWP_SHOWWINDOW).ok()?;
    }
    Some(Shown { x: (x - origin.x) as f64 / scale, y: (y - origin.y) as f64 / scale, w: w as f64 / scale, h: h as f64 / scale })
}

/// The source's visible frame, relative to its window rect, and its size: without the invisible resize borders of Windows 10
/// and 11, which would compose as a dark band and skew the proportions. When that cannot be read, the whole window.
fn visible_frame(source: HWND, thumb: isize) -> Option<(Option<RECT>, (i32, i32))> {
    let size = unsafe { DwmQueryThumbnailSourceSize(thumb) }.ok()?;
    let (mut frame, mut rect) = (RECT::default(), RECT::default());
    let framed = unsafe { DwmGetWindowAttribute(source, DWMWA_EXTENDED_FRAME_BOUNDS, &mut frame as *mut _ as *mut _, size_of::<RECT>() as u32) }.is_ok()
        && unsafe { GetWindowRect(source, &mut rect) }.is_ok();
    match framed.then(|| crop(frame, rect, (size.cx, size.cy))).flatten() {
        Some(r) => Some((Some(r), (r.right - r.left, r.bottom - r.top))),
        None => Some((None, (size.cx, size.cy))),
    }
}

/// The frame (screen px) relative to the window rect, only when DWM's source measures as that rect: a DPI-virtualized window's
/// surface is its unscaled size, where physical px would cut or shift it, so it composes whole.
fn crop(frame: RECT, rect: RECT, (sw, sh): (i32, i32)) -> Option<RECT> {
    (rect.right - rect.left == sw && rect.bottom - rect.top == sh).then_some(RECT {
        left: frame.left - rect.left,
        top: frame.top - rect.top,
        right: frame.right - rect.left,
        bottom: frame.bottom - rect.top,
    })
}

/// Unregisters a thumbnail and destroys its popup; always None, for the slot's answer.
fn drop_thumb(t: Thumb) -> Option<Shown> {
    unsafe {
        let _ = DwmUnregisterThumbnail(t.thumb);
        let _ = DestroyWindow(HWND(t.hwnd as _));
    }
    None
}

/// Every thumbnail `label`'s bar shows goes: its card closed, the bar hid, moved, changed scale or went. Main thread only, where
/// the popups were made. A popup its owner's destruction already took fails `DestroyWindow` harmlessly.
pub(crate) fn clear(label: &str) {
    for t in SHOWN.with_borrow_mut(|m| m.remove(label)).into_iter().flat_map(HashMap::into_values) {
        drop_thumb(t);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_thumbnail_keeps_its_windows_proportions_inside_its_box_and_never_grows() {
        assert_eq!(fit((0, 0, 384, 240), (1920, 1200)), Some((0, 0, 384, 240)));
        assert_eq!(fit((10, 20, 384, 240), (800, 1200)), Some((122, 20, 160, 240)));
        assert_eq!(fit((0, 0, 384, 240), (200, 100)), Some((92, 70, 200, 100)));
    }

    #[test]
    fn a_window_that_measures_nothing_gets_no_thumbnail() {
        assert_eq!(fit((0, 0, 384, 240), (0, 500)), None);
        assert_eq!(fit((0, 0, 384, 240), (500, -1)), None);
        assert_eq!(fit((0, 0, 0, 240), (500, 500)), None);
    }

    #[test]
    fn the_pages_slots_are_finite_positive_once_each_and_few() {
        let s = |id, w| Slot { id, x: 0.0, y: 0.0, w, h: 10.0 };
        // One entry per slot the page sent, in order, so each answer stays on its own box.
        let kept = sanitize(vec![s(1, 10.0), s(1, 10.0), s(2, f64::NAN), s(3, -1.0), s(4, 10.0)]);
        assert_eq!(kept.iter().map(|s| s.map(|s| s.id)).collect::<Vec<_>>(), [Some(1), None, None, None, Some(4)]);
        let many = sanitize((0..100).map(|i| s(i, 10.0)).collect());
        assert_eq!((many.len(), many.iter().flatten().count()), (100, MAX_SLOTS));
        assert!(many[MAX_SLOTS - 1].is_some() && many[MAX_SLOTS].is_none());
    }

    #[test]
    fn the_cap_holds_every_tile_the_card_can_lay_out() {
        // R8's previewLayout keeps tiles while (viewW - 24 - 4 (n - 1)) / n - 12 >= 120: 56 at 7680 CSS px (8K at 100%).
        let tiles = |view: i64| (1..).take_while(|n| (view - 24 - 4 * (n - 1)) / n - 12 >= 120).last().unwrap_or(0) as usize;
        assert_eq!(tiles(1920), 13);
        assert!(tiles(7680) <= MAX_SLOTS);
    }

    #[test]
    fn a_frame_is_cropped_only_when_the_source_measures_as_its_window() {
        let r = |left, top, right, bottom| RECT { left, top, right, bottom };
        let (frame, rect) = (r(107, 100, 1007, 700), r(100, 100, 1014, 707));
        assert_eq!(crop(frame, rect, (914, 607)), Some(r(7, 0, 907, 600)));
        // A DPI-virtualized source: DWM's surface is its unscaled size, so the physical frame would cut or shift it.
        assert_eq!(crop(frame, rect, (457, 303)), None);
    }

    #[test]
    fn a_slot_outside_the_calling_bar_gets_no_thumbnail() {
        let s = |x, y, w, h| Slot { id: 1, x, y, w, h };
        assert!(inside(&s(0.0, 0.0, 192.0, 120.0), (1920.0, 604.0)));
        assert!(inside(&s(1728.0, 484.0, 192.0, 120.0), (1920.0, 604.0)));
        assert!(!inside(&s(5000.0, -3000.0, 192.0, 120.0), (1920.0, 604.0)));
        assert!(!inside(&s(0.0, 0.0, 3000.0, 2000.0), (1920.0, 604.0)));
        assert!(!inside(&s(-1.0, 10.0, 192.0, 120.0), (1920.0, 604.0)));
    }

    #[test]
    fn a_thumbnail_goes_right_above_the_bar_never_over_a_window_that_covers_it() {
        // Under the window just above the bar (a Picture-in-Picture over the card stays over the thumbnail too).
        assert_eq!(insert_after(Some(42), 7), Some(42));
        // The bar on top of everything: the top of the topmost band is right above it.
        assert_eq!(insert_after(None, 7), Some(HWND_TOPMOST.0 as isize));
        // Already the window just above the bar: left where it is.
        assert_eq!(insert_after(Some(7), 7), None);
    }

    #[test]
    fn a_new_set_of_slots_lets_go_of_the_thumbnails_it_no_longer_names() {
        assert_eq!(gone(&[1, 2, 3], &[3, 4]), [1, 2]);
        assert!(gone(&[], &[1]).is_empty());
        assert_eq!(gone(&[5], &[]), [5]);
    }

    #[test]
    fn the_preview_refuses_any_window_but_a_bar_before_anything_else() {
        // The module's code above its tests, read as text: the command's first statement is the bar check.
        let src = include_str!("preview.rs");
        let code = &src[..src.find("#[cfg(test)]").unwrap()];
        let body = &code[code.find("pub fn taskbar_preview").unwrap()..];
        let first = body[body.find('{').unwrap() + 1..].trim_start();
        assert!(first.starts_with("bar::from_bar(&window)?;"), "{}", &first[..first.len().min(60)]);
    }
}
