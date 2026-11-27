//! The bar's web search in the default browser, with the search engine chosen in it (src/features/taskbar/search/run.ts). The
//! browser is the one Windows opens https links with; it starts with "? text", which a Chromium browser's address bar reads as a
//! search with its own engine, or Firefox's own -search switch. Overview's line keeps its fixed engines (lib.rs `web_search`).
//! On macOS the fallback engine's address opens in the default browser: Safari takes no search from its command line.

#[cfg(windows)]
use std::path::Path;

#[cfg(windows)]
use windows::core::{HSTRING, PCWSTR};
#[cfg(windows)]
use windows::Win32::Foundation::ERROR_SUCCESS;
#[cfg(windows)]
use windows::Win32::System::Registry::{RegGetValueW, HKEY, HKEY_CLASSES_ROOT, HKEY_CURRENT_USER, RRF_RT_REG_EXPAND_SZ, RRF_RT_REG_SZ};

/// A registry command line split as Windows reads it: words apart on spaces outside quotes, the quotes dropped.
#[cfg(windows)]
pub(crate) fn split_command(command: &str) -> Vec<String> {
    let mut words = Vec::new();
    let (mut word, mut quoted, mut any) = (String::new(), false, false);
    for c in command.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    words.push(std::mem::take(&mut word));
                }
                any = false;
            }
            c => {
                word.push(c);
                any = true;
            }
        }
    }
    if any {
        words.push(word);
    }
    words
}

/// How to start the browser on a search: `args` each quoted as Windows reads them, then `raw` as it is.
#[cfg(windows)]
#[derive(Debug, PartialEq)]
struct Launch {
    exe: String,
    args: Vec<String>,
    raw: Option<String>,
}

/// How to search for `query` in the browser `command` opens links with (its registry command, "%1" where the link goes). No
/// shell, and the text can never become a switch or a second command. None for nothing to search, a text past 2000 characters,
/// no program or a command Crest does not understand.
#[cfg(windows)]
fn search_args(command: &str, query: &str) -> Option<Launch> {
    let query: String = query.chars().filter(|c| !c.is_control()).collect();
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 2000 {
        return None;
    }
    let mut words = split_command(command);
    if words.is_empty() || words[0].is_empty() {
        return None;
    }
    let exe = words.remove(0);
    let name = Path::new(&exe).file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if name == "firefox.exe" {
        // Firefox's own switch; a leading dash would read as another one.
        let query = query.trim_start_matches('-').trim();
        return (!query.is_empty()).then(|| Launch { exe, args: vec!["-search".to_string(), query.to_string()], raw: None });
    }
    if words.iter().any(|w| w.contains("%1") && w != "%1") {
        return None;
    }
    let term = format!("? {query}");
    // --single-argument takes the rest of the line as it is (Chromium's base/command_line.cc), where Windows pastes the link.
    if words.len() >= 2 && words[words.len() - 1] == "%1" && words[words.len() - 2] == "--single-argument" {
        words.pop();
        return Some(Launch { exe, args: words, raw: Some(term) });
    }
    let mut args: Vec<String> = words.into_iter().map(|w| if w == "%1" { term.clone() } else { w }).collect();
    if !args.contains(&term) {
        args.push(term);
    }
    Some(Launch { exe, args, raw: None })
}

/// A string value from the registry, environment variables expanded; None when missing.
#[cfg(windows)]
pub(crate) fn reg_string(root: HKEY, path: &str, name: Option<&str>) -> Option<String> {
    let mut buf = [0u16; 2048];
    let mut size = (buf.len() * 2) as u32;
    let name = name.map(HSTRING::from);
    let value = name.as_ref().map_or(PCWSTR::null(), |n| PCWSTR(n.as_ptr()));
    let ok = unsafe { RegGetValueW(root, &HSTRING::from(path), value, RRF_RT_REG_SZ | RRF_RT_REG_EXPAND_SZ, None, Some(buf.as_mut_ptr().cast()), Some(&mut size)) } == ERROR_SUCCESS;
    ok.then(|| String::from_utf16_lossy(&buf[..(size as usize / 2).min(buf.len())]).trim_end_matches('\0').to_string())
}

/// Where Windows keeps the user's choice of browser, in HKCU, newest first: Windows 11's UserChoiceLatest keeps it in a ProgId
/// subkey, and the older UserChoice beside it can still name the browser chosen before.
#[cfg(windows)]
const CHOICES: [&str; 2] = [
    r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoiceLatest\ProgId",
    r"Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice",
];

/// The browser's ProgId from the first of `CHOICES` that names one; `read` reads a key's ProgId value.
#[cfg(windows)]
fn chosen_prog(read: impl Fn(&str) -> Option<String>) -> Option<String> {
    CHOICES.iter().filter_map(|k| read(k)).find(|p| !p.trim().is_empty())
}

