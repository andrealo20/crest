//! The bar's disk space widget (Windows only): the lettered drives with their free space, read by system/hw.rs, opening one in
//! File Explorer by a letter this module listed or a folder its scan listed, never a path from the page, and Scan now, the largest
//! folders of a drive or of such a folder. Read on a call only: the notch asks every few minutes for the widget and a bar as its
//! panel opens; Crest hears no device change, so a drive plugged in shows on the next. A scan runs only on a press and saves
//! nothing to disk. Eject (design K) safely removes a drive that plugs in, by a letter this module listed as removable, through
//! Windows' own documented request (CM_Request_Device_EjectW), which asks the apps that hold it first.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::os::windows::fs::MetadataExt;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{Emitter, WebviewWindow};
use windows::core::{GUID, PCWSTR};
// The veto kinds go by the module path: bare constant names in a match trip the upper case lint.
use windows::Win32::Devices::DeviceAndDriverInstallation::{
    self as pnp, CM_Get_DevNode_Registry_PropertyW, CM_Get_Device_Interface_ListW, CM_Get_Device_Interface_List_SizeW, CM_Get_Device_Interface_PropertyW,
    CM_Get_Parent, CM_Locate_DevNodeW, CM_Request_Device_EjectW, CM_DEVCAP_DOCKDEVICE, CM_DEVCAP_REMOVABLE, CM_DRP_CAPABILITIES, CM_GET_DEVICE_INTERFACE_LIST_PRESENT,
    CM_LOCATE_DEVNODE_NORMAL, CONFIGRET, CR_ACCESS_DENIED, CR_SUCCESS, PNP_VETO_TYPE,
};
use windows::Win32::Devices::Properties::{DEVPKEY_Device_InstanceId, DEVPROPTYPE};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN};
use windows::Win32::System::Diagnostics::Debug::{SetThreadErrorMode, SEM_FAILCRITICALERRORS, THREAD_ERROR_MODE};
use windows::Win32::System::Threading::{GetCurrentThread, GetThreadPriority, SetThreadPriority, THREAD_PRIORITY, THREAD_PRIORITY_BELOW_NORMAL};
use windows::Win32::System::IO::DeviceIoControl;

use super::bar;
use crate::system::hw::{extents, open};
use crate::system::{bar_drives, BarDrive};

/// The letters of the last listing: the only drives a bar may open.
static LISTED: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// The letters of the last listing that plug in (BarDrive.removable): the only drives a bar may eject, never the one Windows runs from.
static EJECTABLE: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// A read is under way. One at a time, so a drive that stops answering holds one thread, not one per call, and an older
/// read never overwrites a newer listing.
static READING: AtomicBool = AtomicBool::new(false);

/// The folders a scan's level lists; the others are summed.
const SCAN_ROWS: usize = 10;
/// How deep below the folder it walks a walk keeps its folders' sizes: the levels above that answer from the same walk, and only a
/// press past them walks the disk again.
const KEEP: usize = 3;
/// How often a walk tells its bar how far it got.
const TICK: Duration = Duration::from_millis(250);
/// Where a walk ends and its answer is marked partial, so a drive of many millions of files holds no thread for long.
const MOST_TIME: Duration = Duration::from_secs(180);
const MOST_ENTRIES: u64 = 5_000_000;
/// How long a walk's levels answer a press below, as long as the page keeps its answer (disks.ts SCAN_FRESH).
const FRESH: Duration = Duration::from_secs(600);

/// The scan under way, by the token its page gave it; 0 for none. One at a time across every bar, so a drive that stops answering
/// holds one thread.
static RUNNING: AtomicU64 = AtomicU64::new(0);
/// The scan to stop, by its token: a Stop that comes before its scan starts still ends it, and an old one ends no later scan.
static STOP: AtomicU64 = AtomicU64::new(0);
static SCANS: Mutex<Scans> = Mutex::new(Scans { paths: Vec::new(), ids: BTreeMap::new(), levels: BTreeMap::new() });

/// What the scans gave the pages: every folder they listed, by its id, and the levels their complete walks kept.
#[derive(Default)]
struct Scans {
    /// Never cleared, and a folder keeps its id at every scan, so an id in any bar's page stays the folder it was.
    paths: Vec<PathBuf>,
    ids: BTreeMap<PathBuf, usize>,
    levels: BTreeMap<PathBuf, (Instant, DiskScan)>,
}

impl Scans {
    fn id(&mut self, path: &Path) -> usize {
        if let Some(&id) = self.ids.get(path) {
            return id;
        }
        self.paths.push(path.to_path_buf());
        self.ids.insert(path.to_path_buf(), self.paths.len() - 1);
        self.paths.len() - 1
    }
}

fn scans() -> MutexGuard<'static, Scans> {
    SCANS.lock().unwrap_or_else(|e| e.into_inner())
}

/// One level of a scan: the largest folders directly in it, largest first, the bytes of the others, the files directly in it, and
/// whether its walk ended early (Stop, the bar turned off, or the cap).
#[derive(Serialize, Clone, Default)]
pub struct DiskScan {
    folders: Vec<ScanFolder>,
    more: u64,
    files: u64,
    partial: bool,
}

