// Translated from BrimDeck (Apache-2.0, github.com/MoFeng2223/BrimDeck), src/BrimDeck.Core/LogReader.cs.
//! Token counts from the session logs Claude Code and the Codex CLI keep on this PC
//! (`~/.claude/projects/**/*.jsonl`, `~/.codex/sessions/**/*.jsonl` and `archived_sessions`).
//! Only the usage counters, model names and times are read, never message content.
//!
//! Logs only grow at the end, so each file remembers where its last complete line ended
//! (and the Codex parser's state) and a refresh parses only what was written since. A
//! shorter or rewritten file is parsed again from the start. The WebView gets aggregates:
//! one bucket per model, quarter hour and prompt band, so it can group by local day itself.

use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::{Deserialize, Serialize};

use super::{home, now_ms, parse_iso_ms};

/// Days of history kept. The model page offers up to 30 local days; one more covers time zones.
pub const SCAN_DAYS: u64 = 31;
const QUARTER: u64 = 15 * 60_000;
const DAY: u64 = 86_400_000;

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum Tool {
    Claude,
    Codex,
}

/// One request's usage. Categories are disjoint: `input` excludes cache reads and writes.
#[derive(Clone, Debug, PartialEq)]
pub struct Entry {
    pub key: String,
    pub at: u64,
    pub model: String,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cache_write_1h: u64,
}

impl Entry {
    fn total(&self) -> u64 {
        self.input + self.output + self.cache_read + self.cache_write + self.cache_write_1h
    }
    /// 0: prompt up to 100K tokens, 1: up to 200K, 2: above (for tiered prices).
    fn band(&self) -> u8 {
        match self.input + self.cache_read + self.cache_write + self.cache_write_1h {
            0..=100_000 => 0,
            100_001..=200_000 => 1,
            _ => 2,
        }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    /// Start of the quarter hour, Unix ms.
    pub at: u64,
    pub model: String,
    pub band: u8,
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub cache_write_1h: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolTokens {
    /// "claude" or "codex", the same ids as the quota cards.
    pub id: &'static str,
    /// The tool's log folder exists.
    pub found: bool,
    pub files: usize,
    /// Lines with usage that could not be read.
    pub unreadable: usize,
    pub buckets: Vec<Bucket>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenReport {
    /// Unix ms of the oldest data that can be in the report.
    pub since: u64,
    pub tools: Vec<ToolTokens>,
}

/// Parser state per file.
#[derive(Default)]
struct FileItem {
    len: u64,
    modified: Option<SystemTime>,
    offset: u64,
    entries: Vec<Entry>,
    errors: usize,
    /// Codex: model of the current turn, and the last cumulative totals seen.
    model: String,
    last_total: String,
}

#[derive(Default)]
pub struct Cache {
    files: HashMap<PathBuf, FileItem>,
}

pub fn report(cache: &mut Cache) -> TokenReport {
    let now = now_ms();
    let since = now.saturating_sub(SCAN_DAYS * DAY);
    let home = home();
    let claude = vec![home.join(".claude").join("projects")];
    let codex = vec![home.join(".codex").join("sessions"), home.join(".codex").join("archived_sessions")];
    let mut visited = Vec::new();
    let tools = vec![read_tool(cache, Tool::Claude, &claude, since, now, &mut visited), read_tool(cache, Tool::Codex, &codex, since, now, &mut visited)];
    // Forget files that are gone or fell out of the window.
    let keep: std::collections::HashSet<&PathBuf> = visited.iter().collect();
    cache.files.retain(|p, _| keep.contains(p));
    TokenReport { since, tools }
}

fn read_tool(cache: &mut Cache, tool: Tool, roots: &[PathBuf], since: u64, now: u64, visited: &mut Vec<PathBuf>) -> ToolTokens {
    let mut files = Vec::new();
    let mut found = false;
    for root in roots {
        if root.is_dir() {
            found = true;
            walk(root, &mut files);
        }
    }
    let cutoff = UNIX_START + std::time::Duration::from_millis(since);
    let mut unreadable = 0;
    let mut count = 0;
    let mut best: HashMap<String, Entry> = HashMap::new();
    for path in files {
        let Ok(meta) = std::fs::metadata(&path) else { continue };
        let modified = meta.modified().ok();
        if modified.is_some_and(|m| m < cutoff) {
            continue;
        }
        visited.push(path.clone());
        let item = cache.files.entry(path.clone()).or_default();
        let len = meta.len();
        if len < item.len || (len == item.len && modified != item.modified) {
            *item = FileItem::default();
        }
        if len != item.len || modified != item.modified {
            if parse_file(&path, tool, item, since).is_err() {
                cache.files.remove(&path);
                unreadable += 1;
                continue;
            }
            item.len = len;
            item.modified = modified;
        }
        count += 1;
        unreadable += item.errors;
        for e in &item.entries {
            if e.at < since || e.at > now + 60_000 || e.total() == 0 {
                continue;
            }
            // Streaming Claude lines repeat a message id, and forks copy history: keep the fullest.
            match best.get(&e.key) {
                Some(old) if old.total() >= e.total() => {}
                _ => {
                    best.insert(e.key.clone(), e.clone());
                }
            }
        }
    }
    ToolTokens { id: if tool == Tool::Claude { "claude" } else { "codex" }, found, files: count, unreadable, buckets: aggregate(best.into_values()) }
}

const UNIX_START: SystemTime = SystemTime::UNIX_EPOCH;

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(read) = std::fs::read_dir(dir) else { return };
    for entry in read.flatten() {
        let Ok(kind) = entry.file_type() else { continue };
        let path = entry.path();
        if kind.is_dir() {
            walk(&path, out);
        } else if kind.is_file() && path.extension().is_some_and(|e| e == "jsonl") {
            out.push(path);
        }
    }
}

/// Reads complete lines after the remembered offset; a line still being written waits for the next refresh.
fn parse_file(path: &Path, tool: Tool, item: &mut FileItem, since: u64) -> std::io::Result<()> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(item.offset))?;
    // shortcut: a single line is read whole however long it is (huge tool results), fine for logs of this size.
    let mut reader = BufReader::with_capacity(1 << 20, file);
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = reader.read_until(b'\n', &mut line)?;
        if n == 0 || line.last() != Some(&b'\n') {
            break;
        }
        item.offset += n as u64;
        parse_line(&line, tool, item, since);
    }
    Ok(())
}

