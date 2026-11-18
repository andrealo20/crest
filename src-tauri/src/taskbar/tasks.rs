// Adapted from ManagedShell (Apache-2.0, github.com/cairoshell/ManagedShell), src/ManagedShell.WindowsTasks/ApplicationWindow.cs and TasksService.cs (which windows get a button, minimize, the window in front, flashing and ghost windows).
//! The bar's list of open windows (Windows only): the windows that get a button, grouped by app, each app with its Start
//! entries as pins, and the commands the bar's buttons call.
//!
//! The taskbar thread (mod.rs) feeds it WinEvents (windows shown, hidden, destroyed, renamed, cloaked, minimized, brought to
//! front) and the shell hook's flash, ghost-window and monitor codes. Each only arms a 100 ms timer that is not armed yet; when it
//! fires, the list is made again (`Track::recompute`) and each bar gets the windows on its monitor if they changed. The commands
//! act only on listed windows, still of the process they were listed with.

use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{GUID, PWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HWND, LPARAM, PROPERTYKEY, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
use windows::Win32::Storage::Packaging::Appx::{GetApplicationUserModelId, APPLICATION_USER_MODEL_ID_MAX_LENGTH};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToStringAlloc};
use windows::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
use windows::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, GetAncestor, GetForegroundWindow, GetLastActivePopup, GetWindow, GetWindowLongPtrW, GetWindowTextW, IsIconic,
    IsWindowVisible, KillTimer, PostMessageW, SetForegroundWindow, SetTimer, ShowWindowAsync, EVENT_OBJECT_CLOAKED, EVENT_OBJECT_DESTROY,
    EVENT_OBJECT_HIDE, EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND,
    EVENT_SYSTEM_MINIMIZESTART, GA_ROOT, GA_ROOTOWNER, GWL_EXSTYLE, GWL_STYLE, GW_OWNER, HSHELL_HIGHBIT, HSHELL_MONITORCHANGED, HSHELL_REDRAW,
    HSHELL_WINDOWREPLACED, HSHELL_WINDOWREPLACING, SC_CLOSE, SC_MINIMIZE, SW_RESTORE, WM_SYSCOMMAND, WS_EX_APPWINDOW, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW, WS_EX_WINDOWEDGE, WS_MINIMIZEBOX,
};

use super::screens;
use crate::launcher::{self, LauncherState};
use crate::{display, mixer};

/// A window flashes: the redraw code with the high bit (not in the windows crate).
const HSHELL_FLASH: u32 = HSHELL_REDRAW | HSHELL_HIGHBIT;
/// System.AppUserModel.ID, defined here so one key does not need the EnhancedStorage feature.
pub(super) const APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3), pid: 5 };
/// The list's one-shot timer on the thread's window (mod.rs routes it), with an id of its own.
pub(super) const LIST_TIMER: usize = 2;
const LIST_MS: u32 = 100;
/// Shell surfaces that are windows too (Start, search, flyouts); a Store app's frame has WS_EX_WINDOWEDGE, they do not.
const IMMERSIVE: [&str; 4] = ["ApplicationFrameWindow", "Windows.UI.Core.CoreWindow", "StartMenuSizingFrame", "Shell_LightDismissOverlay"];

/// What the bar shows (`taskbar://windows`, `taskbar_windows`). An HWND has 32 significant bits, a safe number in JS.
#[derive(Clone, Default, PartialEq, Serialize)]
pub struct WindowList {
    groups: Vec<Group>,
    /// The listed window in front, or the one whose dialog is.
    active: Option<isize>,
}

/// One app's windows in the list's order, with its Start entries.
#[derive(Clone, PartialEq, Serialize)]
pub struct Group {
    key: String,
    name: String,
    pins: Vec<Pin>,
    windows: Vec<Win>,
    /// An app without Start entries gets its icon from its exe (`taskbar_icons`).
    #[serde(skip)]
    exe: String,
}

#[derive(Clone, PartialEq, Serialize)]
pub struct Pin {
    id: String,
    name: String,
}

#[derive(Clone, PartialEq, Serialize)]
pub struct Win {
    id: isize,
    title: String,
    minimized: bool,
    flashing: bool,
}

