//! Eyedropper, the Colour tool's pick from the screen: a frozen copy of all monitors fills a popup over them, with a loupe
//! that magnifies the pixels around the pointer and shows the hex value of the one in the middle. A click takes that pixel,
//! and so do Enter and Space after the arrow keys moved the pointer by a pixel (ten with Shift). Esc, a right click,
//! switching to another window or a minute without a pick cancels.
//!
//! Like the region pick (shot.rs) the thread runs per-monitor DPI aware: the pointer, the popup and the copy share physical
//! pixels on every monitor, whatever each one's scaling, so the loupe stays on the pointer on every screen (the web view's
//! own eyedropper drifted away from it on a monitor with another scale). Crest's windows are left out of the copy, so what
//! the open panel covers can be picked too.

use std::sync::Once;

use tauri::{AppHandle, WebviewWindow};
use windows::core::{w, Result};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetKeyState, ReleaseCapture, SetCapture, VIRTUAL_KEY, VK_DOWN, VK_ESCAPE, VK_LEFT, VK_RETURN, VK_RIGHT, VK_SHIFT, VK_SPACE, VK_UP,
};
use windows::Win32::UI::WindowsAndMessaging::*;

use super::math::{hex, intersect, pixel_at, to_bitmap, Loupe, Rect, LOUPE_SPAN};
use super::{monitors, own_hwnd, shot, Hold};

const CLASS: windows::core::PCWSTR = w!("CrestEyedropper");
/// Without a pick in this time the eyedropper closes by itself.
const LIMIT_MS: u32 = 60_000;
const TIMER: usize = 1;

/// The colour the user picks on screen as "#rrggbb"; None when cancelled.
#[tauri::command]
pub async fn colour_pick(app: AppHandle, window: WebviewWindow) -> std::result::Result<Option<String>, String> {
    let owner = own_hwnd(&window);
    tauri::async_runtime::spawn_blocking(move || {
        unsafe {
            let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        let screen = shot::virtual_screen();
        let copy = {
            let _hold = Hold::new(&app);
            shot::grab(screen).map_err(|_| "failed")?
        };
        let list: Vec<(Rect, f32)> = monitors()
            .iter()
            .map(|m| {
                let mut dpi = (96u32, 96u32);
                let _ = unsafe { GetDpiForMonitor(m.handle, MDT_EFFECTIVE_DPI, &mut dpi.0, &mut dpi.1) };
                (m.rect, dpi.0 as f32 / 96.0)
            })
            .collect();
        pick(&copy, screen, &list, owner).map_err(|_| "failed".to_string())
    })
    .await
    .map_err(|_| "failed".to_string())?
}

struct Picker<'a> {
    shot: &'a shot::Dib,
    /// Monitors in bitmap coordinates, with their scale (DPI / 96).
    monitors: Vec<(Rect, f32)>,
    /// The pixel under the pointer, in bitmap coordinates, which are also the popup's client coordinates.
    at: Option<(i32, i32)>,
    /// The left button went down on the popup: only then does its release pick (not the end of the click that started it).
    pressed: bool,
    /// The hex value's font and the height it was made for.
    font: Option<(i32, HFONT)>,
    /// Some(None) = cancelled, Some(Some(pixel)) = picked.
    result: Option<Option<(i32, i32)>>,
}

impl Picker<'_> {
    fn loupe(&self) -> Option<Loupe> {
        let (x, y) = self.at?;
        let all = (Rect { x: 0, y: 0, w: self.shot.w, h: self.shot.h }, 1.0);
        let (monitor, scale) = self.monitors.iter().copied().find(|(m, _)| x >= m.x && x < m.right() && y >= m.y && y < m.bottom()).unwrap_or(all);
        Some(Loupe::new(x, y, scale, monitor))
    }
}

/// Shows the copy `shot` (whose pixel 0, 0 is `screen`'s top left) under a loupe until the user picks a pixel or cancels.
/// `owner` (the notch window, 0 for none) keeps the popup above it: an owned window always sits over its owner.
fn pick(shot: &shot::Dib, screen: Rect, monitors: &[(Rect, f32)], owner: isize) -> Result<Option<String>> {
    let monitors = monitors.iter().filter_map(|(m, scale)| to_bitmap(*m, screen).map(|m| (m, *scale))).collect();
    let mut cursor = POINT::default();
    let at = unsafe { GetCursorPos(&mut cursor) }.ok().map(|_| (cursor.x - screen.x, cursor.y - screen.y));
    // Owned through the raw pointer the window keeps, so the window procedure and this loop never hold two borrows.
    let state = Box::into_raw(Box::new(Picker { shot, monitors, at, pressed: false, font: None, result: None }));

    static REGISTER: Once = Once::new();
    unsafe {
        let instance = GetModuleHandleW(None)?;
        REGISTER.call_once(|| {
            // No class cursor: WM_SETCURSOR hides the pointer, the loupe's middle cell stands for it.
            let class = WNDCLASSW { lpfnWndProc: Some(proc), hInstance: instance.into(), lpszClassName: CLASS, ..Default::default() };
            RegisterClassW(&class);
        });
        let hwnd = CreateWindowExW(
            WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            CLASS,
            w!("Crest eyedropper"),
            WS_POPUP,
            screen.x,
            screen.y,
            screen.w,
            screen.h,
            (owner != 0).then_some(HWND(owner as *mut _)),
            None,
            Some(instance.into()),
            None,
        );
        let hwnd = match hwnd {
            Ok(h) => h,
            Err(e) => {
                drop(Box::from_raw(state));
                return Err(e);
            }
        };
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, state as isize);
        // Never in a recording or a screen share that runs meanwhile.
        let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
        let _ = ShowWindow(hwnd, SW_SHOW);
        let _ = SetForegroundWindow(hwnd);
        SetTimer(Some(hwnd), TIMER, LIMIT_MS, None);

        let mut msg = MSG::default();
        while (*state).result.is_none() && GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        let _ = KillTimer(Some(hwnd), TIMER);
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0);
        let _ = DestroyWindow(hwnd);
        let picker = Box::from_raw(state);
        if let Some((_, font)) = picker.font {
            let _ = DeleteObject(font.into());
        }
        Ok(picker.result.flatten().and_then(|(x, y)| pixel_at(shot.pixels(), shot.w, x, y)).map(hex))
    }
}