fn parse_line(bytes: &[u8], tool: Tool, item: &mut FileItem, since: u64) {
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(bytes);
    let Ok(line) = std::str::from_utf8(bytes) else { return };
    let result = match tool {
        Tool::Claude => {
            if !line.contains("\"usage\"") || !line.contains("\"assistant\"") {
                return;
            }
            parse_claude(line).map(|e| e.into_iter().collect::<Vec<_>>())
        }
        Tool::Codex => {
            if !line.contains("\"token_count\"") && !line.contains("\"turn_context\"") {
                return;
            }
            parse_codex(line, &mut item.model, &mut item.last_total).map(|e| e.into_iter().collect())
        }
    };
    match result {
        Ok(entries) => item.entries.extend(entries.into_iter().filter(|e| e.at >= since)),
        Err(()) => item.errors += 1,
    }
}

#[derive(Deserialize)]
struct ClaudeLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    uuid: Option<String>,
    message: Option<ClaudeMessage>,
}

#[derive(Deserialize)]
struct ClaudeMessage {
    id: Option<String>,
    model: Option<String>,
    usage: Option<ClaudeUsage>,
}

#[derive(Deserialize)]
struct ClaudeUsage {
    input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    cache_read_input_tokens: Option<u64>,
    cache_creation_input_tokens: Option<u64>,
    cache_creation: Option<CacheCreation>,
}

#[derive(Deserialize)]
struct CacheCreation {
    ephemeral_1h_input_tokens: Option<u64>,
}

