//! AI usage: plan limits of locally signed-in AI tools (like OmniNotch).
//! Only reads what the tools already stored on this PC. Tokens are never written
//! back or shared.
//!
//! - Claude (Claude Code): `api.anthropic.com/api/oauth/usage` with the OAuth token from
//!   `~/.claude/.credentials.json`, or, once that has expired, with the Claude desktop app's own sign-in (Windows),
//!   which the app renews while in use. Neither is ever renewed here. Strictly rate-limited → 5 min cache, pause after 429
//!   (Retry-After, at least 30 s; 2 min growing to 30 without one). The last good result is kept
//!   on disk so a restart doesn't query right away and never shows an empty error.
//! - ChatGPT (Codex CLI): live `chatgpt.com/backend-api/wham/usage` with `~/.codex/auth.json`,
//!   fallback: last `rate_limits` entry in `~/.codex/sessions/**.jsonl`.
//! - Antigravity (`agy` CLI): asks the CLI itself (`agy -p /usage --output-format json`,
//!   tested with agy 1.3.3), so its login is never read here. Starting the CLI takes a
//!   few seconds → 5 min cache.
//! - Cursor: monthly requests via `cursor.com/api/usage` with the Cursor app's login.
//! - OpenRouter, DeepSeek, Z.ai: credits, balance and coding-plan limits with an API key the
//!   user saved in Credential Manager (see secrets.rs).
//!
//! Every provider shares one rule for 429 answers (usage_backoff.rs) and keeps its last good
//! reading on any error. Token counts and cost from the local logs: usage_logs.rs.

#[path = "usage_backoff.rs"]
mod backoff;
#[path = "usage_logs.rs"]
mod logs;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, State};

use crate::now_ms;

/// Minimum interval between real queries per provider.
fn cache_for(id: &str) -> Duration {
    match id {
        "claude" | "gemini" => Duration::from_secs(5 * 60),
        _ => Duration::from_secs(2 * 60),
    }
}
/// agy answers in about 6 s; after this it is killed.
const AGY_TIMEOUT: Duration = Duration::from_secs(40);
const PROVIDERS: &[&str] = &["claude", "codex", "gemini", "cursor", "openrouter", "deepseek", "zai"];

#[derive(Default)]
pub struct UsageState {
    /// Last result per provider + earliest time (Unix ms) of the next real query.
    cache: Mutex<HashMap<String, (u64, Provider)>>,
    loaded: Mutex<bool>,
    /// 429 pause per provider.
    backoff: Mutex<HashMap<String, backoff::Backoff>>,
    /// One real query at a time per provider: a second call waits and then finds the cache filled.
    inflight: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    /// Parsed session logs (only filled once the AI usage tool asked for tokens).
    logs: Mutex<logs::Cache>,
    /// Hash of the API key each key source was last asked with (memory only, never logged).
    keys: Mutex<HashMap<String, u64>>,
}

/// Credential Manager entry of the API-key sources.
fn key_name(id: &str) -> Option<&'static str> {
    match id {
        "openrouter" => Some("ai.openrouter"),
        "deepseek" => Some("usage.deepseek"),
        "zai" => Some("usage.zai"),
        "claude" => Some(CLAUDE_WEB_KEY),
        _ => None,
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provider {
    id: String,
    plan: Option<String>,
    windows: Vec<Window>,
    /// Money figures (credits, balances, spend) for API-key providers.
    #[serde(default)]
    balances: Vec<Balance>,
    /// Error code for the frontend (translated there): not-found, not-signed-in, expired,
    /// no-key, bad-key, rate-limited, offline, failed. With data present, the data is stale.
    error: Option<String>,
    /// Unix ms when the data was produced.
    updated_at: u64,
    /// Unix ms of the next try while a 429 pause runs.
    #[serde(default)]
    retry_at: Option<u64>,
}

impl Provider {
    fn new(id: &str) -> Self {
        Provider { id: id.into(), plan: None, windows: vec![], balances: vec![], error: None, updated_at: now_ms(), retry_at: None }
    }
    fn has_data(&self) -> bool {
        !self.windows.is_empty() || !self.balances.is_empty()
    }
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    /// account | key | budget | granted | today | month (translated in the frontend).
    kind: String,
    amount: f64,
    /// The cap the amount is part of (a key limit), if any.
    total: Option<f64>,
    currency: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Window {
    /// session | weekly | weekly-opus | weekly-sonnet | daily | monthly | model:<Name>
    kind: String,
    used_percent: f64,
    /// Unix ms; None if unknown.
    resets_at: Option<u64>,
    /// Window length in seconds (for the "on track" marker).
    window_secs: Option<u64>,
}

#[tauri::command]
pub async fn usage_fetch(providers: Vec<String>, app: AppHandle, state: State<'_, UsageState>) -> Result<Vec<Provider>, String> {
    load_disk_cache(&app, &state);
    // Side by side, so a slow provider (the agy CLI) does not hold the others back.
    let tasks: Vec<_> = providers
        .into_iter()
        .filter(|id| PROVIDERS.contains(&id.as_str()))
        .map(|id| {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { usage_one(&id, &app.state::<UsageState>()).await })
        })
        .collect();
    let mut out = Vec::new();
    // The cache file is written only when a stored entry changed, not on every poll answered from memory.
    let mut changed = false;
    for task in tasks {
        if let Ok((provider, stored)) = task.await {
            out.push(provider);
            changed |= stored;
        }
    }
    if changed {
        save_disk_cache(&app, &state);
    }
    Ok(out)
}

/// One provider's answer, and whether a stored entry changed.
async fn usage_one(id: &str, state: &UsageState) -> (Provider, bool) {
    let gate = state.inflight.lock().unwrap().entry(id.to_string()).or_default().clone();
    let _running = gate.lock().await;
    let id = id.to_string();
    let cached = state.cache.lock().unwrap().get(&id).cloned();
    // A key saved or removed since the last answer: ask again now, whatever the cache or a pause says.
    let key_now = key_name(&id).map(|name| logs::fnv(crate::secrets::read(name).unwrap_or_default().as_bytes()));
    let key_changed = key_now.is_some() && state.keys.lock().unwrap().get(&id).is_some_and(|old| Some(*old) != key_now);
    if key_changed {
        state.backoff.lock().unwrap().remove(&id);
    }
    let paused = state.backoff.lock().unwrap().get_mut(&id).and_then(|b| b.retry_at(now_ms()));
    if let Some((next_at, p)) = cached.as_ref().filter(|_| !key_changed) {
        if paused.is_some() || now_ms() < *next_at {
            return (p.clone(), false);
        }
    }
    let result = match id.as_str() {
        "claude" => fetch_claude().await,
        "codex" => fetch_codex().await,
        "gemini" => fetch_gemini().await,
        "cursor" => fetch_cursor().await,
        "openrouter" => fetch_openrouter().await,
        "deepseek" => fetch_deepseek().await,
        _ => fetch_zai().await,
    };
    let now = now_ms();
    // A 429 starts or grows the pause; any other answer ends it.
    let retry_at = {
        let mut all = state.backoff.lock().unwrap();
        let b = all.entry(id.clone()).or_default();
        match &result {
            Err(Fail { code, retry_after, .. }) if code == "rate-limited" => Some(b.fail(now, *retry_after, jitter())),
            _ => {
                b.reset();
                None
            }
        }
    };
    let mut provider = match (result, cached) {
        (Ok(p), _) => p,
        // Error → keep the last good result, just note the error.
        (Err(e), Some((_, mut old))) if old.has_data() => {
            old.error = Some(e.code);
            old
        }
        // Nothing kept: what the failed provider could still show.
        (Err(Fail { code, data: Some(p), .. }), _) => Provider { error: Some(code), ..*p },
        (Err(e), _) => Provider { error: Some(e.code), ..Provider::new(&id) },
    };
    provider.retry_at = retry_at;
    if let Some(k) = key_now {
        state.keys.lock().unwrap().insert(id.clone(), k);
    }
    // A missing key costs no request to check, so it is asked again on the next poll.
    let next_at = if provider.error.as_deref() == Some("no-key") { now } else { retry_at.unwrap_or(0).max(now + cache_for(&id).as_millis() as u64) };
    state.cache.lock().unwrap().insert(id, (next_at, provider.clone()));
    // Only entries with data are stored. "no-key" is asked again on every poll without a request, so it leaves the file as it is.
    let stored = provider.has_data() && provider.error.as_deref() != Some("no-key");
    (provider, stored)
}

/// Token counts per model from the local Claude Code and Codex logs (last 31 days).
#[tauri::command]
pub async fn usage_tokens(app: AppHandle) -> Result<logs::TokenReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<UsageState>();
        let mut cache = state.logs.lock().unwrap();
        let disk = crate::portable::app_data_dir(&app).ok().filter(|d| std::fs::create_dir_all(d).is_ok()).map(|d| d.join("usage-logs.json"));
        logs::report(&mut cache, disk.as_deref())
    })
    .await
    .map_err(|e| e.to_string())
}