/// The list as last made, with each listed window's process and monitor, for the commands, and what each bar was last sent.
#[derive(Default)]
struct Last {
    list: WindowList,
    pids: Vec<(isize, u32)>,
    /// Each listed window's monitor (`monitor_of`).
    monitors: HashMap<isize, isize>,
    /// By the bar's label.
    sent: HashMap<String, WindowList>,
}

static LAST: LazyLock<Mutex<Last>> = LazyLock::new(Mutex::default);
/// Icons of apps without Start entries, per group (`taskbar_icons`).
static ICONS: Mutex<BTreeMap<String, Option<String>>> = Mutex::new(BTreeMap::new());
/// The window in front, never a bar: a click on a bar leaves in front the app the click acts on (`toggle`).
static FOREGROUND: AtomicIsize = AtomicIsize::new(0);

thread_local! {
    /// The list's state on the taskbar thread, from `begin` until the thread ends.
    static TRACK: RefCell<Option<Track>> = const { RefCell::new(None) };
}

struct Track {
    app: AppHandle,
    window: HWND,
    /// The list timer is armed: SetTimer succeeded.
    armed: bool,
    /// Shell hook codes for the next list.
    shell: Vec<(u32, isize)>,
    /// The listed windows, in the list's order.
    order: Vec<isize>,
    /// Half of a ghost pair (`pair`).
    half: Option<(u32, isize)>,
    /// Ghost windows and the hung window whose app each shows (`stand_in`).
    ghosts: HashMap<isize, isize>,
    flashing: HashSet<isize>,
    /// Apps' names by exe: a version resource is read once.
    names: HashMap<String, String>,
}

/// How a window looks to `eligible`.
struct Look {
    visible: bool,
    /// Hidden by the system: on another virtual desktop, a suspended Store app.
    cloaked: bool,
    /// One of Crest's own windows.
    own: bool,
    owned: bool,
    ex: u32,
    /// One of the `IMMERSIVE` classes.
    immersive: bool,
}

/// Whether a window gets a button: visible, not cloaked, not Crest's, not a tool window, and marked for the taskbar
/// (WS_EX_APPWINDOW) or unowned and activatable; a shell surface only as a Store app's frame.
fn eligible(look: &Look) -> bool {
    look.visible
        && !look.cloaked
        && !look.own
        && look.ex & WS_EX_TOOLWINDOW.0 == 0
        && (look.ex & WS_EX_APPWINDOW.0 != 0 || (!look.owned && look.ex & WS_EX_NOACTIVATE.0 == 0))
        && !(look.immersive && look.ex & WS_EX_WINDOWEDGE.0 == 0)
}

/// The app a window belongs to: the window's AppUserModelID, else its package's, else its exe, lowercased; a window with none
/// of them is an app of its own.
fn group_key(window_aumid: Option<&str>, package_aumid: Option<&str>, exe: &str, id: isize) -> String {
    [window_aumid, package_aumid, Some(exe)].into_iter().flatten().find(|s| !s.is_empty()).map_or_else(|| format!("window:{id}"), str::to_lowercase)
}

/// Windows keep their places and new ones come last, in z-order: bringing a window forward moves no button.
fn merge_order(prev: &[isize], now: &[isize]) -> Vec<isize> {
    prev.iter().filter(|h| now.contains(h)).chain(now.iter().filter(|h| !prev.contains(h))).copied().collect()
}

/// Pairs the shell's two codes for a window that takes another's place (a ghost for its hung window, and back), in either
/// order: (the window that comes, the one that goes). A lone code waits for its other half.
fn pair(half: &mut Option<(u32, isize)>, code: u32, hwnd: isize) -> Option<(isize, isize)> {
    match half.take() {
        Some((other, first)) if other != code => Some(if code == HSHELL_WINDOWREPLACING { (hwnd, first) } else { (first, hwnd) }),
        _ => {
            *half = Some((code, hwnd));
            None
        }
    }
}

/// The order with `new` in `old`'s place, never twice.
fn replace(order: &[isize], new: isize, old: isize) -> Vec<isize> {
    order.iter().filter(|&&h| h != new).map(|&h| if h == old { new } else { h }).collect()
}

