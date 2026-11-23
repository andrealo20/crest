//! The desktop's wallpaper: Crest's collection or a folder the user picks, set per screen with the system's own way
//! (IDesktopWallpaper on Windows, NSWorkspace on a Mac, macos/wallpaper.rs), with the system's own fade.
//!
//! The collection's full-size pictures are not in the installer: each one comes from the `wallpapers-1` prerelease of Crest's
//! repository the first time it is used, or all of them with Download, checked against its SHA-256 here, and then stays on the
//! PC. They are kept in the local app data (never the roaming profile), beside the exe in a portable copy, and in the Store
//! package in its LocalCache, a real path Explorer can read where the package's AppData writes would be redirected.
//! The pictures of unknown source are left out of the Store build.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, WebviewWindow};
#[cfg(not(all(windows, feature = "store")))]
use tauri::Manager;

const BASE_URL: &str = "https://github.com/andrealo20/crest/releases/download/wallpapers-1/";
/// The largest picture is 2.4 MB; the cap only guards against a wrong answer.
const FILE_MAX: usize = 16 * 1024 * 1024;
/// A folder's pictures past this many, by name, are left out.
const MAX_FOLDER: usize = 500;
/// What Windows and macOS both show as a wallpaper without extensions.
const EXTENSIONS: [&str; 4] = ["jpg", "jpeg", "png", "bmp"];

/// The collection in file name order, the order Next follows: the id (the file is `<id>.jpg`), the file's SHA-256, and whether
/// its source is unknown. scripts/wallpapers.py prints both; src/features/wallpapers/collection.ts lists the same ids.
const PICTURES: [(&str, &str, bool); 24] = [
    ("629958", "d86309b22458c6ff9c32e3643bc769848dcd1d1fa37c767e9c5d97b14200e50d", true),
    ("809524", "9da0cb5172644eca382a9f055871cf1bb982d47a263a01c1c71deb9ea2e52ce3", true),
    ("884853", "2f5362520bde50961fa68a8b51fa8740f2958de1944ca9ea43e1a30836602e1f", true),
    ("885155", "8d5ea00e93c70ccb60e07a74c97788c4b24c281f97ba92c3e87d42009c07ac30", true),
    ("99789", "b20e783c792178e2aba02ec45a41b03d20f0bbb64769a64a5ee9c21d16395f98", true),
    ("99790", "9b97bb752ff0fde3367add84d2ad81822f7325d3e8829c2d00d5ac1048514397", true),
    ("a-chosen-soul-3-LRLm5cm0c", "6641ef33e8c160edef7ce8a683ccddd74699ad8514a4d11117f5903e9075dbc1", false),
    ("alexander-lunyov-Qx6dv2tcceU", "84e48321a5003fb1c028856b0fc6c8b2ae1158baaf58d6e67e0e2a1245090e73", false),
    ("andrei-castanha-qTZr2TEUNBo", "dea871514f43110885056f89bd565807e2644a72be1683a947a29c20579f7a56", false),
    ("birmingham-museums-trust-yRDu4_w4g4A", "ff6fc7c8412f7c14ef7b4bbbf790ce9f8c1c65bfed655dea690ab47a7c3226eb", false),
    ("dim-gunger-Am9Se-CMNvM", "bef6d258dc70b6cd9214d0dd1c02d9c088069038e5c376f44bd6f9a0a7005e3f", false),
    ("dynamic-wang-irn9H9-Kfq4", "7d1cbf1511445c8a592d1b433be8871ac2806381b333058d5ec0a556f097b7c6", false),
    ("johny-goerend-Oz2ZQ2j8We8", "2942427244132a4a61ccf7be94749c3cfbe451a6135915d85a4d5c67ace4fa3c", false),
    ("jonas-denil-yVMFWzg7ObU", "c2c2207af22cb67452678d21d1029affe720a19e99ee3de777a08da876f8054d", false),
    ("kerensa-pickett-GjpUV4k76F8", "4809bcd3dfd02a4c9b1cd18a5e8d45a77cb68bdc8f78d226c6b316b594e4e2f4", false),
    ("milad-fakurian-rfZnGUin6WY", "61cb643e90f603bde29eeeb036b77d3c3c852db56c7a9609cc51ecd88a5563f2", false),
    ("pawel-czerwinski-PvgqqicSLvA", "9c66c41a1cd5dcedf937e52f7f44a1677d4d89d60529ecdd6a69f5f635d3178a", false),
    ("pawel-czerwinski-YAtspJ-HV2E", "4e049a592dc117ba6beebc3a418825931a2831515e54e5a452251c451ab23402", false),
    ("pawel-czerwinski-rlJG8NIjfZs", "b172ad7981af842e1acda7b0982771fd1e2e6b6f980eab68bbfe6af5e4e00640", false),
    ("peter-olexa-RYtiT3b7XW4", "bd0bdd33ee2d60129dc85ed37a43eeb8a8d9db66300865e086966eda685f4045", false),
    ("richard-horvath-_nWaeTF6qo0", "0c0d788dfe17fc723b921873585f89de2c4a3287c6c2f513d62436fd8d508c60", false),
    ("shubham-dhage-qQU2hOFtygg", "003acc30333a33d958ea71c0905990b7224224fe4e074b0692a8c3afc9c31df8", false),
    ("simon-lee-egWTpKFu8rU", "338de683207a11ec38bc772f4a9e967ee12491e778489829178753e7c09ac253", false),
    ("steven-lynn-Fh_gYZPIYZE", "71236593b5d58b7571728c6762ed4fdce34a6cbfd4d4377000c3f3108aa69e48", false),
];

