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
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU8, Ordering};
use std::sync::{LazyLock, Mutex, MutexGuard};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use windows::core::{w, GUID, PWSTR};
use windows::Win32::Foundation::{CloseHandle, ERROR_SUCCESS, HWND, LPARAM, PROPERTYKEY, WPARAM};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
use windows::Win32::Graphics::Gdi::{MonitorFromWindow, HMONITOR, MONITOR_DEFAULTTONEAREST};
use windows::Win32::Storage::Packaging::Appx::{GetApplicationUserModelId, APPLICATION_USER_MODEL_ID_MAX_LENGTH};
use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PropVariantToBoolean, PropVariantToStringAlloc};
use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
use windows::Win32::System::Threading::{GetCurrentProcessId, OpenProcess, TerminateProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE};
use windows::Win32::UI::Input::KeyboardAndMouse::IsWindowEnabled;
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
use windows::Win32::UI::Shell::{IVirtualDesktopManager, VirtualDesktopManager};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, GetAncestor, GetDesktopWindow, GetForegroundWindow, GetLastActivePopup, GetPropW, GetShellWindow, GetWindow, GetWindowLongPtrW,
    CascadeWindows, GetWindowTextW, IsIconic, IsWindowVisible, IsZoomed, TileWindows, KillTimer, PostMessageW, SetForegroundWindow, SetTimer, ShowWindowAsync, EVENT_OBJECT_CLOAKED,
    EVENT_OBJECT_DESTROY, EVENT_OBJECT_HIDE, EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_SHOW, EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_FOREGROUND,
    EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, GA_ROOT, GA_ROOTOWNER, GWL_EXSTYLE, GWL_STYLE, GW_OWNER, HSHELL_HIGHBIT,
    HSHELL_LANGUAGE, HSHELL_MONITORCHANGED, HSHELL_REDRAW, HSHELL_WINDOWREPLACED, HSHELL_WINDOWREPLACING, MDITILE_HORIZONTAL, MDITILE_VERTICAL, MDITILE_ZORDER,
    SC_CLOSE, SC_MAXIMIZE, SC_MINIMIZE, SC_MOVE, SC_RESTORE, SC_SIZE, SW_RESTORE, WM_SYSCOMMAND, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_WINDOWEDGE, WS_MAXIMIZEBOX, WS_MINIMIZEBOX, WS_THICKFRAME,
};

use super::{input, ownpins, screens};
use crate::launcher::{self, LauncherState};
use crate::{display, mixer};

/// A window flashes: the redraw code with the high bit (not in the windows crate).
const HSHELL_FLASH: u32 = HSHELL_REDRAW | HSHELL_HIGHBIT;
/// System.AppUserModel.ID, defined here so one key does not need the EnhancedStorage feature.
pub(super) const APP_USER_MODEL_ID: PROPERTYKEY = PROPERTYKEY { fmtid: GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3), pid: 5 };
/// System.AppUserModel.RelaunchCommand, RelaunchDisplayNameResource and PreventPinning, of the same set.
pub(super) const RELAUNCH_COMMAND: PROPERTYKEY = PROPERTYKEY { pid: 2, ..APP_USER_MODEL_ID };
pub(super) const RELAUNCH_NAME: PROPERTYKEY = PROPERTYKEY { pid: 4, ..APP_USER_MODEL_ID };
pub(super) const PREVENT_PINNING: PROPERTYKEY = PROPERTYKEY { pid: 9, ..APP_USER_MODEL_ID };
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
    /// A new instance can start from its first window: a relaunch command, or the exe of an unpackaged process (`ownpins::decide`).
    spawnable: bool,
    /// Spawnable, without entries, and its window does not ask never to be pinned (PreventPinning).
    pinnable: bool,
    /// An app without entries gets its icon from its exe (`taskbar_icons`).
    #[serde(skip)]
    exe: String,
    /// The id Windows keys the app's jump list on: its window's or package's AppUserModelID, else its first Start entry's parsing
    /// name (jumplist.rs).
    #[serde(skip)]
    app_id: Option<String>,
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
    /// Listed ghost windows and the hung window each stands in for (`source`).
    ghosts: HashMap<isize, isize>,
    /// By the bar's label.
    sent: HashMap<String, WindowList>,
}

static LAST: LazyLock<Mutex<Last>> = LazyLock::new(Mutex::default);
/// Icons of apps without Start entries, per group (`taskbar_icons`).
static ICONS: Mutex<BTreeMap<String, Option<String>>> = Mutex::new(BTreeMap::new());
/// The window in front, never a bar: a click on a bar leaves in front the app the click acts on (`toggle`).
static FOREGROUND: AtomicIsize = AtomicIsize::new(0);
/// The last listed window in front, for when Start has held the front since (`release`); 0 once the desktop or a Crest window
/// came after it, as then there is no app to go back to.
static LAST_APP: AtomicIsize = AtomicIsize::new(0);

