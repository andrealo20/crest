//! The Files tool (src/features/files): conversions and file tools run by a separate program, `pomelo-engine.exe`, made from
//! Pomelo (a closed Windows app by Crest's author). It is not part of Crest and not under its licence: Crest holds only this bridge.
//!
//! - The Microsoft Store build carries the package inside its MSIX, beside crest.exe in `pomelo-engine\<version>\`
//!   (scripts/store-package.ps1 checks the archive against `ARCHIVE_SHA256` before it unpacks it there), and never downloads,
//!   updates or removes it: the Store's policy 10.2.2 allows no code fetched after install.
//! - Elsewhere the program is downloaded only when the user asks for it: a manifest, then the archive's parts, each checked against the
//!   manifest and the whole archive against `VERSION` and `ARCHIVE_SHA256` here, which a manifest cannot change. It is unpacked
//!   into a temporary folder and renamed to `<local data>\pomelo-engine\<version>\`, so a broken download never looks installed.
//! - It runs without a window and answers on stdout in JSON lines (`catalog`, `run`, `license`), keeping its licence, free
//!   allowance and temporary files in `<local data>\pomelo`. Crest's only network use here is the download. The licence (paid
//!   with Stripe, keys made by Pomelo's service on pomeloapp.net) is checked and activated by the program itself; Crest only
//!   opens the payment page and passes a key the user typed or brought by a `crest://license` link (link.rs).
//! - Everything the page sends is checked before it reaches the program: files that exist, an operation of the catalog, and
//!   options the operation has, with values of their type.

use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::ipc::Channel;
use tauri::{AppHandle, WebviewWindow};

use crate::agents::job::Job;

/// The wheel, `Pomelo.exe --hosted`.
pub mod wheel;

/// `crest://license?key=`: a bought key into the licence field.
pub mod link;

/// The package Crest runs (the engine, and from 1.1.0 the wheel's `Pomelo.exe` beside it), numbered as the Pomelo it is made
/// from, and the protocol of its lines.
const VERSION: &str = "1.7.0";
const PROTOCOL: u64 = 1;
/// SHA-256 and size in bytes of the whole archive of `VERSION`, set from the real archive with each new engine. The download
/// checks against them, and so does scripts/store-package.ps1, which reads them from here. All zeros would mean none.
const ARCHIVE_SHA256: &str = "aac069018272621be1d47cada3334584de67f4b75b443f0f3aa0f497c2a78e10";
const ARCHIVE_SIZE: u64 = 107_446_305;
/// The manifest of `VERSION`, published beside the archive's parts, which must come from the same host. One folder per
/// version, so an older Crest keeps downloading the engine it knows.
fn manifest_url() -> String {
    format!("https://pomeloapp.net/engine/{VERSION}/manifest.json")
}
const EXE: &str = "pomelo-engine.exe";
/// The whole Pomelo app, hosted by Crest as the wheel (wheel.rs); packages before 1.1.0 lack it.
const WHEEL_EXE: &str = "Pomelo.exe";

/// The wheel's program beside the engine, or in `wheel\` where the package keeps Pomelo apart (a DLL of the same name that differs).
fn wheel_path(engine: &Path) -> Option<PathBuf> {
    let dir = engine.parent()?;
    [dir.join(WHEEL_EXE), dir.join("wheel").join(WHEEL_EXE)].into_iter().find(|p| p.is_file())
}
/// Where a key bought before is sent again, by the email of the purchase.
const RECOVER_URL: &str = "https://pomeloapp.net/crest/recover";
/// Pomelo's site, for whoever wants to see what it is before downloading the package.
const SITE_URL: &str = "https://pomeloapp.net";
/// No engine is near this; a larger manifest is refused.
const MAX_ARCHIVE: u64 = 400 * 1024 * 1024;
/// A one-line answer (catalog, licence) larger than this is no answer.
const MAX_ANSWER: u64 = 4 * 1024 * 1024;
/// After a cancel the engine stops by itself once its stdin closes; what still runs then is ended.
const GRACE: Duration = Duration::from_secs(3);
/// The line types of `run`; others (a newer engine's) are left out.
const LINE_TYPES: [&str; 8] = ["start", "progress", "busy", "done", "error", "allowance", "end", "locked"];

/// Whether `ARCHIVE_SHA256` names a real archive.
fn available(sha: &str) -> bool {
    sha.len() == 64 && sha.bytes().all(|b| b.is_ascii_hexdigit()) && sha.bytes().any(|b| b != b'0')
}

fn base(app: &AppHandle) -> Result<PathBuf, String> {
    crate::portable::local_data_dir(app)
}

/// The package's versions: downloaded into the local data folder, or in the Store build inside the MSIX, beside crest.exe.
fn engine_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(feature = "store")]
    {
        use tauri::Manager;
        app.path().resource_dir().map(|dir| dir.join("pomelo-engine")).map_err(|_| "app-data".into())
    }
    #[cfg(not(feature = "store"))]
    Ok(base(app)?.join("pomelo-engine"))
}

/// The engine's own folder (`--data`), made on first use.
fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = base(app)?.join("pomelo");
    std::fs::create_dir_all(&dir).map_err(|_| "app-data")?;
    Ok(dir)
}

fn installed(app: &AppHandle) -> Result<PathBuf, String> {
    let exe = engine_dir(app)?.join(VERSION).join(EXE);
    if exe.is_file() {
        Ok(exe)
    } else {
        Err("not-installed".into())
    }
}