struct Fail {
    code: String,
    /// What the server's Retry-After said, in ms (after a 429).
    retry_after: Option<u64>,
    /// What can still be shown while this failure stands (the Codex session files after a 429).
    data: Option<Box<Provider>>,
}

impl Fail {
    fn new(code: &str) -> Self {
        Self { code: code.into(), retry_after: None, data: None }
    }
}

/// 0..1 for the backoff's spread, from the clock (no random crate needed for this).
fn jitter() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.subsec_nanos() % 1000).unwrap_or(0) as f64 / 1000.0
}

impl From<&str> for Fail {
    fn from(code: &str) -> Self {
        Fail::new(code)
    }
}

fn client() -> Result<reqwest::Client, Fail> {
    reqwest::Client::builder().timeout(Duration::from_secs(10)).build().map_err(|_| Fail::new("failed"))
}

/// Maps HTTP status to error codes; a 429 carries its Retry-After for the backoff.
fn check(res: &reqwest::Response) -> Result<(), Fail> {
    match res.status().as_u16() {
        200 => Ok(()),
        401 | 403 => Err(Fail::new("expired")),
        429 => {
            let retry_after = res.headers().get("retry-after").and_then(|v| v.to_str().ok()).and_then(|v| parse_retry_after(v, now_ms()));
            Err(Fail { code: "rate-limited".into(), retry_after, data: None })
        }
        _ => Err(Fail::new("failed")),
    }
}

/// For API-key providers a refused key is the key's fault, not an expired sign-in.
fn check_key(res: &reqwest::Response) -> Result<(), Fail> {
    check(res).map_err(|e| if e.code == "expired" { Fail::new("bad-key") } else { e })
}

/// Retry-After as seconds or as an HTTP date ("Wed, 21 Oct 2026 07:28:00 GMT") → ms from now.
fn parse_retry_after(value: &str, now: u64) -> Option<u64> {
    let value = value.trim();
    if let Ok(secs) = value.parse::<u64>() {
        return Some(secs.saturating_mul(1000));
    }
    let mut p = value.split_whitespace().skip(1);
    let (day, month, year, time) = (p.next()?, p.next()?, p.next()?, p.next()?);
    let month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].iter().position(|m| *m == month)? + 1;
    let at = parse_iso_ms(&format!("{year}-{month:02}-{day:0>2}T{time}Z"))?;
    Some(at.saturating_sub(now))
}

// ---------- Claude ----------

async fn fetch_claude_cli() -> Result<Provider, Fail> {
    let creds = read_json(&claude_dir().join(".credentials.json")).or_else(claude_keychain).ok_or("not-found")?;
    let oauth = &creds["claudeAiOauth"];
    let token = oauth["accessToken"].as_str().ok_or("not-signed-in")?;
    // The file is refreshed only by the Claude Code CLI; the desktop app keeps its own sign-in (fetch_claude tries it next).
    if oauth["expiresAt"].as_u64().is_some_and(|exp| exp < now_ms()) {
        return Err("claude-expired".into());
    }
    claude_oauth_usage(token, oauth["subscriptionType"].as_str().map(capitalize)).await
}

/// The plan limits for an OAuth token of Claude Code or of the desktop app (the same endpoint takes both).
async fn claude_oauth_usage(token: &str, plan: Option<String>) -> Result<Provider, Fail> {
    let res = client()?
        .get("https://api.anthropic.com/api/oauth/usage")
        .bearer_auth(token)
        .header("anthropic-beta", "oauth-2025-04-20")
        .send()
        .await
        .map_err(|_| Fail::new("offline"))?;
    check(&res).map_err(|e| if e.code == "expired" { Fail::new("claude-expired") } else { e })?;
    let body: Value = res.json().await.map_err(|_| Fail::new("failed"))?;
    Ok(Provider { plan, windows: claude_windows(&body), ..Provider::new("claude") })
}

/// Claude's limit windows, the same fields from the CLI's endpoint and from claude.ai's own.
fn claude_windows(body: &Value) -> Vec<Window> {
    [("five_hour", "session", 5 * 3600), ("seven_day", "weekly", 7 * 86_400), ("seven_day_opus", "weekly-opus", 7 * 86_400), ("seven_day_sonnet", "weekly-sonnet", 7 * 86_400)]
        .iter()
        .filter_map(|(field, kind, secs)| {
            let w = body.get(*field)?;
            Some(Window {
                kind: kind.to_string(),
                used_percent: w.get("utilization")?.as_f64()?,
                resets_at: w.get("resets_at").and_then(Value::as_str).and_then(parse_iso_ms),
                window_secs: Some(*secs),
            })
        })
        .collect()
}

/// Where the claude.ai session key pasted in Settings lives (Credential Manager or Keychain).
const CLAUDE_WEB_KEY: &str = "usage.claude-web";

/// The CLI's sign-in first. Without a valid one, the desktop app's (Windows), which the app renews by itself while in
/// use, then the claude.ai session key from Settings. No sign-in is ever renewed or written here: a renewal would spend a
/// refresh token the CLI or the app still holds and sign it out.
async fn fetch_claude() -> Result<Provider, Fail> {
    match fetch_claude_cli().await {
        Err(e) if matches!(e.code.as_str(), "not-found" | "not-signed-in" | "claude-expired") => {
            if let Some((token, plan)) = claude_desktop_token() {
                match claude_oauth_usage(&token, plan).await {
                    Err(d) if d.code == "claude-expired" => {}
                    other => return other,
                }
            }
            match crate::secrets::read(CLAUDE_WEB_KEY) {
                Some(key) if !key.trim().is_empty() => fetch_claude_web(key.trim()).await,
                _ => Err(e),
            }
        }
        other => other,
    }
}

/// The Claude desktop app's sign-in: `oauth:tokenCacheV2` in its config.json, sealed with the key in its Local State
/// (wrapped with DPAPI for this user, as every Electron app on Windows does). Read only, the newest profile first.
#[cfg(windows)]
fn claude_desktop_token() -> Option<(String, Option<String>)> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let unprotect = |data: &[u8]| -> Option<Vec<u8>> {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB::default();
        unsafe {
            CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out).ok()?;
            let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
            let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
            Some(bytes)
        }
    };
    let b64 = base64::engine::general_purpose::STANDARD;
    let now = now_ms();
    claude_desktop_profiles().iter().find_map(|dir| {
        let config = read_json(&dir.join("config.json"))?;
        // V2 is the one the app keeps current, cleared entries after a sign-out included.
        let sealed = config.get("oauth:tokenCacheV2").or_else(|| config.get("oauth:tokenCache"))?.as_str()?;
        let state = read_json(&dir.join("Local State"))?;
        let wrapped = b64.decode(state["os_crypt"]["encrypted_key"].as_str()?).ok()?;
        let key = unprotect(wrapped.strip_prefix(b"DPAPI")?)?;
        let cache = serde_json::from_slice(&open_chromium_secret(&key, &b64.decode(sealed).ok()?)?).ok()?;
        desktop_token(&cache, config["lastKnownAccountUuid"].as_str().unwrap_or(""), now)
    })
}

/// The Mac app seals its sign-in with a Keychain key ("Claude Safe Storage"); reading that asks the user, so it isn't.
#[cfg(not(windows))]
fn claude_desktop_token() -> Option<(String, Option<String>)> {
    None
}

/// Where the desktop app keeps its profile: the classic install, the Store package, and the newer Claude-Data folders.
#[cfg(windows)]
fn claude_desktop_profiles() -> Vec<PathBuf> {
    let env = |v: &str| std::env::var_os(v).map(PathBuf::from).unwrap_or_default();
    let (roaming, local) = (env("APPDATA"), env("LOCALAPPDATA"));
    let subdirs = |dir: PathBuf| std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect::<Vec<_>>()).unwrap_or_default();
    let mut dirs = vec![roaming.join("Claude")];
    for package in subdirs(local.join("Packages")) {
        let name = package.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        if name.starts_with("claude_") || name.starts_with("anthropicpbc.claude_") {
            dirs.push(package.join("LocalCache").join("Roaming").join("Claude"));
        }
    }
    dirs.extend(subdirs(local.join("Claude-Data")));
    let modified = |d: &PathBuf| std::fs::metadata(d.join("config.json")).and_then(|m| m.modified()).ok();
    dirs.retain(|d| modified(d).is_some());
    dirs.sort_by_key(|d| std::cmp::Reverse(modified(d)));
    dirs
}