/// The collection this build offers, as (id, SHA-256): the Store build leaves out the pictures of unknown source.
fn collection() -> impl Iterator<Item = (&'static str, &'static str)> {
    PICTURES.iter().filter(|p| !(cfg!(feature = "store") && p.2)).map(|p| (p.0, p.1))
}

/// Downloads one at a time: a picture asked for twice comes once, and a second Download is told "busy".
static DOWNLOADS: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// A screen, left to right: Windows' device path (a Mac's index), whether it is the main one, its picture's path ("" for a
/// plain colour) and the collection's id when the picture is one of Crest's.
#[derive(Serialize, Clone, Debug)]
pub struct Screen {
    pub id: String,
    pub primary: bool,
    pub path: String,
    pub crest: Option<String>,
}

/// The screens, and the main screen's picture as a small PNG data URL when it is not one of Crest's (the app has those).
#[derive(Serialize, Clone)]
pub struct Now {
    screens: Vec<Screen>,
    thumb: Option<String>,
}

/// How a picture fills the screen. Span (across every screen) is Windows' only.
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Fit {
    Fill,
    Fit,
    Span,
}

/// The saved fit's name as a fit; anything unknown fills.
fn fit_of(name: &str) -> Fit {
    match name {
        "fit" => Fit::Fit,
        "span" => Fit::Span,
        _ => Fit::Fill,
    }
}

fn is_picture(path: &Path) -> bool {
    path.extension().and_then(|e| e.to_str()).is_some_and(|e| EXTENSIONS.iter().any(|x| e.eq_ignore_ascii_case(x)))
}

/// A file only in the cloud (OneDrive): reading it would download it, and Explorer could not show it as a wallpaper.
fn cloud_only(meta: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const OFFLINE: u32 = 0x1000;
        const RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
        meta.file_attributes() & (OFFLINE | RECALL_ON_DATA_ACCESS) != 0
    }
    #[cfg(not(windows))]
    {
        let _ = meta;
        false
    }
}

/// The step from `at` (none: before the first) by `by`, round the list; None for an empty one.
fn next_index(len: usize, at: Option<usize>, by: i32) -> Option<usize> {
    if len == 0 {
        return None;
    }
    let from = match at {
        Some(i) => i as i64,
        None if by > 0 => -1,
        None => len as i64,
    };
    Some((from + by as i64).rem_euclid(len as i64) as usize)
}

/// The collection's id of a picture in the collection's folder, None for any other file.
fn crest_id(dir: &Path, path: &Path) -> Option<String> {
    if path.parent()? != dir || !path.extension()?.eq_ignore_ascii_case("jpg") {
        return None;
    }
    let id = path.file_stem()?.to_str()?;
    collection().any(|(known, _)| known == id).then(|| id.to_string())
}

/// A folder's pictures, first level only, by name, without the files only in the cloud; Err("folder") when it cannot be read.
fn folder_pictures(dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut found: Vec<(String, PathBuf)> = std::fs::read_dir(dir)
        .map_err(|_| "folder".to_string())?
        .flatten()
        .filter(|e| e.metadata().is_ok_and(|m| m.is_file() && !cloud_only(&m)))
        .map(|e| e.path())
        .filter(|p| is_picture(p))
        .map(|p| (p.file_name().unwrap_or_default().to_string_lossy().to_lowercase(), p))
        .collect();
    found.sort();
    Ok(found.into_iter().take(MAX_FOLDER).map(|(_, p)| p).collect())
}