/// Where the apps' buttons show (Settings → Taskbar → Show apps on): `OWN` on the bar of the window's monitor, `MAIN` there and on
/// the primary's bar, `ALL` on every bar.
const OWN: u8 = 0;
const MAIN: u8 = 1;
const ALL: u8 = 2;
static APPS_ON: AtomicU8 = AtomicU8::new(OWN);

/// From the notch (screens.rs `taskbar_spread`); anything else is `OWN`, today's bar.
pub(super) fn set_apps_on(mode: &str) {
    APPS_ON.store(match mode { "main" => MAIN, "all" => ALL, _ => OWN }, Ordering::SeqCst);
}

/// Whether a bar shows a listed window on `window_monitor` (None: not listed): on its own monitor's bar always; with `MAIN`
/// also on the primary's; with `ALL` on every bar.
fn shows(mode: u8, primary_bar: bool, window_monitor: Option<&isize>, bar_monitor: isize) -> bool {
    window_monitor.is_some_and(|&m| m == bar_monitor || mode == ALL || (mode == MAIN && primary_bar))
}

/// The order a bar last asked for an app's windows, until the taskbar thread takes it (`on_reorder`).
static REORDER: Mutex<Option<Vec<isize>>> = Mutex::new(None);

/// The places `order` gives to the windows in `ids`, filled with them in `ids`' order; every other window keeps its place and ids
/// not in `order` are ignored. A group keeps its first place, so groups never swap.
fn reorder(order: &[isize], ids: &[isize]) -> Vec<isize> {
    let mut moved = ids.iter().filter(|id| order.contains(id));
    order.iter().map(|&h| if ids.contains(&h) { *moved.next().unwrap_or(&h) } else { h }).collect()
}

/// A preview dragged in its card: listed windows of one app, 2 to 64 of them, that the calling bar shows, in their new order. The
/// list keeps it until Crest restarts.
#[tauri::command]
pub fn taskbar_window_order(window: WebviewWindow, ids: Vec<isize>) -> Result<(), String> {
    super::bar::from_bar(&window)?;
    let monitor = monitor_of(window.hwnd().map_err(|e| e.to_string())?);
    let unique: HashSet<isize> = ids.iter().copied().collect();
    if ids.len() < 2 || ids.len() > 64 || unique.len() != ids.len() || !ids.iter().all(|&id| previewable(id, window.label(), monitor)) {
        return Err("not-found".into());
    }
    *REORDER.lock().unwrap_or_else(|e| e.into_inner()) = Some(ids);
    super::reorder();
    Ok(())
}

/// On the taskbar thread (mod.rs): the order asked for goes into the list, which is made again shortly.
pub(super) fn on_reorder() {
    let Some(ids) = REORDER.lock().unwrap_or_else(|e| e.into_inner()).take() else { return };
    TRACK.with_borrow_mut(|t| {
        if let Some(t) = t {
            t.order = reorder(&t.order, &ids);
        }
    });
    arm();
}

/// Settings → Taskbar → Show windows from all desktops: the list takes the windows of the other virtual desktops too.
static ALL_DESKTOPS: AtomicBool = AtomicBool::new(false);

/// From the notch; a change lists again at once.
#[tauri::command]
pub fn taskbar_all_desktops(on: bool) {
    if ALL_DESKTOPS.swap(on, Ordering::SeqCst) != on {
        super::relist();
    }
}

thread_local! {
    /// The list's state on the taskbar thread, from `begin` until the thread ends.
    static TRACK: RefCell<Option<Track>> = const { RefCell::new(None) };
    /// Windows' virtual desktop manager, made once on the taskbar thread (STA) the first time the setting asks for it.
    static DESKTOPS: std::cell::OnceCell<Option<IVirtualDesktopManager>> = const { std::cell::OnceCell::new() };
}

/// Whether a window is hidden because it is on another virtual desktop: cloaked, not on this desktop, and on a real one. A
/// suspended Store app or a window the shell hides is cloaked on this desktop or has no desktop, so it never counts.
fn on_other_desktop(cloaked: bool, on_current: Option<bool>, desktop: Option<GUID>) -> bool {
    cloaked && on_current == Some(false) && desktop.is_some_and(|g| g != GUID::zeroed())
}

/// A window of another virtual desktop that would get a button there.
fn elsewhere(mgr: &IVirtualDesktopManager, hwnd: HWND, own: u32) -> bool {
    let look = look_of(hwnd, own);
    look.visible
        && look.cloaked
        && eligible(&Look { cloaked: false, ..look })
        && on_other_desktop(true, unsafe { mgr.IsWindowOnCurrentVirtualDesktop(hwnd) }.ok().map(|b| b.as_bool()), unsafe { mgr.GetWindowDesktopId(hwnd) }.ok())
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
    /// Taken off the taskbar by its app (`ITaskList_Deleted`).
    deleted: bool,
}

