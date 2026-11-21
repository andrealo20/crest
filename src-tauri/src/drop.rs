//! Quick drop: real file paths for drag and drop from Explorer.
//!
//! Tauri's own drop handler attaches to the WebView2 child windows at startup. Depending
//! on the WebView2 version, the window under the cursor belongs to another process, so
//! WebView2 answers itself and, since Tauri disables external drops, only shows the red
//! "not allowed" cursor. So this uses the official WebView2 way: the frontend accepts a
//! normal HTML5 drop and passes the `File` objects via
//! `chrome.webview.postMessageWithAdditionalObjects`; here they become paths.

use tauri::{Emitter, WebviewWindow};
use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2File, ICoreWebView2WebMessageReceivedEventArgs2};
use webview2_com::WebMessageReceivedEventHandler;
use windows::core::{Interface, PWSTR};

/// The notch's drops (see `src/platform/drop.ts`): the paths go to every window as `notch://drop`, for the Shelf.
pub fn install(window: &WebviewWindow) {
    on_message(window, "notch-drop", |w, paths| {
        let _ = w.emit("notch://drop", paths);
    });
}

/// A bar's drops on its apps (TaskbarWindow.tsx): Rust pins the apps among them, on a thread of its own (`ownpins::dropped`).
/// A message of its own, so a drop on a bar never opens the notch's Shelf.
pub fn install_bar(window: &WebviewWindow) {
    on_message(window, "taskbar-drop", |w, paths| {
        let w = w.clone();
        std::thread::spawn(move || crate::taskbar::ownpins::dropped(&w, paths));
    });
}

/// Runs `f` with the paths of the files the page sends with `message`; nothing for no file.
fn on_message(window: &WebviewWindow, message: &'static str, f: impl Fn(&WebviewWindow, Vec<String>) + Send + 'static) {
    let target = window.clone();
    let _ = window.with_webview(move |webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut text = PWSTR::null();
            if args.TryGetWebMessageAsString(&mut text).is_err() || text.is_null() {
                return Ok(());
            }
            let ours = text.to_string().is_ok_and(|t| t == message);
            windows::Win32::System::Com::CoTaskMemFree(Some(text.0 as _));
            if !ours {
                return Ok(());
            }
            let paths = paths(&args);
            if !paths.is_empty() {
                f(&target, paths);
            }
            Ok(())
        }));
        let mut token = Default::default();
        let _ = core.add_WebMessageReceived(&handler, &mut token);
    });
}

unsafe fn paths(args: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2WebMessageReceivedEventArgs) -> Vec<String> {
    let mut out = Vec::new();
    let Ok(args) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else { return out };
    let Ok(objects) = args.AdditionalObjects() else { return out };
    let mut count = 0u32;
    if objects.Count(&mut count).is_err() {
        return out;
    }
    for i in 0..count {
        let Some(file) = objects.GetValueAtIndex(i).ok().and_then(|o| o.cast::<ICoreWebView2File>().ok()) else { continue };
        let mut path = PWSTR::null();
        if file.Path(&mut path).is_ok() && !path.is_null() {
            if let Ok(p) = path.to_string() {
                out.push(p);
            }
            windows::Win32::System::Com::CoTaskMemFree(Some(path.0 as _));
        }
    }
    out
}
