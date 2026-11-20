//! Windows' Text size (Settings, Accessibility): WebView2 draws its pages that much larger, on top of the monitor's scale
//! and the panel scale, so its CSS px times DPI times zoom times this factor are device pixels. Everything that turns the
//! page's px into the screen's has to include it, or the notch's window turns click-through over the lower and right part
//! of an open panel and cuts tall tools off (issue #61). Read at start and again when the page's own scale changes
//! (display_rescale); 1 on other systems.

use std::sync::atomic::{AtomicU64, Ordering};

/// The factor as f64 bits; 0 = not read yet.
static FACTOR: AtomicU64 = AtomicU64::new(0);

/// The Text size factor, 1 = 100 %.
pub fn get() -> f64 {
    let known = f64::from_bits(FACTOR.load(Ordering::Relaxed));
    if known > 0.0 {
        return known;
    }
    let now = factor(read());
    FACTOR.store(now.to_bits(), Ordering::Relaxed);
    now
}

/// Reads the setting again; the old and the new factor when it changed.
pub fn refresh() -> Option<(f64, f64)> {
    let old = get();
    let now = factor(read());
    FACTOR.store(now.to_bits(), Ordering::Relaxed);
    (now != old).then_some((old, now))
}

/// The registry value as a factor. Settings writes 100 to 225 and nothing at 100 %; anything else is clamped into that range.
fn factor(percent: Option<u32>) -> f64 {
    percent.map_or(1.0, |p| (p as f64 / 100.0).clamp(1.0, 2.25))
}

/// HKCU\Software\Microsoft\Accessibility\TextScaleFactor, which UISettings.TextScaleFactor (and WebView2 with it) reads.
#[cfg(windows)]
fn read() -> Option<u32> {
    use windows::core::w;
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let (mut value, mut size) = (0u32, 4u32);
    let found = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Accessibility"),
            w!("TextScaleFactor"),
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut _),
            Some(&mut size),
        )
    } == ERROR_SUCCESS;
    found.then_some(value)
}

#[cfg(not(windows))]
fn read() -> Option<u32> {
    None
}

#[cfg(test)]
mod tests {
    use super::factor;

    #[test]
    fn the_text_size_setting_becomes_a_factor() {
        assert_eq!(factor(None), 1.0, "100 % leaves no value");
        assert_eq!(factor(Some(100)), 1.0);
        assert_eq!(factor(Some(125)), 1.25);
        assert_eq!(factor(Some(225)), 2.25);
    }

    #[test]
    fn a_value_out_of_range_is_clamped() {
        assert_eq!(factor(Some(0)), 1.0);
        assert_eq!(factor(Some(80)), 1.0);
        assert_eq!(factor(Some(400)), 2.25);
    }
}
