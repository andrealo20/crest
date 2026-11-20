//! What the clipboard history (clipboard.rs) needs to know of the Linux clipboard: that it changed, and whether a password
//! manager put what is in it. GTK reports a new owner as it happens, so nothing is polled; the history reads the content itself.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use gtk::prelude::*;
use gtk::gdk;

static CHANGES: AtomicU32 = AtomicU32::new(1);
static PRIVATE: AtomicBool = AtomicBool::new(false);

/// What password managers add to what they copy, so it stays out of the history (KeePassXC, Bitwarden, KDE's Klipper convention).
const PRIVATE_TARGETS: [&str; 2] = ["x-kde-passwordManagerHint", "org.nspasteboard.ConcealedType"];

/// Starts counting changes. Called once, on the main thread, after GTK is up.
pub fn install() {
    // gtk-rs doesn't wrap this signal, so it is connected by name.
    gtk::Clipboard::get(&gdk::SELECTION_CLIPBOARD).connect_local("owner-change", false, |values| {
        // Read here, while the owner is the one that just copied: a later owner may not offer the same formats.
        let private = values[0].get::<gtk::Clipboard>().ok().and_then(|clipboard| clipboard.wait_for_targets()).is_some_and(|targets| targets.iter().any(|t| PRIVATE_TARGETS.contains(&t.name().as_str())));
        PRIVATE.store(private, Ordering::Relaxed);
        CHANGES.fetch_add(1, Ordering::Relaxed);
        None
    });
}

pub fn change_count() -> u32 {
    CHANGES.load(Ordering::Relaxed)
}

pub fn is_private() -> bool {
    PRIVATE.load(Ordering::Relaxed)
}