/// A ghost shows its hung window's app, so its button keeps its group, name and icon; the window back from its ghost shows its
/// own again.
fn stand_in(ghosts: &mut HashMap<isize, isize>, new: isize, old: isize) {
    let source = ghosts.remove(&old).unwrap_or(old);
    if source != new {
        ghosts.insert(new, source);
    }
}

/// The listed window in front: the foreground window, or the window that owns it (a Save dialog). None for the desktop and
/// for Crest's windows.
fn active_of(foreground: isize, root_owner: isize, listed: &[isize]) -> Option<isize> {
    [foreground, root_owner].into_iter().find(|h| listed.contains(h))
}

/// Whether a window event can change the list: a window brought to front always, a window shown or uncloaked if it is or could
/// be listed, every other event only for a listed window.
fn arms(event: u32, listed: bool, could_list: impl FnOnce() -> bool) -> bool {
    match event {
        EVENT_SYSTEM_FOREGROUND => true,
        EVENT_OBJECT_SHOW | EVENT_OBJECT_UNCLOAKED => listed || could_list(),
        EVENT_OBJECT_DESTROY | EVENT_OBJECT_HIDE | EVENT_OBJECT_CLOAKED | EVENT_OBJECT_NAMECHANGE | EVENT_SYSTEM_MINIMIZESTART | EVENT_SYSTEM_MINIMIZEEND => {
            listed
        }
        _ => false,
    }
}

/// A click on a window's button minimizes it only when it is the app in front; otherwise it brings the window forward.
fn toggle_minimizes(id: isize, active: Option<isize>, minimized: bool) -> bool {
    active == Some(id) && !minimized
}

/// Where the keyboard goes after a minimize or a close: the first usable (listed, not minimized) window in z-order other than
/// `skip`.
fn next_front(z_order: &[isize], skip: isize, usable: impl Fn(isize) -> bool) -> Option<isize> {
    z_order.iter().copied().find(|&h| h != skip && usable(h))
}

/// A bar's part of the list: each app's windows on the bar's monitor (`on_it`), and no app without one there. It names the window
/// in front only when that is one of them, so a focus change on another monitor leaves this bar's list, and its page, as they are.
fn for_monitor(list: &WindowList, on_it: impl Fn(isize) -> bool) -> WindowList {
    let mut here = list.clone();
    for group in &mut here.groups {
        group.windows.retain(|w| on_it(w.id));
    }
    here.groups.retain(|g| !g.windows.is_empty());
    // `active` is always a listed window, so on this monitor means kept.
    here.active = list.active.filter(|&id| on_it(id));
    here
}

/// The thread has its window (mod.rs): the list starts, at once.
pub(super) fn begin(app: AppHandle, window: HWND) {
    FOREGROUND.store(unsafe { GetForegroundWindow() }.0 as isize, Ordering::SeqCst);
    let track = Track {
        app,
        window,
        armed: false,
        shell: Vec::new(),
        order: Vec::new(),
        half: None,
        ghosts: HashMap::new(),
        flashing: HashSet::new(),
        names: HashMap::new(),
    };
    TRACK.with_borrow_mut(|t| *t = Some(track));
    arm();
}

/// The list is made again shortly, unless the timer is armed: armed again, a title that changes every frame would hold the
/// list back for good.
pub(super) fn arm() {
    TRACK.with_borrow_mut(|t| {
        if let Some(t) = t.as_mut().filter(|t| !t.armed) {
            // Armed only when SetTimer succeeded: a failed one is tried again with the next event.
            t.armed = unsafe { SetTimer(Some(t.window), LIST_TIMER, LIST_MS, None) } != 0;
        }
    });
}

/// A window event (mod.rs `on_event`). The window in front is kept, unless it is a bar.
pub(super) fn on_event(event: u32, hwnd: HWND) {
    let id = hwnd.0 as isize;
    if event == EVENT_SYSTEM_FOREGROUND {
        if screens::is_bar(id) {
            return;
        }
        FOREGROUND.store(id, Ordering::SeqCst);
    }
    let (armed, listed) = TRACK.with_borrow(|t| t.as_ref().map_or((true, false), |t| (t.armed, t.order.contains(&id))));
    if !armed && arms(event, listed, || could_list(hwnd)) {
        arm();
    }
}