unsafe fn state_ref<'a>(hwnd: HWND) -> Option<&'a mut Picker<'a>> {
    let p = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut Picker;
    unsafe { p.as_mut() }
}

fn point(lparam: LPARAM) -> (i32, i32) {
    ((lparam.0 & 0xffff) as i16 as i32, ((lparam.0 >> 16) & 0xffff) as i16 as i32)
}

unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let Some(s) = (unsafe { state_ref(hwnd) }) else { return unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) } };
    unsafe {
        match msg {
            WM_MOUSEMOVE => move_to(hwnd, s, point(lparam)),
            WM_LBUTTONDOWN => {
                s.pressed = true;
                SetCapture(hwnd);
            }
            WM_LBUTTONUP if s.pressed => {
                let _ = ReleaseCapture();
                move_to(hwnd, s, point(lparam));
                s.result = Some(s.at);
            }
            // On the release, so the app under the pointer gets no stray button up (and opens no context menu).
            WM_RBUTTONUP => s.result = Some(None),
            WM_KEYDOWN => key(s, wparam, lparam),
            // Alt+Tab or a click into another app cancels, as in the region pick.
            WM_ACTIVATE if (wparam.0 & 0xffff) as u32 == WA_INACTIVE => s.result = Some(None),
            WM_TIMER if wparam.0 == TIMER => s.result = Some(None),
            WM_SETCURSOR => {
                SetCursor(None);
                return LRESULT(1);
            }
            WM_ERASEBKGND => return LRESULT(1),
            WM_PAINT => paint(hwnd, s),
            _ => return DefWindowProcW(hwnd, msg, wparam, lparam),
        }
    }
    LRESULT(0)
}

/// Esc cancels; Enter and Space take the pixel (not a held key's repeats, which may be the key that started the pick);
/// the arrow keys move the pointer by one pixel, ten with Shift.
fn key(s: &mut Picker, wparam: WPARAM, lparam: LPARAM) {
    let repeat = (lparam.0 >> 30) & 1 == 1;
    let step = if unsafe { GetKeyState(VK_SHIFT.0 as i32) } < 0 { 10 } else { 1 };
    let (dx, dy) = match VIRTUAL_KEY(wparam.0 as u16) {
        VK_ESCAPE => {
            s.result = Some(None);
            return;
        }
        VK_RETURN | VK_SPACE if !repeat => {
            s.result = Some(s.at);
            return;
        }
        VK_LEFT => (-step, 0),
        VK_RIGHT => (step, 0),
        VK_UP => (0, -step),
        VK_DOWN => (0, step),
        _ => return,
    };
    // The move comes back as WM_MOUSEMOVE.
    let mut p = POINT::default();
    if unsafe { GetCursorPos(&mut p) }.is_ok() {
        let _ = unsafe { SetCursorPos(p.x + dx, p.y + dy) };
    }
}

fn move_to(hwnd: HWND, s: &mut Picker, at: (i32, i32)) {
    if s.at == Some(at) {
        return;
    }
    let before = s.loupe().map(|l| l.bounds());
    s.at = Some(at);
    for r in [before, s.loupe().map(|l| l.bounds())].into_iter().flatten() {
        let rect = RECT { left: r.x, top: r.y, right: r.right(), bottom: r.bottom() };
        let _ = unsafe { InvalidateRect(Some(hwnd), Some(&rect), false) };
    }
}

