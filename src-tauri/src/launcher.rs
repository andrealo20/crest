//! App launcher: the Start menu's app list, icons, launching, and Alt+1..6.
//!
//! - List: `shell:AppsFolder` (the Start menu's "All apps": desktop shortcuts and Store
//!   packages alike). An entry's id is `shell:AppsFolder\<parsing name>`, which the shell
//!   opens directly. App Paths in the registry add exe paths (the frontend uses them only to
//!   find AI apps missing from the Start menu).
//! - Icons: `IShellItemImageFactory` for both kinds, as PNG data URLs, cached per id.
//! - Launch: only ids from the list or Rust's own pins (taskbar/ownpins.rs: apps added from their file, on the bar or here), so
//!   the WebView cannot start an arbitrary command.
//! - Shortcuts: Alt+1..6, registered and dispatched by shell.rs with Crest's other shortcuts.
//! - The taskbar finds an open app's entries here (`entries_for`): a Start shortcut that starts an exe with no arguments
//!   keeps that exe.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut};
use windows::core::{Interface, GUID, HSTRING, PCWSTR, PWSTR};
use windows::Win32::Foundation::{GetLastError, ERROR_CANCELLED, ERROR_MORE_DATA, ERROR_SUCCESS, HANDLE, PROPERTYKEY, SIZE};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, MonitorFromWindow, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    HBITMAP, MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::System::Com::{CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE};
use windows::Win32::System::Registry::{
    RegCloseKey, RegEnumKeyExW, RegGetValueW, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ,
};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, FOLDERID_AppsFolder, IEnumShellItems, IShellItem, IShellItem2, IShellItemImageFactory, SHCreateItemFromParsingName,
    SHGetKnownFolderItem, ShellExecuteExW, ShellExecuteW, KF_FLAG_DEFAULT, SEE_MASK_HMONITOR, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW, SHELLEXECUTEINFOW_0,
    SIGDN, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING, SIIGBF_ICONONLY,
};
use windows::Win32::UI::WindowsAndMessaging::{AllowSetForegroundWindow, ASFW_ANY, SW_SHOWNORMAL};

pub(crate) const APPS_PREFIX: &str = r"shell:AppsFolder\";
/// Icon edge in device pixels: 32 CSS px tiles on a 200 % screen.
const ICON_PX: i32 = 64;
const DIGITS: [Code; 6] = [Code::Digit1, Code::Digit2, Code::Digit3, Code::Digit4, Code::Digit5, Code::Digit6];
/// System.Link.TargetParsingPath and System.Link.Arguments of a Start entry's shortcut, defined here so two keys do not need the
/// EnhancedStorage feature.
const LINK_TARGET: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0xb9b4b3fc_2b51_4a42_b5d8_324146afcf25), pid: 2 };
const LINK_ARGUMENTS: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x436f2667_14e2_4feb_b30a_146c53b5b674), pid: 100 };

#[derive(Clone, Serialize)]
pub struct App {
    pub(crate) id: String,
    pub(crate) name: String,
    /// "start", "apppaths" or "pinned" (the bar's own pins, taskbar/ownpins.rs).
    source: &'static str,
    /// The exe the entry starts with no arguments, which an open window of that exe matches (`entries_for`).
    #[serde(skip)]
    exe: Option<String>,
}

impl App {
    pub(crate) fn exe(&self) -> Option<&str> {
        self.exe.as_deref()
    }
}

/// One of the bar's own pins as an entry: the notch's launcher shows none of this source (apps.ts `mergeApps`).
pub(crate) fn pinned_app(id: String, name: String) -> App {
    App { id, name, source: "pinned", exe: None }
}

/// A Start entry of this id that starts `exe`, for other modules' tests.
#[cfg(test)]
pub(crate) fn fixture(id: &str, exe: Option<&str>) -> App {
    App { id: id.into(), name: id.into(), source: "start", exe: exe.map(Into::into) }
}

/// An unknown id reads the list again at most this often.
const RESCAN_GAP: Duration = Duration::from_secs(60);

#[derive(Default)]
pub struct LauncherState {
    apps: Mutex<Option<Vec<App>>>,
    /// When the list was last read.
    scanned: Mutex<Option<Instant>>,
    icons: Mutex<HashMap<String, Option<String>>>,
}

/// Runs COM work on its own STA thread: shell extensions expect one, and the async runtime's
/// threads are initialised as MTA elsewhere in the app.
pub(crate) fn on_sta<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    std::thread::spawn(move || unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE).is_ok();
        let out = f();
        if init {
            CoUninitialize();
        }
        out
    })
    .join()
    .ok()
}