/// Chromium's os_crypt value: "v10", a 12-byte nonce, then the AES-256-GCM ciphertext with its 16-byte tag.
#[cfg_attr(not(windows), allow(dead_code))]
fn open_chromium_secret(key: &[u8], sealed: &[u8]) -> Option<Vec<u8>> {
    use aes_gcm::aead::{Aead, KeyInit};
    let rest = sealed.strip_prefix(b"v10").filter(|r| r.len() >= 12 + 16)?;
    aes_gcm::Aes256Gcm::new_from_slice(key).ok()?.decrypt(aes_gcm::Nonce::from_slice(&rest[..12]), &rest[12..]).ok()
}

/// From the desktop app's token cache, a valid token for api.anthropic.com that can read the profile (the usage endpoint
/// needs `user:profile`), of the account signed in now, and its plan. With several, the one with the fewest scopes.
/// Keys look like "acct:<account>|<client>:<organization>:https://api.anthropic.com:<scopes>".
#[cfg_attr(not(windows), allow(dead_code))]
fn desktop_token(cache: &Value, account: &str, now: u64) -> Option<(String, Option<String>)> {
    const HOST: &str = ":https://api.anthropic.com:";
    cache
        .as_object()?
        .iter()
        .filter(|(name, _)| !name.starts_with("acct:") || (!account.is_empty() && name.starts_with(&format!("acct:{account}|"))))
        .filter_map(|(name, v)| {
            let scopes = name.split_once(HOST)?.1.split_whitespace().collect::<Vec<_>>();
            let token = v["token"].as_str().filter(|t| !t.is_empty())?;
            (scopes.contains(&"user:profile") && v["expiresAt"].as_f64()? > now as f64).then(|| (scopes.len(), token, v["subscriptionType"].as_str()))
        })
        .min_by_key(|(n, ..)| *n)
        .map(|(_, token, plan)| (token.to_string(), plan.map(capitalize)))
}

/// claude.ai's own usage page with the session key: the organizations, then the usage of the one with a chat plan.
/// Not a documented API, so it may change; a rejected key reads as "bad-key" and points to Settings.
async fn fetch_claude_web(key: &str) -> Result<Provider, Fail> {
    let client = client()?;
    let get = |url: String| {
        client
            .get(url)
            .header("Cookie", format!("sessionKey={key}"))
            .header("Accept", "application/json")
            // claude.ai turns away requests without a browser's User-Agent.
            .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .send()
    };
    let res = get("https://claude.ai/api/organizations".into()).await.map_err(|_| Fail::new("offline"))?;
    check_key(&res)?;
    let orgs: Value = res.json().await.map_err(|_| Fail::new("failed"))?;
    let org = claude_org(&orgs).ok_or("failed")?;
    let uuid = org["uuid"].as_str().ok_or("failed")?;
    let res = get(format!("https://claude.ai/api/organizations/{uuid}/usage")).await.map_err(|_| Fail::new("offline"))?;
    check_key(&res)?;
    let body: Value = res.json().await.map_err(|_| Fail::new("failed"))?;
    let windows = claude_windows(&body);
    if windows.is_empty() {
        return Err("failed".into());
    }
    Ok(Provider { plan: claude_web_plan(org), windows, ..Provider::new("claude") })
}

/// The organization with a chat plan (a personal account has exactly one), else the first.
fn claude_org(orgs: &Value) -> Option<&Value> {
    let all = orgs.as_array()?;
    let chat = |o: &&Value| o["capabilities"].as_array().is_some_and(|c| c.iter().any(|x| x == "chat"));
    all.iter().find(chat).or(all.first())
}

/// "Max" or "Pro" from the organization's capabilities, as the plan badge.
fn claude_web_plan(org: &Value) -> Option<String> {
    let caps = org["capabilities"].as_array()?;
    let has = |name: &str| caps.iter().any(|c| c == name);
    if has("claude_max") {
        Some("Max".into())
    } else if has("claude_pro") {
        Some("Pro".into())
    } else {
        None
    }
}

// ---------- ChatGPT (Codex) ----------

async fn fetch_codex() -> Result<Provider, Fail> {
    match fetch_codex_live().await {
        Ok(p) => Ok(p),
        // A 429 must still start the pause, so the session files only ride along as what to show meanwhile.
        Err(mut live) if live.code == "rate-limited" => {
            live.data = codex_from_sessions().map(Box::new);
            Err(live)
        }
        // Live failed (old CLI, offline) → last state from the session files.
        Err(live) => codex_from_sessions().ok_or(live),
    }
}

async fn fetch_codex_live() -> Result<Provider, Fail> {
    let auth = read_json(&codex_dir().join("auth.json")).ok_or("not-found")?;
    let tokens = &auth["tokens"];
    let token = tokens["access_token"].as_str().ok_or("not-signed-in")?;
    let mut req = client()?.get("https://chatgpt.com/backend-api/wham/usage").bearer_auth(token).header("User-Agent", "codex_cli_rs");
    if let Some(account) = tokens["account_id"].as_str() {
        req = req.header("chatgpt-account-id", account);
    }
    let res = req.send().await.map_err(|_| Fail::new("offline"))?;
    check(&res)?;
    let body: Value = res.json().await.map_err(|_| Fail::new("failed"))?;
    let limits = &body["rate_limit"];
    let windows: Vec<Window> = ["primary_window", "secondary_window"]
        .iter()
        .filter_map(|k| {
            let w = &limits[*k];
            let used = w["used_percent"].as_f64()?;
            let secs = w["limit_window_seconds"].as_u64();
            let resets_at = w["reset_at"].as_u64().map(|s| s * 1000).or_else(|| w["reset_after_seconds"].as_u64().map(|s| now_ms() + s * 1000));
            Some(Window { kind: window_kind(secs.unwrap_or(0) / 60).into(), used_percent: used, resets_at, window_secs: secs })
        })
        .collect();
    if windows.is_empty() {
        return Err("failed".into());
    }
    Ok(Provider { plan: body["plan_type"].as_str().map(capitalize), windows, ..Provider::new("codex") })
}

/// Codex writes its limits with every turn, so they are near the end; the sessions themselves grow to 100 MB.
const SESSION_TAIL_BYTES: u64 = 2 * 1024 * 1024;

/// The last `max` bytes of a file as text, starting at a whole line.
fn read_tail(path: &std::path::Path, max: u64) -> Option<String> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(path).ok()?;
    let len = file.metadata().ok()?.len();
    let start = len.saturating_sub(max);
    file.seek(SeekFrom::Start(start)).ok()?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes).ok()?;
    let text = String::from_utf8_lossy(&bytes);
    // Cut mid-file: the first line is a piece of one.
    Some(if start == 0 { text.into_owned() } else { text.split_once('\n').map_or("", |(_, rest)| rest).to_string() })
}

fn codex_from_sessions() -> Option<Provider> {
    let sessions = codex_dir().join("sessions");
    // Newest first by file name (contains the timestamp); mtime is unreliable
    // because Codex rewrites old files when resuming.
    for file in newest_files(&sessions, 15) {
        let Some(text) = read_tail(&file, SESSION_TAIL_BYTES) else { continue };
        for line in text.lines().rev() {
            if !line.contains("\"rate_limits\":{") {
                continue;
            }
            let Ok(event) = serde_json::from_str::<Value>(line) else { continue };
            let limits = &event["payload"]["rate_limits"];
            if !limits.is_object() {
                continue;
            }
            let plan = event["payload"]["plan_type"].as_str().or(limits["plan_type"].as_str()).map(capitalize);
            let windows: Vec<Window> = ["primary", "secondary"].iter().filter_map(|k| codex_window(&limits[*k])).collect();
            if windows.is_empty() {
                continue;
            }
            let updated_at = event["timestamp"].as_str().and_then(parse_iso_ms).unwrap_or_else(now_ms);
            return Some(Provider { plan, windows, updated_at, ..Provider::new("codex") });
        }
    }
    None
}

fn codex_window(w: &Value) -> Option<Window> {
    let minutes = w.get("window_minutes")?.as_u64()?;
    let mut used = w.get("used_percent")?.as_f64()?;
    let resets_at = w.get("resets_at").and_then(Value::as_u64).map(|s| s * 1000);
    // Window has expired since → back to 0.
    if resets_at.is_some_and(|r| r < now_ms()) {
        used = 0.0;
    }
    Some(Window { kind: window_kind(minutes).into(), used_percent: used, resets_at, window_secs: Some(minutes * 60) })
}

