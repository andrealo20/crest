//! The anonymous daily count behind crestisland.app/stats: one POST with this build's version, platform and channel, nothing
//! else. The interface decides when (src/lib/dailyCount.ts: at most once per UTC day, only while Settings, General, Updates,
//! Count this install allows it); the address and the body are fixed here, so it cannot send anything else.

use std::time::Duration;

const URL: &str = "https://crestisland.app/api/ping";

/// "1.3.3" from "1.3.3-beta.1": the Worker takes plain versions only.
fn version() -> &'static str {
    let v = env!("CARGO_PKG_VERSION");
    v.split(['-', '+']).next().unwrap_or(v)
}

/// "store" for the Microsoft Store build, "portable" for the portable zip, "github" for the installer and every Mac build.
fn channel() -> &'static str {
    if cfg!(feature = "store") {
        "store"
    } else if crate::portable::is_portable() {
        "portable"
    } else {
        "github"
    }
}

fn body() -> serde_json::Value {
    let platform = if cfg!(target_os = "macos") { "macos" } else { "windows" };
    serde_json::json!({ "version": version(), "platform": platform, "channel": channel() })
}

/// True only on a counted ping (204). Any other answer or a network error is false, and the interface tries again at its next
/// hourly check. A debug build never sends.
#[tauri::command]
pub async fn daily_count() -> bool {
    if cfg!(debug_assertions) {
        return false;
    }
    let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent("Crest").build() else { return false };
    client.post(URL).json(&body()).send().await.is_ok_and(|r| r.status() == reqwest::StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_body_holds_only_version_platform_and_channel() {
        let b = body();
        let mut keys: Vec<&String> = b.as_object().unwrap().keys().collect();
        keys.sort();
        assert_eq!(keys, ["channel", "platform", "version"]);
        assert!(b["version"].as_str().unwrap().split('.').all(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit())));
        assert!(["windows", "macos"].contains(&b["platform"].as_str().unwrap()));
        assert!(["store", "portable", "github"].contains(&b["channel"].as_str().unwrap()));
    }
}