/// A folder of a level, by the id the page names it by.
#[derive(Serialize, Clone)]
pub struct ScanFolder {
    id: usize,
    name: String,
    size: u64,
}

/// The drives now, read off the calling thread; None while another call reads them, and the caller keeps what it has.
#[tauri::command]
pub async fn taskbar_disks() -> Option<Vec<BarDrive>> {
    if READING.swap(true, Ordering::AcqRel) {
        return None;
    }
    let list = tauri::async_runtime::spawn_blocking(bar_drives).await.unwrap_or_default();
    *LISTED.lock().unwrap_or_else(|e| e.into_inner()) = list.iter().map(|d| d.letter.clone()).collect();
    *EJECTABLE.lock().unwrap_or_else(|e| e.into_inner()) = list.iter().filter(|d| d.removable).map(|d| d.letter.clone()).collect();
    READING.store(false, Ordering::Release);
    Some(list)
}

/// A letter the last listing had.
fn listed(letters: &[String], letter: &str) -> bool {
    letters.iter().any(|l| l == letter)
}

/// A folder the page may name: a listed drive's root, or by its id a folder a scan listed on that drive.
fn target(letter: &str, folder: Option<usize>) -> Result<PathBuf, String> {
    if !listed(&LISTED.lock().unwrap_or_else(|e| e.into_inner()), letter) {
        return Err("unknown".into());
    }
    match folder {
        None => Ok(format!("{letter}\\").into()),
        Some(id) => scanned(&scans().paths, id, letter).cloned().ok_or_else(|| "unknown".into()),
    }
}

/// The folder `id` names, if it lies on `letter`'s drive.
fn scanned<'a>(paths: &'a [PathBuf], id: usize, letter: &str) -> Option<&'a PathBuf> {
    paths.get(id).filter(|p| p.starts_with(format!("{letter}\\")))
}

/// The class of disk device interfaces (GUID_DEVINTERFACE_DISK, ntddstor.h), kept here as hw.rs keeps its IOCTLs.
const DISK_INTERFACES: GUID = GUID::from_u128(0x53f56307_b6bf_11d0_94f2_00a0c91efb8b);
const IOCTL_STORAGE_GET_DEVICE_NUMBER: u32 = 0x2D1080;

/// A letter the last listing had as one that plugs in; "unknown" for any other.
fn ejectable(letter: &str) -> Result<(), String> {
    if listed(&EJECTABLE.lock().unwrap_or_else(|e| e.into_inner()), letter) { Ok(()) } else { Err("unknown".into()) }
}

/// The number of the disk behind a disk interface (the N of PhysicalDriveN), opened with no access as hw.rs opens drives.
fn device_number(path: &str) -> Option<u32> {
    let h = open(path)?;
    // STORAGE_DEVICE_NUMBER: DeviceType, DeviceNumber, PartitionNumber.
    let mut out = [0u32; 3];
    let mut len = 0u32;
    let ok = unsafe { DeviceIoControl(h, IOCTL_STORAGE_GET_DEVICE_NUMBER, None, 0, Some(out.as_mut_ptr().cast()), 12, Some(&mut len), None) };
    unsafe {
        let _ = CloseHandle(h);
    }
    (ok.is_ok() && len >= 8).then_some(out[1])
}

/// The device instance id of disk `number`, NUL-ended, from the disk interfaces Windows lists.
fn disk_instance(number: u32) -> Option<Vec<u16>> {
    unsafe {
        let mut len = 0u32;
        if CM_Get_Device_Interface_List_SizeW(&mut len, &DISK_INTERFACES, PCWSTR::null(), CM_GET_DEVICE_INTERFACE_LIST_PRESENT) != CR_SUCCESS {
            return None;
        }
        let mut list = vec![0u16; len as usize];
        if CM_Get_Device_Interface_ListW(&DISK_INTERFACES, PCWSTR::null(), &mut list, CM_GET_DEVICE_INTERFACE_LIST_PRESENT) != CR_SUCCESS {
            return None;
        }
        let path = list.split(|&c| c == 0).filter(|p| !p.is_empty()).find(|p| device_number(&String::from_utf16_lossy(p)) == Some(number))?;
        let path: Vec<u16> = path.iter().copied().chain([0]).collect();
        // A device instance id is at most 200 characters (MAX_DEVICE_ID_LEN).
        let mut id = [0u16; 256];
        let (mut kind, mut size) = (DEVPROPTYPE(0), (id.len() * 2) as u32);
        if CM_Get_Device_Interface_PropertyW(PCWSTR(path.as_ptr()), &DEVPKEY_Device_InstanceId, &mut kind, Some(id.as_mut_ptr().cast()), &mut size, 0) != CR_SUCCESS {
            return None;
        }
        Some(id[..id.iter().position(|&c| c == 0)?].iter().copied().chain([0]).collect())
    }
}

