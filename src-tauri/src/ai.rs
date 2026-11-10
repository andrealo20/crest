//! Ask: AI chat with streaming.
//!
//! Providers:
//! - `openrouter`, `openai`, `custom`: OpenAI-compatible `/chat/completions` (SSE).
//!   Effort as `reasoning_effort` (OpenRouter: `reasoning.effort`).
//! - `anthropic`: Claude Messages API (SSE), effort as `output_config.effort`.
//!
//! The key comes from Credential Manager (`ai.<provider>`) and only leaves Rust in the
//! Authorization header. A custom endpoint on this computer (LM Studio, Ollama) may have none:
//! the request then goes without the header. Chunks go to the frontend as `ai://delta`;
//! `ai_cancel` stops a running stream.

use std::collections::HashSet;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::secrets;

const SYSTEM_PROMPT: &str = "Du bist Ask, ein schneller Assistent in einer kleinen Notch am oberen Bildschirmrand. \
Antworte knapp und direkt in der Sprache der Frage. Kein Markdown-Overhead: kurze Absätze, Listen nur wenn nötig.";

/// Claude models where the server falls back to a suitable model on refusal
/// (`fallbacks: "default"`).
const CLAUDE_FALLBACK_MODELS: &[&str] = &["claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5-5"];

#[derive(Clone, Deserialize)]
pub struct Msg {
    role: String,
    content: String,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatConfig {
    pub provider: String,
    pub base_url: Option<String>,
    pub model: String,
    /// low | medium | high | xhigh | off (or empty: no parameter, for models that do not reason)
    pub effort: Option<String>,
}

#[derive(Default)]
pub struct AiState {
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Clone, Serialize)]
struct Delta<'a> {
    id: &'a str,
    text: &'a str,
}

#[tauri::command]
pub async fn ai_chat(id: String, config: ChatConfig, messages: Vec<Msg>, app: AppHandle, state: State<'_, AiState>) -> Result<(), String> {
    let key = match secrets::read(&format!("ai.{}", config.provider)) {
        Some(key) => key,
        // A server on this computer usually asks for no key.
        None if config.provider == "custom" && config.base_url.as_deref().is_some_and(|b| on_this_computer(b.trim())) => String::new(),
        None => return Err("no-key".into()),
    };
    let result = stream_chat(&config, &key, &messages, |text| {
        let _ = app.emit("ai://delta", Delta { id: &id, text });
    }, || state.cancelled.lock().unwrap().contains(&id))
    .await;
    state.cancelled.lock().unwrap().remove(&id);
    result
}

#[tauri::command]
pub fn ai_cancel(id: String, state: State<'_, AiState>) {
    state.cancelled.lock().unwrap().insert(id);
}