#[derive(Serialize)]
pub struct Status {
    /// The installed version, None without one.
    version: Option<&'static str>,
    /// The installed package has the wheel's `Pomelo.exe`.
    wheel: bool,
    /// Only an older package is installed (one without the wheel): a download updates it.
    outdated: bool,
    /// Whether a download is possible (this build knows an archive, and is not the Store's).
    available: bool,
    /// The package comes inside Crest's own (the Store build): no download, update or removal.
    bundled: bool,
    /// The download's size in bytes, 0 when unknown.
    size: u64,
}

#[tauri::command(async)]
pub fn files_engine_status(app: AppHandle) -> Status {
    let exe = installed(&app).ok();
    let bundled = cfg!(feature = "store");
    let outdated = !bundled && exe.is_none() && engine_dir(&app).is_ok_and(|dir| older_package(&dir));
    Status {
        version: exe.as_ref().map(|_| VERSION),
        wheel: exe.as_deref().and_then(wheel_path).is_some(),
        outdated,
        available: !bundled && available(ARCHIVE_SHA256),
        size: ARCHIVE_SIZE,
        bundled,
    }
}

/// A version folder other than `VERSION` with an engine in it.
fn older_package(dir: &Path) -> bool {
    std::fs::read_dir(dir).into_iter().flatten().flatten().any(|e| e.file_name() != VERSION && !e.file_name().to_string_lossy().starts_with('.') && e.path().join(EXE).is_file())
}

/// The payment page of `license status`'s `buy`, https on Stripe or pomeloapp.net only, with the engine's random instance id
/// as `client_reference_id` when it gives one (the service ties the purchase to it). Nothing of the user's goes in it.
fn buy_url(status: &Value) -> Option<String> {
    let mut url = tauri::Url::parse(status["buy"].as_str()?).ok()?;
    let host = url.host_str()?;
    if url.scheme() != "https" || !(host == "buy.stripe.com" || host == "pomeloapp.net" || host.ends_with(".pomeloapp.net")) {
        return None;
    }
    // Stripe takes up to 200 letters, digits, dashes and underscores here.
    let id = status["instance_id"].as_str().filter(|id| (1..=200).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'));
    if let Some(id) = id {
        url.query_pairs_mut().append_pair("client_reference_id", id);
    }
    Some(url.into())
}

/// Buy: the payment page the engine names, in the default browser.
#[tauri::command(async)]
pub fn files_buy(app: AppHandle) -> Result<(), String> {
    let status = files_license(app, "status".into(), None)?;
    crate::open_url(&buy_url(&status).ok_or("unavailable")?)
}

/// One of pomeloapp.net's pages, by name: `site` (Discover Pomelo) or `recover` (Already bought?). Nothing else opens from here.
#[tauri::command]
pub fn files_page(page: String) -> Result<(), String> {
    crate::open_url(match page.as_str() {
        "site" => SITE_URL,
        "recover" => RECOVER_URL,
        _ => return Err("page".into()),
    })
}

// ---------- Download ----------

#[derive(Deserialize)]
struct Manifest {
    version: String,
    protocol: u64,
    parts: Vec<Part>,
    sha256: String,
}

#[derive(Deserialize)]
struct Part {
    url: String,
    size: u64,
    sha256: String,
}

#[derive(Serialize, Clone)]
pub struct Progress {
    done: u64,
    total: u64,
}

/// What Crest accepts of a manifest: the expected version, protocol and archive (`sha`, `size`, 0 for any up to the limit), in
/// parts over HTTPS from the manifest's own host. Returns the archive's size.
fn check_manifest(m: &Manifest, version: &str, sha: &str, size: u64) -> Result<u64, String> {
    let host = |url: &str| reqwest::Url::parse(url).ok().filter(|u| u.scheme() == "https").and_then(|u| u.host_str().map(str::to_owned));
    let total = m.parts.iter().try_fold(0u64, |n, p| n.checked_add(p.size)).unwrap_or(u64::MAX);
    let ok = available(sha)
        && m.version == version
        && m.protocol == PROTOCOL
        && m.sha256.eq_ignore_ascii_case(sha)
        && !m.parts.is_empty()
        && total <= MAX_ARCHIVE
        && (size == 0 || total == size)
        && m.parts.iter().all(|p| available(&p.sha256) && host(&p.url).is_some() && host(&p.url) == host(&manifest_url()));
    if ok {
        Ok(total)
    } else {
        Err("mismatch".into())
    }
}

/// Whether `n` bytes hashed into `h` are the expected ones.
fn matches(h: Sha256, n: u64, size: u64, sha: &str) -> bool {
    n == size && format!("{:x}", h.finalize()).eq_ignore_ascii_case(sha)
}

static DOWNLOADING: AtomicBool = AtomicBool::new(false);
/// Set by `files_engine_download_cancel`; the download stops at its next chunk.
static STOP_DOWNLOAD: AtomicBool = AtomicBool::new(false);

/// Holds `DOWNLOADING` while a download runs and lets it go on every way out, an error or a panic included.
struct Downloading;

impl Downloading {
    fn start() -> Option<Downloading> {
        (!DOWNLOADING.swap(true, Ordering::SeqCst)).then(|| {
            STOP_DOWNLOAD.store(false, Ordering::SeqCst);
            Downloading
        })
    }
}

impl Drop for Downloading {
    fn drop(&mut self) {
        DOWNLOADING.store(false, Ordering::SeqCst);
    }
}

/// Downloads, checks and installs the engine, reporting the bytes so far; returns the installed version.
#[tauri::command]
pub async fn files_engine_download(app: AppHandle, on_progress: Channel<Progress>) -> Result<String, String> {
    // The Microsoft Store forbids code downloaded after install (policy 10.2.2): its build never fetches the engine.
    if cfg!(feature = "store") || !available(ARCHIVE_SHA256) {
        return Err("unavailable".into());
    }
    let Some(_held) = Downloading::start() else { return Err("busy".into()) };
    download(&app, &on_progress).await.map(|_| VERSION.to_string())
}

/// Installs a checked archive, never over a folder in use: no run of the engine meanwhile, and a running wheel is stopped first
/// and started again after.
fn install_unused(app: &AppHandle, dir: &Path, archive: &Path) -> Result<(), String> {
    if lock(&RUN).is_some() {
        return Err("busy".into());
    }
    let (paused, unused) = wheel::pause_for_update(app);
    let result = if unused { install(dir, archive) } else { Err("busy".into()) };
    wheel::resume_after_update(app, paused);
    result
}

/// Stops a running download; nothing of it is kept.
#[tauri::command]
pub fn files_engine_download_cancel() {
    STOP_DOWNLOAD.store(true, Ordering::SeqCst);
}

async fn download(app: &AppHandle, progress: &Channel<Progress>) -> Result<(), String> {
    let dir = engine_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|_| "app-data")?;
    // A connection that stalls (no byte for a minute) fails instead of hanging the download for good.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .user_agent("Crest")
        .build()
        .map_err(|_| "offline")?;
    let manifest: Manifest = client
        .get(manifest_url())
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|_| "offline")?
        .error_for_status()
        .map_err(|_| "unavailable")?
        .json()
        .await
        .map_err(|_| "unavailable")?;
    let total = check_manifest(&manifest, VERSION, ARCHIVE_SHA256, ARCHIVE_SIZE)?;
    let archive = dir.join(".download.zip");
    let fetched = fetch_parts(&client, &manifest, &archive, total, progress).await;
    let result = match fetched {
        Ok(()) => {
            let (app, dir, archive) = (app.clone(), dir.clone(), archive.clone());
            tauri::async_runtime::spawn_blocking(move || install_unused(&app, &dir, &archive)).await.map_err(|_| "failed")?
        }
        Err(e) => Err(e),
    };
    let _ = std::fs::remove_file(&archive);
    result
}

