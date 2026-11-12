//! The glass's copy of the screen (src/notch/glass): what lies under the notch window, without that window, handed to the page
//! as a WebView2 shared buffer when it asks for one, as the pointer rests on the notch.
//!
//! - The notch's capture flag goes through the same lock as `exclude`, and never back to WDA_NONE while a recording, a
//!   screenshot, "Hide Crest from screen sharing" or the live glass (glass_live.rs) keeps the window out.
//! - No CAPTUREBLT, which makes the cursor flicker on every call. A DwmFlush between the flag and the copy makes a copy taken
//!   before DWM applies the flag even less likely (none was seen without it); the live test below checks the exclusion.
//! - One buffer per copy, closed right after the post: the page keeps its view until it releases it, and nothing here writes
//!   into memory the page may still read. The page must never write into it either: a write into a read-only buffer crashes
//!   the renderer, and with it all of Crest's interface.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use serde::Serialize;
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment12, ICoreWebView2_17, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY};
use windows::core::{w, Interface, HSTRING, PWSTR};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::System::Com::CoTaskMemFree;
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
use windows::Win32::UI::HiDpi::{SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2};
use windows::Win32::UI::WindowsAndMessaging::{
    GetSystemMetrics, GetWindowDisplayAffinity, GetWindowRect, IsWindowVisible, SetWindowDisplayAffinity, SM_REMOTESESSION, WDA_EXCLUDEFROMCAPTURE,
    WINDOW_DISPLAY_AFFINITY,
};

use super::math::{intersect, Rect};
use super::{affinity, one_at_a_time, own_hwnd, shot, CaptureState};

/// Windows 10 2004: before it WDA_EXCLUDEFROMCAPTURE acts as WDA_MONITOR, and the notch would come out black in the copy.
const FIRST_BUILD: u32 = 19041;

/// The notch window's handle, read once: `hwnd()` goes through the main thread.
static NOTCH: OnceLock<isize> = OnceLock::new();

/// The newest request's `seq`, 0 while none runs. A copy still waiting for the lock when a newer one comes is skipped ("stale"):
/// the page would throw it away.
static LATEST: AtomicU32 = AtomicU32::new(0);

/// What the page gets with the buffer (src/notch/glass/snapshot.ts): the copied area inside the window and the window, physical px.
#[derive(Serialize)]
struct GlassMeta {
    kind: &'static str,
    seq: u32,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    ww: i32,
    wh: i32,
}

/// A copy of the screen behind the notch window for the glass, as a shared buffer (`sharedbufferreceived` on
/// `window.chrome.webview`, with a `GlassMeta`). Resolves once the buffer is posted. Rejects with a short code, and then no buffer
/// follows, but for a `timeout`: the main thread may still post it late.
#[tauri::command]
pub async fn glass_backdrop(seq: u32, app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    let notch = notch(&window);
    if notch == 0 {
        return Err("no-window".into());
    }
    LATEST.fetch_max(seq, Ordering::SeqCst);
    let done = tauri::async_runtime::spawn_blocking(move || take(&app, &window, notch, seq)).await.unwrap_or(Err("failed"));
    // Idle again once the newest request is through: a reloaded page counts from 1 again and must not look old.
    let _ = LATEST.compare_exchange(seq, 0, Ordering::SeqCst, Ordering::SeqCst);
    done.map_err(String::from)
}

