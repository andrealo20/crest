//! Which media session the notch shows. Pure, so the rules are tested without Windows:
//! `rustc --edition 2021 --test src-tauri/src/media_pick.rs`.
//!
//! - A pinned app with a session always wins, playing or not.
//! - Otherwise a playing one wins: Windows' current first, then the app shown before,
//!   then any. If nothing plays, the app shown before stays, so pausing with a media
//!   key doesn't make it jump to another app; then Windows' current.
//! - A pinned app without a session (closed) falls back to the rules above; the pin
//!   stays, so the app is shown again once it plays.

pub struct Candidate<'a> {
    pub app_id: &'a str,
    pub playing: bool,
    /// Windows' current session.
    pub current: bool,
}

/// Index of the session to show.
pub fn choose(all: &[Candidate], shown: &str, pinned: Option<&str>) -> Option<usize> {
    let find = |id: &str| all.iter().position(|c| c.app_id == id);
    if let Some(i) = pinned.filter(|p| !p.is_empty()).and_then(find) {
        return Some(i);
    }
    let current = all.iter().position(|c| c.current);
    if let Some(i) = current.filter(|&i| all[i].playing) {
        return Some(i);
    }
    let by_shown = find(shown).filter(|_| !shown.is_empty());
    by_shown
        .filter(|&i| all[i].playing)
        .or_else(|| all.iter().position(|c| c.playing))
        .or(by_shown)
        .or(current)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(app_id: &str, playing: bool, current: bool) -> Candidate<'_> {
        Candidate { app_id, playing, current }
    }

    #[test]
    fn pinned_wins_even_paused() {
        let all = [c("Spotify.exe", true, true), c("Chrome", false, false)];
        assert_eq!(choose(&all, "Spotify.exe", Some("Chrome")), Some(1));
    }

    #[test]
    fn missing_pin_falls_back() {
        let all = [c("Spotify.exe", false, false), c("Chrome", true, true)];
        assert_eq!(choose(&all, "Spotify.exe", Some("VLC")), Some(1));
        assert_eq!(choose(&all, "Spotify.exe", Some("")), Some(1));
    }

    #[test]
    fn automatic_rules() {
        // Windows' current playing wins over the one shown before.
        assert_eq!(choose(&[c("A", true, false), c("B", true, true)], "A", None), Some(1));
        // Current paused: the shown one if it plays.
        assert_eq!(choose(&[c("A", true, false), c("B", false, true), c("C", true, false)], "C", None), Some(2));
        // Shown paused: any playing one.
        assert_eq!(choose(&[c("A", false, false), c("B", true, false)], "A", None), Some(1));
        // Nothing plays: the shown one stays.
        assert_eq!(choose(&[c("A", false, true), c("B", false, false)], "B", None), Some(1));
        // Nothing plays, nothing shown: Windows' current, else nothing.
        assert_eq!(choose(&[c("A", false, false), c("B", false, true)], "", None), Some(1));
        assert_eq!(choose(&[c("A", false, false)], "", None), None);
        assert_eq!(choose(&[], "A", Some("A")), None);
    }
}