fn window_kind(minutes: u64) -> &'static str {
    match minutes {
        0..=360 => "session",
        361..=1440 => "daily",
        1441..=11_520 => "weekly",
        _ => "monthly",
    }
}

// ---------- Antigravity ----------

/// The running Antigravity app first: it answers at once, and many people have the app but not the `agy` CLI.
/// The CLI is the fallback when the app is closed.
async fn fetch_gemini() -> Result<Provider, Fail> {
    if let Some(app) = tauri::async_runtime::spawn_blocking(antigravity_app).await.ok().flatten() {
        if let Ok(provider) = fetch_antigravity_app(&app).await {
            return Ok(provider);
        }
    }
    let stdout = tauri::async_runtime::spawn_blocking(run_agy).await.map_err(|_| Fail::new("failed"))??;
    Ok(Provider { windows: parse_agy_usage(&stdout)?, ..Provider::new("gemini") })
}

/// Where the running Antigravity app's language server answers: the HTTP port it logs when it starts and the CSRF
/// token it was started with. It is the app's own local API (the editor talks to it the same way), so nothing leaves
/// the computer, and the token is only ever sent back to that port.
struct AntigravityApp {
    port: u16,
    token: String,
}

fn antigravity_app() -> Option<AntigravityApp> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet).with_cmd(UpdateKind::OnlyIfNotSet));
    let token = sys
        .processes()
        .values()
        .filter(|p| p.name().to_string_lossy().starts_with("language_server"))
        .filter(|p| p.exe().is_some_and(|e| e.to_string_lossy().to_lowercase().contains("antigravity")))
        .find_map(|p| csrf_token(p.cmd()))?;
    let log = app_data()?.join("Antigravity").join("logs").join("language_server.log");
    let port = read_tail(&log, 64 * 1024).and_then(|text| logged_http_port(&text))?;
    Some(AntigravityApp { port, token })
}

/// `--csrf_token X` or `--csrf_token=X` among a process's arguments.
fn csrf_token(args: &[std::ffi::OsString]) -> Option<String> {
    let args: Vec<String> = args.iter().map(|a| a.to_string_lossy().into_owned()).collect();
    args.iter().enumerate().find_map(|(i, a)| match a.strip_prefix("--csrf_token") {
        Some("") => args.get(i + 1).cloned(),
        Some(rest) => rest.strip_prefix('=').map(String::from),
        None => None,
    })
    .filter(|t| !t.is_empty())
}

/// The last "listening on random port at N for HTTP" line of the language server's log (not the HTTPS one).
fn logged_http_port(log: &str) -> Option<u16> {
    log.lines().rev().find_map(|line| {
        let rest = line.split("random port at ").nth(1)?;
        let (port, kind) = rest.split_once(' ')?;
        (kind.trim() == "for HTTP").then(|| port.parse().ok()).flatten()
    })
}

async fn fetch_antigravity_app(app: &AntigravityApp) -> Result<Provider, Fail> {
    // Local only: no system proxy in between.
    let client = reqwest::Client::builder().timeout(Duration::from_secs(5)).no_proxy().build().map_err(|_| Fail::new("failed"))?;
    let call = |rpc: &str| {
        client
            .post(format!("http://127.0.0.1:{}/exa.language_server_pb.LanguageServerService/{rpc}", app.port))
            .header("Content-Type", "application/json")
            .header("Connect-Protocol-Version", "1")
            .header("x-codeium-csrf-token", &app.token)
            .body("{}")
            .send()
    };
    let res = call("RetrieveUserQuotaSummary").await.map_err(|_| Fail::new("offline"))?;
    check(&res)?;
    let body: Value = res.json().await.map_err(|_| Fail::new("failed"))?;
    let windows = quota_windows(&body["response"]["groups"])?;
    // The plan's name ("Google AI Pro") is extra: without it the limits still show.
    let plan = match call("GetUserStatus").await {
        Ok(res) if res.status().is_success() => res.json::<Value>().await.ok().and_then(|s| s["userStatus"]["userTier"]["name"].as_str().map(String::from)),
        _ => None,
    };
    Ok(Provider { plan, windows, ..Provider::new("gemini") })
}

/// Where apps keep their data: %APPDATA% on Windows, Application Support on a Mac.
fn app_data() -> Option<PathBuf> {
    if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        Some(home().join("Library").join("Application Support"))
    }
}

/// Runs the CLI's own `/usage` and returns what it prints. `agy` from PATH, otherwise
/// from its default install folder.
fn run_agy() -> Result<String, Fail> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    let installed = std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("agy").join("bin").join("agy.exe"));
    // A Mac app opened from the Finder has no shell PATH: also where Homebrew and installers put the CLI.
    let mac: &[&str] = if cfg!(target_os = "macos") { &["/opt/homebrew/bin/agy", "/usr/local/bin/agy"] } else { &[] };
    let mut child = [Some(PathBuf::from("agy")), installed]
        .into_iter()
        .flatten()
        .chain(mac.iter().map(PathBuf::from))
        .chain(cfg!(target_os = "macos").then(|| home().join(".local").join("bin").join("agy")))
        .find_map(|exe| {
            let mut cmd = Command::new(exe);
            cmd.args(["-p", "/usage", "--output-format", "json", "--print-timeout", "30s"])
                // agy treats the working directory as its workspace; keep it out of ours.
                .current_dir(std::env::temp_dir())
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::null());
            #[cfg(windows)]
            crate::convert::hide_console(&mut cmd);
            cmd.spawn().ok()
        })
        .ok_or("not-found")?;

    // Read while waiting, so a full pipe can't block the CLI.
    let mut pipe = child.stdout.take().ok_or("failed")?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = pipe.read_to_string(&mut text);
        text
    });
    let deadline = Instant::now() + AGY_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            Ok(None) => {
                let _ = child.kill();
                return Err("failed".into());
            }
            _ => return Err("failed".into()),
        }
    }
    reader.join().map_err(|_| Fail::new("failed"))
}

/// Output of `agy -p /usage --output-format json` → limit windows.
fn parse_agy_usage(stdout: &str) -> Result<Vec<Window>, Fail> {
    let body: Value = serde_json::from_str(stdout.trim()).map_err(|_| Fail::new("failed"))?;
    if body["status"] != "SUCCESS" {
        return Err("failed".into());
    }
    quota_windows(&body["command"]["data"]["groups"])
}

/// Antigravity's quota groups → limit windows, from the CLI (snake_case) or the app (camelCase). Two groups have a
/// 5-hour and a weekly limit each: Gemini models keep the plain kinds, the other one (Claude and GPT, bucket IDs
/// "3p-…") gets the "-3p" suffix. Smaller groups, such as one model's own weekly limit, are left out: one row per kind.
fn quota_windows(groups: &Value) -> Result<Vec<Window>, Fail> {
    let field = |bucket: &Value, snake: &str, camel: &str| bucket.get(snake).or_else(|| bucket.get(camel)).cloned().unwrap_or(Value::Null);
    let mut windows: Vec<Window> = groups
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|group| group["buckets"].as_array().into_iter().flatten())
        .filter_map(|bucket| {
            let resets_at = field(bucket, "reset_time", "resetTime").as_str().and_then(parse_iso_ms);
            // The app's JSON leaves out a fraction of 0 (an exhausted limit), which still has its reset time.
            let remaining = field(bucket, "remaining_fraction", "remainingFraction").as_f64().or(resets_at.map(|_| 0.0))?;
            let (kind, secs) = match bucket["window"].as_str()? {
                "5h" => ("session", 5 * 3600),
                "weekly" => ("weekly", 7 * 86_400),
                _ => return None,
            };
            let gemini = field(bucket, "id", "bucketId").as_str().is_some_and(|id| id.starts_with("gemini"));
            Some(Window {
                kind: if gemini { kind.into() } else { format!("{kind}-3p") },
                used_percent: ((1.0 - remaining) * 100.0).clamp(0.0, 100.0),
                resets_at,
                window_secs: Some(secs),
            })
        })
        .collect();
    // Gemini first, session before week (agy lists the week first). One row per kind.
    windows.sort_by_key(|w| (w.kind.ends_with("-3p"), w.kind.starts_with("weekly")));
    windows.dedup_by(|a, b| a.kind == b.kind);
    if windows.is_empty() {
        return Err("failed".into());
    }
    Ok(windows)
}

// ---------- Cursor ----------

