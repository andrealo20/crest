//! Click-through on Linux without a pointer to poll.
//!
//! Windows polls the cursor against the hit zone (hit_test.rs). A Wayland client can't read the pointer or its own place,
//! so here the window's input shape is the hit zone itself: the compositor sends the pointer to the notch only while it is
//! over it, and the page gets ordinary pointer events there (src/platform/native/index.ts turns them into `notch://hover`).

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use gtk::cairo::{RectangleInt, Region};
use gtk::prelude::*;
use tauri::{Emitter, WebviewWindow};

/// (x, y, w, h) in logical px; None = the whole window.
type Zones = Option<Vec<(i32, i32, i32, i32)>>;

/// The shape last set, so an unchanged one is not set again: each change makes the X server decide again what is under a
/// still pointer, and that sends the window a leave and an enter.
static LAST: Mutex<Option<Zones>> = Mutex::new(None);

/// Makes `zones` the only parts of the window that take the pointer; None = all of it.
/// An empty list lets everything through, as before the page reports its first zone.
pub fn apply(window: &WebviewWindow, zones: Zones) {
    let window = window.clone();
    // GTK is used on the main thread only.
    let _ = window.clone().run_on_main_thread(move || {
        if LAST.lock().unwrap().replace(zones.clone()).is_some_and(|last| last == zones) {
            return;
        }
        let Ok(gtk_window) = window.gtk_window() else { return };
        match zones {
            None => gtk_window.input_shape_combine_region(None),
            Some(zones) => {
                let region = Region::create();
                for (x, y, w, h) in zones {
                    let _ = region.union_rectangle(&RectangleInt::new(x, y, w, h));
                }
                gtk_window.input_shape_combine_region(Some(&region));
            }
        }
        // XWayland passes the shape on to the compositor with the next paint; an idle transparent window has none, so the
        // old, larger area kept taking the pointer after the notch had shrunk.
        gtk_window.queue_draw();
    });
}

/// Enters seen so far, to tell a real leave from the pair GTK sends while the shape or the page changes under a still pointer.
static ENTERS: AtomicU64 = AtomicU64::new(0);

/// A leave that no enter follows within this long is the pointer going out.
const LEAVE_WAIT: Duration = Duration::from_millis(60);

/// The pointer left the window's input shape: tells the page (`notch://hover`, false), which sees the pointer enter by itself
/// but no reliable leave. GTK also sends a leave and an enter in a row whenever the shape or the page changes under the
/// pointer, and while it moves between the page's own child windows, so a leave counts once no enter has followed it.
/// Called once, from the main thread, after the window exists.
pub fn install(window: &WebviewWindow) {
    let Ok(gtk_window) = window.gtk_window() else { return };
    gtk_window.add_events(gtk::gdk::EventMask::ENTER_NOTIFY_MASK | gtk::gdk::EventMask::LEAVE_NOTIFY_MASK);
    let window = window.clone();
    let entered = window.clone();
    gtk_window.connect_enter_notify_event(move |_, _| {
        ENTERS.fetch_add(1, Ordering::Relaxed);
        // The page ignores pointer events that no crossing explains: WebKit sends the last position again whenever the page
        // changes under a still pointer.
        let _ = entered.emit("notch://crossed", ());
        gtk::glib::Propagation::Proceed
    });
    gtk_window.connect_leave_notify_event(move |_, _| {
        let seen = ENTERS.load(Ordering::Relaxed);
        let window = window.clone();
        gtk::glib::timeout_add_local_once(LEAVE_WAIT, move || {
            if ENTERS.load(Ordering::Relaxed) == seen {
                let _ = window.emit("notch://hover", false);
            }
        });
        gtk::glib::Propagation::Proceed
    });
}