/// A shell hook code (mod.rs): flashing and ghost windows wait for the next list; a window moved to another monitor only needs
/// one, which moves its button to that monitor's bar.
pub(super) fn on_shell(code: u32, hwnd: isize) {
    if matches!(code, HSHELL_FLASH | HSHELL_REDRAW | HSHELL_WINDOWREPLACING | HSHELL_WINDOWREPLACED) {
        TRACK.with_borrow_mut(|t| {
            if let Some(t) = t {
                t.shell.push((code, hwnd));
            }
        });
        arm();
    } else if code == HSHELL_MONITORCHANGED {
        arm();
    }
}

/// The list timer fired (mod.rs): the list is made again, and each bar gets the windows on its monitor if they changed. A bar
/// that is new or on another monitor gets them too (`screens::sync` lists again).
pub(super) fn on_timer(window: HWND) {
    let _ = unsafe { KillTimer(Some(window), LIST_TIMER) };
    // Out of the cell while Windows is asked: an event let in meanwhile finds no list, never one borrowed twice.
    let Some(mut track) = TRACK.with_borrow_mut(Option::take) else { return };
    track.armed = false;
    let (list, pids, monitors) = track.recompute();
    let app = track.app.clone();
    TRACK.with_borrow_mut(|t| *t = Some(track));
    let lists: Vec<(String, WindowList)> = screens::all()
        .into_iter()
        .map(|(label, bar)| {
            let monitor = monitor_of(HWND(bar as _));
            (label, for_monitor(&list, |id| monitors.get(&id) == Some(&monitor)))
        })
        .collect();
    let mut last = last();
    last.list = list;
    last.pids = pids;
    last.monitors = monitors;
    let changed: Vec<(String, WindowList)> = lists.iter().filter(|(label, here)| last.sent.get(label) != Some(here)).cloned().collect();
    // A bar gone leaves the record.
    last.sent = lists.into_iter().collect();
    drop(last);
    for (label, here) in changed {
        let _ = app.emit_to(label, "taskbar://windows", here);
    }
}

/// The bar has gone (mod.rs `stop`): a bar built later starts from an empty list.
pub(super) fn clear() {
    *last() = Last::default();
}