async fn fetch_cursor() -> Result<Provider, Fail> {
    let db = app_data().ok_or("not-found")?.join("Cursor").join("User").join("globalStorage").join("state.vscdb");
    if !db.is_file() {
        return Err(Fail::new("not-found"));
    }
    let jwt = tauri::async_runtime::spawn_blocking(move || find_jwt_in_file(&db, b"cursorAuth/accessToken")).await.ok().flatten().ok_or("not-signed-in")?;
    // "sub" in the token = "auth0|user_…" → user ID for the query and cookie.
    let payload = jwt.split('.').nth(1).and_then(|p| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(p).ok()).ok_or("not-signed-in")?;
    let claims: Value = serde_json::from_slice(&payload).map_err(|_| Fail::new("not-signed-in"))?;
    let user = claims["sub"].as_str().and_then(|s| s.split('|').next_back()).ok_or("not-signed-in")?.to_string();

    let res = client()?
        .get(format!("https://cursor.com/api/usage?user={user}"))
        .header("Cookie", format!("WorkosCursorSessionToken={user}%3A%3A{jwt}"))
        .send()
        .await
        .map_err(|_| Fail::new("offline"))?;
    check(&res)?;
    let body: Value = res.json().await.map_err(|_| Fail::new("failed"))?;
    let start = body["startOfMonth"].as_str().and_then(parse_iso_ms);
    let resets_at = start.map(|s| s + 30 * 86_400_000);
    let windows: Vec<Window> = body
        .as_object()
        .map(|o| {
            o.iter()
                .filter_map(|(model, v)| {
                    let used = v["numRequests"].as_f64()?;
                    let max = v["maxRequestUsage"].as_f64().filter(|m| *m > 0.0)?;
                    Some(Window { kind: format!("model:{}", if model.starts_with("gpt-4") { "Premium" } else { model.as_str() }), used_percent: (used / max * 100.0).min(100.0), resets_at, window_secs: Some(30 * 86_400) })
                })
                .collect()
        })
        .unwrap_or_default();
    if windows.is_empty() {
        return Err("failed".into());
    }
    Ok(Provider { windows, ..Provider::new("cursor") })
}

/// `find_jwt_after` over a file read in blocks: Cursor's database also holds the chat history and can be huge.
fn find_jwt_in_file(path: &Path, key: &[u8]) -> Option<String> {
    use std::io::Read;
    /// What follows a key: a few bytes of gap and the token.
    const ROOM: usize = 4096;
    let mut file = std::fs::File::open(path).ok()?;
    let mut block = vec![0u8; JWT_BLOCK];
    let mut buf: Vec<u8> = Vec::new();
    loop {
        let n = file.read(&mut block).ok()?;
        let eof = n == 0;
        buf.extend_from_slice(&block[..n]);
        let mut from = 0;
        // A key cut off at the end of the buffer is found again with the next block.
        let mut keep = buf.len().saturating_sub(key.len() - 1);
        while let Some(pos) = buf[from..].windows(key.len()).position(|w| w == key) {
            let start = from + pos;
            if !eof && buf.len() < start + key.len() + ROOM {
                keep = start;
                break;
            }
            if let Some(jwt) = find_jwt_after(&buf[start..(start + key.len() + ROOM).min(buf.len())], key) {
                return Some(jwt);
            }
            from = start + key.len();
        }
        if eof {
            return None;
        }
        buf.drain(..keep);
    }
}

const JWT_BLOCK: usize = 1 << 20;

/// First JWT ("eyJ…") after `key` in a binary file (Cursor's SQLite file, without SQLite).
fn find_jwt_after(bytes: &[u8], key: &[u8]) -> Option<String> {
    let mut from = 0;
    while let Some(pos) = bytes[from..].windows(key.len()).position(|w| w == key) {
        let after = from + pos + key.len();
        let window = &bytes[after..(after + 64).min(bytes.len())];
        if let Some(start) = window.windows(3).position(|w| w == b"eyJ") {
            let s = after + start;
            let end = bytes[s..].iter().position(|&c| !(c.is_ascii_alphanumeric() || c == b'-' || c == b'_' || c == b'.')).map_or(bytes.len(), |e| s + e);
            let token = std::str::from_utf8(&bytes[s..end]).ok()?;
            if token.matches('.').count() == 2 {
                return Some(token.to_string());
            }
        }
        from = after;
    }
    None
}

// ---------- API-key providers ----------
// Endpoints and fields as BrimDeck reads them (src/BrimDeck.Core/ProviderScripts.cs), each
// checked against the provider's documentation named there. Read-only GET requests.

fn key(name: &str) -> Result<String, Fail> {
    crate::secrets::read(name).filter(|k| !k.trim().is_empty()).ok_or_else(|| Fail::new("no-key"))
}

async fn get_json(req: reqwest::RequestBuilder) -> Result<Value, Fail> {
    let res = req.header("Accept", "application/json").send().await.map_err(|_| Fail::new("offline"))?;
    check_key(&res)?;
    res.json().await.map_err(|_| Fail::new("failed"))
}

/// GET /api/v1/key (openrouter.ai/docs/api/reference/limits): the key's spend today and this
/// month and its own cap; GET /api/v1/credits: the account's credits, answered for ordinary
/// keys too, so shown only when it answers. The same key as the AI chat's OpenRouter key.
async fn fetch_openrouter() -> Result<Provider, Fail> {
    let key = key("ai.openrouter")?;
    let http = client()?;
    let body = get_json(http.get("https://openrouter.ai/api/v1/key").bearer_auth(&key)).await?;
    let credits = get_json(http.get("https://openrouter.ai/api/v1/credits").bearer_auth(&key)).await.ok();
    parse_openrouter(&body, credits.as_ref(), now_ms())
}

fn parse_openrouter(body: &Value, credits: Option<&Value>, now: u64) -> Result<Provider, Fail> {
    let data = &body["data"];
    let (Some(daily), Some(monthly)) = (data["usage_daily"].as_f64(), data["usage_monthly"].as_f64()) else { return Err("failed".into()) };
    let usd = |kind: &str, amount: f64, total: Option<f64>| Balance { kind: kind.into(), amount, total, currency: "USD".into() };
    let mut p = Provider::new("openrouter");
    if let Some(c) = credits.map(|c| &c["data"]) {
        if let (Some(total), Some(used)) = (c["total_credits"].as_f64(), c["total_usage"].as_f64()) {
            p.balances.push(usd("account", total - used, None));
        }
    }
    if let (Some(limit), Some(left)) = (data["limit"].as_f64().filter(|l| *l > 0.0), data["limit_remaining"].as_f64()) {
        p.balances.push(usd("key", left, Some(limit)));
        let (resets_at, window_secs) = match data["limit_reset"].as_str() {
            Some("daily") => (Some(next_utc(now, "day")), Some(86_400)),
            Some("weekly") => (Some(next_utc(now, "week")), Some(7 * 86_400)),
            Some("monthly") => (Some(next_utc(now, "month")), Some(30 * 86_400)),
            _ => (None, None),
        };
        p.windows.push(Window { kind: "key-limit".into(), used_percent: ((limit - left) / limit * 100.0).clamp(0.0, 100.0), resets_at, window_secs });
    }
    p.balances.push(usd("today", daily.max(0.0), None));
    p.balances.push(usd("month", monthly.max(0.0), None));
    Ok(p)
}

/// GET /user/balance (api-docs.deepseek.com/api/get-user-balance): per currency, total and
/// granted balance as decimal strings.
async fn fetch_deepseek() -> Result<Provider, Fail> {
    let key = key("usage.deepseek")?;
    let body = get_json(client()?.get("https://api.deepseek.com/user/balance").bearer_auth(key)).await?;
    parse_deepseek(&body)
}

fn parse_deepseek(body: &Value) -> Result<Provider, Fail> {
    let mut p = Provider::new("deepseek");
    for info in body["balance_infos"].as_array().ok_or("failed")? {
        let Some(currency) = info["currency"].as_str().filter(|c| matches!(*c, "CNY" | "USD")) else { continue };
        let amount = |field: &str| info[field].as_str().and_then(|s| s.parse::<f64>().ok());
        let total = amount("total_balance").ok_or("failed")?;
        p.balances.push(Balance { kind: "account".into(), amount: total, total: None, currency: currency.into() });
        if let Some(granted) = amount("granted_balance").filter(|g| *g > 0.0) {
            p.balances.push(Balance { kind: "granted".into(), amount: granted, total: None, currency: currency.into() });
        }
    }
    if p.balances.is_empty() {
        return Err("failed".into());
    }
    Ok(p)
}