/// Whether a window gets a button: visible, not cloaked, not Crest's, not a tool window, and marked for the taskbar
/// (WS_EX_APPWINDOW) or unowned and activatable; a shell surface only as a Store app's frame; and not taken off the taskbar by its
/// app (`ITaskList_Deleted`, set by `ITaskbarList::DeleteTab`, undocumented).
fn eligible(look: &Look) -> bool {
    look.visible
        && !look.deleted
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

/// Where the keyboard goes back to: the app in front, else the last one that was, when Start took the front from it, if it is
/// still `usable` (listed, and not minimized since: that would bring it back).
fn release_target(in_front: Option<isize>, last_app: Option<isize>, usable: impl Fn(isize) -> bool) -> Option<isize> {
    in_front.or(last_app.filter(|&h| usable(h)))
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

/// A window event (mod.rs `on_event`). The window in front is kept, unless it is a bar; a listed one is also the last app, and
/// the desktop or a Crest window clears it. Start and the other shell windows leave it as it is.
pub(super) fn on_event(event: u32, hwnd: HWND) {
    let id = hwnd.0 as isize;
    if event == EVENT_SYSTEM_FOREGROUND {
        if screens::is_bar(id) {
            return;
        }
        FOREGROUND.store(id, Ordering::SeqCst);
        super::tray::on_front(hwnd);
        // Each thread has its layout: the one in front decides what the bar's input language shows.
        language_changed();
    }
    let (armed, listed) = TRACK.with_borrow(|t| t.as_ref().map_or((true, false), |t| (t.armed, t.order.contains(&id))));
    if event == EVENT_SYSTEM_FOREGROUND {
        if listed {
            LAST_APP.store(id, Ordering::SeqCst);
        } else if desktop_itself(hwnd) || display::window_pid(hwnd) == unsafe { GetCurrentProcessId() } {
            LAST_APP.store(0, Ordering::SeqCst);
        }
    }
    if !armed && arms(event, listed, || could_list(hwnd)) {
        arm();
    }
}

/// The desktop's own windows. Not Windows' taskbars, which `display::is_desktop` also counts: the hidden one takes the front as
/// Start opens, and must not clear the last app.
fn desktop_itself(hwnd: HWND) -> bool {
    let desktop = unsafe { hwnd == GetDesktopWindow() || hwnd == GetShellWindow() };
    desktop || matches!(display::class_name(hwnd).as_str(), "Progman" | "WorkerW")
}

/// A shell hook code (mod.rs): flashing and ghost windows wait for the next list; a window moved to another monitor only needs
/// one, which moves its button to that monitor's bar. A new keyboard layout goes to the bar's input language.
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
    } else if code == HSHELL_LANGUAGE {
        language_changed();
    }
}