/// One Claude Code line → its usage, if it is an assistant message with usage. Err = unreadable.
pub fn parse_claude(line: &str) -> Result<Option<Entry>, ()> {
    let l: ClaudeLine = serde_json::from_str(line).map_err(|_| ())?;
    if l.kind.as_deref() != Some("assistant") {
        return Ok(None);
    }
    let (Some(at), Some(message)) = (l.timestamp.as_deref().and_then(parse_iso_ms), l.message) else { return Ok(None) };
    let Some(u) = message.usage else { return Ok(None) };
    let creation = u.cache_creation_input_tokens.unwrap_or(0);
    let hour = u.cache_creation.and_then(|c| c.ephemeral_1h_input_tokens).unwrap_or(0).min(creation);
    let id = message.id.filter(|s| !s.is_empty()).or(l.uuid).unwrap_or_else(|| format!("{at}"));
    Ok(Some(Entry {
        key: format!("claude:{id}"),
        at,
        model: message.model.filter(|m| !m.is_empty()).unwrap_or_else(|| "unknown".into()),
        input: u.input_tokens.unwrap_or(0),
        output: u.output_tokens.unwrap_or(0),
        cache_read: u.cache_read_input_tokens.unwrap_or(0),
        cache_write: creation - hour,
        cache_write_1h: hour,
    }))
}

#[derive(Deserialize)]
struct CodexLine {
    #[serde(rename = "type")]
    kind: Option<String>,
    timestamp: Option<String>,
    payload: Option<CodexPayload>,
}

#[derive(Deserialize)]
struct CodexPayload {
    #[serde(rename = "type")]
    kind: Option<String>,
    model: Option<String>,
    info: Option<CodexInfo>,
}

#[derive(Deserialize)]
struct CodexInfo {
    total_token_usage: Option<CodexUsage>,
    last_token_usage: Option<CodexUsage>,
}

#[derive(Deserialize)]
struct CodexUsage {
    input_tokens: Option<u64>,
    cached_input_tokens: Option<u64>,
    output_tokens: Option<u64>,
    total_tokens: Option<u64>,
}

/// One Codex line. `turn_context` sets the model for the token counts that follow; a
/// `token_count` whose cumulative totals equal the previous one is a repeat and skipped.
pub fn parse_codex(line: &str, model: &mut String, last_total: &mut String) -> Result<Option<Entry>, ()> {
    let l: CodexLine = serde_json::from_str(line).map_err(|_| ())?;
    let Some(payload) = l.payload else { return Ok(None) };
    match l.kind.as_deref() {
        Some("turn_context") => {
            if let Some(m) = payload.model.filter(|m| !m.is_empty()) {
                *model = m;
            }
            return Ok(None);
        }
        Some("event_msg") if payload.kind.as_deref() == Some("token_count") => {}
        _ => return Ok(None),
    }
    let Some(at) = l.timestamp.as_deref().and_then(parse_iso_ms) else { return Ok(None) };
    let Some(info) = payload.info else { return Ok(None) };
    let identity = info.total_token_usage.as_ref().map(|t| {
        format!("{}:{}:{}:{}", t.input_tokens.unwrap_or(0), t.cached_input_tokens.unwrap_or(0), t.output_tokens.unwrap_or(0), t.total_tokens.unwrap_or(0))
    });
    if let Some(id) = &identity {
        if id == last_total {
            return Ok(None);
        }
        last_total.clone_from(id);
    }
    let Some(u) = info.last_token_usage else { return Ok(None) };
    let input = u.input_tokens.unwrap_or(0);
    let cached = u.cached_input_tokens.unwrap_or(0).min(input);
    let output = u.output_tokens.unwrap_or(0);
    Ok(Some(Entry {
        // Time + cumulative totals tell a fork's copied history apart from new turns.
        key: format!("codex:{at}:{}:{input}:{cached}:{output}", identity.unwrap_or_default()),
        at,
        model: if model.is_empty() { "unknown".into() } else { model.clone() },
        input: input - cached,
        output,
        cache_read: cached,
        cache_write: 0,
        cache_write_1h: 0,
    }))
}

