//! The jump list over an app's menu on the bar: the app's own categories and tasks, then its recent or frequent files, as
//! Windows 11 shows them.
//!
//! - Recent and Frequent: Windows' documented `IApplicationDocumentLists`, only while Windows' "Show recently opened items in
//!   Start, Jump Lists, and File Explorer" is on (`Start_TrackDocs`).
//! - Tasks and the app's own categories: the `CustomDestinations` file Windows keeps per AppID. The container is undocumented
//!   (described in libyal's "Jump lists format" document; the file name's CRC-64 polynomial is from Hexacorn's post); its entries
//!   are shell links ([MS-SHLLINK]), loaded by Windows' own `ShellLink`. It is read only, and a file that does not parse whole is
//!   dropped: the app then shows its recent files only.
//! - The page gets titles and icons only. Rust keeps the rows per bar under a token, and the page sends back a token and a row.
//! - The Recently opened button's menu is a list of the same kind: the shortcuts in Windows' Recent folder, newest first, under
//!   the same rule as Recent (`Start_TrackDocs`).

use std::collections::HashMap;
use std::ops::Range;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};
use windows::core::{Interface, GUID, HSTRING, PCSTR, PCWSTR};
use windows::Win32::Foundation::PROPERTYKEY;
use windows::Win32::Storage::FileSystem::GetDriveTypeW;
use windows::Win32::System::Com::StructuredStorage::{PropVariantToBoolean, PropVariantToStringAlloc};
use windows::Win32::System::Com::{CoCreateInstance, IPersistStream, CLSCTX_INPROC_SERVER};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
use windows::Win32::UI::Shell::Common::IObjectArray;
use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
use windows::Win32::UI::Shell::{
    ApplicationActivationManager, ApplicationDocumentLists, IApplicationActivationManager, IApplicationDocumentLists, IContextMenu, IShellItem,
    IShellItemArray, IShellLinkW, ILFree, SHCreateItemFromIDList, SHCreateItemFromParsingName, SHCreateMemStream, SHCreateShellItemArrayFromShellItem,
    SHGetKnownFolderPath, SHLoadIndirectString, ShellLink, ADLT_FREQUENT, ADLT_RECENT, APPDOCLISTTYPE, CMF_DEFAULTONLY, CMINVOKECOMMANDINFO,
    CMINVOKECOMMANDINFOEX, FOLDERID_Recent, KF_FLAG_DEFAULT, SIGDN_DESKTOPABSOLUTEPARSING, SIGDN_NORMALDISPLAY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, CreatePopupMenu, DestroyMenu, GetMenuDefaultItem, ASFW_ANY, GET_MENU_DEFAULT_ITEM_FLAGS, SW_SHOWNORMAL,
};

use crate::launcher::{self, LauncherState};

const FOOTER: u32 = 0xBABF_FBAB;
const POLY: u64 = 0x92C6_4265_D321_39A4;
/// A file bigger than this is not read (the largest on a well used PC is 22 KB).
const MAX_FILE: u64 = 1 << 20;
const MAX_CATEGORIES: u32 = 64;
const MAX_ENTRIES: u32 = 100;
/// Recent and Frequent: Windows' default count.
const KNOWN_ITEMS: u32 = 10;
/// The Recently opened button's rows.
const RECENT_ITEMS: usize = 12;
/// CLSID_ShellLink as stored before each entry.
const SHELL_LINK: [u8; 16] = [0x01, 0x14, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0xC0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x46];
/// System.Title and System.AppUserModel.IsDestListSeparator, defined here so two keys do not need the EnhancedStorage feature.
const TITLE: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xf29f85e0_4ff9_1068_ab91_08002b27b3d9), pid: 2 };
const SEPARATOR: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3), pid: 6 };
/// shobjidl_core.h values the windows crate does not carry (the same bits as SEE_MASK_*).
const CMIC_MASK_NOASYNC: u32 = 0x100;
const CMIC_MASK_UNICODE: u32 = 0x4000;
/// GetDriveTypeW's DRIVE_REMOTE, which lives in a feature Crest does not turn on.
const DRIVE_REMOTE: u32 = 4;

