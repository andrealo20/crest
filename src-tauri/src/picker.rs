//! The system's picker for a folder or a file, over the notch: for installing a plugin and for restoring a backup.
//! The frontend keeps the notch open meanwhile (`holdOpen`), as the dialog takes the pointer and the focus away from it.

use std::path::PathBuf;

use tauri::WebviewWindow;

/// What the picker asks for: a folder, or a file of one type (the type's name in the dialog and its extension), shown
/// first in `dir` when there is one (else where the system's picker was last).
pub enum Pick {
    Folder,
    File { name: &'static str, ext: &'static str, dir: Option<PathBuf> },
}

/// The chosen path, None when cancelled.
#[cfg(windows)]
pub async fn pick(what: Pick, window: &WebviewWindow) -> Option<String> {
    let owner = window.hwnd().ok()?.0 as isize;
    let (tx, rx) = tokio::sync::oneshot::channel();
    // The dialog needs a thread of its own in a single-threaded COM apartment.
    std::thread::spawn(move || {
        let _ = tx.send(dialog(what, owner));
    });
    rx.await.ok().flatten()
}

/// The same with AppKit's picker, through AppleScript; cancelling ends osascript with an error.
#[cfg(target_os = "macos")]
pub async fn pick(what: Pick, _: &WebviewWindow) -> Option<String> {
    let script = applescript(what);
    let out = tauri::async_runtime::spawn_blocking(move || std::process::Command::new("osascript").arg("-e").arg(script).output()).await.ok()?.ok()?;
    let path = String::from_utf8(out.stdout).ok()?.trim_end().to_string();
    (out.status.success() && !path.is_empty()).then_some(path)
}

/// The Mac picker's script. Built on every platform, so its test runs everywhere.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
fn applescript(what: Pick) -> String {
    // An AppleScript string: backslashes and quotes escaped.
    let quoted = |s: &str| format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""));
    match what {
        Pick::Folder => "POSIX path of (choose folder)".to_string(),
        Pick::File { ext, dir, .. } => {
            let start = dir.map(|d| format!(" default location (POSIX file {})", quoted(&d.to_string_lossy()))).unwrap_or_default();
            format!("POSIX path of (choose file of type {{{}}}{start})", quoted(ext))
        }
    }
}


#[cfg(windows)]
fn dialog(what: Pick, owner: isize) -> Option<String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::Common::COMDLG_FILTERSPEC;
    use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH};
    // The filter's texts, alive until the dialog is gone.
    let (filter, dir) = match what {
        Pick::Folder => (None, None),
        Pick::File { name, ext, dir } => (Some((HSTRING::from(format!("{name} (*.{ext})")), HSTRING::from(format!("*.{ext}")))), dir),
    };
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER).ok()?;
            let mut options = dialog.GetOptions().ok()? | FOS_FORCEFILESYSTEM;
            match &filter {
                None => options |= FOS_PICKFOLDERS,
                Some((label, spec)) => {
                    dialog.SetFileTypes(&[COMDLG_FILTERSPEC { pszName: PCWSTR(label.as_ptr()), pszSpec: PCWSTR(spec.as_ptr()) }]).ok()?;
                }
            }
            // A folder that cannot be opened is skipped: the dialog then starts where it was last.
            if let Some(folder) = dir.and_then(|d| SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(d.as_os_str()), None).ok()) {
                let _ = dialog.SetFolder(&folder);
            }
            dialog.SetOptions(options).ok()?;
            // Cancelling returns an error.
            dialog.Show(Some(HWND(owner as *mut _))).ok()?;
            let path = dialog.GetResult().ok()?.GetDisplayName(SIGDN_FILESYSPATH).ok()?;
            let text = path.to_string().ok();
            CoTaskMemFree(Some(path.0 as _));
            text
        })();
        CoUninitialize();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mac_scripts_quote_the_folder() {
        assert_eq!(applescript(Pick::Folder), "POSIX path of (choose folder)");
        assert_eq!(applescript(Pick::File { name: "Crest plugin", ext: "zip", dir: None }), r#"POSIX path of (choose file of type {"zip"})"#);
        let dir = Some(PathBuf::from(r#"/Users/a "b"/Documents/Crest/Backups"#));
        assert_eq!(
            applescript(Pick::File { name: "Crest backup", ext: "json", dir }),
            r#"POSIX path of (choose file of type {"json"} default location (POSIX file "/Users/a \"b\"/Documents/Crest/Backups"))"#
        );
    }
}