/// The Start list failing (or coming back empty) is an error: an empty list must not look like
/// "nothing installed", or the first-run seeding would pin nothing for good.
fn list_apps() -> Result<Vec<App>, String> {
    let mut apps = start_apps().map_err(|e| e.message())?;
    if apps.is_empty() {
        return Err("empty".into());
    }
    apps.extend(app_paths());
    Ok(apps)
}

pub(crate) unsafe fn display_name(item: &IShellItem, kind: SIGDN) -> Option<String> {
    let p: PWSTR = item.GetDisplayName(kind).ok()?;
    let s = p.to_string().ok();
    CoTaskMemFree(Some(p.0 as *const _));
    s
}

fn start_apps() -> windows::core::Result<Vec<App>> {
    unsafe {
        let folder: IShellItem = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)?;
        let items: IEnumShellItems = folder.BindToHandler(None, &BHID_EnumItems)?;
        let mut out = Vec::new();
        loop {
            let mut batch: [Option<IShellItem>; 32] = Default::default();
            let mut fetched = 0u32;
            let _ = items.Next(&mut batch, Some(&mut fetched));
            if fetched == 0 {
                break;
            }
            for item in batch.iter().take(fetched as usize).flatten() {
                let (Some(name), Some(id)) = (display_name(item, SIGDN_NORMALDISPLAY), display_name(item, SIGDN_PARENTRELATIVEPARSING)) else { continue };
                if !name.trim().is_empty() && !id.is_empty() {
                    out.push(App { id: format!("{APPS_PREFIX}{id}"), name, source: "start", exe: shortcut_exe(item) });
                }
            }
        }
        Ok(out)
    }
}

/// The exe a Start entry's shortcut starts with no arguments (`plain_exe`); None for Store apps and everything else.
pub(crate) unsafe fn shortcut_exe(item: &IShellItem) -> Option<String> {
    let item = item.cast::<IShellItem2>().ok()?;
    let read = |key: &PROPERTYKEY| item.GetString(key).ok().and_then(|p| crate::controls::take(p));
    plain_exe(read(&LINK_TARGET).as_deref(), read(&LINK_ARGUMENTS).as_deref())
}

/// An exe target with blank or no arguments: a shortcut that passes arguments (cmd.exe /k VsDevCmd.bat, a browser profile)
/// starts something other than the exe alone.
fn plain_exe(target: Option<&str>, args: Option<&str>) -> Option<String> {
    let target = target?;
    let exe = std::path::Path::new(target).extension().is_some_and(|ext| ext.eq_ignore_ascii_case("exe"));
    (exe && args.is_none_or(|a| a.trim().is_empty())).then(|| target.to_string())
}

/// The Start entries of an open app, for the taskbar. With an AppUserModelID only the entry of that id, never one found by
/// the exe (a web app's window must not light up its browser); without one, the Start entries that start this exe, then its
/// App Paths entry (`list_apps` keeps the Start entries first). Both ASCII case-insensitive, as Windows compares them.
pub(crate) fn entries_for(apps: &[App], aumid: Option<&str>, exe: &str) -> Vec<App> {
    apps.iter()
        .filter(|a| match aumid {
            Some(aumid) => a.id.strip_prefix(APPS_PREFIX).is_some_and(|id| id.eq_ignore_ascii_case(aumid)),
            None => a.exe.as_deref().is_some_and(|e| e.eq_ignore_ascii_case(exe)),
        })
        .cloned()
        .collect()
}