/// A file a user named, as a wallpaper: an existing picture on the PC.
fn usable(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    let meta = std::fs::metadata(&path).map_err(|_| "file".to_string())?;
    if meta.is_file() && is_picture(&path) && !cloud_only(&meta) {
        Ok(path)
    } else {
        Err("file".into())
    }
}

/// Where the collection's pictures are kept (see the module's comment).
fn pack_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(all(windows, feature = "store"))]
    let base = {
        let _ = app;
        let folder = windows::Storage::ApplicationData::Current().and_then(|d| d.LocalCacheFolder()).and_then(|f| f.Path());
        PathBuf::from(folder.map_err(|_| "app-data".to_string())?.to_os_string())
    };
    #[cfg(not(all(windows, feature = "store")))]
    let base = match crate::portable::data_dir() {
        Some(dir) => dir,
        None => app.path().app_local_data_dir().map_err(|_| "app-data".to_string())?,
    };
    Ok(base.join("wallpapers"))
}

fn sha256_matches(body: &[u8], sha256: &str) -> bool {
    format!("{:x}", Sha256::digest(body)) == sha256
}

/// One picture from the release into `dir`, unless it is there: checked, then written beside it and renamed, so a broken
/// download never looks like a picture.
async fn download(client: &reqwest::Client, dir: &Path, id: &str, sha256: &str) -> Result<(), String> {
    let file = dir.join(format!("{id}.jpg"));
    if file.is_file() {
        return Ok(());
    }
    let mut r = client.get(format!("{BASE_URL}{id}.jpg")).send().await.map_err(|_| "unavailable")?;
    if !r.status().is_success() {
        return Err("unavailable".into());
    }
    let mut body = Vec::new();
    while let Some(chunk) = r.chunk().await.map_err(|_| "unavailable")? {
        body.extend_from_slice(&chunk);
        if body.len() > FILE_MAX {
            return Err("checksum".into());
        }
    }
    if !sha256_matches(&body, sha256) {
        return Err("checksum".into());
    }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let part = dir.join(format!("{id}.part"));
    std::fs::write(&part, &body).map_err(|e| e.to_string())?;
    std::fs::rename(&part, &file).map_err(|e| e.to_string())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        .user_agent("Crest")
        .build()
        .map_err(|_| "unavailable".to_string())
}

/// A picture of the collection on the PC, downloaded first if it is not.
async fn fetch(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    let (id, sha256) = collection().find(|(known, _)| *known == id).ok_or("unknown")?;
    let dir = pack_dir(app)?;
    let file = dir.join(format!("{id}.jpg"));
    if !file.is_file() {
        let _one = DOWNLOADS.lock().await;
        download(&client()?, &dir, id, sha256).await?;
    }
    Ok(file)
}

/// The screens' pictures now, the main one's as a small picture.
fn now(app: &AppHandle) -> Result<Now, String> {
    let dir = pack_dir(app).ok();
    let mut screens = platform::screens(app)?;
    for s in &mut screens {
        s.crest = dir.as_deref().and_then(|d| crest_id(d, Path::new(&s.path)));
    }
    let main = screens.iter().find(|s| s.primary);
    let thumb = main.filter(|s| s.crest.is_none() && !s.path.is_empty()).and_then(|s| crate::clipboard::file_thumbnail(Path::new(&s.path)));
    Ok(Now { screens, thumb })
}

/// Tells every window the wallpaper now: after Crest changed it, and when Windows says it changed (taskbar/mod.rs).
pub fn announce(app: &AppHandle) {
    if let Ok(now) = now(app) {
        let _ = app.emit("wallpaper://changed", now);
    }
}

/// Runs blocking work (files, COM, AppKit through the main thread) off the async runtime.
async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// The screens' wallpapers and the main screen's as a small picture.
#[tauri::command]
pub async fn wallpaper_current(app: AppHandle) -> Result<Now, String> {
    blocking(move || now(&app)).await
}

/// The collection's ids present on the PC (`source` "crest"), or a folder's pictures by path.
#[tauri::command]
pub async fn wallpaper_list(app: AppHandle, source: String, folder: String) -> Result<Vec<String>, String> {
    if source == "folder" {
        return blocking(move || Ok(folder_pictures(Path::new(&folder))?.iter().map(|p| p.to_string_lossy().into_owned()).collect())).await;
    }
    let dir = pack_dir(&app)?;
    Ok(collection().filter(|(id, _)| dir.join(format!("{id}.jpg")).is_file()).map(|(id, _)| id.to_string()).collect())
}