/// The CRC-64 Windows names an AppID's jump-list files by: the id upper-cased as UTF-16LE, reflected, no final XOR.
fn app_hash(app_id: &str) -> u64 {
    let mut crc = u64::MAX;
    for byte in app_id.to_uppercase().encode_utf16().flat_map(u16::to_le_bytes) {
        crc ^= byte as u64;
        for _ in 0..8 {
            crc = if crc & 1 != 0 { (crc >> 1) ^ POLY } else { crc >> 1 };
        }
    }
    crc
}

fn custom_file(app_id: &str) -> String {
    format!("{:x}.customDestinations-ms", app_hash(app_id))
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at.checked_add(2)?)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at.checked_add(4)?)?.try_into().ok()?))
}

fn next_u32(b: &[u8], at: &mut usize) -> Option<u32> {
    let v = u32_at(b, *at)?;
    *at += 4;
    Some(v)
}

/// The size of the [MS-SHLLINK] stream at the start of `b`, by its own sizes; None when it is not one or runs past the end.
fn link_len(b: &[u8]) -> Option<usize> {
    if u32_at(b, 0)? != 0x4C {
        return None;
    }
    let flags = u32_at(b, 20)?;
    let mut at = 0x4Cusize;
    if flags & 0x1 != 0 {
        at = at.checked_add(2 + u16_at(b, at)? as usize)?;
    }
    if flags & 0x2 != 0 {
        at = at.checked_add(u32_at(b, at)? as usize)?;
    }
    let unit = if flags & 0x80 != 0 { 2 } else { 1 };
    for bit in [0x4, 0x8, 0x10, 0x20, 0x40] {
        if flags & bit != 0 {
            at = at.checked_add(2 + u16_at(b, at)? as usize * unit)?;
        }
    }
    loop {
        let size = u32_at(b, at)? as usize;
        if size < 4 {
            return Some(at + 4);
        }
        at = at.checked_add(size)?;
    }
}

/// One category of a `CustomDestinations` file; each range is a link stream in the file.
#[derive(Debug, PartialEq)]
enum Category {
    Custom(String, Vec<Range<usize>>),
    /// 1 Frequent, 2 Recent.
    Known(u32),
    Tasks(Vec<Range<usize>>),
}

fn links(b: &[u8], at: &mut usize) -> Option<Vec<Range<usize>>> {
    let count = next_u32(b, at)?;
    if count > MAX_ENTRIES {
        return None;
    }
    (0..count)
        .map(|_| {
            if b.get(*at..at.checked_add(16)?)? != SHELL_LINK {
                return None;
            }
            let start = *at + 16;
            let end = start + link_len(b.get(start..)?)?;
            *at = end;
            Some(start..end)
        })
        .collect()
}