impl Track {
    /// The open windows now, grouped by app in the order each app first comes, and each window's process and monitor.
    fn recompute(&mut self) -> (WindowList, Vec<(isize, u32)>, HashMap<isize, isize>) {
        for (code, hwnd) in std::mem::take(&mut self.shell) {
            match code {
                HSHELL_FLASH => {
                    self.flashing.insert(hwnd);
                }
                HSHELL_REDRAW => {
                    self.flashing.remove(&hwnd);
                }
                _ => {
                    if let Some((new, old)) = pair(&mut self.half, code, hwnd) {
                        self.order = replace(&self.order, new, old);
                        stand_in(&mut self.ghosts, new, old);
                    }
                }
            }
        }
        let own = unsafe { GetCurrentProcessId() };
        let now: Vec<isize> = display::top_windows().into_iter().filter(|&h| listable(h, own)).map(|h| h.0 as isize).collect();
        self.order = merge_order(&self.order, &now);
        let order = &self.order;
        self.ghosts.retain(|ghost, _| order.contains(ghost));
        self.flashing.retain(|h| order.contains(h));
        let active = active_now(order);
        // A window brought to front has been seen: it stops asking for attention.
        if let Some(active) = active {
            self.flashing.remove(&active);
        }
        // Read once per process.
        let mut processes: HashMap<u32, (Option<String>, String)> = HashMap::new();
        let mut groups: Vec<(Group, Option<String>)> = Vec::new();
        let mut pids = Vec::new();
        let mut monitors = HashMap::new();
        for &id in &self.order {
            let hwnd = HWND(id as _);
            let source = HWND(self.ghosts.get(&id).copied().unwrap_or(id) as _);
            let window_aumid = window_app_id(source);
            let pid = display::app_pid(source);
            let (package_aumid, exe) = processes.entry(pid).or_insert_with(|| (package_app_id(pid), mixer::process_path(pid).unwrap_or_default())).clone();
            let key = group_key(window_aumid.as_deref(), package_aumid.as_deref(), &exe, id);
            let win = Win { id, title: title(hwnd), minimized: unsafe { IsIconic(hwnd) }.as_bool(), flashing: self.flashing.contains(&id) };
            pids.push((id, display::window_pid(hwnd)));
            monitors.insert(id, monitor_of(hwnd));
            match groups.iter_mut().find(|(group, _)| group.key == key) {
                Some((group, _)) => group.windows.push(win),
                None => {
                    let aumid = window_aumid.filter(|s| !s.is_empty()).or(package_aumid.filter(|s| !s.is_empty()));
                    groups.push((Group { key, name: String::new(), pins: Vec::new(), windows: vec![win], exe }, aumid));
                }
            }
        }
        let state = self.app.state::<LauncherState>();
        launcher::cached(&state, |apps| {
            for (group, aumid) in &mut groups {
                group.pins = launcher::entries_for(apps, aumid.as_deref(), &group.exe).into_iter().map(|a| Pin { id: a.id, name: a.name }).collect();
            }
        });
        let groups = groups
            .into_iter()
            .map(|(mut group, _)| {
                group.name = match group.pins.first() {
                    Some(pin) => pin.name.clone(),
                    None if !group.exe.is_empty() => self.names.entry(group.exe.clone()).or_insert_with(|| mixer::display_name(&group.exe)).clone(),
                    None => group.windows[0].title.clone(),
                };
                group
            })
            .collect();
        (WindowList { groups, active }, pids, monitors)
    }
}

/// The monitor a window is on; for a minimized one, the monitor it comes back to. It asks no window, so any thread.
pub(super) fn monitor_of(hwnd: HWND) -> isize {
    unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) }.0 as isize
}

/// Whether a top-level window gets a button now (`eligible`). Few are visible, so only those are read further.
pub(super) fn listable(hwnd: HWND, own: u32) -> bool {
    let visible = unsafe { IsWindowVisible(hwnd) }.as_bool();
    visible
        && eligible(&Look {
            visible,
            cloaked: cloaked(hwnd),
            own: display::window_pid(hwnd) == own,
            owned: unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|o| !o.is_invalid()),
            ex: unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32,
            immersive: IMMERSIVE.contains(&display::class_name(hwnd).as_str()),
        })
}

/// Whether the window an event names could get a button: a top-level window that is `listable`.
fn could_list(hwnd: HWND) -> bool {
    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    root == hwnd && listable(hwnd, unsafe { GetCurrentProcessId() })
}

fn cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe { DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4) }.is_ok() && cloaked != 0
}

/// The listed window in front now. Read when asked, as a click on the bar can come before the list that follows a change.
fn active_now(listed: &[isize]) -> Option<isize> {
    let foreground = FOREGROUND.load(Ordering::SeqCst);
    let root_owner = unsafe { GetAncestor(HWND(foreground as _), GA_ROOTOWNER) }.0 as isize;
    active_of(foreground, root_owner, listed)
}

/// The title. Another process's window gives it without a message, so a hung app never holds the thread; Crest's own windows,
/// which would get one, are never listed.
fn title(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let len = unsafe { GetWindowTextW(hwnd, &mut buf) }.max(0) as usize;
    String::from_utf16_lossy(&buf[..len])
}

/// The AppUserModelID an app set on its window (a browser profile, a web app, a Store app's frame).
fn window_app_id(hwnd: HWND) -> Option<String> {
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
        let mut value = store.GetValue(&APP_USER_MODEL_ID).ok()?;
        let id = PropVariantToStringAlloc(&value).ok().and_then(|p| crate::controls::take(p));
        let _ = PropVariantClear(&mut value);
        id
    }
}