/// GET /api/monitor/usage/quota/limit (the Z.ai coding plan, global host). The key goes in
/// Authorization as is. TOKENS_LIMIT / CREDIT_LIMIT with unit 3 count hours (number 5 is the
/// 5-hour window), unit 6 is the week; TIME_LIMIT is the monthly tool-call quota.
async fn fetch_zai() -> Result<Provider, Fail> {
    let key = key("usage.zai")?;
    let url = "https://api.z.ai/api/monitor/usage/quota/limit";
    let http = client()?;
    // The coding plan takes the key as is; if that is refused, try once the usual Bearer form.
    let body = match get_json(http.get(url).header("Authorization", &key)).await {
        Err(e) if e.code == "bad-key" => get_json(http.get(url).bearer_auth(&key)).await?,
        other => other?,
    };
    parse_zai(&body, now_ms())
}

fn parse_zai(body: &Value, now: u64) -> Result<Provider, Fail> {
    if body["success"] == false || body["code"].as_i64().is_some_and(|c| c != 0 && c != 200) {
        return Err("failed".into());
    }
    let data = &body["data"];
    let mut p = Provider::new("zai");
    p.plan = data["level"].as_str().filter(|l| !l.is_empty()).map(capitalize);
    for limit in data["limits"].as_array().ok_or("failed")? {
        let reset = limit["nextResetTime"].as_u64().filter(|r| *r > 0);
        let counted = || {
            let total = limit["usage"].as_f64().filter(|t| *t > 0.0)?;
            Some(limit["currentValue"].as_f64().unwrap_or(0.0) / total * 100.0)
        };
        // Credit plans report exact credits; token plans only a rounded percentage.
        let percent = || if limit["type"] == "CREDIT_LIMIT" { counted() } else { None }.or(limit["percentage"].as_f64());
        let (kind, secs, used) = match (limit["type"].as_str().unwrap_or(""), limit["unit"].as_u64(), limit["number"].as_u64()) {
            ("TIME_LIMIT", ..) => ("monthly-tools", 30 * 86_400, counted()),
            ("TOKENS_LIMIT" | "CREDIT_LIMIT", Some(3), Some(hours)) if hours > 0 => ("session", hours * 3600, percent()),
            ("TOKENS_LIMIT" | "CREDIT_LIMIT", Some(6), _) => ("weekly", 7 * 86_400, percent()),
            _ => continue,
        };
        let Some(used) = used else { continue };
        // A reset beyond the window length is not a real reset time.
        let resets_at = reset.filter(|r| *r <= now + secs * 1000);
        p.windows.push(Window { kind: kind.into(), used_percent: used.clamp(0.0, 100.0), resets_at, window_secs: Some(secs) });
    }
    p.windows.sort_by_key(|w| match w.kind.as_str() { "session" => 0, "weekly" => 1, _ => 2 });
    p.windows.dedup_by(|a, b| a.kind == b.kind);
    if p.windows.is_empty() {
        return Err("failed".into());
    }
    Ok(p)
}

/// Start of the next UTC day, week (Monday) or month after `now`.
fn next_utc(now: u64, unit: &str) -> u64 {
    let day = now / 86_400_000;
    match unit {
        "day" => (day + 1) * 86_400_000,
        // 1970-01-01 was a Thursday: (day + 3) % 7 is 0 on Mondays.
        "week" => (day + 7 - (day + 3) % 7) * 86_400_000,
        _ => {
            let (y, m) = civil_year_month(day as i64);
            let (y, m) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
            parse_iso_ms(&format!("{y}-{m:02}-01T00:00:00Z")).unwrap_or(now)
        }
    }
}

/// Year and month of a day count since 1970 (Howard Hinnant's civil_from_days).
fn civil_year_month(days: i64) -> (i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m)
}

// ---------- Disk cache ----------

fn cache_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = crate::portable::app_data_dir(app).ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("usage-cache.json"))
}

fn load_disk_cache(app: &AppHandle, state: &UsageState) {
    let mut loaded = state.loaded.lock().unwrap();
    if *loaded {
        return;
    }
    *loaded = true;
    let Some(saved) = cache_path(app).and_then(|p| std::fs::read(p).ok()).and_then(|b| serde_json::from_slice::<HashMap<String, (u64, Provider)>>(&b).ok()) else { return };
    state.cache.lock().unwrap().extend(saved);
}

fn save_disk_cache(app: &AppHandle, state: &UsageState) {
    let Some(path) = cache_path(app) else { return };
    let cache = state.cache.lock().unwrap();
    // Only store real data, not bare errors.
    let keep: HashMap<&String, &(u64, Provider)> = cache.iter().filter(|(_, (_, p))| p.has_data()).collect();
    let _ = crate::write_atomic(&path, &serde_json::to_vec(&keep).unwrap_or_default());
}

// ---------- Helpers ----------

/// On a Mac, Claude Code keeps its sign-in in the Keychain ("Claude Code-credentials", the same JSON as the file on
/// Windows). macOS asks once whether Crest may read it.
#[cfg(target_os = "macos")]
fn claude_keychain() -> Option<Value> {
    let user = std::env::var("USER").ok()?;
    serde_json::from_slice(&security_framework::passwords::get_generic_password("Claude Code-credentials", &user).ok()?).ok()
}

#[cfg(not(target_os = "macos"))]
fn claude_keychain() -> Option<Value> {
    None
}

fn read_json(path: &Path) -> Option<Value> {
    std::fs::read(path).ok().and_then(|b| serde_json::from_slice(&b).ok())
}

/// Newest `.jsonl` files under sessions/YYYY/MM/DD, sorted by path descending.
fn newest_files(root: &Path, limit: usize) -> Vec<PathBuf> {
    fn sorted_desc(dir: &Path) -> Vec<PathBuf> {
        let mut v: Vec<PathBuf> = std::fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        v.sort_by(|a, b| b.cmp(a));
        v
    }
    let mut out = Vec::new();
    for year in sorted_desc(root).into_iter().filter(|p| p.is_dir()) {
        for month in sorted_desc(&year).into_iter().filter(|p| p.is_dir()) {
            for day in sorted_desc(&month).into_iter().filter(|p| p.is_dir()) {
                for file in sorted_desc(&day) {
                    if file.extension().is_some_and(|e| e == "jsonl") {
                        out.push(file);
                        if out.len() >= limit {
                            return out;
                        }
                    }
                }
            }
        }
    }
    out
}

/// The user's home: USERPROFILE on Windows, HOME on a Mac (which has no USERPROFILE, so every tool read as missing).
fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from).unwrap_or_default()
}

/// A folder a tool lets its users move with an environment variable, as the tools themselves resolve it.
fn tool_dir(var: &str, default: &str) -> PathBuf {
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from).unwrap_or_else(|| home().join(default))
}

/// Claude Code's folder: `CLAUDE_CONFIG_DIR`, else `~/.claude`.
fn claude_dir() -> PathBuf {
    tool_dir("CLAUDE_CONFIG_DIR", ".claude")
}

/// Codex CLI's folder: `CODEX_HOME`, else `~/.codex`.
fn codex_dir() -> PathBuf {
    tool_dir("CODEX_HOME", ".codex")
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}