/// The whole file, or None.
fn parse(b: &[u8]) -> Option<Vec<Category>> {
    let mut at = 0;
    if next_u32(b, &mut at)? != 2 {
        return None;
    }
    let count = next_u32(b, &mut at)?;
    if count > MAX_CATEGORIES {
        return None;
    }
    next_u32(b, &mut at)?;
    let mut out = Vec::new();
    for _ in 0..count {
        out.push(match next_u32(b, &mut at)? {
            0 => {
                let len = u16_at(b, at)? as usize * 2;
                let name = b.get(at + 2..at + 2 + len)?;
                at += 2 + len;
                let name: Vec<u16> = name.chunks_exact(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
                Category::Custom(String::from_utf16_lossy(&name), links(b, &mut at)?)
            }
            1 => Category::Known(next_u32(b, &mut at)?),
            2 => Category::Tasks(links(b, &mut at)?),
            _ => return None,
        });
        if next_u32(b, &mut at)? != FOOTER {
            return None;
        }
    }
    (at == b.len()).then_some(out)
}

/// A category with its rows read.
enum Section<E> {
    Custom(String, Vec<E>),
    Known(u32),
    Tasks(Vec<E>),
}

/// The groups as Windows orders them, (kind, the app's title for a custom one, rows): the file's in its order, Known 1 as
/// Frequent and 2 as Recent (only with `track`, each read only when named), Tasks last; no file is Recent only. Empty ones go.
fn assemble<E>(file: Option<Vec<Section<E>>>, track: bool, recent: impl FnOnce() -> Vec<E>, frequent: impl FnOnce() -> Vec<E>) -> Vec<(&'static str, String, Vec<E>)> {
    let (mut recent, mut frequent) = (Some(recent), Some(frequent));
    let (mut out, mut tasks) = (Vec::new(), Vec::new());
    for section in file.unwrap_or_else(|| vec![Section::Known(2)]) {
        match section {
            Section::Custom(name, rows) => out.push(("custom", name, rows)),
            Section::Known(1) if track => out.extend(frequent.take().map(|f| ("frequent", String::new(), f()))),
            Section::Known(2) if track => out.extend(recent.take().map(|f| ("recent", String::new(), f()))),
            Section::Known(_) => {}
            Section::Tasks(rows) => tasks.extend(rows),
        }
    }
    out.push(("tasks", String::new(), tasks));
    out.retain(|(_, _, rows)| !rows.is_empty());
    out
}

/// Who a list is for: its AppID and, for a desktop app, the exe that opens its files.
#[derive(Clone)]
struct AppRef {
    app_id: String,
    exe: Option<String>,
}

#[derive(Clone)]
enum Target {
    /// A desktop-absolute parsing path.
    Item(String),
    /// A persisted shell link.
    Link(Vec<u8>),
}

struct Entry {
    title: String,
    icon: Option<String>,
    /// None for a separator.
    target: Option<Target>,
}

/// A bar's list as last sent: its rows by id.
struct Open {
    token: u32,
    app: AppRef,
    targets: Vec<Option<Target>>,
}

static OPEN: LazyLock<Mutex<HashMap<String, Open>>> = LazyLock::new(Default::default);
static NEXT: AtomicU32 = AtomicU32::new(1);
/// Icons by the target's parsing path, cleared past 256.
static ICONS: LazyLock<Mutex<HashMap<String, Option<String>>>> = LazyLock::new(Default::default);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Row `id` of bar `label`'s current list `token`: no other bar's, no older list's, no separator.
fn take_entry(open: &HashMap<String, Open>, label: &str, token: u32, id: usize) -> Option<(AppRef, Target)> {
    let list = open.get(label).filter(|o| o.token == token)?;
    Some((list.app.clone(), list.targets.get(id)?.clone()?))
}

/// The app behind a bar button: a listed group's key, or a Start entry's id (whose parsing name is its AppID).
fn resolve(app: &AppHandle, key: &str) -> Option<AppRef> {
    if let Some((app_id, exe)) = super::tasks::app_of(key) {
        return Some(AppRef { app_id, exe: (!exe.is_empty()).then_some(exe) });
    }
    let app_id = key.strip_prefix(launcher::APPS_PREFIX)?;
    let apps = launcher::apps(&app.state::<LauncherState>(), false).ok()?;
    let entry = apps.iter().find(|a| a.id == key)?;
    Some(AppRef { app_id: app_id.to_string(), exe: entry.exe().map(str::to_string) })
}

/// Windows' "Show recently opened items": missing is on.
fn track() -> bool {
    let mut value = 1u32;
    let mut size = 4u32;
    let key = windows::core::w!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced");
    let read = unsafe { RegGetValueW(HKEY_CURRENT_USER, key, windows::core::w!("Start_TrackDocs"), RRF_RT_REG_DWORD, None, Some((&mut value as *mut u32).cast()), Some(&mut size)) };
    read.is_err() || value != 0
}

unsafe fn load_link(bytes: &[u8]) -> Option<IShellLinkW> {
    let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
    let stream = SHCreateMemStream(Some(bytes))?;
    link.cast::<IPersistStream>().ok()?.Load(&stream).ok()?;
    Some(link)
}

/// A path's icon, cached; a network path gets none, so a dead share never holds the menu.
fn icon(item: &IShellItem, path: &str) -> Option<String> {
    let root = path.get(..3).filter(|r| r.ends_with(":\\"));
    if super::pins::remote(path) || root.is_some_and(|r| unsafe { GetDriveTypeW(&HSTRING::from(r)) } == DRIVE_REMOTE) {
        return None;
    }
    let mut cache = lock(&ICONS);
    if let Some(icon) = cache.get(path) {
        return icon.clone();
    }
    if cache.len() > 256 {
        cache.clear();
    }
    let icon = launcher::item_png(item);
    cache.insert(path.to_string(), icon.clone());
    icon
}

/// A string as it reads: an "@" resource string through Windows.
unsafe fn indirect(s: String) -> String {
    if !s.starts_with('@') {
        return s;
    }
    let mut buf = [0u16; 512];
    match SHLoadIndirectString(&HSTRING::from(&s), &mut buf, None) {
        Ok(()) => String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]),
        Err(_) => String::new(),
    }
}

