//! Offline translation of lyrics: the files the page's translation worker needs (public/translate/worker.js), kept in
//! the app data folder.
//!
//! - The engine: Bergamot, the WebAssembly build Firefox translates pages with (MPL-2.0), pinned to one version and
//!   its SHA-256, downloaded once from Mozilla's CDN.
//! - The models: Mozilla's translation models (MPL-2.0), one folder per language pair, all to or from English. Which
//!   files make up a pair comes from Firefox's own catalog (Remote Settings), which gives every file's SHA-256 and size;
//!   a file is kept only when both match. Only the records Firefox on a desktop release uses are taken.
//!
//! Only the song's lines go through the worker, on this computer; nothing about the song is sent anywhere.

use std::path::PathBuf;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

const CATALOG: &str = "https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records";
const CDN: &str = "https://firefox-settings-attachments.cdn.mozilla.net/";
/// bergamot-translator 3.0 from Firefox's translations-wasm collection; public/translate/bergamot-translator.js is its glue.
const ENGINE: &str = "main-workspace/translations-wasm/05082c31-aee8-4249-9e01-c1865afd7520.wasm";
const ENGINE_SHA256: &str = "a3a89d9ad0a4ed8f27bf3e403701b23f5709816f6376438503f2fa5b0182c2dc";
const ENGINE_SIZE: u64 = 4_960_506;
/// No model file is near this; a larger size in the catalog is not downloaded.
const MAX_FILE: u64 = 200 * 1024 * 1024;
/// The files of a pair, as the worker asks for them.
const KINDS: [&str; 3] = ["model", "lex", "vocab"];

fn root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(crate::portable::app_data_dir(app).map_err(|e| e.to_string())?.join("translation"))
}

/// A language code as the catalog writes it ("ja", "zh_hant"): nothing that could leave the folder.
fn code_ok(code: &str) -> bool {
    (2..=8).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
}

fn pair_dir(app: &AppHandle, from: &str, to: &str) -> Result<PathBuf, String> {
    if !code_ok(from) || !code_ok(to) || (from != "en" && to != "en") {
        return Err("pair".into());
    }
    Ok(root(app)?.join(format!("{from}-{to}")))
}

#[derive(Serialize)]
pub struct Status {
    /// The engine is downloaded.
    engine: bool,
    /// Downloaded pairs ("ja-en") and their size on disk in bytes.
    pairs: Vec<(String, u64)>,
}

#[tauri::command]
pub fn translate_status(app: AppHandle) -> Status {
    let Ok(root) = root(&app) else { return Status { engine: false, pairs: Vec::new() } };
    let engine = std::fs::metadata(root.join("engine.wasm")).is_ok_and(|m| m.len() == ENGINE_SIZE);
    let pairs = std::fs::read_dir(&root)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| {
            let dir = e.path();
            let sizes: Option<Vec<u64>> = KINDS.iter().map(|k| std::fs::metadata(dir.join(k)).ok().map(|m| m.len())).collect();
            Some((e.file_name().to_string_lossy().into_owned(), sizes?.iter().sum()))
        })
        .collect();
    Status { engine, pairs }
}