/// A picture of the collection (downloaded on first use) or a file on one screen, or on every screen without `screen`.
#[tauri::command]
pub async fn wallpaper_set(app: AppHandle, crest: Option<String>, path: Option<String>, screen: Option<String>, fit: String) -> Result<(), String> {
    let file = match (crest, path) {
        (Some(id), _) => fetch(&app, &id).await?,
        (None, Some(path)) => usable(&path)?,
        (None, None) => return Err("unknown".into()),
    };
    blocking(move || {
        if let Some(id) = &screen {
            if !platform::screens(&app)?.iter().any(|s| &s.id == id) {
                return Err("screen".into());
            }
        }
        platform::apply(&app, screen, &file, fit_of(&fit))?;
        announce(&app);
        Ok(())
    })
    .await
}

/// The next or the previous picture of the source after the main screen's, on every screen; Err("empty") when there is none.
#[tauri::command]
pub async fn wallpaper_step(app: AppHandle, by: i32, source: String, folder: String, fit: String) -> Result<(), String> {
    let handle = app.clone();
    let screens = blocking(move || platform::screens(&handle)).await?;
    let main = screens.iter().find(|s| s.primary).or(screens.first()).map(|s| s.path.clone()).unwrap_or_default();
    let file = if source == "folder" {
        let list = blocking(move || folder_pictures(Path::new(&folder))).await?;
        let at = list.iter().position(|p| p.to_string_lossy().eq_ignore_ascii_case(&main));
        list[next_index(list.len(), at, by).ok_or("empty")?].clone()
    } else {
        let ids: Vec<&str> = collection().map(|(id, _)| id).collect();
        let at = crest_id(&pack_dir(&app)?, Path::new(&main)).and_then(|id| ids.iter().position(|known| *known == id));
        fetch(&app, ids[next_index(ids.len(), at, by).ok_or("empty")?]).await?
    };
    blocking(move || {
        platform::apply(&app, None, &file, fit_of(&fit))?;
        announce(&app);
        Ok(())
    })
    .await
}

/// How a picture fills the screens.
#[tauri::command]
pub async fn wallpaper_fit(app: AppHandle, fit: String) -> Result<(), String> {
    blocking(move || platform::fit(&app, fit_of(&fit))).await
}

/// A folder the user picks over the calling window; None when cancelled.
#[tauri::command]
pub async fn wallpaper_folder(window: WebviewWindow) -> Option<String> {
    #[cfg(any(windows, target_os = "macos"))]
    return crate::picker::pick(crate::picker::Pick::Folder, &window).await;
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = window;
        None
    }
}

/// Downloads every picture of the collection not on the PC yet; the bytes of all of them there now.
#[tauri::command]
pub async fn wallpaper_pack_download(app: AppHandle) -> Result<u64, String> {
    let _all = DOWNLOADS.try_lock().map_err(|_| "busy")?;
    let (dir, client) = (pack_dir(&app)?, client()?);
    for (id, sha256) in collection() {
        download(&client, &dir, id, sha256).await?;
    }
    Ok(collection().filter_map(|(id, _)| std::fs::metadata(dir.join(format!("{id}.jpg"))).ok()).map(|m| m.len()).sum())
}