/// `App Paths\<name>.exe` default values: the exe paths Windows finds by name (Win+R). Existing files only.
fn app_paths() -> Vec<App> {
    const KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths";
    let mut out: Vec<App> = Vec::new();
    for root in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        let mut key = HKEY::default();
        if unsafe { RegOpenKeyExW(root, &HSTRING::from(KEY), Some(0), KEY_READ, &mut key) } != ERROR_SUCCESS {
            continue;
        }
        for i in 0.. {
            let mut buf = [0u16; 260];
            let mut len = buf.len() as u32;
            match unsafe { RegEnumKeyExW(key, i, Some(PWSTR(buf.as_mut_ptr())), &mut len, None, None, None, None) } {
                ERROR_SUCCESS => {}
                // A name longer than the buffer only skips that key.
                ERROR_MORE_DATA => continue,
                _ => break,
            }
            let sub = HSTRING::from_wide(&buf[..len as usize]);
            let mut value = [0u16; 1024];
            let mut size = (value.len() * 2) as u32;
            let ok = unsafe {
                RegGetValueW(key, &sub, PCWSTR::null(), RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, None, Some(value.as_mut_ptr().cast()), Some(&mut size))
            } == ERROR_SUCCESS;
            if !ok {
                continue;
            }
            let chars = (size as usize / 2).min(value.len());
            let path = String::from_utf16_lossy(&value[..chars]).trim_end_matches('\0').trim().trim_matches('"').to_string();
            if path.is_empty() || !std::path::Path::new(&path).is_file() || out.iter().any(|a| a.id.eq_ignore_ascii_case(&path)) {
                continue;
            }
            out.push(App { name: crate::mixer::display_name(&path), id: path.clone(), source: "apppaths", exe: Some(path) });
        }
        let _ = unsafe { RegCloseKey(key) };
    }
    out
}

/// The cached list, read once if empty. A failed read is not cached.
pub(crate) fn apps(state: &LauncherState, refresh: bool) -> Result<Vec<App>, String> {
    if !refresh {
        if let Some(apps) = state.apps.lock().unwrap().clone() {
            return Ok(apps);
        }
    }
    // Stamped on the attempt, so a failing list is not read again on every Alt+N press.
    *state.scanned.lock().unwrap() = Some(Instant::now());
    let apps = on_sta(list_apps).ok_or("failed")??;
    *state.apps.lock().unwrap() = Some(apps.clone());
    Ok(apps)
}

/// Runs `f` on the list as last read, empty if it was never read, without reading it: the taskbar's thread must not wait on
/// the shell.
pub(crate) fn cached<T>(state: &LauncherState, f: impl FnOnce(&[App]) -> T) -> T {
    f(state.apps.lock().unwrap_or_else(|e| e.into_inner()).as_deref().unwrap_or_default())
}

/// The list was read, or tried, less than `RESCAN_GAP` ago: it is not read again yet for an id or an app it may lack.
pub(crate) fn read_lately(state: &LauncherState) -> bool {
    state.scanned.lock().unwrap().is_some_and(|t| t.elapsed() < RESCAN_GAP)
}

/// In the Start list as last read.
fn listed(state: &LauncherState, id: &str) -> bool {
    state.apps.lock().unwrap().as_ref().is_some_and(|apps| apps.iter().any(|a| a.id == id))
}

/// In the Start list, or one of the bar's own pins.
fn is_known(state: &LauncherState, id: &str) -> bool {
    listed(state, id) || crate::taskbar::ownpins::known(id)
}

/// Blocking work (the list takes a moment, a few hundred entries) off the async runtime.
async fn blocking<T: Send + 'static>(app: AppHandle, f: impl FnOnce(&LauncherState) -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || f(&app.state::<LauncherState>())).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn launcher_apps(refresh: bool, app: AppHandle) -> Result<Vec<App>, String> {
    blocking(app, move |state| apps(state, refresh)).await?
}

/// Icons only for ids from the list, so no other path (a UNC share, say) reaches the shell.
#[tauri::command]
pub async fn launcher_icons(ids: Vec<String>, app: AppHandle) -> Result<HashMap<String, Option<String>>, String> {
    blocking(app, move |state| {
        apps(state, false)?;
        let ids: Vec<String> = ids.into_iter().filter(|id| is_known(state, id)).collect();
        let missing: Vec<String> = {
            let cache = state.icons.lock().unwrap();
            ids.iter().filter(|id| !cache.contains_key(*id)).cloned().collect()
        };
        if !missing.is_empty() {
            // An own pin is drawn from its exe or shortcut (`icon_source`), a listed entry from its id.
            let sources: Vec<(Option<String>, String)> =
                missing.into_iter().map(|id| (crate::taskbar::ownpins::icon_source(&id).or_else(|| listed(state, &id).then(|| id.clone())), id)).collect();
            let fresh = on_sta(move || sources.into_iter().map(|(source, id)| (id, source.and_then(|s| icon_png(&s)))).collect::<HashMap<_, _>>());
            state.icons.lock().unwrap().extend(fresh.unwrap_or_default());
        }
        let cache = state.icons.lock().unwrap();
        Ok(ids.into_iter().filter_map(|id| cache.get(&id).cloned().map(|icon| (id, icon))).collect())
    })
    .await?
}