/// The AppUserModelID of a packaged app's process; None for any other.
fn package_app_id(pid: u32) -> Option<String> {
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; APPLICATION_USER_MODEL_ID_MAX_LENGTH as usize];
        let mut len = buf.len() as u32;
        let found = GetApplicationUserModelId(process, &mut len, Some(PWSTR(buf.as_mut_ptr()))) == ERROR_SUCCESS;
        let _ = CloseHandle(process);
        found.then(|| String::from_utf16_lossy(&buf[..buf.iter().position(|&c| c == 0).unwrap_or(buf.len())]))
    }
}

fn last() -> MutexGuard<'static, Last> {
    LAST.lock().unwrap_or_else(|e| e.into_inner())
}

/// The calling bar's windows, those on its monitor, for a bar page that has just loaded; `taskbar://windows` brings each change.
#[tauri::command]
pub fn taskbar_windows(window: WebviewWindow) -> WindowList {
    // A sync command runs on the main thread, where the handle is read without a wait.
    let Ok(hwnd) = window.hwnd() else { return WindowList::default() };
    let monitor = monitor_of(hwnd);
    let last = last();
    for_monitor(&last.list, |id| last.monitors.get(&id) == Some(&monitor))
}

/// What a click on a window's button does: "activate", "toggle" (minimizes the app in front, else brings it forward),
/// "minimize" or "close". Only a listed window, still of the process it was listed with. An app running as administrator may
/// refuse a minimize or a close (UIPI): the error comes back and nothing else happens.
#[tauri::command]
pub async fn taskbar_window(id: isize, action: String) -> Result<(), String> {
    let (pid, listed) = {
        let last = last();
        (last.pids.iter().find(|&&(h, _)| h == id).map(|&(_, pid)| pid), last.pids.iter().map(|&(h, _)| h).collect::<Vec<_>>())
    };
    let hwnd = HWND(id as _);
    // Gone, or its handle reused by another process since the list was made.
    let Some(pid) = pid.filter(|&pid| pid == display::window_pid(hwnd)) else { return Err("not-found".into()) };
    match action.as_str() {
        "activate" => activate(hwnd),
        "toggle" if toggle_minimizes(id, active_now(&listed), unsafe { IsIconic(hwnd) }.as_bool()) => minimize(hwnd, pid, &listed),
        "toggle" => activate(hwnd),
        "minimize" => minimize(hwnd, pid, &listed),
        "close" => close(hwnd, pid, &listed),
        _ => Err("unknown-action".into()),
    }
}

/// A bar menu closed with Esc: the keyboard goes back to the app in front.
#[tauri::command]
pub fn taskbar_release() {
    let listed: Vec<isize> = last().pids.iter().map(|&(h, _)| h).collect();
    if let Some(active) = active_now(&listed) {
        let _ = activate(HWND(active as _));
    }
}

/// Icons of listed apps without Start entries, from their exe, cached per group. Only listed groups: the page never names a
/// file the shell would read.
#[tauri::command]
pub async fn taskbar_icons(keys: Vec<String>) -> HashMap<String, Option<String>> {
    let exes: Vec<(String, String)> =
        last().list.groups.iter().filter(|g| g.pins.is_empty() && keys.contains(&g.key)).map(|g| (g.key.clone(), g.exe.clone())).collect();
    let missing: Vec<(String, String)> = {
        let icons = icons();
        exes.iter().filter(|(key, _)| !icons.contains_key(key)).cloned().collect()
    };
    if !missing.is_empty() {
        let read = move || missing.into_iter().map(|(key, exe)| (key, if exe.is_empty() { None } else { launcher::icon_png(&exe) })).collect::<Vec<_>>();
        let fresh = tauri::async_runtime::spawn_blocking(move || launcher::on_sta(read)).await;
        icons().extend(fresh.ok().flatten().unwrap_or_default());
    }
    let icons = icons();
    exes.into_iter().filter_map(|(key, _)| icons.get(&key).cloned().map(|icon| (key, icon))).collect()
}

fn icons() -> MutexGuard<'static, BTreeMap<String, Option<String>>> {
    ICONS.lock().unwrap_or_else(|e| e.into_inner())
}