/// The node's capabilities (CM_DEVCAP_*), none when they cannot be read.
fn caps(node: u32) -> u32 {
    let (mut caps, mut len) = (0u32, 4u32);
    let read = unsafe { CM_Get_DevNode_Registry_PropertyW(node, CM_DRP_CAPABILITIES, None, Some((&mut caps as *mut u32).cast()), &mut len, 0) };
    if read == CR_SUCCESS { caps } else { 0 }
}

/// Which node to eject, from the capabilities of the disk's node and those above it: the disk or the device right above it (the USB
/// drive, the card reader), the first Windows lets go while running, never a dock. Never higher: a hub, a monitor's or a dock's is
/// removable from its port too, and ejecting it takes the keyboard, the network and every other drive on it.
fn eject_pick(caps: &[u32]) -> Option<usize> {
    caps.iter().take(2).position(|&c| c & CM_DEVCAP_REMOVABLE.0 != 0 && c & CM_DEVCAP_DOCKDEVICE.0 == 0)
}

/// The node to eject for a letter (eject_pick). "unknown" for a drive gone, "fixed" for one spanning disks or with nothing to eject
/// (a card reader built in, or on a port its hub keeps).
fn eject_node(letter: &str) -> Result<u32, String> {
    let number = extents(letter).ok_or("unknown")?.ok_or("fixed")?;
    let id = disk_instance(number).ok_or("unknown")?;
    let mut node = 0u32;
    if unsafe { CM_Locate_DevNodeW(&mut node, PCWSTR(id.as_ptr()), CM_LOCATE_DEVNODE_NORMAL) } != CR_SUCCESS {
        return Err("unknown".into());
    }
    let mut parent = 0u32;
    let nodes = if unsafe { CM_Get_Parent(&mut parent, node, 0) } == CR_SUCCESS { vec![node, parent] } else { vec![node] };
    let caps: Vec<u32> = nodes.iter().map(|&n| caps(n)).collect();
    eject_pick(&caps).map(|i| nodes[i]).ok_or_else(|| "fixed".into())
}

/// An app's file name from a veto's name (a path, or a name alone), at most 64 characters.
fn app_name(veto: &str) -> String {
    Path::new(veto).file_name().map(|n| n.to_string_lossy().chars().take(64).collect()).unwrap_or_default()
}

/// What an eject request answered, as the bar's words (toggles.ts ejectNote). A veto counts even beside CR_SUCCESS.
fn veto_code(ret: CONFIGRET, veto: PNP_VETO_TYPE, name: &str) -> Result<(), String> {
    match veto {
        pnp::PNP_VetoAlreadyRemoved => Ok(()),
        pnp::PNP_VetoWindowsApp if !app_name(name).is_empty() => Err(format!("app:{}", app_name(name))),
        pnp::PNP_VetoWindowsApp
        | pnp::PNP_VetoOutstandingOpen
        | pnp::PNP_VetoPendingClose
        | pnp::PNP_VetoWindowsService
        | pnp::PNP_VetoDevice
        | pnp::PNP_VetoDriver
        | pnp::PNP_VetoLegacyDriver
        | pnp::PNP_VetoNonDisableable => Err("busy".into()),
        pnp::PNP_VetoInsufficientRights => Err("rights".into()),
        pnp::PNP_VetoTypeUnknown if ret == CR_SUCCESS => Ok(()),
        _ if ret == CR_ACCESS_DENIED => Err("rights".into()),
        _ => Err("failed".into()),
    }
}

/// Asks Windows to remove the drive's device. With a buffer for the veto's name Windows shows nothing of its own: the bar says it.
/// Outside the PC's own console (Remote Desktop) Windows refuses a normal user: "rights".
fn eject(letter: &str) -> Result<(), String> {
    let node = eject_node(letter)?;
    let mut veto = pnp::PNP_VetoTypeUnknown;
    let mut name = [0u16; 260];
    let ret = unsafe { CM_Request_Device_EjectW(node, Some(&mut veto), Some(&mut name), 0) };
    veto_code(ret, veto, &String::from_utf16_lossy(&name[..name.iter().position(|&c| c == 0).unwrap_or(name.len())]))
}

/// Ejects a removable drive of the last listing by its letter (design K); the bar only. Rejects with veto_code's words, "unknown"
/// or "fixed". Off the main thread: Windows asks the apps that hold the drive and may wait seconds for them. Then the notch reads
/// the drives again (`bar://disks`), so the disk widget drops it now and not at its next read.
#[tauri::command]
pub async fn taskbar_eject(window: WebviewWindow, letter: String) -> Result<(), String> {
    bar::from_bar(&window)?;
    ejectable(&letter)?;
    tauri::async_runtime::spawn_blocking(move || {
        // A card pulled meanwhile raises no "no disk in the drive" dialog.
        let _quiet = Quiet::new(false);
        eject(&letter)
    })
    .await
    .map_err(|e| e.to_string())??;
    let _ = window.emit_to("notch", "bar://disks", ());
    Ok(())
}