/// Core without Tauri, so backend tests can use it too.
pub async fn stream_chat(
    config: &ChatConfig,
    key: &str,
    messages: &[Msg],
    mut on_delta: impl FnMut(&str),
    cancelled: impl Fn() -> bool,
) -> Result<(), String> {
    let model = config.model.trim();
    if model.is_empty() {
        return Err("Kein Modell eingetragen".into());
    }
    let effort = config.effort.as_deref().filter(|e| !matches!(*e, "" | "off"));
    let anthropic = config.provider == "anthropic";

    let url = match config.provider.as_str() {
        "anthropic" => "https://api.anthropic.com/v1/messages".to_string(),
        "openai" => "https://api.openai.com/v1/chat/completions".to_string(),
        "openrouter" => "https://openrouter.ai/api/v1/chat/completions".to_string(),
        "custom" => {
            let base = config.base_url.as_deref().unwrap_or("").trim().trim_end_matches('/');
            if !custom_base_ok(base) {
                return Err("Base-URL muss mit https:// beginnen".into());
            }
            format!("{base}/chat/completions")
        }
        other => return Err(format!("Unbekannter Anbieter: {other}")),
    };

    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        // Reasoning models can think for a while before the first token.
        .read_timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?;

    let request = if anthropic {
        let mut body = json!({
            "model": model,
            "max_tokens": 64000,
            "stream": true,
            "system": SYSTEM_PROMPT,
            "messages": messages.iter().map(|m| json!({ "role": m.role, "content": m.content })).collect::<Vec<_>>(),
        });
        if let Some(e) = effort {
            body["output_config"] = json!({ "effort": e });
        }
        let mut req = client.post(&url).header("x-api-key", key).header("anthropic-version", "2023-06-01");
        if CLAUDE_FALLBACK_MODELS.contains(&model) {
            body["fallbacks"] = json!("default");
            req = req.header("anthropic-beta", "server-side-fallback-2026-07-01");
        }
        req.json(&body)
    } else {
        let mut all = vec![json!({ "role": "system", "content": SYSTEM_PROMPT })];
        all.extend(messages.iter().map(|m| json!({ "role": m.role, "content": m.content })));
        let mut body = json!({ "model": model, "stream": true, "messages": all });
        if let Some(e) = effort {
            if config.provider == "openrouter" {
                body["reasoning"] = json!({ "effort": e });
            } else {
                body["reasoning_effort"] = json!(e);
            }
        }
        let mut req = client.post(&url);
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
        if config.provider == "openrouter" {
            req = req.header("X-Title", "Crest");
        }
        req.json(&body)
    };

    let Some(sent) = or_cancel(request.send(), &cancelled).await else { return Ok(()) };
    let mut res = sent.map_err(|e| format!("Keine Verbindung: {}", short(&e.to_string())))?;
    if !res.status().is_success() {
        let status = res.status().as_u16();
        let text = res.text().await.unwrap_or_default();
        return Err(http_error(status, &text));
    }

    // Read SSE line by line; a chunk can end mid-line or mid-character, so only whole lines are decoded.
    let mut buffer: Vec<u8> = Vec::new();
    // Lines that are not SSE: a provider that ignored `stream` answers with one JSON body.
    let mut plain: Vec<u8> = Vec::new();
    let mut got_text = false;
    'read: loop {
        let Some(chunk) = or_cancel(res.chunk(), &cancelled).await else { return Ok(()) };
        let last = match chunk.map_err(|e| format!("Verbindung abgebrochen: {}", short(&e.to_string())))? {
            Some(chunk) => {
                buffer.extend_from_slice(&chunk);
                false
            }
            None => {
                // The last event may come without its newline.
                buffer.push(b'\n');
                true
            }
        };
        while let Some(pos) = buffer.iter().position(|&b| b == b'\n') {
            let line = String::from_utf8_lossy(&buffer[..pos]).into_owned();
            buffer.drain(..=pos);
            if sse_line(&line, anthropic, &mut on_delta, &mut got_text, &mut plain)? {
                break 'read;
            }
        }
        if last {
            break;
        }
    }
    if !got_text {
        let body: Value = serde_json::from_slice(&plain).unwrap_or_default();
        if let Some(err) = body.get("error") {
            return Err(err["message"].as_str().unwrap_or("Fehler vom Anbieter").to_string());
        }
        let text = if anthropic { &body["content"][0]["text"] } else { &body["choices"][0]["message"]["content"] };
        match text.as_str().filter(|t| !t.is_empty()) {
            Some(t) => on_delta(t),
            None => return Err("Leere Antwort".into()),
        }
    }
    Ok(())
}

/// One SSE line. `Ok(true)`: the stream is finished.
fn sse_line(line: &str, anthropic: bool, on_delta: &mut impl FnMut(&str), got_text: &mut bool, plain: &mut Vec<u8>) -> Result<bool, String> {
    let line = line.trim();
    let Some(data) = line.strip_prefix("data:") else {
        if !line.is_empty() && !line.starts_with(':') && !line.starts_with("event:") {
            plain.extend_from_slice(line.as_bytes());
        }
        return Ok(false);
    };
    let data = data.trim();
    if data == "[DONE]" {
        return Ok(true);
    }
    let Ok(event) = serde_json::from_str::<Value>(data) else { return Ok(false) };
    if let Some(err) = event.get("error") {
        return Err(err["message"].as_str().unwrap_or("Fehler vom Anbieter").to_string());
    }
    let text = if anthropic {
        (event["type"] == "content_block_delta" && event["delta"]["type"] == "text_delta")
            .then(|| event["delta"]["text"].as_str())
            .flatten()
    } else {
        event["choices"][0]["delta"]["content"].as_str()
    };
    if let Some(t) = text.filter(|t| !t.is_empty()) {
        *got_text = true;
        on_delta(t);
    }
    Ok(false)
}

/// Awaits `fut`, but gives up (`None`) within 200 ms of a cancel, also while the provider is silent.
async fn or_cancel<T>(fut: impl std::future::Future<Output = T>, cancelled: &impl Fn() -> bool) -> Option<T> {
    tokio::pin!(fut);
    loop {
        if cancelled() {
            return None;
        }
        if let Ok(v) = tokio::time::timeout(Duration::from_millis(200), &mut fut).await {
            return Some(v);
        }
    }
}

fn http_error(status: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().or(v["message"].as_str()).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(140).collect());
    match status {
        401 | 403 => format!("Schlüssel abgelehnt ({status}): {}", short(&detail)),
        404 => format!("Nicht gefunden (404): Base-URL oder Modell prüfen. {}", short(&detail)),
        429 => format!("Limit erreicht (429): {}", short(&detail)),
        _ => format!("Fehler {status}: {}", short(&detail)),
    }
}