/// From a bar, the app opens on the bar's monitor; from the notch, where Windows puts it. With `admin`, as administrator after
/// Windows asks. With `reuse` (the Launcher's tiles), an app already open comes forward instead (`open`); the bar asks for a new
/// copy here, its buttons bring open windows forward themselves. Errors: not-found, cancelled (the prompt was declined), failed.
#[tauri::command]
pub async fn launcher_open(id: String, admin: Option<bool>, reuse: Option<bool>, window: WebviewWindow, app: AppHandle) -> Result<(), String> {
    let monitor = launch_monitor(&window);
    blocking(app, move |state| open(state, id, admin == Some(true), reuse == Some(true), monitor)).await?
}

/// Where a launch from `window` opens: a bar's monitor, or None from the notch, where Windows puts it.
pub(crate) fn launch_monitor(window: &WebviewWindow) -> Option<isize> {
    on_its_monitor(window.label())
        .then(|| window.hwnd().ok())
        .flatten()
        .map(|hwnd| unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) }.0 as isize)
}

/// The windows whose launches open on their own monitor: the bars, `taskbar` and `taskbar-<n>`.
fn on_its_monitor(label: &str) -> bool {
    label == "taskbar" || label.starts_with("taskbar-")
}

/// Starts one of the bar's own pins as it is (`ownpins::launch_spec`), else a listed app, on `monitor` when one is given; an app
/// that keeps its own place keeps it. With `reuse` and not `admin`, an app already open comes forward instead, as Win+number does
/// on Windows' taskbar (#64). With `admin`, verb `runas`: on the entry's exe when it has one, else on the id itself (a Store app
/// has no `runas`, and nothing starts, as on Windows' taskbar).
fn open(state: &LauncherState, id: String, admin: bool, reuse: bool, monitor: Option<isize>) -> Result<(), String> {
    let verb = admin.then_some("runas");
    // Read once, before the lookup, so an app open before the Launcher was ever used is still found by its Start entry.
    let list = (reuse && !admin).then(|| apps(state, false));
    if let Some(list) = &list {
        if bring_forward(&id, list.clone().unwrap_or_default()) {
            return Ok(());
        }
    }
    if let Some((file, params)) = crate::taskbar::ownpins::launch_spec(&id) {
        return execute(&file, params.as_deref(), verb, monitor);
    }
    list.unwrap_or_else(|| apps(state, false))?;
    // Not in the cached list: it may be new since. Read the list again, at most once a minute.
    if !listed(state, &id) {
        if read_lately(state) || apps(state, true).is_err() || !listed(state, &id) {
            return Err("not-found".into());
        }
    }
    let exe = admin.then(|| cached(state, |apps| apps.iter().find(|a| a.id == id).and_then(|a| a.exe.clone()))).flatten();
    execute(exe.as_deref().unwrap_or(&id), None, verb, monitor)
}

/// Whether app `id` has a window open (`tasks::open_window`), which is then brought forward. A window that Windows does not let
/// come forward still counts: a second copy would not help.
fn bring_forward(id: &str, apps: Vec<App>) -> bool {
    let id = id.to_string();
    on_sta(move || match crate::taskbar::tasks::open_window(&apps, &id) {
        Some(hwnd) => {
            let _ = crate::taskbar::tasks::activate(hwnd);
            true
        }
        None => false,
    })
    .unwrap_or(false)
}

/// Runs `file` with `params` and `verb` through the shell, on `monitor` when one is given. Errors: cancelled (a declined
/// administrator prompt), failed.
pub(crate) fn execute(file: &str, params: Option<&str>, verb: Option<&str>, monitor: Option<isize>) -> Result<(), String> {
    let (file, params, verb) = (HSTRING::from(file), params.map(HSTRING::from), verb.map(HSTRING::from));
    let ok = on_sta(move || unsafe {
        // Lets an already running single-instance app (which only gets a message) take the foreground.
        let _ = AllowSetForegroundWindow(ASFW_ANY);
        let text = |s: &Option<HSTRING>| s.as_ref().map_or(PCWSTR::null(), |s| PCWSTR(s.as_ptr()));
        let ok = match monitor {
            None => ShellExecuteW(None, text(&verb), &file, text(&params), PCWSTR::null(), SW_SHOWNORMAL).0 as isize > 32,
            Some(monitor) => {
                let mut info = SHELLEXECUTEINFOW {
                    cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
                    // NOASYNC: this thread ends right after, so the launch finishes before the call returns.
                    fMask: SEE_MASK_NOASYNC | SEE_MASK_HMONITOR,
                    lpVerb: text(&verb),
                    lpFile: PCWSTR(file.as_ptr()),
                    lpParameters: text(&params),
                    nShow: SW_SHOWNORMAL.0,
                    Anonymous: SHELLEXECUTEINFOW_0 { hMonitor: HANDLE(monitor as _) },
                    ..Default::default()
                };
                ShellExecuteExW(&mut info).is_ok()
            }
        };
        // Read at once, before another call can set it again.
        ok.then_some(()).ok_or_else(|| GetLastError() == ERROR_CANCELLED)
    })
    .unwrap_or(Err(false));
    ok.map_err(|cancelled| if cancelled { "cancelled" } else { "failed" }.into())
}

