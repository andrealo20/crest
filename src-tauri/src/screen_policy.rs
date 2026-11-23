// Translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck.Core/ScreenPolicy.cs and Settings.cs.
//! What the notch does while another window fills its monitor: pure rules, no Win32.
//!
//! display.rs reads the windows and asks here. A context (maximized, borderless or exclusive
//! full screen) calls for a behaviour (keep the style, switch to the line, hide); an app rule
//! for the window's executable answers first, the global rule after it.

use serde::Deserialize;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Behavior {
    #[default]
    Normal,
    Line,
    Hide,
}

impl Behavior {
    pub fn as_str(self) -> &'static str {
        match self {
            Behavior::Normal => "normal",
            Behavior::Line => "line",
            Behavior::Hide => "hide",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Context {
    Desktop,
    Maximized,
    Borderless,
    Exclusive,
}

impl Context {
    /// Covers the monitor like a game or video (gaming mode and `notch://fullscreen`).
    pub fn is_fullscreen(self) -> bool {
        matches!(self, Context::Borderless | Context::Exclusive)
    }
}

/// One app's own answers; `None` follows the global rule. Path is the executable when known.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppRule {
    pub name: String,
    pub path: String,
    pub maximized: Option<Behavior>,
    pub borderless: Option<Behavior>,
    pub exclusive: Option<Behavior>,
}

#[derive(Clone, Debug)]
pub struct Rules {
    pub maximized: Behavior,
    pub borderless: Behavior,
    pub exclusive: Behavior,
    /// A maximized or borderless window behind the foreground one counts too.
    pub background: bool,
    pub apps: Vec<AppRule>,
}

impl Default for Rules {
    fn default() -> Self {
        Rules { maximized: Behavior::Normal, borderless: Behavior::Normal, exclusive: Behavior::Normal, background: true, apps: Vec::new() }
    }
}

impl Rules {
    /// Field by field, so one bad value (or one malformed app rule, which is skipped) can't drop the rest.
    pub fn from_value(v: &serde_json::Value) -> Rules {
        let d = Rules::default();
        let behavior = |key: &str, fallback| v.get(key).and_then(|x| Behavior::deserialize(x).ok()).unwrap_or(fallback);
        Rules {
            maximized: behavior("maximized", d.maximized),
            borderless: behavior("borderless", d.borderless),
            exclusive: behavior("exclusive", d.exclusive),
            background: v.get("background").and_then(|x| x.as_bool()).unwrap_or(d.background),
            apps: v
                .get("apps")
                .and_then(|a| a.as_array())
                .map(|a| a.iter().filter_map(|x| AppRule::deserialize(x).ok()).collect())
                .unwrap_or_default(),
        }
    }