unsafe fn link_entry(bytes: &[u8]) -> Option<Entry> {
    let link = load_link(bytes)?;
    let store = link.cast::<IPropertyStore>().ok();
    let value = |key: &PROPERTYKEY| store.as_ref().and_then(|s| s.GetValue(key).ok());
    if value(&SEPARATOR).is_some_and(|v| PropVariantToBoolean(&v).is_ok_and(|b| b.as_bool())) {
        return Some(Entry { title: String::new(), icon: None, target: None });
    }
    let pidl = link.GetIDList().ok().filter(|p| !p.is_null());
    let target: Option<IShellItem> = pidl.and_then(|p| SHCreateItemFromIDList(p).ok());
    if let Some(p) = pidl {
        ILFree(Some(p));
    }
    let mut desc = [0u16; 260];
    let description = link.GetDescription(&mut desc).ok().map(|()| String::from_utf16_lossy(&desc[..desc.iter().position(|&c| c == 0).unwrap_or(0)]));
    let title = value(&TITLE)
        .and_then(|v| PropVariantToStringAlloc(&v).ok())
        .and_then(|p| crate::controls::take(p))
        .map(|s| indirect(s))
        .filter(|s| !s.trim().is_empty())
        .or(description.map(|s| indirect(s)).filter(|s| !s.trim().is_empty()))
        .or_else(|| target.as_ref().and_then(|t| launcher::display_name(t, SIGDN_NORMALDISPLAY)))
        .filter(|s| !s.trim().is_empty())?;
    // shortcut: the link's own icon location (a task's own picture) and packaged logos are not read, the target's icon stands
    // in; read GetIconLocation if a task looks wrong.
    let icon = target.as_ref().and_then(|t| icon(t, &launcher::display_name(t, SIGDN_DESKTOPABSOLUTEPARSING)?));
    Some(Entry { title, icon, target: Some(Target::Link(bytes.to_vec())) })
}

/// Recent or Frequent, through Windows' documented list.
unsafe fn known(app_id: &str, kind: APPDOCLISTTYPE) -> Vec<Entry> {
    let read = || -> Option<IObjectArray> {
        let lists: IApplicationDocumentLists = CoCreateInstance(&ApplicationDocumentLists, None, CLSCTX_INPROC_SERVER).ok()?;
        lists.SetAppID(&HSTRING::from(app_id)).ok()?;
        lists.GetList(kind, KNOWN_ITEMS).ok()
    };
    let Some(array) = read() else { return Vec::new() };
    // shortcut: a list entry kept as a shell link rather than an item is skipped; read it with GetAt::<IShellLinkW> if an app
    // shows fewer recent files than on Windows' own bar.
    (0..array.GetCount().unwrap_or(0))
        .filter_map(|i| array.GetAt::<IShellItem>(i).ok())
        .filter_map(|item| {
            let path = launcher::display_name(&item, SIGDN_DESKTOPABSOLUTEPARSING)?;
            let title = if super::pins::remote(&path) {
                path.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next().unwrap_or(&path).to_string()
            } else {
                launcher::display_name(&item, SIGDN_NORMALDISPLAY)?
            };
            let icon = icon(&item, &path);
            Some(Entry { title, icon, target: Some(Target::Item(path)) })
        })
        .collect()
}

/// The newest `n` of `rows` by their time, newest first.
fn newest<T>(mut rows: Vec<(SystemTime, T)>, n: usize) -> Vec<T> {
    rows.sort_by(|a, b| b.0.cmp(&a.0));
    rows.into_iter().take(n).map(|(_, row)| row).collect()
}