/// Deletes the downloaded pictures.
#[tauri::command]
pub async fn wallpaper_pack_remove(app: AppHandle) -> Result<(), String> {
    let _all = DOWNLOADS.try_lock().map_err(|_| "busy")?;
    match std::fs::remove_dir_all(pack_dir(&app)?) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// IDesktopWallpaper, the way Windows' own Settings set the wallpaper: per screen, with its fade. COM on a thread of its own.
#[cfg(windows)]
mod platform {
    use std::path::Path;

    use tauri::AppHandle;
    use windows::core::{HSTRING, PCWSTR, PWSTR};
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL};
    use windows::Win32::UI::Shell::{DesktopWallpaper, IDesktopWallpaper, DESKTOP_WALLPAPER_POSITION, DWPOS_FILL, DWPOS_FIT, DWPOS_SPAN};

    use super::{Fit, Screen};

    fn with<T: Send + 'static>(f: impl FnOnce(&IDesktopWallpaper) -> windows::core::Result<T> + Send + 'static) -> Result<T, String> {
        crate::launcher::on_sta(move || {
            // SAFETY: on an STA thread on_sta initialised; the object lives for the call.
            let wallpaper: IDesktopWallpaper = unsafe { CoCreateInstance(&DesktopWallpaper, None, CLSCTX_ALL) }?;
            f(&wallpaper)
        })
        .ok_or_else(|| "failed".to_string())?
        .map_err(|e| e.message())
    }

    /// A string COM allocated, read and freed.
    fn take(p: PWSTR) -> String {
        // SAFETY: a valid string from the call that returned it, freed once here.
        unsafe {
            let s = p.to_string().unwrap_or_default();
            CoTaskMemFree(Some(p.0 as *const _));
            s
        }
    }

    fn position(fit: Fit) -> DESKTOP_WALLPAPER_POSITION {
        match fit {
            Fit::Fill => DWPOS_FILL,
            Fit::Fit => DWPOS_FIT,
            Fit::Span => DWPOS_SPAN,
        }
    }

    pub fn screens(_: &AppHandle) -> Result<Vec<Screen>, String> {
        read()
    }

    /// The attached screens left to right; the main one is the one at 0,0.
    pub(super) fn read() -> Result<Vec<Screen>, String> {
        with(|w| {
            let mut out = Vec::new();
            // SAFETY: plain calls on a live object; each id is a valid string for the next calls.
            unsafe {
                for i in 0..w.GetMonitorDevicePathCount()? {
                    let id = take(w.GetMonitorDevicePathAt(i)?);
                    let key = HSTRING::from(&id);
                    // A monitor Windows remembers but is not attached has no rectangle.
                    let Ok(r) = w.GetMonitorRECT(&key) else { continue };
                    let path = w.GetWallpaper(&key).map(take).unwrap_or_default();
                    out.push((r.left, Screen { id, primary: r.left == 0 && r.top == 0, path, crest: None }));
                }
            }
            out.sort_by_key(|(left, _)| *left);
            Ok(out.into_iter().map(|(_, s)| s).collect())
        })
    }

    pub fn apply(_: &AppHandle, screen: Option<String>, file: &Path, fit: Fit) -> Result<(), String> {
        let file = HSTRING::from(file);
        with(move |w| unsafe {
            // SAFETY: plain calls on a live object with strings alive for them.
            w.SetPosition(position(fit))?;
            match screen {
                Some(id) => w.SetWallpaper(&HSTRING::from(&id), &file),
                None => w.SetWallpaper(PCWSTR::null(), &file),
            }
        })
    }

    /// Windows' fit is one for every screen.
    pub fn fit(_: &AppHandle, fit: Fit) -> Result<(), String> {
        // SAFETY: a plain call on a live object.
        with(move |w| unsafe { w.SetPosition(position(fit)) })
    }
}