#[derive(Deserialize, Clone)]
struct Attachment {
    location: String,
    hash: String,
    size: u64,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Record {
    from_lang: String,
    to_lang: String,
    file_type: String,
    version: String,
    #[serde(default)]
    filter_expression: Option<String>,
    attachment: Attachment,
}

/// Whether Firefox on a desktop release takes this record: no filter, or one that only leaves out Android's release.
fn for_desktop(filter: Option<&str>) -> bool {
    match filter.map(str::trim).unwrap_or("") {
        "" => true,
        f => f == "env.appinfo.OS != 'Android' || env.channel != 'release'",
    }
}

/// "2.1" > "2.0" > "2.0a1" > "1.0": numbers first, a pre-release suffix below the plain release.
fn version_key(v: &str) -> (Vec<u32>, bool) {
    let (num, pre) = match v.find(|c: char| c.is_ascii_alphabetic()) {
        Some(i) => (&v[..i], true),
        None => (v, false),
    };
    (num.split('.').map(|p| p.parse().unwrap_or(0)).collect(), !pre)
}

/// The model, shortlist and vocabulary of the newest desktop version of a pair, or None when one is missing.
fn pick(records: &[Record], from: &str, to: &str) -> Option<Vec<(&'static str, Attachment)>> {
    let mine: Vec<&Record> = records.iter().filter(|r| r.from_lang == from && r.to_lang == to && for_desktop(r.filter_expression.as_deref())).collect();
    let newest = mine.iter().map(|r| version_key(&r.version)).max()?;
    KINDS
        .iter()
        .map(|kind| mine.iter().find(|r| version_key(&r.version) == newest && r.file_type == *kind).map(|r| (*kind, r.attachment.clone())))
        .collect()
}

async fn fetch(client: &reqwest::Client, location: &str, sha256: &str, size: u64) -> Result<Vec<u8>, String> {
    if size > MAX_FILE {
        return Err("too-large".into());
    }
    let res = client.get(format!("{CDN}{location}")).send().await.map_err(|_| "unavailable")?;
    if !res.status().is_success() {
        return Err("unavailable".into());
    }
    let bytes = res.bytes().await.map_err(|_| "unavailable")?;
    if bytes.len() as u64 != size || format!("{:x}", Sha256::digest(&bytes)) != sha256 {
        return Err("checksum".into());
    }
    Ok(bytes.to_vec())
}

fn write(path: &std::path::Path, bytes: &[u8]) -> Result<(), String> {
    std::fs::create_dir_all(path.parent().ok_or("failed")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Downloads the engine (once) and the pair's three files; returns the pair's size. Nothing is kept unless it matches.
#[tauri::command]
pub async fn translate_download(from: String, to: String, app: AppHandle) -> Result<u64, String> {
    let dir = pair_dir(&app, &from, &to)?;
    let root = root(&app)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(600)).user_agent("Crest").build().map_err(|_| "unavailable")?;
    let engine = root.join("engine.wasm");
    if !std::fs::metadata(&engine).is_ok_and(|m| m.len() == ENGINE_SIZE) {
        write(&engine, &fetch(&client, ENGINE, ENGINE_SHA256, ENGINE_SIZE).await?)?;
    }
    #[derive(Deserialize)]
    struct Catalog {
        data: Vec<Record>,
    }
    let catalog: Catalog = client.get(CATALOG).send().await.map_err(|_| "unavailable")?.json().await.map_err(|_| "unavailable")?;
    let files = pick(&catalog.data, &from, &to).ok_or("no-model")?;
    let mut total = 0;
    for (kind, a) in files {
        write(&dir.join(kind), &fetch(&client, &a.location, &a.hash, a.size).await?)?;
        total += a.size;
    }
    Ok(total)
}

#[tauri::command]
pub fn translate_remove(from: String, to: String, app: AppHandle) -> Result<(), String> {
    match std::fs::remove_dir_all(pair_dir(&app, &from, &to)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// One file for the worker, as raw bytes: "engine", or a pair's "model", "lex" or "vocab".
#[tauri::command]
pub async fn translate_file(pair: Option<String>, kind: String, app: AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = match pair {
        None if kind == "engine" => root(&app)?.join("engine.wasm"),
        Some(pair) if KINDS.contains(&kind.as_str()) => {
            let (from, to) = pair.split_once('-').ok_or("pair")?;
            pair_dir(&app, from, to)?.join(&kind)
        }
        _ => return Err("file".into()),
    };
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(path)).await.map_err(|e| e.to_string())?.map_err(|_| "missing")?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rec(from: &str, to: &str, kind: &str, version: &str, filter: &str, location: &str) -> Record {
        Record {
            from_lang: from.into(),
            to_lang: to.into(),
            file_type: kind.into(),
            version: version.into(),
            filter_expression: Some(filter.into()),
            attachment: Attachment { location: location.into(), hash: "h".into(), size: 1 },
        }
    }

    /// The newest version Firefox on a desktop release would use: Android-only and nightly-only records stay out.
    #[test]
    fn picks_the_newest_desktop_files_of_a_pair() {
        let android = "env.appinfo.OS == 'Android' ";
        let desktop = "env.appinfo.OS != 'Android' || env.channel != 'release'";
        let nightly = "env.channel == 'default' || env.channel == 'nightly'";
        let mut records = Vec::new();
        for kind in KINDS {
            records.push(rec("ja", "en", kind, "2.1", android, &format!("android-{kind}")));
            records.push(rec("ja", "en", kind, "2.0", desktop, &format!("desktop-{kind}")));
            records.push(rec("ja", "en", kind, "2.0a1", nightly, &format!("nightly-{kind}")));
            records.push(rec("ja", "en", kind, "1.0", "", &format!("old-{kind}")));
            records.push(rec("en", "it", kind, "2.1", "", &format!("it-{kind}")));
        }
        let got: Vec<String> = pick(&records, "ja", "en").unwrap().into_iter().map(|(_, a)| a.location).collect();
        assert_eq!(got, ["desktop-model", "desktop-lex", "desktop-vocab"]);
        assert!(pick(&records, "ko", "en").is_none());
        // A version with a file missing gives nothing.
        records.retain(|r| !(r.to_lang == "it" && r.file_type == "lex"));
        assert!(pick(&records, "en", "it").is_none());
    }

    #[test]
    fn versions_and_codes() {
        assert!(version_key("2.1") > version_key("2.0") && version_key("2.0") > version_key("2.0a1") && version_key("2.0a1") > version_key("1.0"));
        assert!(code_ok("ja") && code_ok("zh_hant"));
        assert!(!code_ok("..") && !code_ok("j/a") && !code_ok("J") && !code_ok(""));
    }
}
