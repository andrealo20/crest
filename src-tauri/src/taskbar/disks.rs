//! The bar's disk space widget (Windows only): the lettered drives with their free space, read by system/hw.rs, opening one in
//! File Explorer by a letter this module listed or a folder its scan listed, never a path from the page, and Scan now, the largest
//! folders of a drive or of such a folder. Read on a call only: the notch asks every few minutes for the widget and a bar as its
//! panel opens; Crest hears no device change, so a drive plugged in shows on the next. A scan runs only on a press and saves
//! nothing to disk.

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
use windows::Win32::Storage::FileSystem::{FILE_ATTRIBUTE_OFFLINE, FILE_ATTRIBUTE_RECALL_ON_DATA_ACCESS, FILE_ATTRIBUTE_RECALL_ON_OPEN};
use windows::Win32::System::Diagnostics::Debug::{SetThreadErrorMode, SEM_FAILCRITICALERRORS, THREAD_ERROR_MODE};
use windows::Win32::System::Threading::{GetCurrentThread, GetThreadPriority, SetThreadPriority, THREAD_PRIORITY, THREAD_PRIORITY_BELOW_NORMAL};

use super::bar;
use crate::system::{bar_drives, BarDrive};

/// The letters of the last listing: the only drives a bar may open.
static LISTED: Mutex<Vec<String>> = Mutex::new(Vec::new());
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
/// bar's scan runs. The bar only.
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
    Ok(answers(&mut scans(), &walked.map_err(|e| e.to_string())?))
}

/// Ends the scan `token` names at its next folder, or with none whichever runs: a bar that found another bar's scan running
/// stops it this way, and waits a moment for its walk to end, so its own can start. The bar only.
#[tauri::command]
pub async fn taskbar_disk_scan_stop(window: WebviewWindow, token: Option<u64>) -> Result<(), String> {
    bar::from_bar(&window)?;
    stop_scan(token);
    if token.is_none() {
        for _ in 0..40 {
            if RUNNING.load(Ordering::Acquire) == 0 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
    Ok(())
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
/// counted twice. An explicit stack, as NTFS nests deeper than a thread's stack reaches.
// shortcut: logical sizes, as Explorer's Size column; switch to AllocationSize from GetFileInformationByHandleEx(FileIdExtdDirectoryInfo) if size on disk is wanted (NTFS/ReFS only, bounds-checked parsing under panic=abort)
// shortcut: hard links count once per link (WinSxS inflates C:\Windows); dedupe by FileId via FileIdExtdDirectoryInfo if the numbers must match the used space
fn walk(root: &Path, mut go_on: impl FnMut(u64, u64) -> bool) -> Tally {
    let mut nodes = vec![Node { path: root.to_path_buf(), parent: 0, depth: 0, own: 0, size: 0 }];
    // The folders still to read, each with the kept folder its bytes go to and its depth.
    let mut stack = vec![(root.to_path_buf(), 0, 0)];
    let (mut entries, mut counted, mut partial) = (0u64, 0u64, false);
    while let Some((dir, at, depth)) = stack.pop() {
        if !go_on(entries, counted) {
            partial = true;
            break;
        }
        let Ok(list) = std::fs::read_dir(&dir) else { continue };
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
    Tally { nodes, partial }
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
        let t = walk(&root, |_, _| true);
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
        let again = answers(&mut scans, &walk(&root, |_, _| true));
        assert_eq!(again.folders[0].id, level.folders[0].id);
        assert_eq!(scans.paths.len(), 3);
        // A level past the kept ones walks its own folder.
        let deep = answers(&mut scans, &walk(&root.join(r"a\b\d"), |_, _| true));
        assert_eq!((folders(&deep), deep.files), (vec![("e".into(), 5)], 10));
        // A folder that is gone: nothing in it.
        let gone = walk(&root.join("gone"), |_, _| true);
        assert_eq!((gone.nodes.len(), gone.nodes[0].size, gone.partial), (1, 0, false));
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_stop_ends_the_walk() {
        let root = tree("stop");
        let t = walk(&root, |_, _| false);
        assert_eq!((t.partial, t.nodes.len(), t.nodes[0].size), (true, 1, 0));
        // The cap after the first folder: only the root's own files, marked partial and kept for no level.
        let t = walk(&root, |entries, _| entries == 0);
        let mut scans = Scans::default();
        let level = answers(&mut scans, &t);
        assert_eq!((folders(&level), level.files, level.partial), (vec![], 7, true));
        assert!(scans.levels.is_empty());
        std::fs::remove_dir_all(&root).unwrap();
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