async fn fetch_parts(client: &reqwest::Client, m: &Manifest, archive: &Path, total: u64, progress: &Channel<Progress>) -> Result<(), String> {
    let mut file = std::fs::File::create(archive).map_err(|_| "app-data")?;
    let mut whole = Sha256::new();
    let (mut done, mut told) = (0u64, 0u64);
    let _ = progress.send(Progress { done, total });
    for part in &m.parts {
        let mut res = client.get(&part.url).send().await.map_err(|_| "offline")?.error_for_status().map_err(|_| "unavailable")?;
        let (mut h, mut n) = (Sha256::new(), 0u64);
        while let Some(chunk) = res.chunk().await.map_err(|_| "offline")? {
            if STOP_DOWNLOAD.load(Ordering::SeqCst) {
                return Err("cancelled".into());
            }
            n += chunk.len() as u64;
            if n > part.size {
                return Err("checksum".into());
            }
            h.update(&chunk);
            whole.update(&chunk);
            file.write_all(&chunk).map_err(|_| "disk")?;
            done += chunk.len() as u64;
            if done - told >= 256 * 1024 || done == total {
                told = done;
                let _ = progress.send(Progress { done, total });
            }
        }
        if !matches(h, n, part.size, &part.sha256) {
            return Err("checksum".into());
        }
    }
    file.flush().map_err(|_| "disk")?;
    if matches(whole, done, total, ARCHIVE_SHA256) {
        Ok(())
    } else {
        Err("checksum".into())
    }
}

/// Unpacks a checked archive into `<dir>\<VERSION>`, through a temporary folder; other versions go.
fn install(dir: &Path, archive: &Path) -> Result<(), String> {
    let tmp = dir.join(format!(".{VERSION}.tmp"));
    let _ = std::fs::remove_dir_all(&tmp);
    if let Err(e) = extract(archive, &tmp) {
        let _ = std::fs::remove_dir_all(&tmp);
        return Err(e);
    }
    let target = dir.join(VERSION);
    let _ = std::fs::remove_dir_all(&target);
    std::fs::rename(&tmp, &target).map_err(|_| "disk")?;
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        if entry.file_name() != VERSION && entry.path().is_dir() {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
    Ok(())
}

fn extract(archive: &Path, to: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::fs::File::open(archive).map_err(|_| "zip")?).map_err(|_| "zip")?;
    for i in 0..zip.len() {
        let mut entry = zip.by_index(i).map_err(|_| "zip")?;
        // A name that would leave the folder (absolute, "..") has none.
        let path = to.join(entry.enclosed_name().ok_or("zip")?);
        if entry.is_dir() {
            std::fs::create_dir_all(&path).map_err(|_| "disk")?;
            continue;
        }
        std::fs::create_dir_all(path.parent().ok_or("zip")?).map_err(|_| "disk")?;
        let mut out = std::fs::File::create(&path).map_err(|_| "disk")?;
        std::io::copy(&mut entry, &mut out).map_err(|_| "disk")?;
    }
    if to.join(EXE).is_file() {
        Ok(())
    } else {
        Err("zip".into())
    }
}