/// Brings a window forward: restored if minimized, then the dialog it has open, or itself, in front.
fn activate(hwnd: HWND) -> Result<(), String> {
    unsafe {
        if IsIconic(hwnd).as_bool() {
            let _ = ShowWindowAsync(hwnd, SW_RESTORE);
        }
        if SetForegroundWindow(GetLastActivePopup(hwnd)).as_bool() { Ok(()) } else { Err("failed".into()) }
    }
}

/// Minimizes a window as its own button does: only one that has the button and takes input. The app may hand its activation
/// on as it minimizes.
fn minimize(hwnd: HWND, pid: u32, listed: &[isize]) -> Result<(), String> {
    unsafe {
        if GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 & WS_MINIMIZEBOX.0 == 0 || !IsWindowEnabled(hwnd).as_bool() {
            return Err("failed".into());
        }
        let _ = AllowSetForegroundWindow(pid);
    }
    command(hwnd, SC_MINIMIZE, listed)
}

/// Closes a window as its own X does, so an app that closes to the tray does that. Its "Save changes?" may come to the front.
fn close(hwnd: HWND, pid: u32, listed: &[isize]) -> Result<(), String> {
    let _ = unsafe { AllowSetForegroundWindow(pid) };
    command(hwnd, SC_CLOSE, listed)
}