/// Paints only the invalid part, through a back buffer of that size, so moving over a large virtual screen stays smooth.
unsafe fn paint(hwnd: HWND, s: &mut Picker) {
    unsafe {
        let mut ps = PAINTSTRUCT::default();
        let hdc = BeginPaint(hwnd, &mut ps);
        let p = ps.rcPaint;
        let (pw, ph) = (p.right - p.left, p.bottom - p.top);
        if pw > 0 && ph > 0 {
            let back = CreateCompatibleDC(Some(hdc));
            let bmp = CreateCompatibleBitmap(hdc, pw, ph);
            let old = SelectObject(back, bmp.into());
            let _ = BitBlt(back, 0, 0, pw, ph, Some(s.shot.dc), p.left, p.top, SRCCOPY);
            if let Some(l) = s.loupe() {
                draw_loupe(back, s, &l, (p.left, p.top));
            }
            let _ = BitBlt(hdc, p.left, p.top, pw, ph, Some(back), 0, 0, SRCCOPY);
            SelectObject(back, old);
            let _ = DeleteObject(bmp.into());
            let _ = DeleteDC(back);
        }
        let _ = EndPaint(hwnd, &ps);
    }
}

/// The loupe and its label, into a back buffer whose 0, 0 is `origin` in bitmap coordinates (GDI clips what falls outside).
unsafe fn draw_loupe(dc: HDC, s: &mut Picker, l: &Loupe, origin: (i32, i32)) {
    let Some((px, py)) = s.at else { return };
    let at = |x: i32, y: i32, w: i32, h: i32| RECT { left: x - origin.0, top: y - origin.1, right: x + w - origin.0, bottom: y + h - origin.1 };
    let half = LOUPE_SPAN / 2;
    let f = l.frame;
    unsafe {
        let dark = CreateSolidBrush(COLORREF(0x0020_2020));
        let white = CreateSolidBrush(COLORREF(0x00ff_ffff));
        let black = CreateSolidBrush(COLORREF(0));
        // Pixels past the copy's edge (beyond the outer monitors) stay dark.
        FillRect(dc, &at(f.x, f.y, f.w, f.h), dark);
        let source = Rect { x: px - half, y: py - half, w: LOUPE_SPAN, h: LOUPE_SPAN };
        if let Some(i) = intersect(source, Rect { x: 0, y: 0, w: s.shot.w, h: s.shot.h }) {
            // Hard pixel edges, no smoothing between them.
            SetStretchBltMode(dc, COLORONCOLOR);
            let dest = at(f.x + (i.x - source.x) * l.cell, f.y + (i.y - source.y) * l.cell, i.w * l.cell, i.h * l.cell);
            let _ = StretchBlt(dc, dest.left, dest.top, i.w * l.cell, i.h * l.cell, Some(s.shot.dc), i.x, i.y, i.w, i.h, SRCCOPY);
        }
        // Light inside dark, readable on any colour: around the square and around the middle cell, the pixel a click takes.
        FrameRect(dc, &at(f.x - 1, f.y - 1, f.w + 2, f.h + 2), white);
        FrameRect(dc, &at(f.x - 2, f.y - 2, f.w + 4, f.h + 4), black);
        let (mx, my) = (f.x + half * l.cell, f.y + half * l.cell);
        FrameRect(dc, &at(mx - 1, my - 1, l.cell + 2, l.cell + 2), white);
        FrameRect(dc, &at(mx - 2, my - 2, l.cell + 4, l.cell + 4), black);

        // The label: a swatch of the colour and its hex value.
        let b = l.label;
        FillRect(dc, &at(b.x, b.y, b.w, b.h), dark);
        if let Some(rgb) = pixel_at(s.shot.pixels(), s.shot.w, px, py) {
            let pad = b.h / 5;
            let side = b.h - 2 * pad;
            let swatch = CreateSolidBrush(COLORREF(rgb[0] as u32 | (rgb[1] as u32) << 8 | (rgb[2] as u32) << 16));
            FillRect(dc, &at(b.x + pad, b.y + pad, side, side), swatch);
            FrameRect(dc, &at(b.x + pad, b.y + pad, side, side), white);
            let _ = DeleteObject(swatch.into());
            // Half the label's height, made again only when the pointer reaches a monitor with another scale.
            let height = b.h / 2;
            let font = match s.font {
                Some((h, font)) if h == height => font,
                old => {
                    if let Some((_, font)) = old {
                        let _ = DeleteObject(font.into());
                    }
                    let font = CreateFontW(
                        -height,
                        0,
                        0,
                        0,
                        FW_SEMIBOLD.0 as i32,
                        0,
                        0,
                        0,
                        DEFAULT_CHARSET,
                        OUT_DEFAULT_PRECIS,
                        CLIP_DEFAULT_PRECIS,
                        CLEARTYPE_QUALITY,
                        (DEFAULT_PITCH.0 | FF_SWISS.0) as u32,
                        w!("Segoe UI"),
                    );
                    s.font = Some((height, font));
                    font
                }
            };
            let before = SelectObject(dc, font.into());
            SetBkMode(dc, TRANSPARENT);
            SetTextColor(dc, COLORREF(0x00ff_ffff));
            let mut text: Vec<u16> = hex(rgb).to_uppercase().encode_utf16().collect();
            let mut area = at(b.x + 2 * pad + side, b.y, b.w - 3 * pad - side, b.h);
            DrawTextW(dc, &mut text, &mut area, DT_SINGLELINE | DT_VCENTER | DT_LEFT | DT_NOPREFIX);
            SelectObject(dc, before);
        }
        for brush in [dark, white, black] {
            let _ = DeleteObject(brush.into());
        }
    }
}