/// The files and folders Windows recorded as opened last, newest first: the shortcuts Windows writes in its Recent folder, by
/// the time each was written, read as the jump lists' links are; one without a target goes. None when the folder cannot be read.
/// Needs COM: run it through `on_sta`.
unsafe fn recent_files() -> Option<Vec<Entry>> {
    let dir = crate::controls::take(SHGetKnownFolderPath(&FOLDERID_Recent, KF_FLAG_DEFAULT, None).ok()?)?;
    let links = std::fs::read_dir(&dir)
        .ok()?
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("lnk")))
        .filter_map(|e| {
            let meta = e.metadata().ok().filter(|m| m.is_file() && m.len() <= MAX_FILE)?;
            Some((meta.modified().ok()?, e.path()))
        })
        .collect();
    Some(newest(links, RECENT_ITEMS).into_iter().filter_map(|path| link_entry(&std::fs::read(path).ok()?)).filter(|e| e.target.is_some()).collect())
}

/// The app's list. Needs COM: run it through `on_sta`.
unsafe fn read(app: &AppRef) -> Vec<(&'static str, String, Vec<Entry>)> {
    let file = (|| {
        let dir = crate::controls::take(SHGetKnownFolderPath(&FOLDERID_Recent, KF_FLAG_DEFAULT, None).ok()?)?;
        let path = std::path::Path::new(&dir).join("CustomDestinations").join(custom_file(&app.app_id));
        if std::fs::metadata(&path).ok()?.len() > MAX_FILE {
            return None;
        }
        let bytes = std::fs::read(&path).ok()?;
        let rows = |ranges: Vec<Range<usize>>| ranges.into_iter().filter_map(|r| link_entry(&bytes[r])).collect();
        Some(
            parse(&bytes)?
                .into_iter()
                .map(|c| match c {
                    Category::Custom(name, ranges) => Section::Custom(name, rows(ranges)),
                    Category::Known(id) => Section::Known(id),
                    Category::Tasks(ranges) => Section::Tasks(rows(ranges)),
                })
                .collect(),
        )
    })();
    assemble(file, track(), || known(&app.app_id, ADLT_RECENT), || known(&app.app_id, ADLT_FREQUENT))
}

/// Opens a file with its packaged app, through Windows' own activation.
unsafe fn activate_for_file(app_id: &str, path: &str) -> Option<()> {
    let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path), None).ok()?;
    let items: IShellItemArray = SHCreateShellItemArrayFromShellItem(&item).ok()?;
    let manager: IApplicationActivationManager = CoCreateInstance(&ApplicationActivationManager, None, CLSCTX_INPROC_SERVER).ok()?;
    manager.ActivateForFile(&HSTRING::from(app_id), &items, windows::core::w!("open")).ok().map(|_| ())
}

