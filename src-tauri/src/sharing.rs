//! "Hide Crest from screen sharing and recordings" (Settings, Display, Presentation mode).
//!
//! On: every Crest window is kept out of what other apps capture (Teams, Zoom, Discord, OBS ...), and stays out for windows
//! opened later (the floating timer, the copies on other monitors). Off by default.
//!
//! - Windows: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, Windows 10 2004 and later (on older builds the call fails
//!   and nothing changes). capture/mod.rs sets the same flag for a moment around Crest's own screenshots and recordings and
//!   then goes back to this choice (`hidden`), so a screenshot never un-hides Crest.
//! - macOS: Tauri's `set_content_protected` (`NSWindow.sharingType = .none`). From macOS 15 apps that capture with
//!   ScreenCaptureKit may ignore it, so there it is less reliable than on Windows.
//!
//! Neither is a security boundary: an app that captures at a low level (a capture card, a hook in the graphics driver, a phone
//! pointed at the screen) still sees the picture.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::AppHandle;
#[cfg(not(windows))]
use tauri::Manager;

static HIDDEN: AtomicBool = AtomicBool::new(false);

/// The user's choice, which Crest's temporary exclusions around its own captures go back to.
pub fn hidden() -> bool {
    HIDDEN.load(Ordering::SeqCst)
}

/// Async on purpose: window handles go through the main thread.
#[tauri::command]
pub async fn sharing_hide(on: bool, app: AppHandle) {
    HIDDEN.store(on, Ordering::SeqCst);
    apply(&app, on);
}

#[cfg(windows)]
fn apply(app: &AppHandle, on: bool) {
    crate::capture::set_hidden(app, on);
}

/// Every window, and a window opened later (`protect_new`).
#[cfg(not(windows))]
fn apply(app: &AppHandle, on: bool) {
    for window in app.webview_windows().values() {
        let _ = window.set_content_protected(on);
    }
}

/// A window opened after the setting was made follows it.
#[cfg(not(windows))]
pub fn protect_new(app: &AppHandle) {
    if hidden() {
        apply(app, true);
    }
}