/// Registers Alt+1.. for these ids (slot = index, at most six) through the shell's shortcut registry,
/// which frees the keys held before. Returns per slot whether Windows gave the key (false = another app holds it).
/// Not async: it runs on the main thread, where the plugin's hotkey window lives.
#[tauri::command]
pub fn launcher_shortcuts(ids: Vec<String>, app: AppHandle) -> Vec<bool> {
    crate::shell::bind_launch(&app, ids.into_iter().zip(DIGITS).map(|(id, code)| (Shortcut::new(Some(Modifiers::ALT), code), id)).collect())
}

/// An Alt+N key was pressed (dispatched by `shell::on_shortcut`).
pub fn launch_from_key(app: &AppHandle, id: String) {
    let app = app.clone();
    // Off the main thread: the first launch may have to read the app list.
    std::thread::spawn(move || {
        if let Err(code) = open(&app.state::<LauncherState>(), id.clone(), false, true, None) {
            // The frontend names the app; open the notch so the message is seen.
            let _ = app.emit("launcher://missing", serde_json::json!({ "id": id, "code": code }));
            crate::shell::open(&app, Some("launcher"));
        }
    });
}

/// Whether the Start menu's app list (`shell:AppsFolder`) has this AppUserModelID. Needs COM: run it through `on_sta`.
pub(crate) fn in_apps_folder(app_id: &str) -> bool {
    let item: windows::core::Result<IShellItem> = unsafe { SHCreateItemFromParsingName(&HSTRING::from(format!("{APPS_PREFIX}{app_id}")), None) };
    item.is_ok()
}

/// The entry's icon as a PNG data URL (works for `shell:AppsFolder\…` ids and exe paths).
pub(crate) fn icon_png(id: &str) -> Option<String> {
    let item: IShellItem = unsafe { SHCreateItemFromParsingName(&HSTRING::from(id), None) }.ok()?;
    item_png(&item)
}

/// A shell item's icon as a PNG data URL.
pub(crate) fn item_png(item: &IShellItem) -> Option<String> {
    unsafe {
        let factory: IShellItemImageFactory = item.cast().ok()?;
        let bitmap = factory.GetImage(SIZE { cx: ICON_PX, cy: ICON_PX }, SIIGBF_ICONONLY).ok()?;
        let png = bitmap_to_png(bitmap);
        let _ = DeleteObject(bitmap.into());
        Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png?)))
    }
}

