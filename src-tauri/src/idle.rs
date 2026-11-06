//! Seconds since the user's last keyboard or mouse input, for the break reminders (src/features/breaks).
//!
//! Asked for when the page wants it, never watched: no hook, no listener, nothing runs in between. Windows reads
//! `GetLastInputInfo`, a Mac the event source's idle time (CoreGraphics, already linked for the mouse button in macos/).

#[tauri::command]
pub fn idle_seconds() -> Result<u64, String> {
    read()
}

/// Milliseconds from the last input to now. `GetLastInputInfo` stamps with the low 32 bits of the tick count, which wrap
/// after 49.7 days, so the difference is taken modulo 2^32 (a plain subtraction of the 64-bit count would be huge then).
#[cfg(any(windows, test))]
fn idle_ms(now_tick: u64, last_input: u32) -> u32 {
    (now_tick as u32).wrapping_sub(last_input)
}

#[cfg(windows)]
fn read() -> Result<u64, String> {
    use windows::Win32::System::SystemInformation::GetTickCount64;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    // SAFETY: `info` is a live LASTINPUTINFO with cbSize set, as the call requires.
    if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
        return Err("failed".into());
    }
    // SAFETY: no arguments, no state.
    Ok(u64::from(idle_ms(unsafe { GetTickCount64() }, info.dwTime)) / 1000)
}

#[cfg(target_os = "macos")]
fn read() -> Result<u64, String> {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGEventSourceSecondsSinceLastEventType(state: i32, event: u32) -> f64;
    }
    // SAFETY: plain value arguments. Combined session state (0) and any input event (kCGAnyInputEventType, all bits set).
    let seconds = unsafe { CGEventSourceSecondsSinceLastEventType(0, u32::MAX) };
    if seconds.is_finite() && seconds >= 0.0 {
        Ok(seconds as u64)
    } else {
        Err("failed".into())
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
fn read() -> Result<u64, String> {
    Err("unsupported".into())
}

#[cfg(test)]
mod tests {
    use super::idle_ms;

    #[test]
    fn idle_time_is_the_gap_between_the_tick_counts() {
        assert_eq!(idle_ms(10_000, 7_500), 2_500);
        assert_eq!(idle_ms(10_000, 10_000), 0);
    }

    #[test]
    fn idle_time_survives_the_32_bit_wrap() {
        // 60 s of idle across the wrap: the last input was 30 s before 2^32 ms, the 64-bit count is 30 s past it.
        let last = u32::MAX - 29_999;
        assert_eq!(idle_ms(u64::from(u32::MAX) + 1 + 30_000, last), 60_000);
        // Long after the wrap the 64-bit count is far above 32 bits; only its low half matters.
        assert_eq!(idle_ms(5 * (1u64 << 32) + 4_000, 1_000), 3_000);
    }
}