/// Minimal ISO 8601 parser ("2026-10-04T17:30:00.123+00:00" / "...Z") → Unix ms.
fn parse_iso_ms(s: &str) -> Option<u64> {
    let (date, rest) = s.split_once('T')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let time_end = rest.find(|c: char| c == 'Z' || c == '+' || (c == '-' && rest.len() > 8)).unwrap_or(rest.len());
    let (time, tz) = rest.split_at(time_end);
    let mut t = time.split(':');
    let (h, min) = (t.next()?.parse::<i64>().ok()?, t.next()?.parse::<i64>().ok()?);
    let sec: f64 = t.next().unwrap_or("0").parse().ok()?;
    let offset_min = match tz.chars().next() {
        Some(sign @ ('+' | '-')) => {
            let mut p = tz[1..].split(':');
            let oh: i64 = p.next()?.parse().ok()?;
            let om: i64 = p.next().unwrap_or("0").parse().ok()?;
            (oh * 60 + om) * if sign == '-' { -1 } else { 1 }
        }
        _ => 0,
    };
    // Days since 1970 (Howard Hinnant's algorithm).
    let (y2, m2) = if m <= 2 { (y - 1, m + 9) } else { (y, m - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let secs = days * 86_400 + h * 3600 + min * 60 - offset_min * 60;
    Some((secs as f64 * 1000.0 + sec * 1000.0) as u64)
}

#[cfg(test)]
mod tests {
    use super::{claude_org, claude_web_plan, desktop_token, open_chromium_secret, claude_windows, csrf_token, find_jwt_after, find_jwt_in_file, logged_http_port, quota_windows, next_utc, parse_agy_usage, parse_deepseek, parse_iso_ms, parse_openrouter, parse_retry_after, parse_zai, read_tail};
    use serde_json::json;

    #[test]
    fn tail_starts_at_a_whole_line() {
        let path = std::env::temp_dir().join(format!("crest-tail-test-{}.jsonl", std::process::id()));
        std::fs::write(&path, "first line\nsecond line\nthird\n").unwrap();
        assert_eq!(read_tail(&path, 1000).unwrap(), "first line\nsecond line\nthird\n");
        // 15 bytes from the end fall inside "second line": that piece is dropped.
        assert_eq!(read_tail(&path, 15).unwrap(), "third\n");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn retry_after() {
        let now = parse_iso_ms("2026-10-21T07:27:00Z").unwrap();
        assert_eq!(parse_retry_after("120", now), Some(120_000));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:28:00 GMT", now), Some(60_000));
        assert_eq!(parse_retry_after("Wed, 21 Oct 2026 07:20:00 GMT", now), Some(0));
        assert_eq!(parse_retry_after("soon", now), None);
    }

    #[test]
    fn utc_resets() {
        let now = parse_iso_ms("2026-10-31T15:00:00Z").unwrap(); // a Saturday
        assert_eq!(next_utc(now, "day"), parse_iso_ms("2026-11-01T00:00:00Z").unwrap());
        assert_eq!(next_utc(now, "week"), parse_iso_ms("2026-11-02T00:00:00Z").unwrap());
        assert_eq!(next_utc(now, "month"), parse_iso_ms("2026-11-01T00:00:00Z").unwrap());
        let dec = parse_iso_ms("2026-12-10T00:00:00Z").unwrap();
        assert_eq!(next_utc(dec, "month"), parse_iso_ms("2027-01-01T00:00:00Z").unwrap());
        // On a Monday the next week starts a week later.
        let monday = parse_iso_ms("2026-11-02T08:00:00Z").unwrap();
        assert_eq!(next_utc(monday, "week"), parse_iso_ms("2026-11-09T00:00:00Z").unwrap());
    }

    #[test]
    fn openrouter() {
        let now = parse_iso_ms("2026-10-31T15:00:00Z").unwrap();
        let key = json!({"data": {"label": "sk-or-v1-abc", "limit": 20.0, "limit_remaining": 5.0, "limit_reset": "monthly", "usage": 40.0, "usage_daily": 1.5, "usage_weekly": 4.0, "usage_monthly": 15.0}});
        let credits = json!({"data": {"total_credits": 50.0, "total_usage": 42.5}});
        let p = parse_openrouter(&key, Some(&credits), now).map_err(|e| e.code).unwrap();
        let got: Vec<_> = p.balances.iter().map(|b| (b.kind.as_str(), b.amount, b.total)).collect();
        assert_eq!(got, [("account", 7.5, None), ("key", 5.0, Some(20.0)), ("today", 1.5, None), ("month", 15.0, None)]);
        assert_eq!(p.windows.len(), 1);
        assert_eq!((p.windows[0].kind.as_str(), p.windows[0].used_percent), ("key-limit", 75.0));
        assert_eq!(p.windows[0].resets_at, parse_iso_ms("2026-11-01T00:00:00Z"));
        // No cap and no credits: spend only.
        let plain = json!({"data": {"limit": null, "limit_remaining": null, "usage_daily": 0.0, "usage_monthly": 2.0}});
        let p = parse_openrouter(&plain, None, now).map_err(|e| e.code).unwrap();
        assert!(p.windows.is_empty());
        assert_eq!(p.balances.len(), 2);
        assert_eq!(parse_openrouter(&json!({"error": "x"}), None, now).err().map(|e| e.code), Some("failed".into()));
    }

    #[test]
    fn deepseek() {
        let body = json!({"is_available": true, "balance_infos": [{"currency": "CNY", "total_balance": "110.00", "granted_balance": "10.00", "topped_up_balance": "100.00"}, {"currency": "EUR", "total_balance": "1"}]});
        let p = parse_deepseek(&body).map_err(|e| e.code).unwrap();
        let got: Vec<_> = p.balances.iter().map(|b| (b.kind.as_str(), b.amount, b.currency.as_str())).collect();
        assert_eq!(got, [("account", 110.0, "CNY"), ("granted", 10.0, "CNY")]);
        assert_eq!(parse_deepseek(&json!({"balance_infos": []})).err().map(|e| e.code), Some("failed".into()));
    }

    #[test]
    fn zai() {
        let now = parse_iso_ms("2026-10-31T15:00:00Z").unwrap();
        let body = json!({"code": 200, "success": true, "data": {"level": "pro", "limits": [
            {"type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 40, "nextResetTime": now + 3 * 86_400_000},
            {"type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 12, "nextResetTime": now + 3_600_000},
            {"type": "TIME_LIMIT", "unit": 5, "number": 1, "usage": 1000, "currentValue": 250, "nextResetTime": now + 400 * 86_400_000u64}
        ]}});
        let p = parse_zai(&body, now).map_err(|e| e.code).unwrap();
        assert_eq!(p.plan.as_deref(), Some("Pro"));
        let got: Vec<_> = p.windows.iter().map(|w| (w.kind.as_str(), w.used_percent, w.resets_at.is_some())).collect();
        // Session first; a tool-call reset far beyond its month is dropped.
        assert_eq!(got, [("session", 12.0, true), ("weekly", 40.0, true), ("monthly-tools", 25.0, false)]);
        assert!(parse_zai(&json!({"code": 1001, "msg": "bad", "success": false}), now).is_err());
    }

    /// Real output of agy 1.3.3, only the fractions edited.
    const AGY_USAGE: &str = r#"{"conversation_id":"","status":"SUCCESS","response":"Gemini Models\tWeekly Limit Remaining\t50%\t2026-10-19T09:39:00Z\nGemini Models\tFive Hour Limit Remaining\t75%\t2026-10-12T23:31:25Z\nClaude and GPT models\tWeekly Limit Remaining\t100%\t2026-10-19T18:31:25Z\nClaude and GPT models\tFive Hour Limit Remaining\t25%\t2026-10-12T23:31:25Z\n","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0},"command":{"name":"usage","data":{"description":"Within each group, models share a weekly limit and a 5-hour limit.","groups":[{"name":"Gemini Models","description":"Models within this group: Gemini Flash, Gemini Pro","buckets":[{"id":"gemini-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":0.5,"reset_time":"2026-10-19T09:39:00Z"},{"id":"gemini-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":0.75,"reset_time":"2026-10-12T23:31:25Z"}]},{"name":"Claude and GPT models","description":"Models within this group: Claude Opus, Claude Sonnet, GPT-OSS","buckets":[{"id":"3p-weekly","name":"Weekly Limit Remaining","window":"weekly","remaining_fraction":1,"reset_time":"2026-10-19T18:31:25Z"},{"id":"3p-5h","name":"Five Hour Limit Remaining","window":"5h","remaining_fraction":0.25,"reset_time":"2026-10-12T23:31:25Z"}]}]}}}"#;

    /// Gemini first, session before week; remaining → used.
    #[test]
    fn agy_usage() {
        let windows = parse_agy_usage(AGY_USAGE).map_err(|e| e.code).unwrap();
        let got: Vec<_> = windows.iter().map(|w| (w.kind.as_str(), w.used_percent, w.resets_at, w.window_secs)).collect();
        assert_eq!(
            got,
            [
                ("session", 25.0, Some(1_791_847_885_000), Some(18_000)),
                ("weekly", 50.0, Some(1_792_402_740_000), Some(604_800)),
                ("session-3p", 75.0, Some(1_791_847_885_000), Some(18_000)),
                ("weekly-3p", 0.0, Some(1_792_434_685_000), Some(604_800)),
            ]
        );
    }

    /// Live, needs a signed-in agy on this PC: `cargo test --lib agy_live -- --ignored`
    #[test]
    #[ignore]
    fn agy_live() {
        let provider = tauri::async_runtime::block_on(super::fetch_gemini()).map_err(|e| e.code).unwrap();
        assert!(provider.windows.iter().any(|w| w.kind == "session"));
    }

    #[test]
    fn agy_usage_errors() {
        let code = |s: &str| parse_agy_usage(s).map(|w| w.len()).map_err(|e| e.code);
        assert_eq!(code("not json"), Err("failed".into()));
        assert_eq!(code(r#"{"conversation_id":"","status":"ERROR","response":"not signed in"}"#), Err("failed".into()));
        assert_eq!(code(r#"{"status":"SUCCESS","command":{"name":"usage","data":{"groups":[]}}}"#), Err("failed".into()));
    }

    /// The Antigravity app's RetrieveUserQuotaSummary (shape of 2.29.0): camelCase, a used-up limit without its
    /// fraction, and a third group with one model's own weekly limit, which stays out.
    #[test]
    fn antigravity_app_quota() {
        let body = json!({"response": {"groups": [
            {"displayName": "Gemini Models", "buckets": [
                {"bucketId": "gemini-weekly", "window": "weekly", "remainingFraction": 0.5, "resetTime": "2026-11-12T18:25:44Z"},
                {"bucketId": "gemini-5h", "window": "5h", "resetTime": "2026-11-05T23:25:44Z"}]},
            {"displayName": "Claude and GPT models", "buckets": [
                {"bucketId": "3p-weekly", "window": "weekly", "remainingFraction": 1, "resetTime": "2026-11-12T18:25:44Z"},
                {"bucketId": "3p-5h", "window": "5h", "remainingFraction": 0.9, "resetTime": "2026-11-05T23:25:44Z"}]},
            {"displayName": "Gemini 4 Argon", "buckets": [
                {"bucketId": "gemini-argon-wtu-weekly", "window": "weekly", "remainingFraction": 0.96, "resetTime": "2026-11-10T17:52:04Z"}]}
        ]}});
        let windows = quota_windows(&body["response"]["groups"]).map_err(|e| e.code).unwrap();
        let got: Vec<_> = windows.iter().map(|w| (w.kind.as_str(), w.used_percent.round(), w.resets_at.is_some())).collect();
        assert_eq!(got, [("session", 100.0, true), ("weekly", 50.0, true), ("session-3p", 10.0, true), ("weekly-3p", 0.0, true)]);
    }

    /// claude.ai's organizations and usage, as the web page gets them: the chat organization and its plan, and the
    /// same windows as the CLI's endpoint.
    #[test]
    fn claude_web() {
        let orgs = json!([
            {"uuid": "api-org", "capabilities": ["api"]},
            {"uuid": "me", "capabilities": ["chat", "claude_max"]}
        ]);
        let org = claude_org(&orgs).unwrap();
        assert_eq!(org["uuid"], "me");
        assert_eq!(claude_web_plan(org).as_deref(), Some("Max"));
        assert_eq!(claude_org(&json!([{"uuid": "only"}])).unwrap()["uuid"], "only");
        assert!(claude_org(&json!([])).is_none());
        let usage = json!({"five_hour": {"utilization": 12.0, "resets_at": "2026-11-05T23:00:00Z"}, "seven_day": {"utilization": 40.0, "resets_at": null}, "seven_day_opus": null});
        let got: Vec<_> = claude_windows(&usage).iter().map(|w| (w.kind.clone(), w.used_percent, w.resets_at.is_some())).collect();
        assert_eq!(got, [("session".to_string(), 12.0, true), ("weekly".to_string(), 40.0, false)]);
    }

    #[test]
    fn antigravity_app_discovery() {
        let args = |a: &[&str]| a.iter().map(std::ffi::OsString::from).collect::<Vec<_>>();
        assert_eq!(csrf_token(&args(&["ls.exe", "--https_server_port", "0", "--csrf_token", "abc-1"])).as_deref(), Some("abc-1"));
        assert_eq!(csrf_token(&args(&["ls.exe", "--csrf_token=xyz"])).as_deref(), Some("xyz"));
        assert_eq!(csrf_token(&args(&["ls.exe", "--csrf_token"])), None);
        let log = "I1105 18:23:15 server.go:746] Language server listening on random port at 53712 for HTTPS (gRPC)\n\
                   I1105 18:23:15 server.go:754] Language server listening on random port at 53713 for HTTP\n\
                   I1105 18:25:01 server.go:746] Language server listening on random port at 50637 for HTTPS (gRPC)\n\
                   I1105 18:25:01 server.go:754] Language server listening on random port at 50638 for HTTP\n\
                   I1105 18:25:02 other.go:1] unrelated";
        assert_eq!(logged_http_port(log), Some(50638));
        assert_eq!(logged_http_port("nothing here"), None);
    }

    #[test]
    fn iso() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-10-04T12:00:00Z"), Some(1_791_115_200_000));
        assert_eq!(parse_iso_ms("2026-10-04T14:00:00+02:00"), Some(1_791_115_200_000));
        assert_eq!(parse_iso_ms("2026-10-04T12:00:00.500Z"), Some(1_791_115_200_500));
    }

    #[test]
    fn jwt_scan() {
        let db = b"\x00\x01cursorAuth/accessToken\x07\x12eyJhbGc.eyJzdWIiOiJ4In0.sig-_x\x00more";
        assert_eq!(find_jwt_after(db, b"cursorAuth/accessToken").as_deref(), Some("eyJhbGc.eyJzdWIiOiJ4In0.sig-_x"));
    }

    #[test]
    fn jwt_scan_in_a_file_across_blocks() {
        let key = b"cursorAuth/accessToken";
        let path = std::env::temp_dir().join(format!("crest-jwt-scan-{}.bin", std::process::id()));
        // The key straddles the first block boundary, an unrelated key comes before it.
        let mut db = vec![0u8; super::JWT_BLOCK - 10];
        db[100..100 + key.len()].copy_from_slice(key);
        db.extend_from_slice(key);
        db.extend_from_slice(b"\x07\x12eyJhbGc.eyJzdWIiOiJ4In0.sig-_x\x00more");
        std::fs::write(&path, &db).unwrap();
        let found = find_jwt_in_file(&path, key);
        let _ = std::fs::remove_file(&path);
        assert_eq!(found.as_deref(), Some("eyJhbGc.eyJzdWIiOiJ4In0.sig-_x"));
        assert!(find_jwt_in_file(&path, key).is_none());
    }

    #[test]
    fn desktop_token_takes_a_valid_profile_token_of_the_signed_in_account() {
        let now = 1_000_000;
        let api = ":https://api.anthropic.com:";
        let cache = json!({
            format!("acct:me|client:org{api}user:inference user:profile user:sessions"): { "token": "wide", "expiresAt": 2_000_000, "subscriptionType": "max" },
            format!("acct:me|client:org{api}user:profile"): { "token": "narrow", "expiresAt": 2_000_000.0, "subscriptionType": "max" },
            format!("acct:me|client:old{api}user:profile"): { "token": "stale", "expiresAt": 999_999 },
            format!("acct:other|client:org{api}user:profile"): { "token": "someone-else", "expiresAt": 2_000_000 },
            format!("acct:me|client:org{api}user:inference"): { "token": "no-profile", "expiresAt": 2_000_000 },
            "acct:me|client:org:https://claude.ai:user:profile": { "token": "other-host", "expiresAt": 2_000_000 },
        });
        assert_eq!(desktop_token(&cache, "me", now), Some(("narrow".into(), Some("Max".into()))));
        // Another account's tokens, expired ones and the wrong scope or host are never taken.
        assert_eq!(desktop_token(&cache, "nobody", now), None);
        assert_eq!(desktop_token(&cache, "", now), None);
        assert_eq!(desktop_token(&cache, "me", 3_000_000), None);
        // Entries without an account prefix belong to whoever is signed in.
        let plain = json!({ format!("client:org{api}user:profile"): { "token": "t", "expiresAt": 2_000_000 } });
        assert_eq!(desktop_token(&plain, "", now), Some(("t".into(), None)));
    }

    #[test]
    fn chromium_secret_opens_only_with_its_key() {
        use aes_gcm::aead::{Aead, KeyInit};
        let (key, nonce) = ([7u8; 32], [3u8; 12]);
        let sealed = aes_gcm::Aes256Gcm::new_from_slice(&key).unwrap().encrypt(aes_gcm::Nonce::from_slice(&nonce), b"{\"a\":1}".as_ref()).unwrap();
        let value = [b"v10".as_ref(), &nonce, &sealed].concat();
        assert_eq!(open_chromium_secret(&key, &value).as_deref(), Some(b"{\"a\":1}".as_ref()));
        assert_eq!(open_chromium_secret(&[8u8; 32], &value), None);
        assert_eq!(open_chromium_secret(&key, &value[3..]), None);
        assert_eq!(open_chromium_secret(&key, b"v10short"), None);
    }
}

/// For backend tests without the Tauri runtime: Claude + ChatGPT, error codes/counters only.
#[doc(hidden)]
pub async fn probe_for_test() -> Vec<(String, Result<usize, String>)> {
    vec![
        ("claude".into(), fetch_claude().await.map(|p| p.windows.len()).map_err(|e| e.code)),
        ("codex".into(), fetch_codex().await.map(|p| p.windows.len()).map_err(|e| e.code)),
        ("gemini".into(), fetch_gemini().await.map(|p| p.windows.len()).map_err(|e| e.code)),
    ]
}
