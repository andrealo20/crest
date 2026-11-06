//! Whether the screen is off or the system is suspending, so the pollers stop calling into drivers meanwhile.
//!
//! With Modern Standby the screen turning off is the moment the graphics, panel and storage drivers power down, and a
//! driver that misses that transition stops the machine (DRIVER_POWER_STATE_FAILURE, 0x9F). Crest's periodic reads
//! (DDC/CI to monitors, GPU and sensor queries, the foreground window, media, the cursor) are skipped while it lasts,
//! and the ones that talk to monitors also wait `SETTLE` after the screen comes back, while drivers are still waking.
//!
//! sysevents.rs sets it on Windows from GUID_CONSOLE_DISPLAY_STATE and the suspend and resume notifications. Nothing
//! sets it on a Mac, so there every poller keeps running as before.

// Only sysevents.rs sets the state, and only on Windows.
#![cfg_attr(not(windows), allow(dead_code))]

use std::sync::Mutex;
use std::time::{Duration, Instant};

/// After the screen comes back, how long monitor reads (DDC/CI) still wait.
pub const SETTLE: Duration = Duration::from_secs(8);

#[derive(Default)]
struct State {
    display_off: bool,
    suspended: bool,
    /// When the last sleep ended.
    woke: Option<Instant>,
}

impl State {
    fn asleep(&self) -> bool {
        self.display_off || self.suspended
    }

    fn set(&mut self, display_off: Option<bool>, suspended: Option<bool>, now: Instant) {
        let was = self.asleep();
        self.display_off = display_off.unwrap_or(self.display_off);
        self.suspended = suspended.unwrap_or(self.suspended);
        if was && !self.asleep() {
            self.woke = Some(now);
        }
    }

    fn settling(&self, settle: Duration, now: Instant) -> bool {
        self.asleep() || self.woke.is_some_and(|t| now.saturating_duration_since(t) < settle)
    }
}

static STATE: Mutex<State> = Mutex::new(State { display_off: false, suspended: false, woke: None });

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

/// The console display went off (false) or came back, dimmed included (true).
pub fn set_display(on: bool) {
    state().set(Some(!on), None, Instant::now());
}

/// The system is suspending (true) or resumed (false).
pub fn set_suspended(suspended: bool) {
    state().set(None, Some(suspended), Instant::now());
}

/// Screen off or suspending: skip every device read.
pub fn asleep() -> bool {
    state().asleep()
}

/// Asleep, or awake for less than `SETTLE`: skip reads that go to the monitors.
pub fn settling() -> bool {
    state().settling(SETTLE, Instant::now())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sleeps_with_the_screen_or_the_system_and_settles_after() {
        let t0 = Instant::now();
        let at = |s: u64| t0 + Duration::from_secs(s);
        let mut s = State::default();
        assert!(!s.asleep() && !s.settling(SETTLE, at(0)));

        // Screen off, then the system suspends: asleep until both are over.
        s.set(Some(true), None, at(1));
        s.set(None, Some(true), at(2));
        assert!(s.asleep());
        s.set(Some(false), None, at(3));
        assert!(s.asleep(), "still suspended");
        s.set(None, Some(false), at(4));
        assert!(!s.asleep());

        // Monitor reads wait SETTLE from the moment it woke, not from when it slept.
        assert!(s.settling(SETTLE, at(4) + SETTLE - Duration::from_secs(1)));
        assert!(!s.settling(SETTLE, at(4) + SETTLE));

        // A dim screen counts as on; a repeated "on" does not restart the wait.
        s.set(Some(false), None, at(30));
        assert!(!s.settling(SETTLE, at(30)));
    }
}
