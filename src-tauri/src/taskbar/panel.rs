//! The bar's two ways to reach the notch. Its capability only listens (capabilities/taskbar.json), so its page cannot emit an
//! event to another window: `taskbar_panel` tells the notch what the bar's panel shows (`bar://panel`, with the label of the
//! bar that asks, so each monitor's bar counts on its own), and `taskbar_ask` passes on the few requests only the notch may
//! carry out, as the bridge's own action (`bridge://action`, src/lib/bridge.ts). Both are narrow on purpose: a bug in the bar's
//! page must not reach the settings window's requests (an update, a restart, the vault) through them.

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

/// What the bridge may refresh (`REFRESH` in src/lib/bridge.ts).
const REFRESH: [&str; 8] = ["usage", "github", "leetcode", "calendar", "discord", "plugins", "offline", "notices"];

/// What the bar's panel shows: "apps", a tool's id, or None once it closes.
#[tauri::command]
pub fn taskbar_panel(open: Option<String>, window: WebviewWindow) -> Result<(), String> {
    if !panel_open(open.as_deref()) {
        return Err("bad-panel".into());
    }
    window.app_handle().emit_to("notch", "bar://panel", json!({ "label": window.label(), "open": open })).map_err(|e| e.to_string())
}

/// A request of the bar's, passed on to the notch only if the bar may make it; the notch checks it again field for field.
#[tauri::command]
pub fn taskbar_ask(action: Value, app: AppHandle) -> Result<(), String> {
    let action = bar_ask(&action).ok_or("not-allowed")?;
    app.emit_to("notch", "bridge://action", action).map_err(|e| e.to_string())
}

/// None, or an id of 1 to 64 ASCII letters, digits, `-`, `_` and `:` ("apps", "media", "plugin:x").
pub(crate) fn panel_open(open: Option<&str>) -> bool {
    open.is_none_or(|id| (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"-_:".contains(&b)))
}

/// The bar's request rebuilt with its known fields alone, or None for anything else, the settings window's own requests
/// (hotkeys, the closed notch's edit, updates, a restart, the vault) included.
pub(crate) fn bar_ask(v: &Value) -> Option<Value> {
    let kind = v.get("kind")?.as_str()?;
    match kind {
        "refresh" => {
            let what = v.get("what")?.as_str().filter(|w| REFRESH.contains(w))?;
            match v.get("force") {
                None => Some(json!({ "kind": kind, "what": what })),
                Some(force) => Some(json!({ "kind": kind, "what": what, "force": force.as_bool()? })),
            }
        }
        // Null keeps the machine awake until it is turned off; `get`, since indexing would read a missing field as null too.
        "awake" => match v.get("minutes")? {
            Value::Null => Some(json!({ "kind": kind, "minutes": null })),
            m => m.as_u64().filter(|m| (1..=1440).contains(m)).map(|m| json!({ "kind": kind, "minutes": m })),
        },
        "focusMute" => Some(json!({ "kind": kind, "on": v.get("on")?.as_bool()? })),
        "noticeDelete" => {
            let id = v.get("id")?.as_str().filter(|id| (1..=128).contains(&id.chars().count()))?;
            Some(json!({ "kind": kind, "id": id }))
        }
        "presentation" | "awakeOff" | "renewClaude" | "noticesClear" | "timerSilence" => Some(json!({ "kind": kind })),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::{bar_ask, panel_open};

    #[test]
    fn the_bar_asks_only_what_it_may() {
        let kept = |v: Value| assert_eq!(bar_ask(&v), Some(v.clone()), "{v}");
        let refused = |v: Value| assert_eq!(bar_ask(&v), None, "{v}");
        kept(json!({ "kind": "refresh", "what": "github" }));
        kept(json!({ "kind": "refresh", "what": "github", "force": true }));
        refused(json!({ "kind": "refresh", "what": "evil" }));
        for minutes in [json!(1), json!(30), json!(1440), json!(null)] {
            kept(json!({ "kind": "awake", "minutes": minutes }));
        }
        for minutes in [json!(0), json!(1441), json!(2.5), json!("30")] {
            refused(json!({ "kind": "awake", "minutes": minutes }));
        }
        // Null keeps the machine awake until it is turned off: a request without the field is not one.
        refused(json!({ "kind": "awake" }));
        for kind in ["awakeOff", "renewClaude", "noticesClear", "timerSilence", "presentation"] {
            kept(json!({ "kind": kind }));
        }
        kept(json!({ "kind": "focusMute", "on": true }));
        refused(json!({ "kind": "focusMute", "on": "yes" }));
        kept(json!({ "kind": "noticeDelete", "id": "a1" }));
        kept(json!({ "kind": "noticeDelete", "id": "a".repeat(128) }));
        refused(json!({ "kind": "noticeDelete", "id": "" }));
        refused(json!({ "kind": "noticeDelete", "id": "a".repeat(129) }));
        // The settings window's own requests, each in a shape the notch would run.
        for kind in ["pauseHotkeys", "closedEdit", "checkUpdate", "installUpdate", "restart", "lockVault"] {
            refused(json!({ "kind": kind, "on": false }));
        }
        assert_eq!(bar_ask(&json!({ "kind": "timerSilence", "x": 1 })), Some(json!({ "kind": "timerSilence" })));
        refused(json!("timerSilence"));
    }

    #[test]
    fn a_panel_names_apps_or_a_tool() {
        assert!(panel_open(None) && panel_open(Some("apps")) && panel_open(Some("media")) && panel_open(Some("plugin:x_y-1")));
        assert!(panel_open(Some(&"a".repeat(64))));
        assert!(!panel_open(Some("")) && !panel_open(Some(&"a".repeat(65))) && !panel_open(Some("a b")) && !panel_open(Some("../x")));
    }
}