#[tauri::command(async)]
pub fn files_engine_remove(app: AppHandle) -> Result<(), String> {
    // The Store's package keeps its engine: Windows removes it with Crest.
    if cfg!(feature = "store") {
        return Err("bundled".into());
    }
    if lock(&RUN).is_some() || DOWNLOADING.load(Ordering::SeqCst) {
        return Err("busy".into());
    }
    // The running wheel holds its files open.
    if wheel::running() {
        return Err("wheel".into());
    }
    *lock(&CATALOG) = None;
    match std::fs::remove_dir_all(engine_dir(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err("locked".into()),
        _ => Ok(()),
    }
}

// ---------- Running it ----------

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Op {
    id: String,
    /// "convert" | "tools" | "actions"
    tab: String,
    name: String,
    #[serde(default)]
    kinds: Vec<String>,
    /// The extensions it takes, with their dot (".jpg").
    #[serde(default)]
    extensions: Vec<String>,
    #[serde(default)]
    output: Option<String>,
    #[serde(default)]
    options: Vec<Opt>,
    /// Joins all its files into one result (a merge, a ZIP); without it each file gives its own.
    #[serde(default)]
    multi: bool,
    /// Asks for a password, which goes to the engine's stdin.
    #[serde(default)]
    secret: bool,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Opt {
    id: String,
    /// "int" | "bool" | "choice" | "text"
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    label: String,
    #[serde(default)]
    default: Value,
    #[serde(default)]
    min: Option<f64>,
    #[serde(default)]
    max: Option<f64>,
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Choice {
    id: String,
    label: String,
}

/// The catalog the page saw last: `run` takes only its operations.
static CATALOG: Mutex<Option<Vec<Op>>> = Mutex::new(None);

struct Running {
    /// Closing it is the engine's own cancel.
    stdin: Option<ChildStdin>,
    child: Child,
    job: Option<Job>,
    cancelled: bool,
}

/// One run at a time.
static RUN: Mutex<Option<Running>> = Mutex::new(None);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// An id as the catalog writes them ("image.convert.png", "quality"): nothing a command line could read as more.
fn id_ok(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b)) && !id.starts_with('-')
}

fn command(exe: &Path, args: &[OsString]) -> Command {
    let mut cmd = Command::new(exe);
    cmd.args(args).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    if let Some(dir) = exe.parent() {
        cmd.current_dir(dir);
    }
    crate::convert::hide_console(&mut cmd);
    cmd
}

/// Runs a command that answers with one JSON object, ended after `timeout`: the object (None for no answer) and the exit code.
fn once(mut cmd: Command, timeout: Duration) -> Result<(Option<Value>, i32), String> {
    let mut child = cmd.spawn().map_err(|_| "broken")?;
    let job = Job::hold(&child);
    let out = child.stdout.take().ok_or("broken")?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = out.take(MAX_ANSWER).read_to_string(&mut text);
        text
    });
    let start = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|_| "broken")? {
            break status;
        }
        if start.elapsed() > timeout {
            if let Some(job) = &job {
                job.kill();
            }
            let _ = child.kill();
            let _ = child.wait();
            return Err("timeout".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    };
    let text = reader.join().unwrap_or_default();
    let value = text.lines().find_map(|l| serde_json::from_str::<Value>(l.trim().trim_start_matches('\u{feff}')).ok().filter(Value::is_object));
    Ok((value, status.code().unwrap_or(-1)))
}

/// What an exit code of the engine means, None for done.
fn exit_error(code: i32) -> Option<&'static str> {
    match code {
        0 => None,
        2 => Some("args"),
        3 => Some("locked"),
        4 => Some("broken"),
        _ => Some("failed"),
    }
}

/// A language code ("it", "pt-BR", "zh-Hans").
fn lang_ok(lang: &str) -> bool {
    (2..=16).contains(&lang.len()) && lang.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-') && !lang.starts_with('-')
}

fn parse_catalog(value: Value) -> Result<Vec<Op>, String> {
    #[derive(Deserialize)]
    struct Catalog {
        ops: Vec<Op>,
    }
    let Catalog { ops } = serde_json::from_value(value).map_err(|_| "broken")?;
    Ok(ops
        .into_iter()
        .filter(|o| id_ok(&o.id) && ["convert", "tools", "actions"].contains(&o.tab.as_str()) && o.options.iter().all(|x| id_ok(&x.id)))
        .collect())
}

/// The operations the engine offers, with names in `lang` where it has them.
#[tauri::command(async)]
pub fn files_catalog(app: AppHandle, lang: Option<String>) -> Result<Vec<Op>, String> {
    let exe = installed(&app)?;
    let mut args: Vec<OsString> = vec!["catalog".into(), "--data".into(), data_dir(&app)?.into()];
    if let Some(lang) = lang.filter(|l| lang_ok(l)) {
        args.extend(["--lang".into(), lang.into()]);
    }
    let (value, code) = once(command(&exe, &args), Duration::from_secs(30))?;
    if let Some(e) = exit_error(code) {
        return Err(e.into());
    }
    let ops = parse_catalog(value.ok_or("broken")?)?;
    *lock(&CATALOG) = Some(ops.clone());
    Ok(ops)
}

/// Whether `v` is a value of option `opt`: one line, short, and of its type.
fn value_ok(opt: &Opt, v: &str) -> bool {
    if v.len() > 256 || v.chars().any(char::is_control) {
        return false;
    }
    match opt.kind.as_str() {
        "int" => v.parse::<i64>().is_ok_and(|n| opt.min.is_none_or(|m| n as f64 >= m) && opt.max.is_none_or(|m| n as f64 <= m)),
        "bool" => v == "true" || v == "false",
        "choice" => opt.choices.iter().any(|c| c.id == v),
        "text" => true,
        _ => false,
    }
}