fn take(app: &AppHandle, window: &WebviewWindow, notch: isize, seq: u32) -> Result<(), &'static str> {
    unsafe {
        let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    }
    let mut value = 0u32;
    let mut size = std::mem::size_of::<u32>() as u32;
    let read = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            crate::quick::PERSONALIZE,
            w!("EnableTransparency"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    };
    let remote = unsafe { GetSystemMetrics(SM_REMOTESESSION) } != 0;
    if let Some(why) = refusal(crate::terminal::windows_build(), transparency_on(read.is_ok().then_some(value)), remote) {
        return Err(why);
    }
    let notch = HWND(notch as *mut _);
    let (win, monitor) = placement(notch).ok_or("no-window")?;
    let (area, x, y) = copy_area(win, monitor).ok_or("no-window")?;
    let state = app.state::<CaptureState>();
    let dib = copy_without(notch, area, seq, || {
        restore_to(state.excluded(), state.holds.load(Ordering::SeqCst), crate::sharing::hidden(), state.live.load(Ordering::SeqCst))
    })?;
    let pixels = dib.pixels().to_vec();
    drop(dib);
    let meta =
        serde_json::to_string(&GlassMeta { kind: "glass-backdrop", seq, x, y, w: area.w, h: area.h, ww: win.w, wh: win.h }).map_err(|_| "failed")?;
    let (tx, rx) = std::sync::mpsc::channel();
    window
        .with_webview(move |webview| {
            let _ = tx.send(share(&webview, &pixels, &meta));
        })
        .map_err(|_| "failed")?;
    rx.recv_timeout(Duration::from_secs(1)).unwrap_or(Err("timeout"))
}

/// Why no copy can be taken now; None when it can.
fn refusal(build: u32, transparency: bool, remote: bool) -> Option<&'static str> {
    if build < FIRST_BUILD {
        Some("old-windows")
    } else if !transparency {
        Some("transparency-off")
    } else if remote {
        Some("remote")
    } else {
        None
    }
}

/// `EnableTransparency` as read: missing counts as on.
fn transparency_on(value: Option<u32>) -> bool {
    value != Some(0)
}

/// The notch window and the monitor it is on, physical px; None while it is hidden.
fn placement(notch: HWND) -> Option<(Rect, Rect)> {
    let rect = |r: RECT| Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
    unsafe {
        if !IsWindowVisible(notch).as_bool() {
            return None;
        }
        let mut win = RECT::default();
        GetWindowRect(notch, &mut win).ok()?;
        let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
        GetMonitorInfoW(MonitorFromWindow(notch, MONITOR_DEFAULTTONEAREST), &mut info).as_bool().then(|| (rect(win), rect(info.rcMonitor)))
    }
}

/// The window's part on its monitor and where that part starts in the window; None when nothing of it is on the monitor.
fn copy_area(window: Rect, monitor: Rect) -> Option<(Rect, i32, i32)> {
    let area = intersect(window, monitor)?;
    Some((area, area.x - window.x, area.y - window.y))
}

/// The notch window's handle, 0 when it cannot be read. Kept once read: `hwnd()` goes through the main thread.
pub(super) fn notch(window: &WebviewWindow) -> isize {
    let notch = NOTCH.get().copied().unwrap_or_else(|| own_hwnd(window));
    if notch != 0 {
        let _ = NOTCH.set(notch);
    }
    notch
}

/// The flag the notch goes back to after the copy; None while a recording, a screenshot or the live glass (glass_live.rs) still
/// holds it out.
pub(super) fn restore_to(recording: bool, holds: usize, hidden: bool, live: bool) -> Option<WINDOW_DISPLAY_AFFINITY> {
    (!recording && holds == 0 && !live).then(|| affinity(false, hidden))
}

/// The screen under `area` without the window `notch`, through the same lock as `exclude`. No wait on the main thread in here.
fn copy_without(notch: HWND, area: Rect, seq: u32, restore: impl FnOnce() -> Option<WINDOW_DISPLAY_AFFINITY>) -> Result<shot::Dib, &'static str> {
    let _one = one_at_a_time();
    if LATEST.load(Ordering::SeqCst) != seq {
        return Err("stale");
    }
    let mut flag = 0u32;
    unsafe { GetWindowDisplayAffinity(notch, &mut flag) }.map_err(|_| "exclude-failed")?;
    // Already out (a recording, a screenshot, Hide Crest from screen sharing): left as it is, to whoever put it there.
    let change = flag != WDA_EXCLUDEFROMCAPTURE.0;
    if change {
        let set = unsafe { SetWindowDisplayAffinity(notch, WDA_EXCLUDEFROMCAPTURE) }.is_ok();
        let mut now = 0u32;
        if !set || unsafe { GetWindowDisplayAffinity(notch, &mut now) }.is_err() || now != WDA_EXCLUDEFROMCAPTURE.0 {
            if let Some(back) = restore() {
                let _ = unsafe { SetWindowDisplayAffinity(notch, back) };
            }
            return Err("exclude-failed");
        }
        let _ = unsafe { DwmFlush() };
    }
    let copy = shot::grab_plain(area).map_err(|_| "failed");
    if change {
        // Read now, so a choice the user made during the copy wins.
        if let Some(back) = restore() {
            let _ = unsafe { SetWindowDisplayAffinity(notch, back) };
        }
    }
    copy
}

