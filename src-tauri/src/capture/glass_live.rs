//! The live glass on the closed notch and the capsule (src/notch/glass), Windows 11 only, behind its own switch in Settings ›
//! Themes, off by default.
//!
//! - While the switch is on the notch window stays out of every capture, its own included, whether the copy runs or not:
//!   `glass_live_exclude` sets the flag when it goes on and puts it back when it goes off, `exclude` keeps it out through
//!   recordings, screenshots and Hide Crest from screen sharing, and the copy for the open panel (backdrop.rs) finds it out.
//! - Hidden on ARM64 PCs, in the Store build and before Windows 11 until someone tries it there.

use std::sync::atomic::Ordering;
use std::sync::OnceLock;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Environment12, ICoreWebView2_17};
use windows::core::Interface;
use windows::Graphics::Capture::GraphicsCaptureSession;
use windows::Win32::Foundation::HWND;
use windows::Win32::Graphics::Dwm::DwmFlush;
use windows::Win32::UI::WindowsAndMessaging::{GetWindowDisplayAffinity, SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WINDOW_DISPLAY_AFFINITY};

use super::{backdrop, one_at_a_time, CaptureState};

/// Windows 11: on Windows 10 a capture keeps its yellow border around the whole screen (IsBorderRequired comes with 20348).
const FIRST_BUILD: u32 = 22000;

/// Whether the live glass can run on this PC, and if not why: the page shows its switch only when it can.
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub struct Support {
    supported: bool,
    reason: Option<&'static str>,
}

#[tauri::command]
pub async fn glass_live_supported(window: WebviewWindow) -> Support {
    let reason = support(&window).await;
    Support { supported: reason.is_none(), reason }
}

/// The switch went on or off; the page also calls it at load. On: the notch window out of every capture until it goes off,
/// or a rejection with the reason it cannot run, or `exclude-failed` with the flag as it was. Off: the flag goes back to what
/// recordings, screenshots and Hide Crest from screen sharing ask for. Either way, again is the same.
#[tauri::command]
pub async fn glass_live_exclude(on: bool, app: AppHandle, window: WebviewWindow) -> Result<(), String> {
    if on {
        if let Some(why) = support(&window).await {
            return Err(why.into());
        }
    }
    let notch = backdrop::notch(&window);
    tauri::async_runtime::spawn_blocking(move || switch(&app, HWND(notch as _), on)).await.unwrap_or(Err("failed")).map_err(String::from)
}

fn switch(app: &AppHandle, notch: HWND, on: bool) -> Result<(), &'static str> {
    let state = app.state::<CaptureState>();
    let _one = one_at_a_time();
    if on {
        keep_out(notch)?;
        state.live.store(true, Ordering::SeqCst);
    } else if state.live.swap(false, Ordering::SeqCst) {
        if let Some(flag) = backdrop::restore_to(state.excluded(), state.holds.load(Ordering::SeqCst), crate::sharing::hidden(), false) {
            let _ = unsafe { SetWindowDisplayAffinity(notch, flag) };
        }
    }
    Ok(())
}

/// The notch out of captures: the flag, read back, then a frame of DWM so the next capture is without it. On a failure the
/// flag goes back to what it was. Under `one_at_a_time`.
fn keep_out(notch: HWND) -> Result<(), &'static str> {
    let mut was = 0u32;
    unsafe { GetWindowDisplayAffinity(notch, &mut was) }.map_err(|_| "exclude-failed")?;
    if was == WDA_EXCLUDEFROMCAPTURE.0 {
        return Ok(());
    }
    let set = unsafe { SetWindowDisplayAffinity(notch, WDA_EXCLUDEFROMCAPTURE) }.is_ok();
    let mut now = 0u32;
    if !set || unsafe { GetWindowDisplayAffinity(notch, &mut now) }.is_err() || now != WDA_EXCLUDEFROMCAPTURE.0 {
        let _ = unsafe { SetWindowDisplayAffinity(notch, WINDOW_DISPLAY_AFFINITY(was)) };
        return Err("exclude-failed");
    }
    let _ = unsafe { DwmFlush() };
    Ok(())
}

/// Why the live glass cannot run here, None when it can. Worked out once.
async fn support(window: &WebviewWindow) -> Option<&'static str> {
    static KNOWN: OnceLock<Option<&'static str>> = OnceLock::new();
    if let Some(known) = KNOWN.get() {
        return *known;
    }
    let why = match unsupported(crate::terminal::windows_build(), crate::native_machine() == Some("aarch64"), cfg!(feature = "store")) {
        None if !capture(window).await => Some("unsupported"),
        why => why,
    };
    *KNOWN.get_or_init(|| why)
}

/// The reasons that come before trying anything, in the contract's order. ARM64 and the Store build have never been tried.
fn unsupported(build: u32, arm: bool, store: bool) -> Option<&'static str> {
    if build < FIRST_BUILD {
        Some("old-windows")
    } else if arm {
        Some("arm64")
    } else if store {
        Some("store")
    } else {
        None
    }
}

/// Windows.Graphics.Capture, and a WebView2 that takes shared buffers (backdrop.rs `share`).
async fn capture(window: &WebviewWindow) -> bool {
    if !GraphicsCaptureSession::IsSupported().unwrap_or(false) {
        return false;
    }
    let (tx, rx) = tokio::sync::oneshot::channel();
    let asked = window.with_webview(move |webview| {
        let _ = tx.send(unsafe {
            webview.environment().cast::<ICoreWebView2Environment12>().is_ok()
                && webview.controller().CoreWebView2().is_ok_and(|core| core.cast::<ICoreWebView2_17>().is_ok())
        });
    });
    asked.is_ok() && rx.await.unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reasons_it_cannot_run_in_the_order_of_the_contract() {
        assert_eq!(unsupported(26100, false, false), None);
        assert_eq!(unsupported(22000, false, false), None);
        assert_eq!(unsupported(21999, false, false), Some("old-windows"));
        assert_eq!(unsupported(22000, true, false), Some("arm64"));
        assert_eq!(unsupported(22000, false, true), Some("store"));
        // Several at once: the first one.
        assert_eq!(unsupported(19045, true, true), Some("old-windows"));
        assert_eq!(unsupported(26100, true, true), Some("arm64"));
    }

    #[test]
    fn support_as_the_page_reads_it() {
        let yes = Support { supported: true, reason: None };
        assert_eq!(serde_json::to_string(&yes).unwrap(), r#"{"supported":true,"reason":null}"#);
        let no = Support { supported: false, reason: unsupported(26100, false, true) };
        assert_eq!(serde_json::to_string(&no).unwrap(), r#"{"supported":false,"reason":"store"}"#);
    }
}