    /// Whether a window behind the foreground one could change anything: only maximized and borderless are read there.
    pub fn background_matters(&self) -> bool {
        self.background && (self.maximized != Behavior::Normal || self.borderless != Behavior::Normal || !self.apps.is_empty())
    }
}

/// For `#[serde(deserialize_with)]`: never fails, see `Rules::from_value`.
pub fn lenient_rules<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Rules, D::Error> {
    Ok(Rules::from_value(&serde_json::Value::deserialize(d)?))
}

/// The context of one window. A window without a caption across the monitor is borderless unless
/// it is maximized inside the work area and keeps its resize frame: where the work area is the
/// whole monitor (Windows' taskbar on auto-hide, or a monitor without a taskbar), a maximized app
/// that draws its own title bar covers the monitor but keeps its resize frame, while full-screen
/// modes (F11 in Firefox and Chromium) drop it. A window with a caption covering the monitor
/// without being maximized (old games) is borderless too.
pub fn classify(exclusive: bool, covers_monitor: bool, has_caption: bool, maximized: bool, within_work: bool, resizable: bool) -> Context {
    if exclusive {
        Context::Exclusive
    } else if covers_monitor && !has_caption && !(maximized && within_work && resizable) {
        Context::Borderless
    } else if maximized {
        Context::Maximized
    } else if covers_monitor {
        Context::Borderless
    } else {
        Context::Desktop
    }
}

/// A rectangle in physical pixels: left, top, right, bottom.
pub type Edges = (i32, i32, i32, i32);

/// A window that is not maximized but whose top edge reaches into the notch's band, the `band` pixels below the top of the
/// monitor `m`, while it overlaps the notch's window `notch` along that edge (snapped to a half or a quarter, or dragged
/// to the top): the notch would cover its title bar, so it follows the maximized rule. Only a notch on the top edge of
/// this monitor counts. The notch's window keeps one size whether the notch is closed, the line or open, so the answer
/// does not change with the look it calls for.
pub fn under_notch(frame: Edges, notch: Edges, m: Edges, band: i32) -> bool {
    let on_top_edge = notch.1 >= m.1 - 2 && notch.1 <= m.1 + 2 && notch.0 >= m.0 - 2 && notch.2 <= m.2 + 2;
    on_top_edge && frame.1 < m.1 + band && frame.3 > m.1 + band && frame.0 < notch.2 && frame.2 > notch.0
}

/// Process names compare without ".exe", so a rule may be saved either way.
pub fn normalize_name(name: &str) -> String {
    let lower = name.trim().to_lowercase();
    lower.strip_suffix(".exe").unwrap_or(&lower).trim().to_string()
}

pub fn normalize_path(path: &str) -> String {
    path.trim().replace('/', "\\").to_lowercase()
}

/// A rule matches by path, or by name (so it still works when the path can't be read, e.g. an elevated process).
pub fn matches(rule: &AppRule, name: &str, path: &str) -> bool {
    let (rp, wp) = (normalize_path(&rule.path), normalize_path(path));
    if !rp.is_empty() && rp == wp {
        return true;
    }
    let rn = normalize_name(&rule.name);
    !rn.is_empty() && rn == normalize_name(name)
}

/// The behaviour a context calls for, for the window of app (name, path).
pub fn resolve(rules: &Rules, context: Context, name: &str, path: &str) -> Behavior {
    if let Some(rule) = rules.apps.iter().find(|r| matches(r, name, path)) {
        let own = match context {
            Context::Maximized => rule.maximized,
            Context::Borderless => rule.borderless,
            Context::Exclusive => rule.exclusive,
            Context::Desktop => None,
        };
        if let Some(b) = own {
            return b;
        }
    }
    match context {
        Context::Maximized => rules.maximized,
        Context::Borderless => rules.borderless,
        Context::Exclusive => rules.exclusive,
        Context::Desktop => Behavior::Normal,
    }
}

/// What a whole reading calls for: the foreground window, else (when the rules ask) the one
/// behind it that fills the monitor. Gaming mode keeps full screen visible so FPS can show.
pub fn decide(rules: &Rules, foreground: (Context, &str, &str), background: Option<(Context, &str, &str)>, gaming: bool) -> Behavior {
    let (context, name, path) = match (foreground.0, background) {
        (Context::Desktop, Some(bg)) if rules.background => bg,
        _ => foreground,
    };
    if gaming && context.is_fullscreen() {
        return Behavior::Normal;
    }
    resolve(rules, context, name, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> Rules {
        Rules { maximized: Behavior::Line, borderless: Behavior::Hide, exclusive: Behavior::Hide, background: true, apps: vec![] }
    }

    #[test]
    fn classifies_the_four_contexts() {
        assert_eq!(classify(true, false, true, false, false, false), Context::Exclusive);
        assert_eq!(classify(false, true, false, true, false, false), Context::Borderless);
        assert_eq!(classify(false, false, true, true, false, false), Context::Maximized);
        assert_eq!(classify(false, true, true, false, false, false), Context::Borderless);
        assert_eq!(classify(false, false, true, false, false, false), Context::Desktop);
    }

    #[test]
    fn a_maximized_window_inside_the_work_area_is_not_full_screen() {
        use Context::*;
        assert_eq!(classify(false, true, false, true, true, true), Maximized); // auto-hide taskbar, maximized app that draws its own title bar
        assert_eq!(classify(false, true, false, true, false, true), Borderless); // maximized over a reserved taskbar band
        assert_eq!(classify(false, true, false, false, true, false), Borderless); // F11 in Chromium, borderless game
        assert_eq!(classify(false, true, false, true, true, false), Borderless); // full screen entered from a maximized window (Firefox F11)
        assert_eq!(classify(true, true, false, true, true, true), Exclusive);
    }

    #[test]
    fn a_window_under_the_notch_follows_the_maximized_rule() {
        // A 2560 x 1080 monitor, the notch's window 760 px wide in the middle of the top edge, a 40 px band.
        let m = (0, 0, 2560, 1080);
        let notch = (900, 0, 1660, 560);
        assert!(under_notch((0, 0, 1280, 1032), notch, m, 40)); // snapped to the left half
        assert!(under_notch((1280, 0, 2560, 1032), notch, m, 40)); // the right half
        assert!(under_notch((1000, 20, 1500, 700), notch, m, 40)); // dragged up under the notch
        assert!(!under_notch((0, 0, 800, 1032), notch, m, 40)); // beside the notch
        assert!(!under_notch((1000, 120, 1500, 700), notch, m, 40)); // below the notch's band
        assert!(!under_notch((1000, 0, 1500, 30), notch, m, 40)); // a strip that ends inside the band
        // A notch on another edge or another monitor never counts.
        assert!(!under_notch((0, 0, 1280, 1032), (900, 520, 1660, 1080), m, 40));
        assert!(!under_notch((0, 0, 1280, 1032), (3460, 0, 4220, 560), m, 40));
        // A second monitor below the first: a window at the top of the lower one is not under the notch above it.
        let below = (0, 1080, 2560, 2160);
        assert!(!under_notch((0, 1080, 1280, 2112), notch, below, 40));
    }

    #[test]
    fn names_compare_without_exe_and_case() {
        assert_eq!(normalize_name(" Game.EXE "), "game");
        assert_eq!(normalize_name("game"), "game");
        assert_eq!(normalize_name(".exe"), "");
        let rule = AppRule { name: "vlc.exe".into(), ..Default::default() };
        assert!(matches(&rule, "VLC", ""));
        assert!(!matches(&rule, "vlc2", ""));
    }

    #[test]
    fn paths_match_across_slashes_and_case() {
        let rule = AppRule { name: "x".into(), path: "C:/Games/Foo.exe".into(), ..Default::default() };
        assert!(matches(&rule, "other", "c:\\games\\foo.exe"));
        // An empty rule never matches everything.
        assert!(!matches(&AppRule::default(), "", ""));
    }

    #[test]
    fn app_rules_answer_first_and_follow_otherwise() {
        let mut r = rules();
        r.apps.push(AppRule { name: "mpv".into(), borderless: Some(Behavior::Normal), ..Default::default() });
        assert_eq!(resolve(&r, Context::Borderless, "mpv.exe", ""), Behavior::Normal);
        // Follow (None) for maximized takes the global rule.
        assert_eq!(resolve(&r, Context::Maximized, "mpv.exe", ""), Behavior::Line);
        assert_eq!(resolve(&r, Context::Borderless, "chrome", ""), Behavior::Hide);
        assert_eq!(resolve(&r, Context::Desktop, "mpv", ""), Behavior::Normal);
    }

    #[test]
    fn the_window_behind_counts_only_when_asked() {
        let mut r = rules();
        let fg = (Context::Desktop, "explorer", "");
        let bg = Some((Context::Maximized, "chrome", ""));
        assert_eq!(decide(&r, fg, bg, false), Behavior::Line);
        r.background = false;
        assert_eq!(decide(&r, fg, bg, false), Behavior::Normal);
        // A foreground context wins over the background.
        r.background = true;
        assert_eq!(decide(&r, (Context::Exclusive, "game", ""), bg, false), Behavior::Hide);
    }

    #[test]
    fn malformed_rules_keep_what_is_valid() {
        let v = serde_json::json!({
            "maximized": "line", "borderless": 7, "background": "yes",
            "apps": [{ "name": "mpv", "borderless": "hide" }, { "name": "bad", "maximized": "bogus" }, 3]
        });
        let r = Rules::from_value(&v);
        assert_eq!(r.maximized, Behavior::Line);
        assert_eq!(r.borderless, Behavior::Normal);
        assert!(r.background);
        assert_eq!(r.apps.len(), 1);
        assert_eq!(r.apps[0].borderless, Some(Behavior::Hide));
        assert_eq!(Rules::from_value(&serde_json::json!(null)).apps.len(), 0);
    }

    #[test]
    fn the_background_scan_runs_only_when_it_can_matter() {
        let mut r = Rules::default();
        assert!(!r.background_matters());
        r.exclusive = Behavior::Hide;
        assert!(!r.background_matters());
        r.maximized = Behavior::Line;
        assert!(r.background_matters());
        r.background = false;
        assert!(!r.background_matters());
        let r = Rules { apps: vec![AppRule { name: "x".into(), ..Default::default() }], ..Rules::default() };
        assert!(r.background_matters());
    }

    #[test]
    fn gaming_keeps_full_screen_visible() {
        let r = rules();
        assert_eq!(decide(&r, (Context::Borderless, "game", ""), None, true), Behavior::Normal);
        assert_eq!(decide(&r, (Context::Exclusive, "game", ""), None, true), Behavior::Normal);
        assert_eq!(decide(&r, (Context::Maximized, "word", ""), None, true), Behavior::Line);
    }
}
