//! The system's accent colour and its light or dark side, for the System theme card (src/features/themes/store.ts).

use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize, Clone, PartialEq)]
pub struct SystemAccent {
    accent: String,
    dark: bool,
}

/// None where Crest cannot read it: the page then shows no System card.
#[tauri::command]
pub fn system_accent() -> Option<SystemAccent> {
    read()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02x}{g:02x}{b:02x}")
}

/// Sends the new value only when it differs: the system reports one change several times, and changes of colours the card
/// does not use.
#[cfg(any(windows, target_os = "macos"))]
fn send_if_changed(app: &AppHandle, last: &std::sync::Mutex<Option<SystemAccent>>) {
    use tauri::Emitter;
    let now = read();
    let mut last = last.lock().unwrap_or_else(|e| e.into_inner());
    if *last != now {
        *last = now.clone();
        let _ = app.emit("theme://system-accent", now);
    }
}

#[cfg(windows)]
fn read() -> Option<SystemAccent> {
    use windows::UI::ViewManagement::{UIColorType, UISettings};
    let c = UISettings::new().and_then(|s| s.GetColorValue(UIColorType::Accent)).ok()?;
    Some(SystemAccent { accent: hex(c.R, c.G, c.B), dark: crate::quick::dark() })
}

#[cfg(windows)]
pub(crate) fn watch(app: AppHandle) {
    use std::sync::{Mutex, OnceLock};
    use windows::core::IInspectable;
    use windows::Foundation::TypedEventHandler;
    use windows::UI::ViewManagement::UISettings;
    // The handler lives as long as the object it is registered on: kept for the app's lifetime.
    static SETTINGS: OnceLock<UISettings> = OnceLock::new();
    let Ok(settings) = UISettings::new() else { return };
    let last = Mutex::new(read());
    let handler = TypedEventHandler::<UISettings, IInspectable>::new(move |_, _| {
        send_if_changed(&app, &last);
        Ok(())
    });
    match settings.ColorValuesChanged(&handler) {
        Ok(_) => drop(SETTINGS.set(settings)),
        Err(e) => eprintln!("accent: no change events: {e}"),
    }
}

#[cfg(target_os = "macos")]
fn read() -> Option<SystemAccent> {
    use objc2_app_kit::NSColor;
    use objc2_foundation::{NSString, NSUserDefaults};
    let accent = crate::macos::colour::srgb_hex(&NSColor::controlAccentColor())?;
    let style = NSUserDefaults::standardUserDefaults().stringForKey(&NSString::from_str("AppleInterfaceStyle"));
    Some(SystemAccent { accent, dark: style.is_some_and(|s| s.isEqualToString(&NSString::from_str("Dark"))) })
}

#[cfg(target_os = "macos")]
pub(crate) fn watch(app: AppHandle) {
    use std::ptr::NonNull;
    use std::sync::Mutex;

    use block2::RcBlock;
    use objc2_app_kit::NSSystemColorsDidChangeNotification;
    use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
    let last = Mutex::new(read());
    let block = RcBlock::new(move |_: NonNull<NSNotification>| send_if_changed(&app, &last));
    // SAFETY: AppKit's own notification name, no object filter; on the main queue the block runs on the main thread, where
    // AppKit's colours are read.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(NSSystemColorsDidChangeNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // Registered for the app's lifetime: nothing ever removes it.
    std::mem::forget(observer);
}

#[cfg(not(any(windows, target_os = "macos")))]
fn read() -> Option<SystemAccent> {
    None
}

#[cfg(not(any(windows, target_os = "macos")))]
pub(crate) fn watch(_app: AppHandle) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_is_lowercase_rrggbb() {
        assert_eq!(hex(0, 120, 212), "#0078d4");
    }

    #[test]
    fn the_page_reads_accent_and_dark() {
        let json = serde_json::to_string(&SystemAccent { accent: "#0078d4".into(), dark: true }).unwrap();
        assert_eq!(json, r##"{"accent":"#0078d4","dark":true}"##);
    }
}