/// The arguments of `run`, after checking every input against the operation: files that exist and that it takes (one unless
/// `multi`), an output folder that exists or "same" (beside the originals), and options it has with values of their type.
fn run_args(data: &Path, lang: Option<&str>, op: &Op, out: Option<&str>, options: &[(String, String)], files: &[String]) -> Result<Vec<OsString>, String> {
    // Every operation takes several files, done one by one; `multi` only says it joins them into one result.
    if files.is_empty() {
        return Err("files".into());
    }
    for f in files {
        let path = Path::new(f);
        let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy().to_lowercase())).unwrap_or_default();
        if !path.is_absolute() || !path.is_file() || (!op.extensions.is_empty() && !op.extensions.iter().any(|x| x.eq_ignore_ascii_case(&ext))) {
            return Err("files".into());
        }
    }
    let out: OsString = match out {
        None | Some("same") => "same".into(),
        Some(dir) if Path::new(dir).is_absolute() && Path::new(dir).is_dir() => dir.into(),
        Some(_) => return Err("out".into()),
    };
    let mut args: Vec<OsString> = vec!["run".into(), "--data".into(), data.into(), "--op".into(), op.id.clone().into(), "--out".into(), out];
    // The language of the engine's error texts.
    if let Some(lang) = lang.filter(|l| lang_ok(l)) {
        args.extend(["--lang".into(), lang.into()]);
    }
    for (i, (key, value)) in options.iter().enumerate() {
        let known = op.options.iter().find(|o| &o.id == key).ok_or("option")?;
        if !value_ok(known, value) || options[..i].iter().any(|(k, _)| k == key) {
            return Err("option".into());
        }
        args.extend(["--opt".into(), format!("{key}={value}").into()]);
    }
    args.push("--".into());
    args.extend(files.iter().map(OsString::from));
    Ok(args)
}

/// A line of `run` as the page gets it: a JSON object of a known type, None for anything else.
fn parse_line(line: &str) -> Option<Value> {
    let v: Value = serde_json::from_str(line.trim().trim_start_matches('\u{feff}')).ok()?;
    LINE_TYPES.contains(&v.get("type")?.as_str()?).then_some(v)
}

/// Runs `cmd`, passing each line to `emit` as it comes; returns the exit code, or "cancelled".
fn run_process(mut cmd: Command, secret: Option<&str>, mut emit: impl FnMut(Value)) -> Result<i32, String> {
    let mut slot = lock(&RUN);
    if slot.is_some() {
        return Err("busy".into());
    }
    let mut child = cmd.spawn().map_err(|_| "broken")?;
    let job = Job::hold(&child);
    let mut stdin = child.stdin.take();
    if let (Some(secret), Some(pipe)) = (secret, stdin.as_mut()) {
        let _ = writeln!(pipe, "{secret}").and_then(|_| pipe.flush());
    }
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return Err("broken".into());
    };
    *slot = Some(Running { stdin, child, job, cancelled: false });
    drop(slot);
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if let Some(v) = parse_line(&line) {
            emit(v);
        }
    }
    let mut run = lock(&RUN).take().ok_or("failed")?;
    drop(run.stdin.take());
    let status = run.child.wait().map_err(|_| "failed")?;
    if run.cancelled {
        Err("cancelled".into())
    } else {
        Ok(status.code().unwrap_or(-1))
    }
}

/// Closes the engine's stdin, its own way to stop with the originals intact; whatever still runs after `GRACE` is ended.
fn cancel() {
    let mut slot = lock(&RUN);
    let Some(run) = slot.as_mut() else { return };
    run.cancelled = true;
    drop(run.stdin.take());
    drop(slot);
    std::thread::spawn(|| {
        std::thread::sleep(GRACE);
        if let Some(run) = lock(&RUN).as_mut().filter(|r| r.cancelled) {
            if let Some(job) = &run.job {
                job.kill();
            }
            let _ = run.child.kill();
        }
    });
}

/// Runs operation `op` on `files`; the engine's lines come as `on_event`. `options` are (id, value) pairs of the operation's
/// options; `secret` is the password an operation with `secret` asks for.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
pub fn files_run(
    app: AppHandle,
    op: String,
    files: Vec<String>,
    out: Option<String>,
    options: Vec<(String, String)>,
    secret: Option<String>,
    lang: Option<String>,
    on_event: Channel<Value>,
) -> Result<(), String> {
    let exe = installed(&app)?;
    let op = lock(&CATALOG).as_ref().and_then(|ops| ops.iter().find(|o| o.id == op).cloned()).ok_or("op")?;
    let secret = match (op.secret, secret) {
        (true, Some(s)) if !s.is_empty() && s.len() <= 1024 && !s.contains(['\r', '\n']) => Some(s),
        (false, _) => None,
        _ => return Err("password".into()),
    };
    let args = run_args(&data_dir(&app)?, lang.as_deref(), &op, out.as_deref(), &options, &files)?;
    let code = run_process(command(&exe, &args), secret.as_deref(), |v| {
        let _ = on_event.send(v);
    })?;
    exit_error(code).map_or(Ok(()), |e| Err(e.into()))
}

#[tauri::command]
pub fn files_cancel() {
    cancel();
}