/// The command line Windows opens https links with: the user's choice of browser, then that browser's open command.
#[cfg(windows)]
fn https_command() -> Option<String> {
    let prog = chosen_prog(|k| reg_string(HKEY_CURRENT_USER, k, Some("ProgId")))?;
    reg_string(HKEY_CLASSES_ROOT, &format!(r"{prog}\shell\open\command"), None)
}

/// Starts the default browser on the search; false when there is none Crest can tell how, or it does not start.
#[cfg(windows)]
fn search_in_browser(query: &str) -> bool {
    use std::os::windows::process::CommandExt;
    let Some(l) = https_command().and_then(|c| search_args(&c, query)) else { return false };
    let mut cmd = std::process::Command::new(&l.exe);
    cmd.args(&l.args);
    if let Some(raw) = &l.raw {
        cmd.raw_arg(raw);
    }
    cmd.spawn().is_ok()
}

/// Searches the web for `query` in the default browser with its own engine; where it cannot (macOS, no browser found, or it does
/// not start), `fallback`'s address in it instead (lib.rs `search_url`).
#[tauri::command]
pub fn web_search_browser(query: String, fallback: String) -> Result<(), String> {
    #[cfg(windows)]
    if search_in_browser(&query) {
        return Ok(());
    }
    crate::open_url(&crate::search_url(&fallback, &query).ok_or("bad-search")?)
}

#[cfg(all(test, windows))]
mod tests {
    use super::{chosen_prog, search_args, Launch};

    fn launch(exe: &str, args: &[&str], raw: Option<&str>) -> Option<Launch> {
        Some(Launch { exe: exe.to_string(), args: args.iter().map(|a| a.to_string()).collect(), raw: raw.map(String::from) })
    }

    #[test]
    fn the_default_browser_searches_with_its_own_engine() {
        // --single-argument takes the rest of the line as it is (Chromium's base/command_line.cc), as Windows pastes a link there:
        // the search goes after it unquoted, or its quotes would be searched too.
        let exe = r"C:\Program Files\Google\Chrome\Application\chrome.exe";
        let chrome = format!(r#""{exe}" --single-argument %1"#);
        assert_eq!(search_args(&chrome, " weather london "), launch(exe, &["--single-argument"], Some("? weather london")));
        assert_eq!(search_args(&chrome, r#""quoted" --flag"#), launch(exe, &["--single-argument"], Some(r#"? "quoted" --flag"#)));
        // Without it each word is an argument of its own, quoted.
        assert_eq!(search_args(r#""C:\b\b.exe" --new-window "%1""#, "a b"), launch(r"C:\b\b.exe", &["--new-window", "? a b"], None));
        // No %1: the search goes last.
        assert_eq!(search_args(r"C:\b\b.exe", "x"), launch(r"C:\b\b.exe", &["? x"], None));
        // %1 inside a word is a command Crest does not understand.
        assert_eq!(search_args(r#""C:\b\b.exe" --url=%1"#, "x"), None);
        // Firefox has a switch of its own; a leading dash would read as another switch.
        let firefox = r#""C:\Program Files\Mozilla Firefox\firefox.exe" -osint -url "%1""#;
        assert_eq!(search_args(firefox, "--private x").map(|l| l.args), Some(vec!["-search".to_string(), "private x".to_string()]));
        // A line break never reaches the browser; nothing to search, an overlong text or no program gives no search.
        assert_eq!(search_args(&chrome, "a\nb").and_then(|l| l.raw), Some("? ab".to_string()));
        assert_eq!(search_args(&chrome, "   "), None);
        assert_eq!(search_args(&chrome, &"x".repeat(2001)), None);
        assert_eq!(search_args("", "x"), None);
    }

    #[test]
    fn the_newest_choice_of_browser_wins() {
        // Andrea's PC: Chrome chosen on Windows 11 (a ProgId subkey of UserChoiceLatest), Edge still named in the older UserChoice.
        let read = |k: &str| {
            if k.ends_with(r"UserChoiceLatest\ProgId") {
                Some("ChromeHTML".to_string())
            } else if k.ends_with("UserChoice") {
                Some("MSEdgeHTM".to_string())
            } else {
                None
            }
        };
        assert_eq!(chosen_prog(read), Some("ChromeHTML".to_string()));
        // Older Windows has only UserChoice, and an empty value never hides it.
        let older = |k: &str| k.ends_with("UserChoice").then(|| "FirefoxURL".to_string());
        assert_eq!(chosen_prog(older), Some("FirefoxURL".to_string()));
        let blank = |k: &str| Some(if k.ends_with("UserChoice") { "FirefoxURL".to_string() } else { String::new() });
        assert_eq!(chosen_prog(blank), Some("FirefoxURL".to_string()));
        assert_eq!(chosen_prog(|_: &str| None), None);
    }
}
