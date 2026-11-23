//! The desktop picture on a Mac (wallpaper.rs): NSWorkspace, per screen, on the main thread. The main screen is the first, the
//! one with the menu bar; screens go by their place in that list. macOS sets the picture on the current Space only.

use std::path::Path;
use std::sync::mpsc;

use objc2_app_kit::{NSScreen, NSWorkspace, NSWorkspaceDesktopImageAllowClippingKey, NSWorkspaceDesktopImageScalingKey};
#[allow(deprecated)]
use objc2_foundation::MainThreadMarker;
use objc2_foundation::{NSDictionary, NSNumber, NSURL};
use tauri::AppHandle;

use crate::wallpaper::{Fit, Screen};

/// AppKit's NSImageScaleProportionallyUpOrDown.
const PROPORTIONAL: isize = 3;

/// Runs `f` on the main thread, where AppKit's screens live, and waits for it: called from a blocking thread, never the main one.
fn on_main<T: Send + 'static>(app: &AppHandle, f: impl FnOnce(MainThreadMarker) -> Result<T, String> + Send + 'static) -> Result<T, String> {
    let (tx, rx) = mpsc::channel();
    app.run_on_main_thread(move || {
        let _ = tx.send(MainThreadMarker::new().ok_or_else(|| "thread".to_string()).and_then(f));
    })
    .map_err(|e| e.to_string())?;
    rx.recv().map_err(|_| "failed".to_string())?
}

pub fn screens(app: &AppHandle) -> Result<Vec<Screen>, String> {
    on_main(app, |mtm| {
        let workspace = NSWorkspace::sharedWorkspace();
        Ok(NSScreen::screens(mtm)
            .iter()
            .enumerate()
            .map(|(i, screen)| Screen {
                id: i.to_string(),
                primary: i == 0,
                path: workspace.desktopImageURLForScreen(&screen).and_then(|url| url.to_file_path()).map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
                crest: None,
            })
            .collect())
    })
}

/// Fill scales the picture to cover the screen, cutting what overflows; Fit scales it to show whole. Span is Windows' only.
fn set(screen: &NSScreen, url: &NSURL, fit: Fit) -> Result<(), String> {
    let scale = NSNumber::new_isize(PROPORTIONAL);
    let clip = NSNumber::new_bool(fit != Fit::Fit);
    // SAFETY: AppKit's own constant keys.
    let keys = unsafe { [NSWorkspaceDesktopImageScalingKey, NSWorkspaceDesktopImageAllowClippingKey] };
    let options = NSDictionary::from_slices(&keys, &[&*scale, &*clip]);
    // SAFETY: both options take an NSNumber, as given.
    unsafe { NSWorkspace::sharedWorkspace().setDesktopImageURL_forScreen_options_error(url, screen, options.cast_unchecked()) }
        .map_err(|e| e.localizedDescription().to_string())
}

pub fn apply(app: &AppHandle, screen: Option<String>, file: &Path, fit: Fit) -> Result<(), String> {
    let url = file.to_path_buf();
    on_main(app, move |mtm| {
        let url = NSURL::from_file_path(&url).ok_or_else(|| "file".to_string())?;
        for (i, s) in NSScreen::screens(mtm).iter().enumerate() {
            if screen.as_deref().is_none_or(|id| id == i.to_string()) {
                set(&s, &url, fit)?;
            }
        }
        Ok(())
    })
}

/// The fit is part of each screen's setting: every screen's picture is set again with it.
pub fn fit(app: &AppHandle, fit: Fit) -> Result<(), String> {
    on_main(app, move |mtm| {
        let workspace = NSWorkspace::sharedWorkspace();
        for s in NSScreen::screens(mtm).iter() {
            if let Some(url) = workspace.desktopImageURLForScreen(&s) {
                set(&s, &url, fit)?;
            }
        }
        Ok(())
    })
}