/// Runs a link's default verb, as opening the shortcut in File Explorer does (so a packaged target with arguments goes the
/// shell's way).
unsafe fn invoke_link(bytes: &[u8]) -> Option<()> {
    let menu_handler = load_link(bytes)?.cast::<IContextMenu>().ok()?;
    let menu = CreatePopupMenu().ok()?;
    let ran = (|| {
        menu_handler.QueryContextMenu(menu, 0, 1, 0x7FFF, CMF_DEFAULTONLY).ok().ok()?;
        let id = GetMenuDefaultItem(menu, 0, GET_MENU_DEFAULT_ITEM_FLAGS(0));
        if id == u32::MAX || id == 0 {
            return None;
        }
        let verb = (id - 1) as usize;
        let info = CMINVOKECOMMANDINFOEX {
            cbSize: std::mem::size_of::<CMINVOKECOMMANDINFOEX>() as u32,
            // NOASYNC: this thread ends right after.
            fMask: CMIC_MASK_UNICODE | CMIC_MASK_NOASYNC,
            lpVerb: PCSTR(verb as *const u8),
            lpVerbW: PCWSTR(verb as *const u16),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        menu_handler.InvokeCommand(&info as *const CMINVOKECOMMANDINFOEX as *const CMINVOKECOMMANDINFO).ok()
    })();
    let _ = DestroyMenu(menu);
    ran
}

/// Opens a row with the app whose list it is in, where Windows allows it on `monitor`. Errors: failed.
fn open(app: AppRef, target: Target, monitor: Option<isize>) -> Result<(), String> {
    match target {
        Target::Item(path) => {
            if app.app_id.contains('!') {
                let (id, file) = (app.app_id.clone(), path.clone());
                if launcher::on_sta(move || unsafe { activate_for_file(&id, &file) }).flatten().is_some() {
                    return Ok(());
                }
            }
            match app.exe.filter(|_| !app.app_id.contains('!')) {
                // shortcut: the file goes to the app's exe as its argument, which is what most file types' "%1" do; switch to
                // SHAssocEnumHandlers if an app wants its files another way.
                Some(exe) => launcher::execute(&exe, Some(&quoted(&path)), None, monitor),
                None => launcher::execute(&path, None, None, monitor),
            }
        }
        Target::Link(bytes) => launcher::on_sta(move || unsafe {
            let _ = AllowSetForegroundWindow(ASFW_ANY);
            invoke_link(&bytes)
        })
        .flatten()
        .ok_or_else(|| "failed".into()),
    }
}

/// A path as one argument: a trailing backslash is doubled so it does not escape the closing quote.
fn quoted(path: &str) -> String {
    if path.ends_with('\\') { format!("\"{path}\\\"") } else { format!("\"{path}\"") }
}

#[derive(Serialize)]
pub struct JumpList {
    token: u32,
    groups: Vec<JumpGroup>,
}

#[derive(Serialize)]
struct JumpGroup {
    /// "frequent", "recent", "custom" or "tasks".
    kind: &'static str,
    /// The app's own name for a custom category, empty for the others.
    title: String,
    items: Vec<JumpItem>,
}

#[derive(Serialize)]
struct JumpItem {
    id: usize,
    title: String,
    icon: Option<String>,
    separator: bool,
}

/// The jump list of the app behind a bar button: `key` is a listed group's key or a Start entry's id (`resolve`). Rust keeps
/// the rows for this bar under a new token; the page gets their titles and icons only. Errors: none (no list for this app).
#[tauri::command]
pub async fn taskbar_jump_list(key: String, window: WebviewWindow, app: AppHandle) -> Result<JumpList, String> {
    super::bar::from_bar(&window)?;
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let who = resolve(&app, &key).ok_or("none")?;
        let reading = who.clone();
        let groups = launcher::on_sta(move || unsafe { read(&reading) }).ok_or("failed")?;
        Ok(keep(label, who, groups))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Keeps `groups`' rows for bar `label` under a new token, the list before it gone, and gives the page their titles and icons.
fn keep(label: String, who: AppRef, groups: Vec<(&'static str, String, Vec<Entry>)>) -> JumpList {
    let mut targets = Vec::new();
    let groups = groups
        .into_iter()
        .map(|(kind, title, rows)| JumpGroup {
            kind,
            title,
            items: rows
                .into_iter()
                .map(|e| {
                    targets.push(e.target);
                    JumpItem { id: targets.len() - 1, separator: targets.last().is_some_and(Option::is_none), title: e.title, icon: e.icon }
                })
                .collect(),
        })
        .collect();
    let token = NEXT.fetch_add(1, Ordering::SeqCst);
    lock(&OPEN).insert(label, Open { token, app: who, targets });
    JumpList { token, groups }
}

/// The Recently opened button's menu: the files and folders Windows recorded as opened last, newest first (`recent_files`), read
/// as the menu opens. Kept for this bar as a jump list is, so a row opens through `taskbar_jump_open`, with its link's default
/// verb: the app Windows opens that file with. Errors: off (Windows' "Show recently opened items" is off and keeps no list), failed.
#[tauri::command]
pub async fn taskbar_recent(window: WebviewWindow) -> Result<JumpList, String> {
    super::bar::from_bar(&window)?;
    if !track() {
        return Err("off".into());
    }
    let label = window.label().to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let rows = launcher::on_sta(|| unsafe { recent_files() }).flatten().ok_or("failed")?;
        // No app: each row is a link, which opens by itself (`open`).
        Ok(keep(label, AppRef { app_id: String::new(), exe: None }, vec![("recent", String::new(), rows)]))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Opens row `id` of this bar's current list (`token`) with the app the list belongs to, on the bar's monitor where Windows
/// allows it. Errors: unknown (no such row now), failed.
#[tauri::command]
pub async fn taskbar_jump_open(token: u32, id: usize, window: WebviewWindow) -> Result<(), String> {
    super::bar::from_bar(&window)?;
    let (who, target) = take_entry(&lock(&OPEN), window.label(), token, id).ok_or("unknown")?;
    let monitor = launcher::launch_monitor(&window);
    tauri::async_runtime::spawn_blocking(move || open(who, target, monitor)).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_app_id_hashes_as_windows_names_its_files() {
        assert_eq!(custom_file("Microsoft.InternetExplorer.Default"), "28c8b86deab549a1.customDestinations-ms");
        assert_eq!(format!("{:x}", app_hash(r"{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\notepad.exe")), "9b9cdc69c1c24e2b");
        // 15 digits: Windows prints no leading zero.
        assert_eq!(format!("{:x}", app_hash("Microsoft.WindowsNotepad_8wekyb3d8bbwe!App")), "a61657a5e5dfbdc");
        assert_eq!(format!("{:x}", app_hash("Chrome")), "5d696d521de238c3");
        assert_eq!(format!("{:x}", app_hash("Microsoft.Windows.Explorer")), "f01b4d95cf55d32a");
        // Case does not matter.
        assert_eq!(app_hash("chrome"), app_hash("Chrome"));
    }

    /// A link header with these flags, then `body`, then the terminal block.
    fn link(flags: u32, body: &[u8]) -> Vec<u8> {
        let mut b = vec![0u8; 0x4C];
        b[0] = 0x4C;
        b[20..24].copy_from_slice(&flags.to_le_bytes());
        b.extend_from_slice(body);
        b.extend_from_slice(&0u32.to_le_bytes());
        b
    }

    #[test]
    fn a_link_is_measured_by_its_own_sizes() {
        assert_eq!(link_len(&link(0, &[])), Some(0x50));
        let mut idlist = 8u16.to_le_bytes().to_vec();
        idlist.extend([0; 8]);
        assert_eq!(link_len(&link(0x1, &idlist)), Some(0x5A));
        let mut args = 3u16.to_le_bytes().to_vec();
        args.extend([b'a', 0, b'b', 0, b'c', 0]);
        assert_eq!(link_len(&link(0x20 | 0x80, &args)), Some(0x50 + 8));
        // An extra block of 12 bytes before the terminal one.
        let mut block = 12u32.to_le_bytes().to_vec();
        block.extend([0; 8]);
        assert_eq!(link_len(&link(0, &block)), Some(0x50 + 12));
        let mut bad = link(0, &[]);
        bad[0] = 0x4D;
        assert_eq!(link_len(&bad), None);
        // A block running past the end.
        let mut past = vec![0u8; 0x4C];
        past[0] = 0x4C;
        past.extend(64u32.to_le_bytes());
        assert_eq!(link_len(&past), None);
        assert_eq!(link_len(&[0x4C, 0, 0]), None);
    }

    fn file() -> (Vec<u8>, Vec<Range<usize>>) {
        let one = link(0, &[]);
        let mut b = Vec::new();
        let mut ranges = Vec::new();
        let mut entry = |b: &mut Vec<u8>| {
            b.extend(SHELL_LINK);
            ranges.push(b.len()..b.len() + one.len());
            b.extend(&one);
        };
        b.extend([2u32, 3, 0].iter().flat_map(|v| v.to_le_bytes()));
        b.extend(0u32.to_le_bytes());
        b.extend(6u16.to_le_bytes());
        b.extend("Recent".encode_utf16().flat_map(u16::to_le_bytes));
        b.extend(1u32.to_le_bytes());
        entry(&mut b);
        b.extend(FOOTER.to_le_bytes());
        b.extend([1u32, 1, FOOTER].iter().flat_map(|v| v.to_le_bytes()));
        b.extend([2u32, 2].iter().flat_map(|v| v.to_le_bytes()));
        entry(&mut b);
        entry(&mut b);
        b.extend(FOOTER.to_le_bytes());
        (b, ranges)
    }

    #[test]
    fn a_custom_file_parses_only_whole() {
        let (b, r) = file();
        assert_eq!(parse(&b), Some(vec![Category::Custom("Recent".into(), vec![r[0].clone()]), Category::Known(1), Category::Tasks(vec![r[1].clone(), r[2].clone()])]));
        let mut v3 = b.clone();
        v3[0] = 3;
        assert_eq!(parse(&v3), None);
        assert_eq!(parse(&b[..b.len() - 4]), None); // no last footer
        let mut more = b.clone();
        more.push(0);
        assert_eq!(parse(&more), None);
        let mut many = b.clone();
        many[4..8].copy_from_slice(&(MAX_CATEGORIES + 1).to_le_bytes());
        assert_eq!(parse(&many), None);
        let mut clsid = b.clone();
        clsid[r[0].start - 16] ^= 1;
        assert_eq!(parse(&clsid), None);
        assert_eq!(parse(&b[..r[2].start + 10]), None); // a truncated link
    }

    #[test]
    fn the_list_comes_in_windows_order() {
        let rows = |s: &[&str]| s.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let names = |g: Vec<(&'static str, String, Vec<String>)>| g.into_iter().map(|(k, t, r)| format!("{k}:{t}:{}", r.join(","))).collect::<Vec<_>>();
        let no = || -> Vec<String> { panic!("read when not named") };
        assert_eq!(names(assemble(None, true, || rows(&["a"]), no)), ["recent::a"]);
        assert!(assemble::<String>(None, false, no, no).is_empty());
        let file = || Some(vec![Section::Tasks(rows(&["t"])), Section::Known(1), Section::Custom("Most visited".into(), rows(&["m"])), Section::Known(7), Section::Custom("Empty".into(), vec![])]);
        assert_eq!(names(assemble(file(), true, no, || rows(&["f"]))), ["frequent::f", "custom:Most visited:m", "tasks::t"]);
        assert_eq!(names(assemble(file(), false, no, no)), ["custom:Most visited:m", "tasks::t"]);
    }

    #[test]
    fn a_row_is_taken_only_from_its_own_bar_and_token() {
        let app = AppRef { app_id: "Chrome".into(), exe: None };
        let open = HashMap::from([("taskbar".to_string(), Open { token: 5, app, targets: vec![Some(Target::Item("C:\\a".into())), None] })]);
        assert!(take_entry(&open, "taskbar", 5, 0).is_some());
        assert!(take_entry(&open, "taskbar-1", 5, 0).is_none());
        assert!(take_entry(&open, "taskbar", 4, 0).is_none());
        assert!(take_entry(&open, "taskbar", 5, 1).is_none()); // a separator
        assert!(take_entry(&open, "taskbar", 5, 2).is_none());
    }

    #[test]
    fn the_recent_menu_lists_the_newest_links_first() {
        use std::time::{Duration, UNIX_EPOCH};
        let at = |s: u64| UNIX_EPOCH + Duration::from_secs(s);
        assert_eq!(newest(vec![(at(5), "b"), (at(9), "c"), (at(1), "a")], 12), ["c", "b", "a"]);
        assert_eq!(newest(vec![(at(5), "b"), (at(9), "c"), (at(1), "a"), (at(7), "d")], 2), ["c", "d"]);
        assert!(newest(Vec::<(std::time::SystemTime, &str)>::new(), 12).is_empty());
    }

    #[test]
    fn a_path_is_one_argument() {
        assert_eq!(quoted(r"C:\a b.txt"), r#""C:\a b.txt""#);
        assert_eq!(quoted(r"C:\"), r#""C:\\""#);
    }

    #[test]
    fn windows_writes_links_this_parser_measures() {
        use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
        let checked = launcher::on_sta(|| unsafe {
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            link.SetPath(windows::core::w!(r"C:\Windows\notepad.exe")).unwrap();
            link.SetArguments(windows::core::w!("/a b")).unwrap();
            let stream = SHCreateMemStream(None).unwrap();
            link.cast::<IPersistStream>().unwrap().Save(&stream, true).unwrap();
            let mut stat = STATSTG::default();
            stream.Stat(&mut stat, STATFLAG_NONAME).unwrap();
            stream.Seek(0, STREAM_SEEK_SET, None).unwrap();
            let mut bytes = vec![0u8; stat.cbSize as usize];
            stream.Read(bytes.as_mut_ptr().cast(), bytes.len() as u32, None).ok().unwrap();
            assert_eq!(link_len(&bytes), Some(bytes.len()));
            let mut args = [0u16; 64];
            load_link(&bytes).unwrap().GetArguments(&mut args).unwrap();
            String::from_utf16_lossy(&args[..args.iter().position(|&c| c == 0).unwrap()])
        });
        assert_eq!(checked.as_deref(), Some("/a b"));
    }
}