#[cfg(target_os = "macos")]
use crate::macos::wallpaper as platform;

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use std::path::Path;

    use tauri::AppHandle;

    use super::{Fit, Screen};

    pub fn screens(_: &AppHandle) -> Result<Vec<Screen>, String> {
        Err("unsupported".into())
    }

    pub fn apply(_: &AppHandle, _: Option<String>, _: &Path, _: Fit) -> Result<(), String> {
        Err("unsupported".into())
    }

    pub fn fit(_: &AppHandle, _: Fit) -> Result<(), String> {
        Err("unsupported".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The shape every id of the collection keeps: safe in a file name and a URL. Ids come only from PICTURES, never from a caller.
    fn valid_id(id: &str) -> bool {
        (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    }

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("crest-wallpaper-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn an_id_is_safe_in_a_file_name_and_a_url() {
        for id in ["richard-horvath-_nWaeTF6qo0", "809524"] {
            assert!(valid_id(id), "{id}");
        }
        for id in ["", "..", "a/b", "a\\b", "x.jpg", &"a".repeat(65)] {
            assert!(!valid_id(id), "{id}");
        }
    }

    #[test]
    fn the_collection_is_its_thumbnails_with_a_hash_each_and_the_store_leaves_out_the_unknown_source() {
        let ids: Vec<&str> = PICTURES.iter().map(|p| p.0).collect();
        let mut sorted = ids.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(ids, sorted);
        for (id, sha256, unknown) in PICTURES {
            assert!(valid_id(id), "{id}");
            assert!(sha256.len() == 64 && sha256.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)), "{id}");
            assert_eq!(unknown, id.bytes().all(|b| b.is_ascii_digit()), "{id}");
        }
        let thumbs = Path::new(env!("CARGO_MANIFEST_DIR")).join("../src/assets/wallpapers");
        let mut names: Vec<String> = std::fs::read_dir(thumbs).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".jpg")).collect();
        names.sort();
        assert_eq!(names, ids.iter().map(|id| format!("{id}.jpg")).collect::<Vec<_>>());
        assert_eq!(collection().count(), if cfg!(feature = "store") { 18 } else { 24 });
        assert!(BASE_URL.starts_with("https://github.com/andrealo20/crest/releases/download/wallpapers-1/"));
    }

    #[test]
    fn a_download_counts_only_with_its_hash() {
        let abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert!(sha256_matches(b"abc", abc));
        assert!(!sha256_matches(b"abd", abc));
    }

    #[test]
    fn next_goes_round_and_starts_at_an_end() {
        assert_eq!(next_index(0, None, 1), None);
        assert_eq!(next_index(0, Some(0), -1), None);
        assert_eq!(next_index(3, Some(2), 1), Some(0));
        assert_eq!(next_index(3, Some(0), -1), Some(2));
        assert_eq!(next_index(3, Some(1), 1), Some(2));
        assert_eq!(next_index(3, None, 1), Some(0));
        assert_eq!(next_index(3, None, -1), Some(2));
    }

    #[test]
    fn pictures_by_extension_whatever_the_case() {
        assert!(is_picture(Path::new("a.JPG")) && is_picture(Path::new("b.jpeg")) && is_picture(Path::new("c.Png")) && is_picture(Path::new("d.bmp")));
        assert!(!is_picture(Path::new("e.heic")) && !is_picture(Path::new("f")) && !is_picture(Path::new("g.jpg.exe")));
    }

    #[test]
    fn a_folder_lists_its_own_pictures_by_name_up_to_the_cap() {
        let dir = temp("folder");
        for name in ["b.png", "a.JPG", "c.txt"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }
        std::fs::create_dir(dir.join("sub.jpg")).unwrap();
        std::fs::write(dir.join("sub.jpg").join("d.jpg"), b"x").unwrap();
        assert_eq!(folder_pictures(&dir).unwrap(), vec![dir.join("a.JPG"), dir.join("b.png")]);
        for i in 0..MAX_FOLDER {
            std::fs::write(dir.join(format!("p{i:03}.jpg")), b"x").unwrap();
        }
        let all = folder_pictures(&dir).unwrap();
        assert_eq!(all.len(), MAX_FOLDER);
        assert_eq!(all[0], dir.join("a.JPG"));
        assert_eq!(folder_pictures(&dir.join("gone")), Err("folder".to_string()));
        assert_eq!(usable(&dir.join("a.JPG").to_string_lossy()), Ok(dir.join("a.JPG")));
        for bad in [dir.join("c.txt"), dir.join("sub.jpg"), dir.join("gone.jpg")] {
            assert!(usable(&bad.to_string_lossy()).is_err(), "{bad:?}");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn only_a_collection_picture_in_its_folder_counts_as_crest() {
        let dir = Path::new("C:/data/wallpapers");
        assert_eq!(crest_id(dir, &dir.join("richard-horvath-_nWaeTF6qo0.jpg")), Some("richard-horvath-_nWaeTF6qo0".into()));
        assert_eq!(crest_id(dir, &dir.join("sub").join("richard-horvath-_nWaeTF6qo0.jpg")), None);
        assert_eq!(crest_id(Path::new("C:/elsewhere"), &dir.join("richard-horvath-_nWaeTF6qo0.jpg")), None);
        assert_eq!(crest_id(dir, &dir.join("mine.jpg")), None);
        assert_eq!(crest_id(dir, &dir.join("richard-horvath-_nWaeTF6qo0.part")), None);
        assert_eq!(crest_id(dir, Path::new("")), None);
        assert_eq!(crest_id(dir, &dir.join("809524.jpg")).is_some(), !cfg!(feature = "store"));
    }

    #[test]
    fn an_unknown_fit_fills() {
        assert_eq!([fit_of("fill"), fit_of("fit"), fit_of("span"), fit_of("tile"), fit_of("")], [Fit::Fill, Fit::Fit, Fit::Span, Fit::Fill, Fit::Fill]);
    }

    /// Reads, never sets: the screens and their pictures on this PC.
    #[cfg(windows)]
    #[test]
    #[ignore = "reads this PC's screens"]
    fn reads_the_screens() {
        let screens = platform::read().unwrap();
        println!("{screens:#?}");
        assert!(screens.iter().filter(|s| s.primary).count() <= 1);
    }
}