/// Sums entries per quarter hour, model and prompt band, oldest first.
pub fn aggregate(entries: impl IntoIterator<Item = Entry>) -> Vec<Bucket> {
    let mut map: HashMap<(u64, String, u8), Bucket> = HashMap::new();
    for e in entries {
        let at = e.at - e.at % QUARTER;
        let band = e.band();
        let b = map.entry((at, e.model.clone(), band)).or_insert_with(|| Bucket { at, model: e.model.clone(), band, input: 0, output: 0, cache_read: 0, cache_write: 0, cache_write_1h: 0 });
        b.input += e.input;
        b.output += e.output;
        b.cache_read += e.cache_read;
        b.cache_write += e.cache_write;
        b.cache_write_1h += e.cache_write_1h;
    }
    let mut out: Vec<Bucket> = map.into_values().collect();
    out.sort_by(|a, b| (a.at, &a.model, a.band).cmp(&(b.at, &b.model, b.band)));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE: &str = include_str!("../fixtures/usage/claude-code.jsonl");
    const CODEX: &str = include_str!("../fixtures/usage/codex.jsonl");

    fn run(text: &str, tool: Tool) -> FileItem {
        let mut item = FileItem::default();
        for line in text.split_inclusive('\n') {
            parse_line(line.as_bytes(), tool, &mut item, 0);
        }
        item
    }

    #[test]
    fn claude_fixture() {
        let item = run(CLAUDE, Tool::Claude);
        // A user line, a summary and a line without usage are ignored; one broken line is counted.
        assert_eq!(item.errors, 1);
        let got: Vec<_> = item.entries.iter().map(|e| (e.key.as_str(), e.model.as_str(), e.input, e.output, e.cache_read, e.cache_write, e.cache_write_1h)).collect();
        assert_eq!(
            got,
            [
                ("claude:msg_a", "claude-opus-5-5", 10, 5, 0, 0, 0),
                ("claude:msg_a", "claude-opus-5-5", 10, 120, 0, 0, 0),
                ("claude:msg_b", "claude-sonnet-5-5", 3, 40, 2000, 300, 700),
                ("claude:msg_c", "claude-haiku-5-5", 150_000, 10, 0, 0, 0),
            ]
        );
        assert_eq!(item.entries[0].at, parse_iso_ms("2026-10-30T09:00:01.000Z").unwrap());
    }

    #[test]
    fn codex_fixture() {
        let item = run(CODEX, Tool::Codex);
        assert_eq!(item.errors, 0);
        let got: Vec<_> = item.entries.iter().map(|e| (e.model.as_str(), e.input, e.output, e.cache_read)).collect();
        // The second token_count repeats the first one's totals and is skipped; the model follows turn_context.
        assert_eq!(got, [("gpt-5-codex", 800, 50, 200), ("gpt-5.1-codex-mini", 100, 20, 900)]);
    }

    #[test]
    fn dedup_and_buckets() {
        let mut entries: HashMap<String, Entry> = HashMap::new();
        for e in run(CLAUDE, Tool::Claude).entries {
            match entries.get(&e.key) {
                Some(old) if old.total() >= e.total() => {}
                _ => {
                    entries.insert(e.key.clone(), e);
                }
            }
        }
        let buckets = aggregate(entries.into_values());
        let got: Vec<_> = buckets.iter().map(|b| (b.at % QUARTER, b.model.as_str(), b.band, b.output)).collect();
        // Streaming repeat of msg_a kept once with its fuller usage; Haiku's 150K prompt is band 1.
        assert_eq!(got, [(0, "claude-haiku-5-5", 1, 10), (0, "claude-opus-5-5", 0, 120), (0, "claude-sonnet-5-5", 0, 40)]);
        assert!(buckets.windows(2).all(|w| w[0].at <= w[1].at));
    }

    #[test]
    fn partial_last_line_waits() {
        let dir = std::env::temp_dir().join(format!("crest-usage-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let full = CLAUDE.lines().find(|l| l.contains("msg_b")).unwrap();
        std::fs::write(&path, format!("{full}\n{}", &full[..40])).unwrap();
        let mut item = FileItem::default();
        parse_file(&path, Tool::Claude, &mut item, 0).unwrap();
        assert_eq!(item.entries.len(), 1);
        assert_eq!(item.offset as usize, full.len() + 1);
        // The rest of the line arrives: only the new line is parsed.
        std::fs::write(&path, format!("{full}\n{}\n", full.replace("msg_b", "msg_z"))).unwrap();
        parse_file(&path, Tool::Claude, &mut item, 0).unwrap();
        assert_eq!(item.entries.iter().map(|e| e.key.as_str()).collect::<Vec<_>>(), ["claude:msg_b", "claude:msg_z"]);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