/// Opens a listed drive, or a folder a scan of it listed, in File Explorer, by Explorer's full path: never the shell's open verb,
/// which an autorun.inf could take over. The bar only.
#[tauri::command]
pub async fn taskbar_disk_open(window: WebviewWindow, letter: String, folder: Option<usize>) -> Result<(), String> {
    bar::from_bar(&window)?;
    let path = target(&letter, folder)?;
    if folder.is_none() {
        return crate::opener().arg(path).spawn().map(|_| ()).map_err(|e| e.to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Explorer opens Documents for a folder that is gone. Asked here, off the main thread, so a sleeping disk freezes no window,
        // and a card pulled meanwhile raises no dialog.
        let _quiet = Quiet::new(false);
        // No Windows name holds a quote, and one would end the argument.
        if path.to_string_lossy().contains('"') || !path.is_dir() {
            return Err("gone".to_string());
        }
        // Quoted whole, as Explorer splits an unquoted path at a comma, and from the path itself: display() loses a name that is
        // not valid UTF-16.
        let mut arg = OsString::from("\"");
        arg.push(&path);
        arg.push("\"");
        crate::opener().raw_arg(arg).spawn().map(|_| ()).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Scan now: the largest folders directly in a listed drive's root, or in a folder a scan of it listed, by its id. A level an earlier
/// complete walk kept answers at once unless `fresh` (Rescan); any other walks that folder on a thread of its own, telling its bar
/// how far it got (`taskbar://disk-scan`, the bytes counted) every TICK, until it ends or `token` is stopped. "busy" while any
/// bar's scan runs, "gone" for a folder or drive it cannot read. The bar only.
#[tauri::command]
pub async fn taskbar_disk_scan(window: WebviewWindow, letter: String, folder: Option<usize>, token: u64, fresh: bool) -> Result<DiskScan, String> {
    bar::from_bar(&window)?;
    let root = target(&letter, folder)?;
    let kept = if fresh { None } else { scans().levels.get(&root).filter(|(at, _)| at.elapsed() < FRESH).map(|(_, level)| level.clone()) };
    if let Some(level) = kept {
        return Ok(level);
    }
    if token == 0 {
        return Err("unknown".into());
    }
    stopping().await;
    if RUNNING.compare_exchange(0, token, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Err("busy".into());
    }
    let label = window.label().to_string();
    let walked = tauri::async_runtime::spawn_blocking(move || {
        let _quiet = Quiet::new(true);
        let (start, mut told) = (Instant::now(), Instant::now());
        walk(&root, |entries, counted| {
            if told.elapsed() >= TICK {
                told = Instant::now();
                let _ = window.emit_to(label.as_str(), "taskbar://disk-scan", counted);
            }
            STOP.load(Ordering::Acquire) != token && entries < MOST_ENTRIES && start.elapsed() < MOST_TIME
        })
    })
    .await;
    // Only once the thread has left the walk: no scan starts beside one still waiting on a dying drive.
    RUNNING.store(0, Ordering::Release);
    let tally = walked.map_err(|e| e.to_string())?.ok_or("gone")?;
    Ok(answers(&mut scans(), &tally))
}

/// Ends the scan `token` names at its next folder, or with none whichever runs: a bar that found another bar's scan running
/// stops it this way, and waits a moment for its walk to end, so its own can start. The bar only.
#[tauri::command]
pub async fn taskbar_disk_scan_stop(window: WebviewWindow, token: Option<u64>) -> Result<(), String> {
    bar::from_bar(&window)?;
    stop_scan(token);
    if token.is_none() {
        stopping().await;
    }
    Ok(())
}

/// Waits up to a second for the scan running to end, if it was told to: a walk sees a Stop only before its next folder, and
/// Back then Scan now would otherwise find the scan Back just stopped still running and call it another bar's.
async fn stopping() {
    for _ in 0..40 {
        let running = RUNNING.load(Ordering::Acquire);
        if running == 0 || running != STOP.load(Ordering::Acquire) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

/// Stops the scan `token` names, or with none the one running; also as the bar turns off (taskbar::stop).
pub(crate) fn stop_scan(token: Option<u64>) {
    STOP.store(token.unwrap_or_else(|| RUNNING.load(Ordering::Acquire)), Ordering::Release);
}

/// The calling thread's error mode for one task, and with `low` its priority: no "no disk in the drive" dialog for a drive pulled
/// meanwhile, and a walk that leaves the CPU to the apps in use. Below normal, not Windows' background mode, which also lowers the
/// I/O and memory priority: a cold walk would crawl, and the pages it read would be the first to go. Put back as it drops, since
/// the runtime reuses its blocking threads and dev builds unwind.
struct Quiet {
    mode: THREAD_ERROR_MODE,
    priority: Option<i32>,
}

impl Quiet {
    fn new(low: bool) -> Self {
        let mut mode = THREAD_ERROR_MODE(0);
        unsafe {
            let _ = SetThreadErrorMode(SEM_FAILCRITICALERRORS, Some(&mut mode));
            let priority = low.then(|| GetThreadPriority(GetCurrentThread()));
            if low {
                let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
            }
            Quiet { mode, priority }
        }
    }
}

impl Drop for Quiet {
    fn drop(&mut self) {
        unsafe {
            let _ = SetThreadErrorMode(self.mode, None);
            if let Some(priority) = self.priority {
                let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY(priority));
            }
        }
    }
}

/// A folder a walk keeps: the kept folder it lies in, how deep below the walked one, the bytes counted in it and in no kept folder
/// below (its own files, or at KEEP all it holds), and in the end everything it holds.
struct Node {
    path: PathBuf,
    parent: usize,
    depth: usize,
    own: u64,
    size: u64,
}

/// A walk: its kept folders, the walked one first and each after the one it lies in; partial when it ended early.
struct Tally {
    nodes: Vec<Node>,
    partial: bool,
}

/// Adds up the files under `root` without opening one, so no antivirus or cloud provider reads them. `go_on` hears the entries and
/// bytes so far before each folder, and false ends the walk. A folder Windows keeps from this user (System Volume Information,
/// other profiles) is skipped, and std's is_dir is false for junctions, folder links and mount points, so none is followed or
/// counted twice. An explicit stack, as NTFS nests deeper than a thread's stack reaches. None when the walked folder itself cannot
/// be read (gone, or its drive pulled), where an empty answer would be kept and shown as all of it unreadable.
// shortcut: logical sizes, as Explorer's Size column; switch to AllocationSize from GetFileInformationByHandleEx(FileIdExtdDirectoryInfo) if size on disk is wanted (NTFS/ReFS only, bounds-checked parsing under panic=abort)
// shortcut: hard links count once per link (WinSxS inflates C:\Windows); dedupe by FileId via FileIdExtdDirectoryInfo if the numbers must match the used space
fn walk(root: &Path, mut go_on: impl FnMut(u64, u64) -> bool) -> Option<Tally> {
    let mut nodes = vec![Node { path: root.to_path_buf(), parent: 0, depth: 0, own: 0, size: 0 }];
    // The folders still to read, each with the kept folder its bytes go to and its depth.
    let mut stack = vec![(root.to_path_buf(), 0, 0)];
    let (mut entries, mut counted, mut partial) = (0u64, 0u64, false);
    while let Some((dir, at, depth)) = stack.pop() {
        if !go_on(entries, counted) {
            partial = true;
            break;
        }
        let Ok(list) = std::fs::read_dir(&dir) else {
            if depth == 0 {
                return None;
            }
            continue;
        };
        for entry in list.flatten() {
            entries += 1;
            let (Ok(kind), Ok(meta)) = (entry.file_type(), entry.metadata()) else { continue };
            let attrs = meta.file_attributes();
            if kind.is_dir() && opens(attrs) {
                let path = entry.path();
                let under = if depth < KEEP {
                    nodes.push(Node { path: path.clone(), parent: at, depth: depth + 1, own: 0, size: 0 });
                    nodes.len() - 1
                } else {
                    at
                };
                stack.push((path, under, depth + 1));
            } else if kind.is_file() {
                let bytes = on_disk(meta.len(), attrs);
                counted += bytes;
                nodes[at].own += bytes;
            }
        }
    }
    // Each kept folder comes after the one it lies in: one pass from the end adds each into its parent.
    for i in (0..nodes.len()).rev() {
        nodes[i].size += nodes[i].own;
        if i > 0 {
            let (parent, size) = (nodes[i].parent, nodes[i].size);
            nodes[parent].size += size;
        }
    }
    Some(Tally { nodes, partial })
}

/// A file's bytes on this PC: none for one only in the cloud (OneDrive's online-only files), or a scan would count gigabytes
/// this drive does not hold.
fn on_disk(len: u64, attrs: u32) -> u64 {
    if attrs & (FILE_ATTRIBUTE_OFFLINE.0 | FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0) != 0 { 0 } else { len }
}

/// A folder a walk lists: not a cloud placeholder, whose listing would make its provider fetch it.
fn opens(attrs: u32) -> bool {
    attrs & (FILE_ATTRIBUTE_RECALL_ON_OPEN.0 | FILE_ATTRIBUTE_OFFLINE.0) == 0
}

/// The SCAN_ROWS largest, largest first and the first by name on a tie, and the bytes of the rest; an empty one is left out.
fn rank<T: Ord>(mut items: Vec<(T, u64)>) -> (Vec<(T, u64)>, u64) {
    items.retain(|(_, size)| *size > 0);
    items.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let rest = items.split_off(items.len().min(SCAN_ROWS));
    (items, rest.iter().map(|(_, size)| size).sum())
}

/// A walk's answer for its folder. A complete walk also keeps, in place of what earlier walks kept there, the levels a press below
/// can ask for: down the folders each level lists, to KEEP - 1 deep, below which its folders' own were not kept. A partial one
/// keeps none.
fn answers(scans: &mut Scans, t: &Tally) -> DiskScan {
    let mut kids = vec![Vec::new(); t.nodes.len()];
    for (i, n) in t.nodes.iter().enumerate().skip(1) {
        kids[n.parent].push(i);
    }
    let root = &t.nodes[0].path;
    if !t.partial {
        scans.levels.retain(|path, (at, _)| !path.starts_with(root) && at.elapsed() < FRESH);
    }
    let mut todo = vec![0];
    while let Some(i) = todo.pop() {
        let (top, more) = rank(kids[i].iter().map(|&j| ((&t.nodes[j].path, j), t.nodes[j].size)).collect());
        let folders = top
            .iter()
            .map(|&((path, _), size)| ScanFolder { id: scans.id(path), name: path.file_name().unwrap_or_default().to_string_lossy().into_owned(), size })
            .collect();
        let level = DiskScan { folders, more, files: t.nodes[i].own, partial: t.partial };
        if t.partial {
            return level;
        }
        if t.nodes[i].depth + 1 < KEEP {
            todo.extend(top.iter().map(|&((_, j), _)| j));
        }
        scans.levels.insert(t.nodes[i].path.clone(), (Instant::now(), level));
    }
    scans.levels.get(root).map(|(_, level)| level.clone()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_ARCHIVE, FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_PINNED, FILE_ATTRIBUTE_REPARSE_POINT};
    use windows::Win32::System::Diagnostics::Debug::GetThreadErrorMode;

    #[test]
    fn only_listed_letters_open() {
        let letters = vec!["C:".to_string(), "E:".to_string()];
        assert!(listed(&letters, "C:") && listed(&letters, "E:"));
        assert!(!listed(&letters, "D:") && !listed(&letters, r"C:\Windows") && !listed(&letters, "") && !listed(&[], "C:"));
        // A folder only by an id a scan gave, and only on the drive the page names.
        let paths = [PathBuf::from(r"C:\Users"), PathBuf::from(r"C:\Windows"), PathBuf::from(r"E:\Fotos")];
        assert_eq!(scanned(&paths, 1, "C:"), Some(&paths[1]));
        assert_eq!(scanned(&paths, 2, "E:"), Some(&paths[2]));
        assert_eq!(scanned(&paths, 2, "C:"), None);
        assert_eq!(scanned(&paths, 3, "C:"), None);
        assert_eq!(scanned(&[], 0, "C:"), None);
    }

    #[test]
    fn only_listed_drives_that_plug_in_eject() {
        *EJECTABLE.lock().unwrap() = vec!["E:".to_string()];
        assert_eq!(ejectable("E:"), Ok(()));
        // The system drive and any internal one are never in the list; a letter gone since is not either.
        assert_eq!(ejectable("C:"), Err("unknown".to_string()));
        assert_eq!(ejectable("e:"), Err("unknown".to_string()));
        assert_eq!(ejectable(""), Err("unknown".to_string()));
        EJECTABLE.lock().unwrap().clear();
        assert_eq!(ejectable("E:"), Err("unknown".to_string()));
    }

    #[test]
    fn each_veto_has_its_word() {
        // CR_REMOVE_VETOED.
        let vetoed = CONFIGRET(0x17);
        assert_eq!(veto_code(CR_SUCCESS, pnp::PNP_VetoTypeUnknown, ""), Ok(()));
        // Gone already: what the click asked.
        assert_eq!(veto_code(vetoed, pnp::PNP_VetoAlreadyRemoved, ""), Ok(()));
        // An app that holds it: its file only, from a path or a name.
        assert_eq!(veto_code(vetoed, pnp::PNP_VetoWindowsApp, r"\Device\HarddiskVolume3\Program Files\Microsoft Office\WINWORD.EXE"), Err("app:WINWORD.EXE".into()));
        assert_eq!(veto_code(vetoed, pnp::PNP_VetoWindowsApp, "notepad.exe"), Err("app:notepad.exe".into()));
        assert_eq!(veto_code(vetoed, pnp::PNP_VetoWindowsApp, ""), Err("busy".into()));
        for veto in [pnp::PNP_VetoOutstandingOpen, pnp::PNP_VetoPendingClose, pnp::PNP_VetoWindowsService, pnp::PNP_VetoDevice, pnp::PNP_VetoDriver, pnp::PNP_VetoLegacyDriver, pnp::PNP_VetoNonDisableable] {
            assert_eq!(veto_code(vetoed, veto, "svc"), Err("busy".into()), "{veto:?}");
            // A veto counts even if the call says success.
            assert_eq!(veto_code(CR_SUCCESS, veto, "svc"), Err("busy".into()), "{veto:?}");
        }
        assert_eq!(veto_code(vetoed, pnp::PNP_VetoInsufficientRights, ""), Err("rights".into()));
        assert_eq!(veto_code(CR_ACCESS_DENIED, pnp::PNP_VetoTypeUnknown, ""), Err("rights".into()));
        assert_eq!(veto_code(vetoed, pnp::PNP_VetoTypeUnknown, ""), Err("failed".into()));
        // PNP_VetoInsufficientPower and the other kinds no word fits.
        assert_eq!(veto_code(CR_SUCCESS, PNP_VETO_TYPE(9), ""), Err("failed".into()));
    }

    #[test]
    fn an_apps_name_is_its_file_cut_to_64() {
        assert_eq!(app_name(r"C:\Tools\copy.exe"), "copy.exe");
        assert_eq!(app_name("copy.exe"), "copy.exe");
        assert_eq!(app_name(""), "");
        let long = format!(r"C:\{}.exe", "a".repeat(100));
        assert_eq!(app_name(&long).chars().count(), 64);
    }

    #[test]
    fn the_largest_folders_lead() {
        let items = |sizes: &[(&'static str, u64)]| sizes.to_vec();
        // Larger first, the name first on a tie; empty folders carry no size and go.
        let (top, more) = rank(items(&[("b", 5), ("a", 5), ("z", 0), ("c", 9)]));
        assert_eq!((top, more), (vec![("c", 9), ("a", 5), ("b", 5)], 0));
        // The first SCAN_ROWS, the rest summed.
        let many: Vec<(String, u64)> = (1..=13).map(|i| (format!("{i:02}"), i)).collect();
        let (top, more) = rank(many);
        assert_eq!(top.len(), SCAN_ROWS);
        assert_eq!((top[0].1, top[SCAN_ROWS - 1].1, more), (13, 4, 1 + 2 + 3));
        assert_eq!(rank(items(&[])), (vec![], 0));
        assert_eq!(rank(items(&[("a", 0), ("b", 0)])), (vec![], 0));
    }

    #[test]
    fn cloud_only_files_take_no_room() {
        assert_eq!(on_disk(4096, FILE_ATTRIBUTE_OFFLINE.0), 0);
        assert_eq!(on_disk(4096, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS.0), 0);
        assert_eq!(on_disk(4096, 0), 4096);
        // Kept on this PC: its size.
        assert_eq!(on_disk(4096, FILE_ATTRIBUTE_PINNED.0 | FILE_ATTRIBUTE_ARCHIVE.0), 4096);
    }

    #[test]
    fn placeholder_folders_are_not_listed() {
        assert!(!opens(FILE_ATTRIBUTE_DIRECTORY.0 | FILE_ATTRIBUTE_RECALL_ON_OPEN.0));
        assert!(!opens(FILE_ATTRIBUTE_DIRECTORY.0 | FILE_ATTRIBUTE_OFFLINE.0));
        assert!(opens(FILE_ATTRIBUTE_DIRECTORY.0));
        // A cloud folder already on this PC.
        assert!(opens(FILE_ATTRIBUTE_DIRECTORY.0 | FILE_ATTRIBUTE_REPARSE_POINT.0));
    }

    /// root/a/x (100 B), root/a/b/y (50), root/a/b/d/z (10), root/a/b/d/e/w (5), root/c (empty), root/f (7).
    fn tree(name: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("crest-scan-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(r"a\b\d\e")).unwrap();
        std::fs::create_dir_all(root.join("c")).unwrap();
        for (file, len) in [(r"a\x", 100), (r"a\b\y", 50), (r"a\b\d\z", 10), (r"a\b\d\e\w", 5), ("f", 7)] {
            std::fs::write(root.join(file), vec![0u8; len]).unwrap();
        }
        root
    }

    fn folders(level: &DiskScan) -> Vec<(String, u64)> {
        level.folders.iter().map(|f| (f.name.clone(), f.size)).collect()
    }

    #[test]
    fn a_walk_adds_up_each_top_folder() {
        let root = tree("walk");
        let t = walk(&root, |_, _| true).unwrap();
        assert!(!t.partial);
        assert_eq!((t.nodes[0].size, t.nodes[0].own), (172, 7));
        let mut scans = Scans::default();
        let level = answers(&mut scans, &t);
        // The empty folder carries nothing and is left out.
        assert_eq!((folders(&level), level.more, level.files, level.partial), (vec![("a".into(), 165)], 0, 7, false));
        assert_eq!(scans.paths[level.folders[0].id], root.join("a"));
        // The levels below come from the same walk, down to the folders three deep, whose own folders were not kept.
        let kept = |p: &str| scans.levels.get(&root.join(p)).map(|(_, l)| (folders(l), l.files));
        assert_eq!(kept("a"), Some((vec![("b".into(), 65)], 100)));
        assert_eq!(kept(r"a\b"), Some((vec![("d".into(), 15)], 50)));
        assert_eq!(kept(r"a\b\d"), None);
        // A folder keeps its id at the next scan.
        let again = answers(&mut scans, &walk(&root, |_, _| true).unwrap());
        assert_eq!(again.folders[0].id, level.folders[0].id);
        assert_eq!(scans.paths.len(), 3);
        // A level past the kept ones walks its own folder.
        let deep = answers(&mut scans, &walk(&root.join(r"a\b\d"), |_, _| true).unwrap());
        assert_eq!((folders(&deep), deep.files), (vec![("e".into(), 5)], 10));
        // A folder that is gone, or its drive pulled: no answer, where an empty one would be kept and shown as all unreadable.
        assert!(walk(&root.join("gone"), |_, _| true).is_none());
        // A folder that is there and empty still answers.
        assert_eq!(walk(&root.join("c"), |_, _| true).map(|t| (t.nodes.len(), t.nodes[0].size, t.partial)), Some((1, 0, false)));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_stop_ends_the_walk() {
        let root = tree("stop");
        let t = walk(&root, |_, _| false).unwrap();
        assert_eq!((t.partial, t.nodes.len(), t.nodes[0].size), (true, 1, 0));
        // The cap after the first folder: only the root's own files, marked partial and kept for no level.
        let t = walk(&root, |entries, _| entries == 0).unwrap();
        let mut scans = Scans::default();
        let level = answers(&mut scans, &t);
        assert_eq!((folders(&level), level.files, level.partial), (vec![], 7, true));
        assert!(scans.levels.is_empty());
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_scan_waits_for_the_one_it_stopped() {
        // Back, then Scan now: the walk Back stopped sees it only before its next folder, a moment later.
        RUNNING.store(7, Ordering::Release);
        STOP.store(7, Ordering::Release);
        let ends = std::thread::spawn(|| {
            std::thread::sleep(Duration::from_millis(100));
            RUNNING.store(0, Ordering::Release);
        });
        tauri::async_runtime::block_on(stopping());
        assert_eq!(RUNNING.load(Ordering::Acquire), 0);
        ends.join().unwrap();
        // Another bar's scan, which nothing stopped: no wait, that one is busy.
        RUNNING.store(8, Ordering::Release);
        let at = Instant::now();
        tauri::async_runtime::block_on(stopping());
        assert!(at.elapsed() < Duration::from_millis(500));
        RUNNING.store(0, Ordering::Release);
    }

    #[test]
    fn eject_takes_the_drive_and_never_a_hub_or_a_dock() {
        let (rem, dock) = (CM_DEVCAP_REMOVABLE.0, CM_DEVCAP_DOCKDEVICE.0);
        // A USB stick: its disk is not removable, the USB device right above it is.
        assert_eq!(eject_pick(&[0, rem, rem]), Some(1));
        assert_eq!(eject_pick(&[rem, rem]), Some(0));
        // A card reader on a port its hub keeps: only the hub, further up, is removable, and it holds the keyboard too.
        assert_eq!(eject_pick(&[0, 0, rem]), None);
        assert_eq!(eject_pick(&[0, rem | dock]), None);
        assert_eq!(eject_pick(&[]), None);
    }

    #[test]
    fn a_scan_thread_gets_its_settings_back() {
        let now = || unsafe { (GetThreadPriority(GetCurrentThread()), GetThreadErrorMode()) };
        let before = now();
        {
            let _quiet = Quiet::new(true);
            assert_eq!(now().0, THREAD_PRIORITY_BELOW_NORMAL.0);
            assert_ne!(now().1 & SEM_FAILCRITICALERRORS.0, 0);
        }
        assert_eq!(now(), before);
        // Dev builds unwind: a panic in the walk leaves the pooled thread as it was.
        let _ = std::panic::catch_unwind(|| {
            let _quiet = Quiet::new(true);
            panic!("walk");
        });
        assert_eq!(now(), before);
    }
}

#[cfg(test)]
mod live {
    //! K3, reads only and ejects nothing (decision W17): `cargo test --lib taskbar::disks::live -- --ignored --nocapture`.
    use super::*;
    use windows::Win32::Devices::DeviceAndDriverInstallation::CM_Get_Device_IDW;

    /// Each drive that plugs in, with its disk's node and the nodes above it, their capabilities, and the node Eject would ask for.
    #[test]
    #[ignore]
    fn reads_the_removable_chain() {
        for d in bar_drives().into_iter().filter(|d| d.removable) {
            let Some(Some(number)) = extents(&d.letter) else {
                eprintln!("{}: no single disk", d.letter);
                continue;
            };
            let Some(id) = disk_instance(number) else {
                eprintln!("{}: disk {number} not among the interfaces", d.letter);
                continue;
            };
            let mut node = 0u32;
            if unsafe { CM_Locate_DevNodeW(&mut node, PCWSTR(id.as_ptr()), CM_LOCATE_DEVNODE_NORMAL) } != CR_SUCCESS {
                continue;
            }
            loop {
                let mut name = [0u16; 256];
                let _ = unsafe { CM_Get_Device_IDW(node, &mut name, 0) };
                eprintln!("{}: {} caps {:#x}", d.letter, String::from_utf16_lossy(&name).trim_end_matches('\0'), caps(node));
                let mut parent = 0u32;
                if unsafe { CM_Get_Parent(&mut parent, node, 0) } != CR_SUCCESS {
                    break;
                }
                node = parent;
            }
            eprintln!("{}: would eject {:?}", d.letter, eject_node(&d.letter));
        }
    }
}