/// The bar's input language is read again (input.rs). Not while `on_timer` holds the list: the next event reads it.
fn language_changed() {
    if let Some(app) = TRACK.with_borrow(|t| t.as_ref().map(|t| t.app.clone())) {
        input::changed(&app);
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
    let ghosts = track.ghosts.clone();
    let app = track.app.clone();
    TRACK.with_borrow_mut(|t| *t = Some(track));
    let lists: Vec<(String, WindowList)> = screens::all()
        .into_iter()
        .map(|(label, bar)| {
            let monitor = monitor_of(HWND(bar as _));
            let (mode, primary) = (APPS_ON.load(Ordering::SeqCst), label == super::bar::LABEL);
            let here = for_monitor(&list, |id| shows(mode, primary, monitors.get(&id), monitor));
            (label, here)
        })
        .collect();
    let mut last = last();
    last.list = list;
    last.pids = pids;
    last.monitors = monitors;
    last.ghosts = ghosts;
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
        let all = ALL_DESKTOPS.load(Ordering::SeqCst);
        let mgr = if all { DESKTOPS.with(|d| d.get_or_init(|| unsafe { CoCreateInstance(&VirtualDesktopManager, None, CLSCTX_ALL) }.ok()).clone()) } else { None };
        let now: Vec<isize> = display::top_windows()
            .into_iter()
            .filter(|&h| listable(h, own) || mgr.as_ref().is_some_and(|m| elsewhere(m, h, own)))
            .map(|h| h.0 as isize)
            .collect();
        self.order = merge_order(&self.order, &now);
        let order = &self.order;
        self.ghosts.retain(|ghost, _| order.contains(ghost));
        self.flashing.retain(|h| order.contains(h));
        let active = active_now(order);
        // A window brought to front has been seen: it stops asking for attention.
        if let Some(active) = active {
            self.flashing.remove(&active);
            // Also a window listed only now, after its own foreground event (a new app). Never after a clear: `active` is the
            // listed window in front now, and the desktop or a Crest window in front gives none.
            LAST_APP.store(active, Ordering::SeqCst);
        }
        // Read once per process.
        let mut processes: HashMap<u32, (Option<String>, String)> = HashMap::new();
        let mut groups: Vec<(Group, Option<String>)> = Vec::new();
        let mut pids = Vec::new();
        let mut monitors = HashMap::new();
        for &id in &self.order {
            let hwnd = HWND(id as _);
            let source = HWND(self.ghosts.get(&id).copied().unwrap_or(id) as _);
            let Props { aumid: window_aumid, relaunch, prevent } = window_props(source);
            let pid = display::app_pid(source);
            let (package_aumid, exe) = processes.entry(pid).or_insert_with(|| (package_app_id(pid), mixer::process_path(pid).unwrap_or_default())).clone();
            let key = group_key(window_aumid.as_deref(), package_aumid.as_deref(), &exe, id);
            let win = Win { id, title: title(hwnd), minimized: unsafe { IsIconic(hwnd) }.as_bool(), flashing: self.flashing.contains(&id) };
            pids.push((id, display::window_pid(hwnd)));
            monitors.insert(id, monitor_of(hwnd));
            match groups.iter_mut().find(|(group, _)| group.key == key) {
                Some((group, _)) => group.windows.push(win),
                None => {
                    let relaunch = relaunch.as_ref().map(|(command, name)| (command.as_str(), name.as_str()));
                    let spawnable = ownpins::decide(window_aumid.as_deref(), relaunch, package_aumid.is_some(), &exe).is_some();
                    let aumid = window_aumid.or(package_aumid.filter(|s| !s.is_empty()));
                    // Pinnable until an entry turns up below.
                    let group = Group { key, name: String::new(), pins: Vec::new(), windows: vec![win], spawnable, pinnable: spawnable && !prevent, exe, app_id: None };
                    groups.push((group, aumid));
                }
            }
        }
        let state = self.app.state::<LauncherState>();
        launcher::cached(&state, |apps| {
            for (group, aumid) in &mut groups {
                group.pins = launcher::entries_for(apps, aumid.as_deref(), &group.exe).into_iter().map(|a| Pin { id: a.id, name: a.name }).collect();
            }
        });
        // Out of the Start list's lock: an app without a Start entry takes the bar's own pins, which name it and draw its icon.
        for (group, aumid) in &mut groups {
            if group.pins.is_empty() {
                group.pins = ownpins::entries_for(aumid.as_deref(), &group.exe).into_iter().map(|a| Pin { id: a.id, name: a.name }).collect();
            }
            group.pinnable &= group.pins.is_empty();
            group.app_id = aumid.clone().or_else(|| group.pins.iter().find_map(|p| p.id.strip_prefix(launcher::APPS_PREFIX).map(str::to_string)));
        }
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

/// Whether a top-level window gets a button now (`eligible`), on this virtual desktop. Few are visible, so only those are read further.
pub(super) fn listable(hwnd: HWND, own: u32) -> bool {
    unsafe { IsWindowVisible(hwnd) }.as_bool() && eligible(&look_of(hwnd, own))
}

fn look_of(hwnd: HWND, own: u32) -> Look {
    Look {
        visible: unsafe { IsWindowVisible(hwnd) }.as_bool(),
        cloaked: cloaked(hwnd),
        own: display::window_pid(hwnd) == own,
        owned: unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|o| !o.is_invalid()),
        ex: unsafe { GetWindowLongPtrW(hwnd, GWL_EXSTYLE) } as u32,
        immersive: IMMERSIVE.contains(&display::class_name(hwnd).as_str()),
        deleted: !unsafe { GetPropW(hwnd, w!("ITaskList_Deleted")) }.is_invalid(),
    }
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

/// What an app set on its window for the taskbar.
#[derive(Default)]
pub(super) struct Props {
    /// Its AppUserModelID (a browser profile, a web app, a Store app's frame).
    pub(super) aumid: Option<String>,
    /// The relaunch command and its display name resource, only when both are set.
    pub(super) relaunch: Option<(String, String)>,
    /// PreventPinning: the window asks never to be pinned.
    pub(super) prevent: bool,
}

/// The window's `Props`, from one property store; empty strings read as unset.
pub(super) fn window_props(hwnd: HWND) -> Props {
    unsafe {
        let Ok(store) = SHGetPropertyStoreForWindow::<IPropertyStore>(hwnd) else { return Props::default() };
        let text = |key: &PROPERTYKEY| {
            let mut value = store.GetValue(key).ok()?;
            let text = PropVariantToStringAlloc(&value).ok().and_then(|p| crate::controls::take(p));
            let _ = PropVariantClear(&mut value);
            text.filter(|s| !s.is_empty())
        };
        let prevent = store.GetValue(&PREVENT_PINNING).is_ok_and(|mut value| {
            let on = PropVariantToBoolean(&value).is_ok_and(|b| b.as_bool());
            let _ = PropVariantClear(&mut value);
            on
        });
        Props { aumid: text(&APP_USER_MODEL_ID), relaunch: text(&RELAUNCH_COMMAND).zip(text(&RELAUNCH_NAME)), prevent }
    }
}

/// The AppUserModelID of a packaged app's process; None for any other.
pub(super) fn package_app_id(pid: u32) -> Option<String> {
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

/// Whether `id` was listed, with the process that has its handle now (`pid_now`), where a bar on `monitor` shows it (`shows`).
fn listed_on(pids: &[(isize, u32)], monitors: &HashMap<isize, isize>, id: isize, pid_now: u32, (mode, primary): (u8, bool), monitor: isize) -> bool {
    pids.contains(&(id, pid_now)) && shows(mode, primary, monitors.get(&id), monitor)
}

/// Whether bar `label` on `monitor` may show `id`'s live preview (preview.rs): a listed window, still of the process it was
/// listed with, that this bar shows a button for. The pid is read before the lock is taken, so no call to Windows runs under it.
pub(super) fn previewable(id: isize, label: &str, monitor: isize) -> bool {
    let pid_now = display::window_pid(HWND(id as _));
    let last = last();
    listed_on(&last.pids, &last.monitors, id, pid_now, (APPS_ON.load(Ordering::SeqCst), label == super::bar::LABEL), monitor)
}

/// The calling bar's windows, those on its monitor, for a bar page that has just loaded; `taskbar://windows` brings each change.
#[tauri::command]
pub fn taskbar_windows(window: WebviewWindow) -> WindowList {
    // A sync command runs on the main thread, where the handle is read without a wait.
    let Ok(hwnd) = window.hwnd() else { return WindowList::default() };
    let monitor = monitor_of(hwnd);
    let (mode, primary) = (APPS_ON.load(Ordering::SeqCst), window.label() == super::bar::LABEL);
    let last = last();
    for_monitor(&last.list, |id| shows(mode, primary, last.monitors.get(&id), monitor))
}

/// The process of listed window `id`, while the window is still of the process it was listed with: None once it is gone, or
/// its handle was reused by another process since the list was made. Every command on a listed window starts here.
pub(super) fn listed_pid(id: isize) -> Option<u32> {
    let pid = last().pids.iter().find(|&&(h, _)| h == id).map(|&(_, pid)| pid)?;
    (pid == display::window_pid(HWND(id as _))).then_some(pid)
}

/// The window whose app listed window `id` shows: the hung window a ghost stands in for, else `id` itself. A ghost is drawn by a
/// system process, so a command on the app (End task, a pin, a new instance, its file) reads the app from here.
pub(super) fn source(id: isize) -> HWND {
    HWND(last().ghosts.get(&id).copied().unwrap_or(id) as _)
}

/// The first pin of listed window `id`'s app, as (id, name): its Start entry, or an own pin made of it before.
pub(super) fn first_pin(id: isize) -> Option<(String, String)> {
    let last = last();
    let group = last.list.groups.iter().find(|g| g.windows.iter().any(|w| w.id == id))?;
    group.pins.first().map(|p| (p.id.clone(), p.name.clone()))
}

/// The jump-list id and the exe of listed group `key` (jumplist.rs), when Windows keys a list for it.
pub(super) fn app_of(key: &str) -> Option<(String, String)> {
    let last = last();
    let group = last.list.groups.iter().find(|g| g.key == key)?;
    Some((group.app_id.clone()?, group.exe.clone()))
}

/// What a click on a window's button, or its app's menu, does: "activate", "toggle" (minimizes the app in front, else brings it
/// forward), "minimize", "close" or "end" (End task); from the window menu also "restore", "maximize", and "move" and "size",
/// which bring it forward and start Windows' keyboard move or size. Only a listed window, still of the process it was listed with. An app
/// running as administrator may refuse a minimize, a close or an end (UIPI, access denied): the error comes back and nothing
/// else happens.
#[tauri::command]
pub async fn taskbar_window(id: isize, action: String) -> Result<(), String> {
    let Some(pid) = listed_pid(id) else { return Err("not-found".into()) };
    let listed: Vec<isize> = last().pids.iter().map(|&(h, _)| h).collect();
    let hwnd = HWND(id as _);
    match action.as_str() {
        "activate" => activate(hwnd),
        "toggle" if toggle_minimizes(id, active_now(&listed), unsafe { IsIconic(hwnd) }.as_bool()) => minimize(hwnd, pid, &listed),
        "toggle" => activate(hwnd),
        "minimize" => minimize(hwnd, pid, &listed),
        "close" => close(hwnd, pid, &listed),
        "restore" => sys(hwnd, SC_RESTORE).and_then(|_| activate(hwnd)),
        "maximize" if style(hwnd) & WS_MAXIMIZEBOX.0 != 0 => sys(hwnd, SC_MAXIMIZE).and_then(|_| activate(hwnd)),
        "move" => activate(hwnd).and_then(|_| sys(hwnd, SC_MOVE)),
        "size" if style(hwnd) & WS_THICKFRAME.0 != 0 => activate(hwnd).and_then(|_| sys(hwnd, SC_SIZE)),
        "end" => {
            let source = source(id);
            end(source, display::window_pid(source))
        }
        _ => Err("unknown-action".into()),
    }
}

/// What the window menu enables, as Windows' own system menu does.
#[derive(Serialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WindowMenu {
    minimized: bool,
    maximized: bool,
    can_minimize: bool,
    can_maximize: bool,
    can_size: bool,
}

fn menu_state(style: u32, iconic: bool, zoomed: bool) -> WindowMenu {
    WindowMenu {
        minimized: iconic,
        maximized: zoomed,
        can_minimize: style & WS_MINIMIZEBOX.0 != 0,
        can_maximize: style & WS_MAXIMIZEBOX.0 != 0,
        can_size: style & WS_THICKFRAME.0 != 0,
    }
}

fn style(hwnd: HWND) -> u32 {
    unsafe { GetWindowLongPtrW(hwnd, GWL_STYLE) as u32 }
}

/// The state of listed window `id` for its menu (Shift+right-click).
#[tauri::command]
pub fn taskbar_window_menu(id: isize) -> Result<WindowMenu, String> {
    listed_pid(id).ok_or("not-found")?;
    let hwnd = HWND(id as _);
    Ok(menu_state(style(hwnd), unsafe { IsIconic(hwnd) }.as_bool(), unsafe { IsZoomed(hwnd) }.as_bool()))
}

#[derive(PartialEq, Debug, Clone, Copy)]
enum How {
    Cascade,
    Stack,
    Side,
    Restore,
    Minimize,
}

fn arrange_how(s: &str) -> Option<How> {
    Some(match s {
        "cascade" => How::Cascade,
        "stack" => How::Stack,
        "side" => How::Side,
        "restore" => How::Restore,
        "minimize" => How::Minimize,
        _ => return None,
    })
}

/// The group menu: an app's windows cascaded, stacked or side by side in the work area of the calling bar's monitor, or all
/// restored or minimized. Only windows the calling bar lists (`previewable`), 1 to 64 of them.
#[tauri::command]
pub async fn taskbar_arrange(window: WebviewWindow, ids: Vec<isize>, how: String) -> Result<(), String> {
    super::bar::from_bar(&window)?;
    let how = arrange_how(&how).ok_or("unknown")?;
    let monitor = monitor_of(window.hwnd().map_err(|e| e.to_string())?);
    let unique: HashSet<isize> = ids.iter().copied().collect();
    if ids.is_empty() || ids.len() > 64 || unique.len() != ids.len() || !ids.iter().all(|&id| previewable(id, window.label(), monitor)) {
        return Err("not-found".into());
    }
    // CascadeWindows and TileWindows wait on each window's answer: never on the main thread.
    tauri::async_runtime::spawn_blocking(move || arrange(&ids, how, monitor)).await.map_err(|e| e.to_string())?
}

fn arrange(ids: &[isize], how: How, monitor: isize) -> Result<(), String> {
    let hwnds: Vec<HWND> = ids.iter().map(|&id| HWND(id as _)).collect();
    let post = |h: HWND, sc: u32| drop(unsafe { PostMessageW(Some(h), WM_SYSCOMMAND, WPARAM(sc as usize), LPARAM(0)) });
    match how {
        How::Restore => hwnds.iter().for_each(|&h| post(h, SC_RESTORE)),
        How::Minimize => hwnds.iter().filter(|&&h| style(h) & WS_MINIMIZEBOX.0 != 0).for_each(|&h| post(h, SC_MINIMIZE)),
        _ => unsafe {
            for &h in &hwnds {
                if IsIconic(h).as_bool() {
                    let _ = ShowWindowAsync(h, SW_RESTORE);
                }
            }
            let (_, work) = display::monitor_rect(HMONITOR(monitor as _)).ok_or("failed")?;
            let done = match how {
                How::Cascade => CascadeWindows(None, MDITILE_ZORDER, Some(&work), Some(&hwnds)),
                How::Stack => TileWindows(None, MDITILE_HORIZONTAL, Some(&work), Some(&hwnds)),
                _ => TileWindows(None, MDITILE_VERTICAL, Some(&work), Some(&hwnds)),
            };
            if done == 0 {
                return Err("failed".into());
            }
        },
    }
    Ok(())
}

/// One wheel step on an app's button: every audio session of the listed window's program moves by `step` (-1..1). Its new
/// level in percent, None when the program plays nothing. Only a listed window, still of its process.
#[tauri::command]
pub async fn taskbar_app_volume(id: isize, step: f32) -> Result<Option<u8>, String> {
    if listed_pid(id).is_none() {
        return Err("not-found".into());
    }
    // The app behind a Store app's frame, as the list reads it.
    let Some(exe) = mixer::process_path(display::app_pid(source(id))) else { return Ok(None) };
    let step = step.clamp(-1.0, 1.0);
    tauri::async_runtime::spawn_blocking(move || mixer::step_app(&exe, step))
        .await
        .map_err(|e| e.to_string())?
        .map(|level| level.map(|l| (l * 100.0).round() as u8))
        .map_err(|e| e.message())
}

/// A bar menu or panel closed from the bar (Esc, a second click on its item): the keyboard goes back (`release`).
#[tauri::command]
pub fn taskbar_release() {
    release();
}

/// The keyboard goes back to the app in front, or to the last one if only Start has been in front since; to none after the
/// desktop or a Crest window (`LAST_APP`). On the main thread: `taskbar_release`, and the Start button's click that closed
/// Start (start.rs).
pub(crate) fn release() {
    let listed: Vec<isize> = last().pids.iter().map(|&(h, _)| h).collect();
    let usable = |h: isize| listed.contains(&h) && !unsafe { IsIconic(HWND(h as _)) }.as_bool();
    if let Some(target) = release_target(active_now(&listed), Some(LAST_APP.load(Ordering::SeqCst)), usable) {
        let _ = activate(HWND(target as _));
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

/// Whether End task may end process `pid`: never Crest itself, never the shell's explorer.exe (it draws the desktop, and File
/// Explorer's windows usually live in it), never ApplicationFrameHost, which every Store app's frame shares (`frame_host`: a
/// frame whose app process was not found).
fn may_end(pid: u32, own: u32, shell: u32, frame_host: bool) -> bool {
    pid != own && pid != shell && !frame_host
}

/// End task, as on Windows' taskbar: the window's app process ends at once, without saving, and not its children.
/// `window_pid` is the process the window was listed with.
fn end(hwnd: HWND, window_pid: u32) -> Result<(), String> {
    let pid = display::app_pid(hwnd);
    let frame_host = display::class_name(hwnd) == "ApplicationFrameWindow" && pid == window_pid;
    let shell = display::window_pid(unsafe { GetShellWindow() });
    if !may_end(pid, unsafe { GetCurrentProcessId() }, shell, frame_host) {
        return Err("failed".into());
    }
    unsafe {
        // An app running as administrator refuses the open.
        let process = OpenProcess(PROCESS_TERMINATE, false, pid).map_err(|_| "failed".to_string())?;
        let ended = TerminateProcess(process, 1);
        let _ = CloseHandle(process);
        ended.map_err(|_| "failed".into())
    }
}

/// Posts a window command, never waiting on a hung app, and leaves the keyboard where it is.
fn sys(hwnd: HWND, sc: u32) -> Result<(), String> {
    unsafe { PostMessageW(Some(hwnd), WM_SYSCOMMAND, WPARAM(sc as usize), LPARAM(0)) }.map_err(|_| "failed".to_string())
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
    fn a_preview_dragged_moves_its_window_among_its_apps_places() {
        assert_eq!(reorder(&[1, 5, 2, 6, 3], &[3, 1, 2]), [3, 5, 1, 6, 2]);
        assert_eq!(reorder(&[1, 5, 2], &[2, 9, 1]), [2, 5, 1]);
        assert_eq!(reorder(&[1, 5, 2], &[1, 2]), [1, 5, 2]);
        assert_eq!(reorder(&[1, 5, 2], &[]), [1, 5, 2]);
    }

    #[test]
    fn the_window_menu_enables_what_the_window_allows() {
        let all = WS_MINIMIZEBOX.0 | WS_MAXIMIZEBOX.0 | WS_THICKFRAME.0;
        assert_eq!(menu_state(all, false, false), WindowMenu { minimized: false, maximized: false, can_minimize: true, can_maximize: true, can_size: true });
        assert!(menu_state(all, true, false).minimized);
        assert!(menu_state(all, false, true).maximized);
        assert_eq!(menu_state(0, false, false), WindowMenu { minimized: false, maximized: false, can_minimize: false, can_maximize: false, can_size: false });
        for (name, how) in [("cascade", How::Cascade), ("stack", How::Stack), ("side", How::Side), ("restore", How::Restore), ("minimize", How::Minimize)] {
            assert_eq!(arrange_how(name), Some(how));
        }
        assert_eq!(arrange_how("tile"), None);
    }

    #[test]
    fn only_windows_hidden_on_another_desktop_count_as_there() {
        let g = GUID::from_u128(7);
        assert!(on_other_desktop(true, Some(false), Some(g)));
        assert!(!on_other_desktop(false, Some(false), Some(g)));
        assert!(!on_other_desktop(true, Some(true), Some(g)));
        assert!(!on_other_desktop(true, Some(false), Some(GUID::zeroed())));
        assert!(!on_other_desktop(true, None, None));
    }

    #[test]
    fn only_taskbar_windows_get_a_button() {
        let l = |ex: u32, owned: bool| Look { visible: true, cloaked: false, own: false, owned, ex, immersive: false, deleted: false };
        assert!(!eligible(&Look { deleted: true, ..l(WS_EX_APPWINDOW.0, false) })); // taken off the taskbar by its app
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
    fn the_keyboard_goes_back_to_the_last_app_when_start_held_the_front() {
        let usable = |h: isize| h != 8 && h != 9; // 8 is minimized, 9 no longer listed
        assert_eq!(release_target(None, Some(7), usable), Some(7));
        assert_eq!(release_target(Some(3), Some(7), usable), Some(3));
        assert_eq!(release_target(None, None, usable), None);
        assert_eq!(release_target(None, Some(8), usable), None); // minimized since: not brought back
        assert_eq!(release_target(None, Some(9), usable), None); // closed since
    }

    #[test]
    fn each_bar_lists_its_own_monitors_windows() {
        let w = |id| Win { id, title: String::new(), minimized: false, flashing: false };
        let g = |key: &str, ids: &[isize]| Group { key: key.into(), name: key.into(), pins: vec![], windows: ids.iter().map(|&i| w(i)).collect(), spawnable: false, pinnable: false, exe: String::new(), app_id: None };
        let list = WindowList { groups: vec![g("chrome", &[1, 2]), g("code", &[3])], active: Some(3) };
        let here = for_monitor(&list, |id| id == 2);
        assert_eq!(here.groups.len(), 1);
        assert_eq!(here.groups[0].windows.iter().map(|w| w.id).collect::<Vec<_>>(), vec![2]); // Chrome keeps only its window on this monitor
        assert_eq!(here.active, None); // the window in front is on another monitor, so this bar's list names none
        assert_eq!(for_monitor(&list, |id| id == 3).active, Some(3)); // the bar on its monitor keeps it
        assert!(for_monitor(&list, |_| false).groups.is_empty());
    }

    #[test]
    fn end_task_spares_crest_the_shell_and_the_frame_host() {
        assert!(!may_end(10, 10, 20, false)); // Crest
        assert!(!may_end(20, 10, 20, false)); // the shell's explorer.exe
        assert!(!may_end(30, 10, 20, true)); // ApplicationFrameHost
        assert!(may_end(30, 10, 20, false));
    }

    #[test]
    fn a_preview_shows_only_a_listed_window_of_its_own_process_on_the_callers_monitor() {
        let pids = [(10, 1), (20, 2)];
        let monitors = HashMap::from([(10, 100), (20, 200)]);
        let own = (OWN, false);
        assert!(listed_on(&pids, &monitors, 10, 1, own, 100));
        assert!(!listed_on(&pids, &monitors, 10, 1, own, 200)); // on another monitor
        assert!(!listed_on(&pids, &monitors, 10, 3, own, 100)); // its handle reused by another process
        assert!(!listed_on(&pids, &monitors, 30, 1, own, 100)); // not listed
        assert!(listed_on(&pids, &monitors, 10, 1, (MAIN, true), 200)); // the primary's bar under Main shows it too
        assert!(!listed_on(&pids, &monitors, 30, 1, (ALL, false), 200)); // never one not listed
    }

    #[test]
    fn show_apps_on_picks_the_bars_a_window_shows_on() {
        let (here, there) = (Some(&1), Some(&2));
        assert!(shows(OWN, false, here, 1) && !shows(OWN, true, there, 1)); // its own monitor's bar only
        assert!(shows(MAIN, true, there, 1) && !shows(MAIN, false, there, 1)); // and the primary's
        assert!(shows(ALL, false, there, 1)); // every bar
        assert!(!shows(ALL, true, None, 1)); // never one not listed
    }
}