/// On the main thread: a new shared buffer with the pixels, posted read only with `meta` to Crest's own page, then closed.
fn share(webview: &PlatformWebview, pixels: &[u8], meta: &str) -> Result<(), &'static str> {
    unsafe {
        let core = webview.controller().CoreWebView2().map_err(|_| "failed")?;
        let (Ok(env), Ok(view)) = (webview.environment().cast::<ICoreWebView2Environment12>(), core.cast::<ICoreWebView2_17>()) else {
            return Err("unsupported");
        };
        // Other apps' pixels: only for Crest's own page (lib.rs own_page), never for one the window was taken to.
        let mut uri = PWSTR::null();
        let page = if core.Source(&mut uri).is_ok() && !uri.is_null() { uri.to_string().unwrap_or_default() } else { String::new() };
        CoTaskMemFree(Some(uri.0 as _));
        if !tauri::Url::parse(&page).is_ok_and(|u| crate::own_page(&u)) {
            return Err("failed");
        }
        let buffer = env.CreateSharedBuffer(pixels.len() as u64).map_err(|_| "failed")?;
        let mut to = std::ptr::null_mut();
        let posted = buffer.Buffer(&mut to).is_ok() && !to.is_null() && {
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), to, pixels.len());
            view.PostSharedBufferToScript(&buffer, COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_ONLY, &HSTRING::from(meta)).is_ok()
        };
        // The page's view stays valid: the memory goes once both sides let go of it.
        let _ = buffer.Close();
        if posted {
            Ok(())
        } else {
            Err("failed")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::UI::WindowsAndMessaging::WDA_NONE;

    #[test]
    fn refusals_in_the_order_of_the_contract() {
        assert_eq!(refusal(19040, true, false), Some("old-windows"));
        assert_eq!(refusal(19041, true, false), None);
        assert_eq!(refusal(26100, false, false), Some("transparency-off"));
        assert_eq!(refusal(26100, true, true), Some("remote"));
        // Several at once: the first one in the table.
        assert_eq!(refusal(19040, false, true), Some("old-windows"));
        assert_eq!(refusal(26100, false, true), Some("transparency-off"));
    }

    #[test]
    fn missing_transparency_counts_as_on() {
        assert!(transparency_on(None));
        assert!(transparency_on(Some(1)));
        assert!(!transparency_on(Some(0)));
    }

    #[test]
    fn the_copy_keeps_to_the_windows_monitor() {
        let monitor = Rect { x: 0, y: 0, w: 2880, h: 1800 };
        let window = Rect { x: 680, y: 0, w: 1520, h: 1120 };
        assert_eq!(copy_area(window, monitor), Some((window, 0, 0)));
        // Wider and taller than a small monitor, centred on it (a high panel scale): cut, from 120 px into the window.
        let small = Rect { x: 0, y: 0, w: 1280, h: 800 };
        assert_eq!(copy_area(Rect { x: -120, y: 0, w: 1520, h: 1120 }, small), Some((small, 120, 0)));
        // On a monitor left of the primary, in negative coordinates.
        let left = Rect { x: -1920, y: 0, w: 1920, h: 1080 };
        let there = Rect { x: -1720, y: 0, w: 1520, h: 1080 };
        assert_eq!(copy_area(there, left), Some((there, 0, 0)));
        assert_eq!(copy_area(Rect { x: 3000, y: 0, w: 1520, h: 1120 }, monitor), None);
    }

    #[test]
    fn the_flag_goes_back_to_the_users_choice_unless_a_capture_holds_it() {
        assert_eq!(restore_to(false, 0, false, false), Some(WDA_NONE));
        assert_eq!(restore_to(false, 0, true, false), Some(WDA_EXCLUDEFROMCAPTURE));
        assert_eq!(restore_to(true, 0, false, false), None);
        assert_eq!(restore_to(false, 1, false, false), None);
        // The live glass keeps the notch out until it is switched off.
        assert_eq!(restore_to(false, 0, false, true), None);
    }

    #[test]
    fn meta_as_the_page_reads_it() {
        let meta = GlassMeta { kind: "glass-backdrop", seq: 7, x: 0, y: 0, w: 4, h: 2, ww: 4, wh: 2 };
        assert_eq!(serde_json::to_string(&meta).unwrap(), r#"{"kind":"glass-backdrop","seq":7,"x":0,"y":0,"w":4,"h":2,"ww":4,"wh":2}"#);
    }
}

#[cfg(test)]
mod live {
    //! Shows a magenta window for a moment and copies the screen under it, with and without it. Nothing is saved.
    //! It shows on screen, so only on request, with the PC free and unlocked (a locked screen copies black):
    //! `cargo test --lib capture::backdrop::live -- --ignored --nocapture`.
    use std::time::Instant;

    use super::super::math::pixel_at;
    use super::*;
    use windows::Win32::Foundation::{COLORREF, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Gdi::CreateSolidBrush;
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::WindowsAndMessaging::*;

    unsafe extern "system" fn proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) }
    }

    fn middle(dib: &shot::Dib) -> Option<[u8; 3]> {
        pixel_at(dib.pixels(), dib.w, dib.w / 2, dib.h / 2)
    }

    #[test]
    #[ignore]
    fn the_window_stays_out_of_its_own_backdrop() {
        const MAGENTA: Option<[u8; 3]> = Some([255, 0, 255]);
        unsafe {
            let _ = SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        }
        let instance = unsafe { GetModuleHandleW(None) }.unwrap();
        let class = WNDCLASSW {
            lpfnWndProc: Some(proc),
            hInstance: instance.into(),
            lpszClassName: w!("CrestBackdropTest"),
            hbrBackground: unsafe { CreateSolidBrush(COLORREF(0x00ff_00ff)) },
            ..Default::default()
        };
        unsafe { RegisterClassW(&class) };
        let hwnd = unsafe {
            CreateWindowExW(
                WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                w!("CrestBackdropTest"),
                w!("Crest backdrop test"),
                WS_POPUP,
                100,
                100,
                200,
                120,
                None,
                None,
                Some(instance.into()),
                None,
            )
        }
        .unwrap();
        let _ = unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
        // Painted and composed.
        let shown = Instant::now();
        let mut msg = MSG::default();
        while shown.elapsed() < Duration::from_millis(200) {
            unsafe {
                while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            std::thread::sleep(Duration::from_millis(10));
        }
        let mut r = RECT::default();
        unsafe { GetWindowRect(hwnd, &mut r) }.unwrap();
        let rect = Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top };
        let flag = || {
            let mut v = 0u32;
            unsafe { GetWindowDisplayAffinity(hwnd, &mut v) }.unwrap();
            v
        };
        assert_eq!(middle(&shot::grab_plain(rect).unwrap()), MAGENTA);

        // No glass request runs in a test: LATEST stays 0.
        let t = Instant::now();
        let without = copy_without(hwnd, rect, 0, || Some(WDA_NONE)).unwrap();
        eprintln!("copy without the window: {:?}", t.elapsed());
        assert_ne!(middle(&without), MAGENTA);
        assert_eq!(flag(), WDA_NONE.0);

        // Already out: the copy leaves the flag alone and never asks what to put back.
        unsafe { SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE) }.unwrap();
        let without = copy_without(hwnd, rect, 0, || panic!("restored a flag it did not change")).unwrap();
        assert_ne!(middle(&without), MAGENTA);
        assert_eq!(flag(), WDA_EXCLUDEFROMCAPTURE.0);
        unsafe {
            let _ = DestroyWindow(hwnd);
        }
    }
}