/// Posts a window command, never waiting on a hung app, then the keyboard goes to the next window, as when Windows minimizes or
/// closes one.
fn command(hwnd: HWND, sc: u32, listed: &[isize]) -> Result<(), String> {
    unsafe { PostMessageW(Some(hwnd), WM_SYSCOMMAND, WPARAM(sc as usize), LPARAM(0)) }.map_err(|_| "failed".to_string())?;
    let z_order: Vec<isize> = display::top_windows().into_iter().map(|h| h.0 as isize).collect();
    let usable = |h: isize| listed.contains(&h) && !unsafe { IsIconic(HWND(h as _)) }.as_bool();
    if let Some(next) = next_front(&z_order, hwnd.0 as isize, usable) {
        let _ = unsafe { SetForegroundWindow(GetLastActivePopup(HWND(next as _))) };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_taskbar_windows_get_a_button() {
        let l = |ex: u32, owned: bool| Look { visible: true, cloaked: false, own: false, owned, ex, immersive: false };
        assert!(eligible(&l(0, false))); // plain unowned
        assert!(!eligible(&l(0, true))); // owned dialog
        assert!(eligible(&l(WS_EX_APPWINDOW.0, true)));
        assert!(!eligible(&l(WS_EX_NOACTIVATE.0, false)));
        assert!(eligible(&l(WS_EX_NOACTIVATE.0 | WS_EX_APPWINDOW.0, false)));
        assert!(!eligible(&l(WS_EX_TOOLWINDOW.0 | WS_EX_APPWINDOW.0, false)));
        assert!(!eligible(&Look { cloaked: true, ..l(0, false) }));
        assert!(!eligible(&Look { visible: false, ..l(0, false) }));
        assert!(!eligible(&Look { own: true, ..l(WS_EX_APPWINDOW.0, false) })); // Crest's own windows
        assert!(!eligible(&Look { immersive: true, ..l(0, false) })); // a shell surface without WS_EX_WINDOWEDGE
        assert!(eligible(&Look { immersive: true, ..l(WS_EX_WINDOWEDGE.0, false) })); // a UWP app frame
    }

    #[test]
    fn windows_group_by_aumid_then_package_then_exe() {
        assert_eq!(group_key(Some("Chrome"), Some("x!App"), r"C:\a.exe", 1), "chrome");
        assert_eq!(group_key(None, Some("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"), r"C:\a.exe", 1), "microsoft.windowscalculator_8wekyb3d8bbwe!app");
        assert_eq!(group_key(Some(""), None, r"C:\Users\u\Code.exe", 1), r"c:\users\u\code.exe");
        assert_eq!(group_key(None, None, "", 123), "window:123");
    }

    #[test]
    fn the_list_keeps_its_order() {
        assert_eq!(merge_order(&[1, 2, 3], &[3, 1, 2]), vec![1, 2, 3]); // a z-order change alone changes nothing
        assert_eq!(merge_order(&[1, 2, 3], &[3, 1]), vec![1, 3]);
        assert_eq!(merge_order(&[1, 2], &[4, 2, 1]), vec![1, 2, 4]);
        assert_eq!(merge_order(&[], &[5, 6]), vec![5, 6]);
    }

    #[test]
    fn a_ghost_takes_its_hung_windows_place() {
        let mut pending = None;
        assert_eq!(pair(&mut pending, HSHELL_WINDOWREPLACED, 10), None);
        assert_eq!(pair(&mut pending, HSHELL_WINDOWREPLACING, 20), Some((20, 10)));
        assert_eq!(pair(&mut pending, HSHELL_WINDOWREPLACING, 30), None);
        assert_eq!(pair(&mut pending, HSHELL_WINDOWREPLACED, 40), Some((30, 40)));
        assert_eq!(replace(&[1, 10, 2], 20, 10), vec![1, 20, 2]);
    }

    #[test]
    fn a_ghost_shows_its_hung_windows_app() {
        assert_eq!(replace(&[1, 10, 20], 20, 10), vec![1, 20]); // the ghost was listed first: it is never there twice
        let mut ghosts = HashMap::new();
        stand_in(&mut ghosts, 20, 10); // ghost 20 for hung window 10
        assert_eq!(ghosts.get(&20), Some(&10));
        stand_in(&mut ghosts, 10, 20); // 10 answers again and takes its place back
        assert!(ghosts.is_empty());
    }

    #[test]
    fn the_app_in_front_is_the_listed_window_or_its_owner() {
        assert_eq!(active_of(7, 7, &[7, 8]), Some(7));
        assert_eq!(active_of(9, 8, &[7, 8]), Some(8)); // an owned Save dialog
        assert_eq!(active_of(5, 5, &[7, 8]), None); // the desktop or a Crest window
    }

    #[test]
    fn only_list_changes_arm_the_timer() {
        assert!(arms(EVENT_SYSTEM_FOREGROUND, false, || false));
        assert!(arms(EVENT_OBJECT_NAMECHANGE, true, || false) && !arms(EVENT_OBJECT_NAMECHANGE, false, || true));
        assert!(arms(EVENT_OBJECT_SHOW, false, || true) && !arms(EVENT_OBJECT_SHOW, false, || false));
        assert!(arms(EVENT_OBJECT_UNCLOAKED, false, || true));
        assert!(!arms(0x7FFF, true, || true));
    }

    #[test]
    fn toggle_minimizes_only_the_app_in_front() {
        assert!(toggle_minimizes(7, Some(7), false));
        assert!(!toggle_minimizes(7, Some(7), true)); // minimized: bring it back
        assert!(!toggle_minimizes(7, Some(8), false)); // behind: bring it forward
        assert!(!toggle_minimizes(7, None, false));
    }

    #[test]
    fn the_keyboard_goes_to_the_next_window() {
        let usable = |h: isize| h != 3; // 3 is minimized
        assert_eq!(next_front(&[1, 2, 3, 4], 1, usable), Some(2));
        assert_eq!(next_front(&[1, 3], 1, usable), None);
    }

    #[test]
    fn each_bar_lists_its_own_monitors_windows() {
        let w = |id| Win { id, title: String::new(), minimized: false, flashing: false };
        let g = |key: &str, ids: &[isize]| Group { key: key.into(), name: key.into(), pins: vec![], windows: ids.iter().map(|&i| w(i)).collect(), exe: String::new() };
        let list = WindowList { groups: vec![g("chrome", &[1, 2]), g("code", &[3])], active: Some(3) };
        let here = for_monitor(&list, |id| id == 2);
        assert_eq!(here.groups.len(), 1);
        assert_eq!(here.groups[0].windows.iter().map(|w| w.id).collect::<Vec<_>>(), vec![2]); // Chrome keeps only its window on this monitor
        assert_eq!(here.active, None); // the window in front is on another monitor, so this bar's list names none
        assert_eq!(for_monitor(&list, |id| id == 3).active, Some(3)); // the bar on its monitor keeps it
        assert!(for_monitor(&list, |_| false).groups.is_empty());
    }
}