/// 32-bit bitmap with premultiplied alpha (what the shell hands out) to a straight-alpha PNG.
pub(crate) unsafe fn bitmap_to_png(bitmap: HBITMAP) -> Option<Vec<u8>> {
    let mut bm = BITMAP::default();
    if GetObjectW(bitmap.into(), std::mem::size_of::<BITMAP>() as i32, Some((&mut bm as *mut BITMAP).cast())) == 0 {
        return None;
    }
    let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
    let mut bmi = BITMAPINFO::default();
    bmi.bmiHeader = BITMAPINFOHEADER {
        biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: w,
        biHeight: -h, // top-down
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let mut px = vec![0u8; (w * h * 4) as usize];
    let dc = CreateCompatibleDC(None);
    let lines = GetDIBits(dc, bitmap, 0, h as u32, Some(px.as_mut_ptr().cast()), &mut bmi, DIB_RGB_COLORS);
    let _ = DeleteDC(dc);
    if lines == 0 {
        return None;
    }
    let no_alpha = px.chunks(4).all(|p| p[3] == 0);
    for p in px.chunks_mut(4) {
        p.swap(0, 2); // BGRA → RGBA
        if no_alpha {
            p[3] = 255;
        } else if p[3] > 0 && p[3] < 255 {
            let a = p[3] as u32;
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    let img = image::RgbaImage::from_raw(w as u32, h as u32, px)?;
    let mut png = Vec::new();
    img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
    Some(png)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apps_folder_has_listed_ids_not_made_up_ones() {
        // A machine whose Start list cannot be read (a service account) has nothing to check.
        let Some(Ok(listed)) = on_sta(start_apps) else { return };
        let ids: Vec<String> = listed.iter().take(10).filter_map(|a| a.id.strip_prefix(APPS_PREFIX).map(str::to_string)).collect();
        if !ids.is_empty() {
            assert_eq!(on_sta(move || ids.iter().any(|id| in_apps_folder(id))), Some(true));
        }
        // Explorer opens Documents for an id like this one (issue #50), so notices must not hand it over.
        assert_eq!(on_sta(|| in_apps_folder("Crest.Test.NotAnApp")), Some(false));
    }

    #[test]
    fn a_shortcut_matches_by_exe_only_without_arguments() {
        assert_eq!(plain_exe(Some(r"C:\Users\u\Code.exe"), None), Some(r"C:\Users\u\Code.exe".into()));
        assert_eq!(plain_exe(Some(r"C:\Windows\System32\cmd.exe"), Some("/k VsDevCmd.bat")), None);
        assert_eq!(plain_exe(Some("::{52205FD8-5DFB-447D-801A-D0B52F2E83E1}"), None), None);
        assert_eq!(plain_exe(Some(r"C:\Windows\System32\compmgmt.msc"), Some(" ")), None);
    }

    #[test]
    fn open_apps_find_their_start_entries() {
        let app = |id: &str, source: &'static str, exe: Option<&str>| App { id: id.into(), name: id.into(), source, exe: exe.map(Into::into) };
        let apps = [
            app("shell:AppsFolder\\Chrome", "start", None), // its shortcut has arguments
            app("shell:AppsFolder\\VSCode", "start", Some(r"C:\Users\u\Code.exe")),
            app("shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App", "start", None),
            app(r"C:\Users\u\Code.exe", "apppaths", Some(r"C:\Users\u\Code.exe")),
        ];
        let ids = |v: Vec<App>| v.into_iter().map(|a| a.id).collect::<Vec<_>>();
        assert_eq!(ids(entries_for(&apps, Some("chrome"), "")), ["shell:AppsFolder\\Chrome"]);
        assert!(entries_for(&apps, Some("Chrome._crx_x"), r"C:\Program Files\Google\Chrome\chrome.exe").is_empty()); // a PWA never lights up its browser
        assert_eq!(ids(entries_for(&apps, None, r"c:\users\u\code.exe")), ["shell:AppsFolder\\VSCode", r"C:\Users\u\Code.exe"]);
        assert_eq!(ids(entries_for(&apps, Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"), "")), ["shell:AppsFolder\\Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"]);
        assert!(entries_for(&apps, None, r"C:\tools\portable.exe").is_empty());
    }

    #[test]
    fn only_listed_ids_and_own_pins_launch() {
        let state = LauncherState::default();
        let here = std::env::current_exe().unwrap().to_string_lossy().into_owned();
        let gone = r"C:\Crest\Test\gone.exe";
        let pin = |path: &str| serde_json::json!({ "id": path, "name": "Pin", "kind": "exe", "path": path });
        crate::taskbar::ownpins::with_saved(&serde_json::json!([pin(&here), pin(gone)]).to_string(), || {
            assert!(is_known(&state, &here) && is_known(&state, gone));
            assert_eq!(crate::taskbar::ownpins::launch_spec(&here), Some((here.clone(), None)));
            // A pin whose exe is gone falls through to the Start list, which does not have it.
            assert_eq!(crate::taskbar::ownpins::launch_spec(gone), None);
            assert!(open(&state, gone.into(), false, false, None).is_err());
            // No window answers to it either, so asking to reuse one changes nothing.
            assert!(open(&state, gone.into(), false, true, None).is_err());
            // Neither list knows it.
            assert!(!is_known(&state, r"C:\Crest\Test\other.exe"));
            assert!(open(&state, r"C:\Crest\Test\other.exe".into(), false, false, None).is_err());
        });
    }

    #[test]
    fn only_a_bar_launches_on_its_own_monitor() {
        assert!(on_its_monitor("taskbar") && on_its_monitor("taskbar-2"));
        assert!(!on_its_monitor("notch") && !on_its_monitor("settings") && !on_its_monitor("taskbarx"));
    }
}