fn short(s: &str) -> String {
    let s = s.trim();
    if s.chars().count() > 160 { format!("{}…", s.chars().take(160).collect::<String>()) } else { s.to_string() }
}

/// A custom endpoint gets the API key: https, or plain http only to this computer.
fn custom_base_ok(base: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(base) else { return false };
    match url.scheme() {
        "https" => true,
        "http" => on_this_computer(base),
        _ => false,
    }
}

/// The address is this computer's own (LM Studio, Ollama and the like).
fn on_this_computer(base: &str) -> bool {
    reqwest::Url::parse(base).is_ok_and(|url| matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
}

#[cfg(test)]
mod tests {
    use super::{custom_base_ok, on_this_computer, or_cancel, sse_line, stream_chat, ChatConfig, Msg};
    use std::time::Duration;

    /// One request to a server on this computer: the request as it arrived (lower case), answered with an SSE "ok".
    fn serve_once() -> (u16, std::thread::JoinHandle<String>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let (mut request, mut buf) = (Vec::new(), [0u8; 4096]);
            // The headers, then as much body as they announce.
            loop {
                let n = stream.read(&mut buf).unwrap();
                request.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&request).to_lowercase();
                if let Some(end) = text.find("\r\n\r\n") {
                    let length = text.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let body = "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n";
            let _ = write!(stream, "HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
            String::from_utf8_lossy(&request).to_lowercase()
        });
        (port, server)
    }

    #[test]
    fn a_server_on_this_computer_needs_no_key() {
        for key in ["", "secret"] {
            let (port, server) = serve_once();
            let config = ChatConfig { provider: "custom".into(), base_url: Some(format!("http://127.0.0.1:{port}/v1")), model: "local".into(), effort: None };
            let mut out = String::new();
            let hi = [Msg { role: "user".into(), content: "hi".into() }];
            let result = tauri::async_runtime::block_on(stream_chat(&config, key, &hi, |t| out.push_str(t), || false));
            assert_eq!((result, out.as_str()), (Ok(()), "ok"));
            let request = server.join().unwrap();
            assert!(request.starts_with("post /v1/chat/completions "), "{request}");
            // Without a key no Authorization header at all, not an empty "Bearer".
            assert_eq!(request.contains("\r\nauthorization:"), !key.is_empty(), "{request}");
        }
        for local in ["http://localhost:11434/v1", "https://127.0.0.1:1234/v1", "http://[::1]:8080"] {
            assert!(on_this_computer(local), "{local}");
        }
        for remote in ["https://api.example.com/v1", "http://localhost.example.com/v1", "http://localhost@evil.example/v1", ""] {
            assert!(!on_this_computer(remote), "{remote}");
        }
    }

    #[test]
    fn sse_lines_give_text_errors_and_the_end() {
        let (mut out, mut got, mut plain) = (String::new(), false, Vec::new());
        let mut run = |line: &str, anthropic: bool| sse_line(line, anthropic, &mut |t| out.push_str(t), &mut got, &mut plain);
        assert_eq!(run(r#"data: {"choices":[{"delta":{"content":"Hi"}}]}"#, false), Ok(false));
        assert_eq!(run(r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" there"}}"#, true), Ok(false));
        assert_eq!(run(": keep-alive", false), Ok(false));
        assert_eq!(run("event: ping", true), Ok(false));
        assert_eq!(run(r#"data: {"error":{"message":"overloaded"}}"#, false), Err("overloaded".into()));
        assert_eq!(run("data: [DONE]", false), Ok(true));
        assert_eq!(run(r#"{"choices":[]}"#, false), Ok(false));
        assert_eq!(out, "Hi there");
        assert!(got);
        assert_eq!(plain, br#"{"choices":[]}"#);
    }

    #[test]
    fn a_cancel_ends_a_silent_wait() {
        let r = tauri::async_runtime::block_on(or_cancel(std::future::pending::<()>(), &|| true));
        assert!(r.is_none());
        let r = tauri::async_runtime::block_on(or_cancel(async { tokio::time::sleep(Duration::from_millis(250)).await; 7 }, &|| false));
        assert_eq!(r, Some(7));
    }

    #[test]
    fn custom_base_url_needs_https_or_this_computer() {
        for ok in ["https://api.example.com/v1", "http://localhost:11434/v1", "http://127.0.0.1:8080", "http://[::1]:1234/v1"] {
            assert!(custom_base_ok(ok), "{ok}");
        }
        for bad in ["http://localhost.example.com/v1", "http://localhost@evil.example/v1", "http://127.0.0.1.nip.io", "http://api.example.com", "ftp://localhost", "localhost:11434", ""] {
            assert!(!custom_base_ok(bad), "{bad}");
        }
    }
}
