//! The bar's search: files and folders by name from Windows' index, under the user's folder, and their thumbnails
//! (src/features/taskbar/search/files.ts). Only the index answers: a folder it does not cover is never walked, so a search
//! never keeps the disk busy.

use std::os::windows::fs::MetadataExt;
use std::time::Duration;

use base64::Engine as _;
use serde::Serialize;
use windows::core::{Interface, HSTRING};
use windows::Storage::Search::{FolderDepth, IndexerOption, QueryOptions, SortEntry};
use windows::Storage::{StorageFolder, StorageItemTypes};
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::DeleteObject;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_MULTITHREADED};
use windows::Win32::UI::Shell::{IShellItem, IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF, SIIGBF_ICONONLY, SIIGBF_RESIZETOFIT};

/// A file or folder the index found.
#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub path: String,
    pub name: String,
    pub folder: bool,
}

/// How long a search may take before the page gets nothing; a healthy index answers in a few ms.
const DEADLINE: Duration = Duration::from_millis(1500);
const MAX_RESULTS: u32 = 50;

/// The words typed as an AQS filter on the file's name, each word somewhere in it. An AQS phrase cannot escape a quote, so
/// quotes go. None for nothing left to look for.
pub(crate) fn aqs_name_filter(query: &str) -> Option<String> {
    let words: Vec<String> = query.split_whitespace().map(|w| w.replace('"', "")).filter(|w| !w.is_empty()).collect();
    (!words.is_empty()).then(|| words.iter().map(|w| format!("System.FileName:~=\"{w}\"")).collect::<Vec<_>>().join(" "))
}

/// The index's matches under the user's folder, newest first.
fn find(filter: &str, limit: u32) -> windows::core::Result<Vec<Found>> {
    let Ok(home) = std::env::var("USERPROFILE") else { return Ok(Vec::new()) };
    let folder = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(home))?.join()?;
    let options = QueryOptions::new()?;
    options.SetFolderDepth(FolderDepth::Deep)?;
    options.SetIndexerOption(IndexerOption::OnlyUseIndexer)?;
    options.SetUserSearchFilter(&HSTRING::from(filter))?;
    options.SortOrder()?.Append(&SortEntry { PropertyName: HSTRING::from("System.DateModified"), AscendingOrder: false })?;
    let items = folder.CreateItemQueryWithOptions(&options)?.GetItemsAsync(0, limit)?.join()?;
    let mut found = Vec::new();
    for item in items {
        found.push(Found { path: item.Path()?.to_string(), name: item.Name()?.to_string(), folder: item.IsOfType(StorageItemTypes::Folder)? });
    }
    Ok(found)
}

/// Files and folders whose name holds every word typed. On a thread of its own with COM for WinRT; a search that outlasts
/// DEADLINE gives nothing and its late answer is dropped.
#[tauri::command]
pub async fn search_files(query: String, limit: u32) -> Vec<Found> {
    let Some(filter) = aqs_name_filter(&query) else { return Vec::new() };
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let _ = tx.send(find(&filter, limit.min(MAX_RESULTS)).unwrap_or_default());
    });
    tokio::time::timeout(DEADLINE, rx).await.ok().and_then(Result::ok).unwrap_or_default()
}

/// Whether reading the file would download it from the cloud (OneDrive and the like): those get their icon only.
fn cloud_only(path: &str) -> bool {
    const OFFLINE: u32 = 0x1000;
    const RECALL_ON_DATA_ACCESS: u32 = 0x40_0000;
    std::fs::metadata(path).is_ok_and(|m| m.file_attributes() & (OFFLINE | RECALL_ON_DATA_ACCESS) != 0)
}

/// Explorer's picture of the item as a PNG data URL: a photo's or a video's thumbnail, else its icon.
fn thumb(path: &str, size: i32) -> Option<String> {
    let flags: SIIGBF = if cloud_only(path) { SIIGBF_ICONONLY } else { SIIGBF_RESIZETOFIT };
    unsafe {
        let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path), None).ok()?;
        let factory: IShellItemImageFactory = item.cast().ok()?;
        let bitmap = factory.GetImage(SIZE { cx: size, cy: size }, flags).ok()?;
        let png = crate::launcher::bitmap_to_png(bitmap);
        let _ = DeleteObject(bitmap.into());
        Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(png?)))
    }
}

/// The picture of a found item, `size` px square at most. One STA thread per call, as the shell expects.
#[tauri::command]
pub async fn search_file_thumb(path: String, size: u32) -> Option<String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    std::thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        let _ = tx.send(thumb(&path, size.clamp(16, 512) as i32));
    });
    rx.await.ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_filter_keeps_each_word_and_drops_the_quotes_aqs_cannot_escape() {
        assert_eq!(aqs_name_filter("holiday").as_deref(), Some("System.FileName:~=\"holiday\""));
        assert_eq!(aqs_name_filter("my \"file\"").as_deref(), Some("System.FileName:~=\"my\" System.FileName:~=\"file\""));
        assert_eq!(aqs_name_filter("a:b (c)*").as_deref(), Some("System.FileName:~=\"a:b\" System.FileName:~=\"(c)*\""));
        assert_eq!(aqs_name_filter("  \"\" "), None);
    }

    /// On this PC: what the index finds for a word, and a thumbnail of the first hit.
    #[test]
    #[ignore = "reads this PC's index"]
    fn the_index_answers_with_names_and_pictures() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
        let found = rt.block_on(search_files("crest".into(), 10));
        for f in &found {
            println!("{} | {} | folder {}", f.name, f.path, f.folder);
        }
        assert!(!found.is_empty(), "the index found nothing for 'crest'");
        let first = found.iter().find(|f| !f.folder).expect("a file");
        let picture = rt.block_on(search_file_thumb(first.path.clone(), 64));
        assert!(picture.is_some_and(|p| p.starts_with("data:image/png;base64,")));
    }
}