/// A licence key as typed: letters, digits and dashes (the engine knows the exact form and normalises it).
fn key_ok(key: &str) -> bool {
    (8..=128).contains(&key.len()) && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

/// `license status|activate|deactivate`: the engine's answer as it gives it (null for none).
#[tauri::command(async)]
pub fn files_license(app: AppHandle, action: String, key: Option<String>) -> Result<Value, String> {
    let exe = installed(&app)?;
    let mut args: Vec<OsString> = vec!["license".into(), action.clone().into(), "--data".into(), data_dir(&app)?.into()];
    match action.as_str() {
        "status" | "deactivate" => {}
        "activate" => {
            let key = key.map(|k| k.split_whitespace().collect::<String>()).filter(|k| key_ok(k)).ok_or("key")?;
            args.extend(["--key".into(), key.into()]);
        }
        _ => return Err("action".into()),
    }
    // Activating goes to Pomelo's licence service over the network, from the engine.
    let timeout = Duration::from_secs(if action == "activate" { 60 } else { 45 });
    match once(command(&exe, &args), timeout)? {
        (Some(v), _) => Ok(v),
        (None, code) => exit_error(code).map_or(Ok(Value::Null), |e| Err(e.into())),
    }
}

/// A folder for the results, picked over the calling window; None when cancelled.
#[tauri::command]
pub async fn files_pick_folder(window: WebviewWindow) -> Option<String> {
    crate::picker::pick(crate::picker::Pick::Folder, &window).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The test engine: a batch file that prints the contract's lines (fake-engine.cmd beside this file, not part of the app).
    fn fake() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("pomelo_engine").join("fake-engine.cmd")
    }

    fn op(json: Value) -> Op {
        serde_json::from_value(json).unwrap()
    }

    fn png() -> Op {
        op(serde_json::json!({
            "id": "image.convert.png", "tab": "convert", "name": "PNG", "extensions": [".jpg", ".png"], "output": ".png", "multi": true,
            "options": [
                { "id": "quality", "type": "int", "label": "Quality", "default": 80, "min": 1, "max": 100 },
                { "id": "strip", "type": "bool", "label": "Strip", "default": true },
                { "id": "size", "type": "choice", "label": "Size", "default": "s", "choices": [{ "id": "s", "label": "Small" }] },
            ],
        }))
    }

    /// Two real files in a folder of their own.
    fn files() -> (PathBuf, Vec<String>) {
        let dir = std::env::temp_dir().join(format!("crest-engine-test-{}-{:?}", std::process::id(), std::thread::current().id()));
        std::fs::create_dir_all(&dir).unwrap();
        let paths = ["a.jpg", "B.PNG"].map(|n| {
            let p = dir.join(n);
            std::fs::write(&p, b"x").unwrap();
            p.to_string_lossy().into_owned()
        });
        (dir, paths.to_vec())
    }

    #[test]
    fn lines_of_known_types_only() {
        assert_eq!(parse_line(r#"{"type":"progress","index":0,"fraction":0.42}"#).unwrap()["fraction"], 0.42);
        assert!(parse_line("\u{feff}{\"type\":\"end\",\"ok\":3,\"failed\":0}\r").is_some());
        for line in ["", "hello", "[1,2]", r#"{"index":0}"#, r#"{"type":"surprise"}"#, r#"{"type":4}"#, r#"{"type":"done""#] {
            assert!(parse_line(line).is_none(), "{line}");
        }
    }

    #[test]
    fn digests_and_manifests() {
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let hashed = |b: &[u8]| {
            let mut h = Sha256::new();
            h.update(b);
            h
        };
        assert!(matches(hashed(b"abc"), 3, 3, abc));
        assert!(matches(hashed(b"abc"), 3, 3, &abc.to_uppercase()));
        assert!(!matches(hashed(b"abd"), 3, 3, abc));
        assert!(!matches(hashed(b"abc"), 3, 4, abc));

        // All zeros names no archive, so even a manifest that repeats it is refused.
        let zeros = "0".repeat(64);
        assert!(available(ARCHIVE_SHA256) && !available(&zeros) && !available("") && !available(&"g".repeat(64)) && available(abc));
        let manifest = |sha: &str, url: &str, size: u64| Manifest {
            version: "1.0.0".into(),
            protocol: 1,
            parts: vec![Part { url: url.into(), size, sha256: abc.into() }, Part { url: "https://pomeloapp.net/engine/b".into(), size: 5, sha256: abc.into() }],
            sha256: sha.into(),
        };
        let good = manifest(abc, "https://pomeloapp.net/engine/a", 10);
        assert_eq!(check_manifest(&good, "1.0.0", abc, 15), Ok(15));
        assert_eq!(check_manifest(&good, "1.0.0", abc, 0), Ok(15));
        assert!(check_manifest(&good, "1.0.0", &zeros, 0).is_err());
        assert!(check_manifest(&manifest(&zeros, "https://pomeloapp.net/a", 10), "1.0.0", &zeros, 0).is_err());
        assert!(check_manifest(&good, "1.0.1", abc, 0).is_err());
        assert!(check_manifest(&good, "1.0.0", abc, 16).is_err());
        assert!(check_manifest(&manifest(&abc.replace('b', "c"), "https://pomeloapp.net/a", 10), "1.0.0", abc, 0).is_err());
        assert!(check_manifest(&manifest(abc, "http://pomeloapp.net/a", 10), "1.0.0", abc, 0).is_err());
        assert!(check_manifest(&manifest(abc, "https://elsewhere.example/a", 10), "1.0.0", abc, 0).is_err());
        assert!(check_manifest(&manifest(abc, "https://pomeloapp.net/a", u64::MAX), "1.0.0", abc, 0).is_err());
    }

    #[test]
    fn arguments_from_checked_inputs_only() {
        let (dir, files) = files();
        let data = Path::new(r"C:\data\pomelo");
        let png = png();
        let opts = |list: &[(&str, &str)]| list.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>();
        let args = run_args(data, Some("it"), &png, None, &opts(&[("quality", "90"), ("strip", "false"), ("size", "s")]), &files).unwrap();
        let mut want: Vec<OsString> = ["run", "--data", r"C:\data\pomelo", "--op", "image.convert.png", "--out", "same", "--lang", "it", "--opt", "quality=90", "--opt", "strip=false", "--opt", "size=s", "--"]
            .map(OsString::from)
            .to_vec();
        want.extend(files.iter().map(OsString::from));
        assert_eq!(args, want);
        let out = dir.to_string_lossy().into_owned();
        assert_eq!(run_args(data, None, &png, Some(&out), &[], &files[..1]).unwrap()[6], OsString::from(&out));

        let bad = |out: Option<&str>, o: &[(&str, &str)], f: &[String]| run_args(data, None, &png, out, &opts(o), f).unwrap_err();
        assert_eq!(bad(None, &[("quality", "0")], &files), "option");
        assert_eq!(bad(None, &[("quality", "x")], &files), "option");
        assert_eq!(bad(None, &[("strip", "yes")], &files), "option");
        assert_eq!(bad(None, &[("size", "huge")], &files), "option");
        assert_eq!(bad(None, &[("other", "1")], &files), "option");
        assert_eq!(bad(None, &[("quality", "5"), ("quality", "6")], &files), "option");
        assert_eq!(bad(None, &[], &[]), "files");
        assert_eq!(bad(None, &[], &[dir.join("missing.jpg").to_string_lossy().into_owned()]), "files");
        assert_eq!(bad(None, &[], &["a.jpg".to_string()]), "files");
        assert_eq!(bad(Some("relative"), &[], &files), "out");
        assert_eq!(bad(Some(&dir.join("nope").to_string_lossy()), &[], &files), "out");
        let txt = dir.join("c.txt");
        std::fs::write(&txt, b"x").unwrap();
        assert_eq!(bad(None, &[], &[txt.to_string_lossy().into_owned()]), "files");
        // One result per file: several files still go, one by one.
        let each = Op { multi: false, ..png.clone() };
        assert_eq!(run_args(data, None, &each, None, &[], &files).unwrap().len(), want.len() - 8);

        let text = op(serde_json::json!({ "id": "t", "tab": "tools", "name": "T", "options": [{ "id": "name", "type": "text" }] }));
        assert!(run_args(data, None, &text, None, &opts(&[("name", "a b = c")]), &files[..1]).is_ok());
        assert_eq!(run_args(data, None, &text, None, &opts(&[("name", "a\nb")]), &files[..1]).unwrap_err(), "option");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn catalog_keeps_known_tabs_and_clean_ids() {
        let ops = parse_catalog(serde_json::json!({ "ops": [
            { "id": "image.convert.png", "tab": "convert", "name": "PNG" },
            { "id": "--evil", "tab": "convert", "name": "X" },
            { "id": "pdf.merge", "tab": "elsewhere", "name": "X" },
            { "id": "pdf.lock", "tab": "actions", "name": "Lock", "secret": true, "options": [{ "id": "bad key", "type": "text" }] },
        ]}))
        .unwrap();
        assert_eq!(ops.iter().map(|o| o.id.as_str()).collect::<Vec<_>>(), ["image.convert.png"]);
        assert!(parse_catalog(serde_json::json!({ "nope": 1 })).is_err());
        assert!(key_ok("38B1460A-5104-4067-A91D-77B872934D51") && !key_ok("short") && !key_ok("38B1460A 5104") && !key_ok("--key=x-yyyyyy"));
    }

    // The engine runs one at a time, and so do the tests that start the fake one.
    static FAKE: Mutex<()> = Mutex::new(());

    #[test]
    fn runs_the_fake_engine() {
        let _one = lock(&FAKE);
        let (dir, files) = files();
        let args = run_args(&dir, None, &png(), None, &[], &files).unwrap();
        let mut lines = Vec::new();
        assert_eq!(run_process(command(&fake(), &args), None, |v| lines.push(v)), Ok(0));
        let types: Vec<&str> = lines.iter().map(|v| v["type"].as_str().unwrap()).collect();
        assert_eq!(types, ["start", "progress", "done", "allowance", "end"]);
        assert_eq!(lines[2]["outputs"][0], r"C:\out\a.png");

        // The password reaches its stdin as one line.
        let mut secret = Op { id: "test.secret".into(), ..png() };
        secret.secret = true;
        let args = run_args(&dir, None, &secret, None, &[], &files[..1]).unwrap();
        let mut lines = Vec::new();
        assert_eq!(run_process(command(&fake(), &args), Some("hunter2"), |v| lines.push(v)), Ok(0));
        assert_eq!(lines[0]["type"], "done");

        let locked = Op { id: "test.locked".into(), ..png() };
        let mut lines = Vec::new();
        let code = run_process(command(&fake(), &run_args(&dir, None, &locked, None, &[], &files).unwrap()), None, |v| lines.push(v)).unwrap();
        assert_eq!((exit_error(code), lines[0]["type"].as_str()), (Some("locked"), Some("locked")));

        let (answer, code) = once(command(&fake(), &["license".into(), "status".into(), "--data".into(), dir.clone().into()]), Duration::from_secs(20)).unwrap();
        let answer = answer.unwrap();
        assert_eq!((answer["state"].as_str(), code), (Some("free"), 0));
        assert_eq!(buy_url(&answer).as_deref(), Some("https://buy.stripe.com/test_fake?client_reference_id=fake-instance"));
        let (answer, _) = once(command(&fake(), &["catalog".into(), "--data".into(), dir.clone().into()]), Duration::from_secs(20)).unwrap();
        assert_eq!(parse_catalog(answer.unwrap()).unwrap()[0].id, "image.convert.png");
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_cancel_ends_the_engine_and_what_it_started() {
        let _one = lock(&FAKE);
        let (dir, files) = files();
        let slow = Op { id: "test.slow".into(), ..png() };
        let args = run_args(&dir, None, &slow, None, &[], &files).unwrap();
        let start = Instant::now();
        let runner = std::thread::spawn(move || run_process(command(&fake(), &args), None, |_| {}));
        // Cancelled once it runs; the batch file ignores its stdin and waits 30 s in a child of its own.
        while lock(&RUN).is_none() {
            std::thread::sleep(Duration::from_millis(20));
        }
        std::thread::sleep(Duration::from_millis(300));
        cancel();
        assert_eq!(runner.join().unwrap(), Err("cancelled".to_string()));
        assert!(start.elapsed() < GRACE + Duration::from_secs(5), "{:?}", start.elapsed());
        assert!(lock(&RUN).is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn a_download_lets_go_of_its_flag_on_every_way_out() {
        {
            let _held = Downloading::start().unwrap();
            assert!(Downloading::start().is_none());
        }
        let panicked = std::panic::catch_unwind(|| {
            let _held = Downloading::start().unwrap();
            panic!("mid-download");
        });
        assert!(panicked.is_err());
        assert!(Downloading::start().is_some());
        assert!(manifest_url().ends_with(&format!("/engine/{VERSION}/manifest.json")));
    }

    #[test]
    fn finds_the_wheel_beside_the_engine_or_in_its_folder() {
        let dir = std::env::temp_dir().join(format!("crest-engine-wheel-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("wheel")).unwrap();
        let engine = dir.join(EXE);
        assert_eq!(wheel_path(&engine), None);
        std::fs::write(dir.join("wheel").join(WHEEL_EXE), b"MZ").unwrap();
        assert_eq!(wheel_path(&engine), Some(dir.join("wheel").join(WHEEL_EXE)));
        std::fs::write(dir.join(WHEEL_EXE), b"MZ").unwrap();
        assert_eq!(wheel_path(&engine), Some(dir.join(WHEEL_EXE)));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn unpacks_only_inside_its_folder() {
        use zip::write::SimpleFileOptions;
        let dir = std::env::temp_dir().join(format!("crest-engine-zip-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let write = |name: &str, entries: &[&str]| {
            let path = dir.join(name);
            let mut w = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
            for e in entries {
                w.start_file(*e, SimpleFileOptions::default()).unwrap();
                w.write_all(b"MZ").unwrap();
            }
            w.finish().unwrap();
            path
        };
        let good = write("good.zip", &[EXE, "lib/engine.dll"]);
        install(&dir, &good).unwrap();
        assert!(dir.join(VERSION).join(EXE).is_file() && dir.join(VERSION).join("lib").join("engine.dll").is_file());
        assert!(!dir.join(format!(".{VERSION}.tmp")).exists());
        assert_eq!(extract(&write("evil.zip", &[EXE, "../evil.exe"]), &dir.join("x")), Err("zip".to_string()));
        assert!(!dir.join("evil.exe").exists());
        assert_eq!(extract(&write("noexe.zip", &["readme.txt"]), &dir.join("y")), Err("zip".to_string()));
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn buy_opens_the_engines_payment_page_with_its_instance_only() {
        let page = "https://buy.stripe.com/test_abc";
        assert_eq!(buy_url(&serde_json::json!({ "buy": page })).as_deref(), Some(page));
        assert_eq!(
            buy_url(&serde_json::json!({ "buy": page, "instance_id": "0f8c2a3e-5b7d-4c1a-9e2f-6a4b8d0c1e3f" })).as_deref(),
            Some("https://buy.stripe.com/test_abc?client_reference_id=0f8c2a3e-5b7d-4c1a-9e2f-6a4b8d0c1e3f")
        );
        // A link with its own query keeps it.
        assert_eq!(
            buy_url(&serde_json::json!({ "buy": "https://pay.pomeloapp.net/x?locale=it", "instance_id": "abc_1" })).as_deref(),
            Some("https://pay.pomeloapp.net/x?locale=it&client_reference_id=abc_1")
        );
        // An instance id that is not one is left out, not escaped in.
        for id in [serde_json::json!("a&b=c"), serde_json::json!(""), serde_json::json!("x".repeat(201)), serde_json::json!("ü"), serde_json::json!(7)] {
            assert_eq!(buy_url(&serde_json::json!({ "buy": page, "instance_id": id })).as_deref(), Some(page), "{id}");
        }
        for bad in ["", "http://buy.stripe.com/x", "https://evil.example/x", "https://buy.stripe.com.evil.example/x", "https://notpomeloapp.net/x", "file:///C:/Windows/notepad.exe", r"C:\x.exe", "javascript:alert(1)"] {
            assert_eq!(buy_url(&serde_json::json!({ "buy": bad })), None, "{bad}");
        }
        assert_eq!(buy_url(&serde_json::json!({ "state": "free" })), None);
        assert_eq!(buy_url(&serde_json::json!({ "buy": true })), None);
    }
}
