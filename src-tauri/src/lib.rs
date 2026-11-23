mod accent;
mod agents;
pub mod ai;
#[cfg(windows)]
mod audio;
mod backup;
#[cfg(windows)]
mod banners;
#[cfg(windows)]
mod brightness;
mod calendar;
#[cfg(windows)]
mod camera;
#[cfg(windows)]
mod capture;
mod clipboard;
#[cfg(windows)]
mod controls;
#[cfg(windows)]
mod quick;
pub mod convert;
#[cfg(windows)]
mod discord;
// On a Mac these keep parts only Windows reads yet (screen rules, mirrors, the launcher keys).
#[cfg_attr(not(windows), allow(dead_code))]
mod display;
// Only Windows watches the folder yet; the Mac keeps the command as a no-op.
#[cfg_attr(not(windows), allow(dead_code))]
mod downloads;
#[cfg(windows)]
mod drop;
#[cfg(windows)]
mod fps;
mod github;
mod leetcode;
mod hit_test;
mod idle;
#[cfg(windows)]
mod loopback;
mod lyrics;
#[cfg(windows)]
mod launcher;
#[cfg(windows)]
mod media;
#[cfg(windows)]
mod media_pick;
#[cfg(windows)]
mod memory;
#[cfg(windows)]
mod mirror;
#[cfg(windows)]
mod mixer;
#[cfg(windows)]
mod notice_sound;
#[cfg(windows)]
mod notices;
mod notify_wire;
#[cfg(windows)]
mod osd;
mod picker;
mod plugins;
pub mod portable;
mod ports;
#[cfg(windows)]
mod power;
#[cfg(windows)]
mod privacy;
mod phone_share;
mod romanize;
mod screentime;
mod standby;
mod translate;
#[cfg_attr(not(windows), allow(dead_code))]
mod screen_policy;
pub mod secrets;
mod settings_window;
#[cfg(windows)]
mod shelf;
#[cfg_attr(not(windows), allow(dead_code))]
mod shell;
mod startup;
#[cfg(windows)]
mod system;
#[cfg(windows)]
mod sysevents;
#[cfg(windows)]
mod taskbar;
mod text_scale;
mod timer_window;
#[cfg(windows)]
mod terminal;
mod themes;
mod trading;
pub mod usage;
#[cfg(windows)]
mod vault;
mod mic;
mod sharing;
mod wallpaper;

// The Mac's own versions of what the shared modules call into (src/macos/); the other Windows modules have no Mac
// counterpart yet and their tools are hidden there.
#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
use macos::{audio, media, mirror};

use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, State, WebviewWindow};
#[cfg(windows)]
use windows::Win32::Foundation::HWND;
#[cfg(windows)]
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, IsWindow, SetForegroundWindow};

/// Milliseconds since 1970 (0 if the clock is before it).
pub(crate) fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// A failed request as the frontend's error codes.
pub(crate) fn net_error(e: reqwest::Error) -> String {
    if e.is_timeout() || e.is_connect() { "offline" } else { "failed" }.into()
}

/// Temp file, flushed to disk, then renamed: a crash or a power cut leaves the old file whole.
pub(crate) fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let tmp = path.with_extension("tmp");
    let mut file = std::fs::File::create(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    std::fs::rename(&tmp, path)
}

/// Crest's windows only ever show its own pages: a dropped link or a script must not navigate one elsewhere, above all
/// not to a plugin page, which as the top frame would get the app's commands. Plugins run in their iframe (on Windows
/// this check only sees the top frame; on a Mac it sees frames too, where plugins don't load anyway).
pub(crate) fn own_page(url: &tauri::Url) -> bool {
    match url.scheme() {
        "tauri" | "about" => true,
        "http" | "https" => url.host_str() == Some("tauri.localhost") || (cfg!(debug_assertions) && url.host_str() == Some("localhost")),
        _ => false,
    }
}

/// What the settings window may not call: commands that act on the window calling them (its hit zone, its focus, its
/// glass) or apply the settings to the system. The notch applies what the settings window saves, so only it does that.
const SETTINGS_DENIED: &[&str] = &[
    "display_apply", "keyboard_focus", "set_hit_rect", "set_pet_rect", "set_pinned", "set_passthrough", "memory_low", "hotkeys_apply",
    "launcher_shortcuts", "launcher_add_file", "clipboard_mode", "tray_texts", "media_pin", "status_configure", "status_bar", "notices_configure",
    "notices_banners", "notices_sounds", "discord_configure", "downloads_configure", "sharing_hide", "keep_awake_set",
    "mirror_picture_set", "glass_backdrop", "glass_live_start", "glass_live_stop", "glass_live_exclude", "display_alert",
    "timer_window_open", "taskbar_apply", "taskbar_hit_rects", "taskbar_window", "taskbar_release", "taskbar_panel", "taskbar_ask",
    "taskbar_auto_hide", "taskbar_slid", "taskbar_shell", "taskbar_windows_pins", "taskbar_tray_on", "taskbar_tray_click",
    "taskbar_settings", "taskbar_wifi_scan", "taskbar_wifi_allow", "taskbar_wifi_focus", "taskbar_wifi_connect", "taskbar_wifi_disconnect",
    "taskbar_bt_devices", "taskbar_preview", "taskbar_pin_window", "taskbar_launch_window", "taskbar_reveal", "taskbar_own_pins_keep",
    "display_rescale", "taskbar_input", "taskbar_app_volume", "taskbar_spread", "taskbar_jump_list", "taskbar_jump_open", "taskbar_recent",
    "taskbar_keys", "taskbar_focus", "taskbar_recycle", "taskbar_recycle_do", "taskbar_all_desktops", "taskbar_window_menu", "taskbar_arrange",
    "taskbar_window_order", "taskbar_end_task", "taskbar_decor", "taskbar_decor_images", "taskbar_disks", "taskbar_disk_open",
    "taskbar_disk_scan", "taskbar_disk_scan_stop", "screentime_set", "wallpaper_set", "wallpaper_step", "wallpaper_fit", "wallpaper_folder",
    "wallpaper_pack_download", "wallpaper_pack_remove", "taskbar_desktop_icons", "taskbar_desktop_icons_set", "taskbar_eject", "taskbar_hotspot",
    "taskbar_hotspot_set",
];

/// What the bar may call: its own hit zones, window list and window in front, listing and starting apps, pinning a listed window,
/// a new instance or File Explorer from one (taskbar/ownpins.rs), opening the notch and the settings, the Crest menu, its own
/// glass with the power state that stops it in Energy saver (`status_seed`, read-only), its
/// two ways to reach the notch (taskbar/panel.rs), its widgets' hello and calendar (taskbar/widgets.rs), its slide off the screen
/// (`taskbar_slid`), Windows' Start, its Win+X menu, its quick settings, Task Manager, Search, Task view, its widgets, its
/// input language switcher, Show desktop and the On-Screen Keyboard (`taskbar_shell`), the input language it shows (taskbar/input.rs), an app's volume from its button, some of its
/// settings pages (`taskbar_settings`), the tray's icons with their pictures and clicks, the badges and progress apps report
/// (taskbar/taskband.rs), the quick panel's Wi-Fi page (taskbar/wifi.rs) and its
/// Bluetooth page (taskbar/bluetooth.rs), the window previews over an app's button (taskbar/preview.rs), the jump list of an
/// app's menu and its rows opened, and the Recently opened button's list (taskbar/jumplist.rs), the keyboard after one of its Windows keys (`taskbar_focus`), the Recycle Bin
/// (taskbar/recycle.rs), the drives of its disk space widget, opening one, ejecting one and its Scan now (taskbar/disks.rs), the window and group menus and the previews' order (taskbar/tasks.rs),
/// the desktop's icons and the mobile hotspot of its Windows buttons (taskbar/toggles.rs), the app icons of its Unread widget (`notices_icon`), and what the notch's
/// tools in its panel read or do on a click, the Converter's public rates among them (`portfolio_prices`), and the pinned tools that run
/// there whole: the Depot's accounts (never a key's value), Agents, Colour's picker, the Clipboard's history, Ask's chat, the Launcher's
/// apps, the Recorder (sound only, capture/mod.rs `capture_start`), Screen Time's days (`screentime_days`, never recording or deleting them) and Wallpapers'
/// pictures, folder and download (wallpaper.rs). Its settings reach Rust only through the notch (`taskbar_apply`, `taskbar_auto_hide`,
/// `taskbar_tray_on`, `taskbar_spread`, `taskbar_all_desktops`, `taskbar_end_task`).
const TASKBAR_ALLOWED: &[&str] = &[
    "taskbar_hit_rects", "taskbar_windows", "taskbar_window", "taskbar_icons", "taskbar_release", "launcher_open", "launcher_icons",
    "taskbar_tray", "taskbar_tray_images", "taskbar_tray_click", "taskbar_decor", "taskbar_decor_images",
    "notch_open", "settings_window_open", "autostart_get", "autostart_set", "app_quit", "build_info", "crash_log", "taskbar_front",
    "taskbar_slid", "glass_live_supported", "glass_live_exclude", "glass_live_start", "glass_live_stop", "status_seed",
    "taskbar_panel", "taskbar_ask", "taskbar_hello", "taskbar_calendar", "translate_status", "taskbar_shell", "taskbar_settings",
    "calendar_open_link", "github_open_profile", "leetcode_open_profile", "discord_action", "usage_tokens",
    "notices_open_app", "notices_copy_code", "notices_icon",
    "power_plans", "power_plan_set", "system_icon", "system_ipconfig", "system_battery_report", "reveal_file", "ports_list", "ports_open", "ports_end",
    "convert_probe", "file_preview", "open_path", "copy_files", "shelf_drag_out", "clipboard_paste_files", "shelf_clipboard_text",
    "phone_share_start", "phone_share_stop", "portfolio_prices",
    "media_get", "media_control", "media_open_source", "media_sources", "mixer_list", "volume_get", "mixer_set", "volume_set",
    "lyrics_romanize", "translate_file",
    "audio_outputs", "audio_set_output", "brightness_get", "brightness_set", "focus_get", "focus_set", "quick_get", "quick_radio",
    "quick_dark", "mic_mute", "quick_power", "web_search",
    "taskbar_wifi_scan", "taskbar_wifi_allow", "taskbar_wifi_focus", "taskbar_wifi_connect", "taskbar_wifi_disconnect", "taskbar_bt_devices",
    "taskbar_preview", "taskbar_pin_window", "taskbar_launch_window", "taskbar_reveal", "taskbar_input", "taskbar_app_volume",
    "taskbar_jump_list", "taskbar_jump_open", "taskbar_recent", "taskbar_focus", "taskbar_recycle", "taskbar_recycle_do", "taskbar_window_menu", "taskbar_arrange",
    "taskbar_window_order", "taskbar_disks", "taskbar_disk_open", "taskbar_disk_scan", "taskbar_disk_scan_stop", "taskbar_eject",
    "taskbar_desktop_icons", "taskbar_desktop_icons_set", "taskbar_hotspot", "taskbar_hotspot_set",
    "secret_has", "portfolio_fetch", "portfolio_record", "agents_list", "colour_pick",
    "clipboard_list", "clipboard_copy", "clipboard_paste", "clipboard_preview", "clipboard_text", "clipboard_delete", "clipboard_clear",
    "ai_chat", "ai_cancel", "launcher_apps", "launcher_add_file",
    "capture_list", "capture_details", "capture_start", "capture_stop", "capture_pause", "capture_state", "capture_delete",
    "screentime_days", "wallpaper_current", "wallpaper_list", "wallpaper_set", "wallpaper_step", "wallpaper_fit", "wallpaper_folder",
    "wallpaper_pack_download", "wallpaper_pack_remove",
];

/// The notch window may call every command; the settings, timer, mirror and bar windows only what they need. Tauri lets every
/// local window call every app command (the capabilities only cover plugins and core), so a bug in one of them would
/// otherwise reach the vault or the terminal.
fn command_allowed(window: &str, command: &str) -> bool {
    match window {
        "notch" => true,
        "settings" => !SETTINGS_DENIED.contains(&command),
        "timer" => command == "timer_window_close",
        w if w.starts_with("mirror-") => command == "mirror_picture",
        w if w == "taskbar" || w.starts_with("taskbar-") => TASKBAR_ALLOWED.contains(&command),
        _ => false,
    }
}

/// What a close asked from outside Crest (WM_CLOSE, Alt+F4) does to a window.
#[derive(Debug, PartialEq)]
enum CloseAction {
    /// Crest quits as with Quit: only the notch applies the bar's settings, so Crest without it is half alive.
    Quit,
    /// A bar goes only through Off, which gives Windows' taskbar back.
    Ignore,
    Close,
}

fn close_action(label: &str) -> CloseAction {
    match label {
        "notch" => CloseAction::Quit,
        l if l == "taskbar" || l.starts_with("taskbar-") => CloseAction::Ignore,
        _ => CloseAction::Close,
    }
}

/// Opens a web or store link, or a file, in its default handler. Not through Explorer: it reads an address with `?a=1&b=2`
/// or a file name with a comma as something else and opens Documents instead.
pub(crate) fn open_url(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::core::{w, HSTRING, PCWSTR};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        // Above 32 is success (the old HINSTANCE convention).
        let ok = unsafe { ShellExecuteW(None, w!("open"), &HSTRING::from(url), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) }.0 as isize > 32;
        if ok { Ok(()) } else { Err("open-failed".into()) }
    }
    #[cfg(not(windows))]
    opener().arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Opens files and folders: Explorer on Windows, by its full path, since a bare "explorer" is looked up next
/// to crest.exe first, and a portable copy's folder may be one other users can write to. `open` on a Mac.
pub(crate) fn opener() -> std::process::Command {
    if cfg!(windows) {
        let root = std::env::var_os("SystemRoot").unwrap_or_else(|| r"C:\Windows".into());
        std::process::Command::new(std::path::Path::new(&root).join("explorer.exe"))
    } else {
        std::process::Command::new("open")
    }
}

/// For main.rs: elevated "Unlock FPS" call (see fps::fps_unlock).
#[cfg(windows)]
pub fn fps_elevated_unlock(sid: &str) -> i32 {
    fps::elevated_unlock(sid)
}

/// For main.rs: the process that puts the Windows volume and brightness indicator back after Crest (see osd.rs).
#[cfg(windows)]
pub fn osd_guard(pid: &str) -> i32 {
    osd::guard(pid)
}

/// For main.rs: the installer and the uninstaller put the Windows volume and brightness indicator back before they close Crest and its guard (see osd.rs).
#[cfg(windows)]
pub fn restore_osd() {
    osd::restore()
}

/// For main.rs: the process that gives Windows' taskbar back after Crest (see taskbar/explorer.rs).
#[cfg(windows)]
pub fn taskbar_guard(pid: &str) -> i32 {
    taskbar::explorer::guard(pid)
}

/// For main.rs: the uninstaller gives Windows' taskbar back before it closes Crest and its guard (see taskbar/explorer.rs).
#[cfg(windows)]
pub fn restore_taskbar() {
    taskbar::explorer::restore();
    // No Explorer restart: Crest still runs and holds the keys; Windows has them again from the next sign-in.
    taskbar::keys::restore_value();
}

/// For main.rs: the uninstaller gives back the Windows banners Crest turned off (see banners.rs).
#[cfg(windows)]
pub fn restore_banners() {
    banners::restore()
}

pub fn run() {
    let builder = tauri::Builder::default()
        // A second launch doesn't open a second notch; it opens the settings of this one.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| shell::second_launch(app)));
    // The Store build starts with Windows through its package (startup.rs) and only the Store may update it.
    #[cfg(not(feature = "store"))]
    let builder = builder
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, None))
        // Updates: signed installers from GitHub, only on click in the settings.
        .plugin(tauri_plugin_updater::Builder::new().build());
    #[cfg(windows)]
    let builder = builder
        .manage(mixer::MixerState::default())
        .manage(system::SystemState::default())
        .manage(mirror::MirrorState::default())
        .manage(discord::DiscordState::default())
        .manage(vault::VaultState::default())
        .manage(terminal::TerminalState::default())
        .manage(launcher::LauncherState::default())
        .manage(notices::NoticesState::default())
        .manage(capture::CaptureState::default());
    builder
        .plugin(tauri_plugin_process::init())
        // Shortcuts are set in the settings (shell.rs).
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(shell::on_shortcut).build())
        .manage(shell::Hotkeys::default())
        .manage(hit_test::HitState::default())
        .manage(media::MediaState::default())
        .manage(clipboard::ClipboardState::default())
        .manage(FocusState::default())
        .manage(TrayItems::default())
        .manage(audio::AudioState::default())
        .manage(ai::AiState::default())
        .manage(trading::TradingState::default())
        .manage(usage::UsageState::default())
        .manage(display::DisplayState::default())
        .manage(github::GithubState::default())
        .manage(leetcode::LeetcodeState::default())
        .manage(calendar::CalendarState::default())
        .manage(plugins::PluginsState::default())
        // Plugin pages, each only from its own folder (plugins.rs).
        .register_asynchronous_uri_scheme_protocol(plugins::SCHEME, |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            let webview = ctx.webview_label().to_string();
            tauri::async_runtime::spawn_blocking(move || responder.respond(plugins::protocol(&app, &webview, &request)));
        })
        .invoke_handler({
            let commands: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
            hit_test::set_hit_rect,
            hit_test::set_pet_rect,
            hit_test::set_pinned,
            hit_test::set_passthrough,
            idle::idle_seconds,
            screentime::screentime_set,
            screentime::screentime_days,
            screentime::screentime_clear,
            media::media_get,
            media::media_control,
            media::media_pin,
            media::media_sources,
            media::media_lyrics,
            #[cfg(windows)]
            memory::memory_low,
            clipboard::clipboard_list,
            clipboard::clipboard_mode,
            clipboard::clipboard_copy,
            clipboard::clipboard_paste,
            clipboard::clipboard_delete,
            clipboard::clipboard_clear,
            clipboard::clipboard_preview,
            clipboard::clipboard_paste_files,
            clipboard::clipboard_text,
            keyboard_focus,
            audio::audio_levels,
            ai::ai_chat,
            ai::ai_cancel,
            secrets::secret_set,
            secrets::secret_has,
            trading::portfolio_fetch,
            trading::portfolio_prices,
            trading::portfolio_coin,
            trading::portfolio_record,
            trading::portfolio_forget,
            usage::usage_fetch,
            usage::usage_tokens,
            #[cfg(windows)]
            system::system_stats,
            #[cfg(windows)]
            sysevents::status_seed,
            #[cfg(windows)]
            sysevents::status_configure,
            #[cfg(windows)]
            sysevents::status_bar,
            #[cfg(windows)]
            system::system_icon,
            #[cfg(windows)]
            system::system_ipconfig,
            #[cfg(windows)]
            system::system_battery_report,
            convert::convert_probe,
            convert::reveal_file,
            convert::open_path,
            convert::copy_files,
            convert::file_preview,
            downloads::downloads_configure,
            display::display_monitors,
            display::display_apply,
            display::display_rescale,
            display::display_screen,
            display::display_fullscreen,
            display::display_raise,
            display::display_alert,
            display::display_apps,
            #[cfg(windows)]
            mirror::display_cursor_monitor,
            #[cfg(windows)]
            mirror::mirror_picture,
            #[cfg(windows)]
            mirror::mirror_picture_set,
            shell::hotkeys_apply,
            shell::crash_log,
            #[cfg(windows)]
            fps::gaming_fps,
            #[cfg(windows)]
            fps::fps_unlock,
            #[cfg(windows)]
            controls::volume_get,
            #[cfg(windows)]
            controls::volume_set,
            #[cfg(windows)]
            controls::audio_outputs,
            #[cfg(windows)]
            controls::audio_set_output,
            #[cfg(windows)]
            mixer::mixer_list,
            #[cfg(windows)]
            mixer::mixer_set,
            #[cfg(windows)]
            mixer::media_open_source,
            tray_texts,
            #[cfg(windows)]
            controls::focus_get,
            #[cfg(windows)]
            controls::focus_set,
            #[cfg(windows)]
            power::keep_awake_set,
            #[cfg(windows)]
            power::power_plans,
            #[cfg(windows)]
            power::power_plan_set,
            #[cfg(windows)]
            privacy::privacy_state,
            #[cfg(windows)]
            discord::discord_configure,
            #[cfg(windows)]
            discord::discord_action,
            #[cfg(windows)]
            discord::discord_state,
            #[cfg(windows)]
            vault::vault_status,
            #[cfg(windows)]
            vault::vault_setup,
            #[cfg(windows)]
            vault::vault_unlock,
            #[cfg(windows)]
            vault::vault_lock,
            #[cfg(windows)]
            vault::vault_save_password,
            #[cfg(windows)]
            vault::vault_add_totp,
            #[cfg(windows)]
            vault::vault_delete,
            #[cfg(windows)]
            vault::vault_reveal,
            #[cfg(windows)]
            vault::vault_copy,
            #[cfg(windows)]
            vault::vault_copy_text,
            #[cfg(windows)]
            vault::vault_codes,
            #[cfg(windows)]
            vault::vault_options,
            #[cfg(windows)]
            vault::vault_change_pin,
            #[cfg(windows)]
            vault::vault_reset,
            #[cfg(windows)]
            vault::vault_scan,
            #[cfg(windows)]
            vault::vault_hello_supported,
            #[cfg(windows)]
            vault::vault_hello_unlock,
            #[cfg(windows)]
            vault::vault_hello_enable,
            #[cfg(windows)]
            vault::vault_hello_disable,
            autostart_get,
            autostart_set,
            app_quit,
            build_info,
            diagnostics_info,
            open_sponsors,
            open_store_review,
            web_search,
            open_bug_report,
            #[cfg(windows)]
            brightness::brightness_get,
            #[cfg(windows)]
            brightness::brightness_set,
            #[cfg(target_os = "macos")]
            macos::brightness::brightness_get,
            #[cfg(target_os = "macos")]
            macos::brightness::brightness_set,
            #[cfg(windows)]
            quick::quick_get,
            #[cfg(windows)]
            quick::quick_radio,
            #[cfg(windows)]
            quick::quick_dark,
            #[cfg(windows)]
            quick::quick_power,
            #[cfg(target_os = "macos")]
            macos::quick::quick_get,
            #[cfg(target_os = "macos")]
            macos::quick::quick_radio,
            #[cfg(target_os = "macos")]
            macos::quick::quick_dark,
            #[cfg(target_os = "macos")]
            macos::quick::quick_power,
            #[cfg(target_os = "macos")]
            macos::memory_low,
            #[cfg(target_os = "macos")]
            macos::status_configure,
            #[cfg(target_os = "macos")]
            macos::privacy_state,
            translate::translate_status,
            translate::translate_download,
            translate::translate_remove,
            translate::translate_file,
            phone_share::phone_share_start,
            phone_share::phone_share_stop,
            timer_window::timer_window_open,
            timer_window::timer_window_close,
            settings_window::settings_window_open,
            settings_window::settings_window_section,
            settings_window::settings_window_background,
            shell::notch_open,
            #[cfg(windows)]
            banners::notices_banners,
            #[cfg(windows)]
            banners::notices_sounds,
            #[cfg(windows)]
            notice_sound::notices_sound_pick,
            #[cfg(windows)]
            notice_sound::notices_sound_read,
            #[cfg(windows)]
            shelf::shelf_drag_out,
            #[cfg(windows)]
            shelf::shelf_clipboard_text,
            #[cfg(windows)]
            terminal::terminal_info,
            #[cfg(windows)]
            terminal::terminal_start,
            #[cfg(windows)]
            terminal::terminal_write,
            #[cfg(windows)]
            terminal::terminal_resize,
            #[cfg(windows)]
            terminal::terminal_kill,
            #[cfg(windows)]
            terminal::terminal_clipboard_text,
            themes::themes_folder,
            themes::themes_read,
            themes::themes_write,
            accent::system_accent,
            #[cfg(windows)]
            launcher::launcher_apps,
            #[cfg(windows)]
            launcher::launcher_icons,
            #[cfg(windows)]
            launcher::launcher_open,
            #[cfg(windows)]
            launcher::launcher_shortcuts,
            #[cfg(windows)]
            taskbar::bar::taskbar_apply,
            #[cfg(windows)]
            taskbar::bar::taskbar_hit_rects,
            #[cfg(windows)]
            taskbar::bar::taskbar_slid,
            #[cfg(windows)]
            taskbar::tasks::taskbar_windows,
            #[cfg(windows)]
            taskbar::tasks::taskbar_window,
            #[cfg(windows)]
            taskbar::tasks::taskbar_icons,
            #[cfg(windows)]
            taskbar::jumplist::taskbar_jump_list,
            #[cfg(windows)]
            taskbar::jumplist::taskbar_jump_open,
            #[cfg(windows)]
            taskbar::jumplist::taskbar_recent,
            #[cfg(windows)]
            taskbar::recycle::taskbar_recycle,
            #[cfg(windows)]
            taskbar::recycle::taskbar_recycle_do,
            #[cfg(windows)]
            taskbar::disks::taskbar_disks,
            #[cfg(windows)]
            taskbar::disks::taskbar_disk_open,
            #[cfg(windows)]
            taskbar::disks::taskbar_disk_scan,
            #[cfg(windows)]
            taskbar::disks::taskbar_disk_scan_stop,
            #[cfg(windows)]
            taskbar::disks::taskbar_eject,
            #[cfg(windows)]
            taskbar::toggles::taskbar_desktop_icons,
            #[cfg(windows)]
            taskbar::toggles::taskbar_desktop_icons_set,
            #[cfg(windows)]
            taskbar::toggles::taskbar_hotspot,
            #[cfg(windows)]
            taskbar::toggles::taskbar_hotspot_set,
            #[cfg(windows)]
            taskbar::tasks::taskbar_all_desktops,
            #[cfg(windows)]
            taskbar::tasks::taskbar_end_task,
            #[cfg(windows)]
            taskbar::tasks::taskbar_window_menu,
            #[cfg(windows)]
            taskbar::tasks::taskbar_arrange,
            #[cfg(windows)]
            taskbar::tasks::taskbar_window_order,
            #[cfg(windows)]
            taskbar::tasks::taskbar_release,
            #[cfg(windows)]
            taskbar::bar::taskbar_focus,
            #[cfg(windows)]
            taskbar::keys::taskbar_keys,
            #[cfg(windows)]
            taskbar::keys::taskbar_keys_status,
            #[cfg(windows)]
            taskbar::start::taskbar_shell,
            #[cfg(windows)]
            taskbar::preview::taskbar_preview,
            #[cfg(windows)]
            taskbar::panel::taskbar_panel,
            #[cfg(windows)]
            taskbar::panel::taskbar_ask,
            #[cfg(windows)]
            taskbar::widgets::taskbar_hello,
            #[cfg(windows)]
            taskbar::widgets::taskbar_calendar,
            #[cfg(windows)]
            taskbar::widgets::taskbar_settings,
            #[cfg(windows)]
            taskbar::wifi::taskbar_wifi_scan,
            #[cfg(windows)]
            taskbar::wifi::taskbar_wifi_allow,
            #[cfg(windows)]
            taskbar::wifi::taskbar_wifi_focus,
            #[cfg(windows)]
            taskbar::wifi::taskbar_wifi_connect,
            #[cfg(windows)]
            taskbar::wifi::taskbar_wifi_disconnect,
            #[cfg(windows)]
            taskbar::bluetooth::taskbar_bt_devices,
            #[cfg(windows)]
            taskbar::pins::taskbar_import_pins,
            #[cfg(windows)]
            taskbar::pins::taskbar_windows_pins,
            #[cfg(windows)]
            taskbar::ownpins::taskbar_pin_window,
            #[cfg(windows)]
            taskbar::ownpins::taskbar_launch_window,
            #[cfg(windows)]
            taskbar::ownpins::taskbar_reveal,
            #[cfg(windows)]
            taskbar::ownpins::taskbar_own_pins_keep,
            #[cfg(windows)]
            taskbar::ownpins::launcher_add_file,
            #[cfg(windows)]
            taskbar::front::taskbar_auto_hide,
            #[cfg(windows)]
            taskbar::front::taskbar_front,
            #[cfg(windows)]
            taskbar::front::taskbar_slide_blocked,
            #[cfg(windows)]
            taskbar::reserve::taskbar_reserve_reachable,
            #[cfg(windows)]
            taskbar::tray::taskbar_tray_on,
            #[cfg(windows)]
            taskbar::tray::taskbar_tray,
            #[cfg(windows)]
            taskbar::tray::taskbar_tray_images,
            #[cfg(windows)]
            taskbar::tray::taskbar_tray_click,
            #[cfg(windows)]
            taskbar::taskband::taskbar_decor,
            #[cfg(windows)]
            taskbar::taskband::taskbar_decor_images,
            #[cfg(windows)]
            taskbar::input::taskbar_input,
            #[cfg(windows)]
            taskbar::tasks::taskbar_app_volume,
            #[cfg(windows)]
            taskbar::screens::taskbar_spread,
            github::github_contributions,
            github::github_open_profile,
            leetcode::leetcode_stats,
            leetcode::leetcode_open_profile,
            calendar::calendar_fetch,
            calendar::calendar_open_link,
            lyrics::lyrics_fetch,
            romanize::lyrics_romanize,
            romanize::lyrics_dict_status,
            romanize::lyrics_dict_download,
            romanize::lyrics_dict_remove,
            #[cfg(windows)]
            notices::notices_configure,
            #[cfg(windows)]
            notices::notices_status,
            #[cfg(windows)]
            notices::notices_request_access,
            #[cfg(windows)]
            notices::notices_answer,
            #[cfg(windows)]
            notices::notices_remove_windows,
            #[cfg(windows)]
            notices::notices_open_app,
            #[cfg(windows)]
            notices::notices_icon,
            #[cfg(windows)]
            notices::notices_copy_code,
            backup::backup_save,
            backup::backup_open,
            plugins::plugins_list,
            plugins::plugins_pick,
            plugins::plugins_stage,
            plugins::plugins_commit,
            plugins::plugins_discard,
            plugins::plugins_remove,
            plugins::plugins_storage,
            plugins::plugins_fetch,
            portable::portable_info,
            portable::portable_check,
            portable::portable_install,
            ports::ports_list,
            ports::ports_end,
            ports::ports_open,
            #[cfg(windows)]
            capture::capture_sources,
            #[cfg(windows)]
            capture::capture_shot,
            #[cfg(windows)]
            capture::capture_state,
            #[cfg(windows)]
            capture::capture_start,
            #[cfg(windows)]
            capture::capture_pause,
            #[cfg(windows)]
            capture::capture_stop,
            #[cfg(windows)]
            capture::capture_list,
            #[cfg(windows)]
            capture::capture_details,
            #[cfg(windows)]
            capture::capture_delete,
            #[cfg(windows)]
            capture::find::find_scan,
            #[cfg(windows)]
            capture::find::find_highlight,
            #[cfg(windows)]
            capture::eyedropper::colour_pick,
            #[cfg(windows)]
            capture::backdrop::glass_backdrop,
            #[cfg(windows)]
            capture::glass_live::glass_live_supported,
            #[cfg(windows)]
            capture::glass_live::glass_live_exclude,
            #[cfg(windows)]
            capture::glass_live::glass_live_start,
            #[cfg(windows)]
            capture::glass_live::glass_live_stop,
            #[cfg(target_os = "macos")]
            macos::glass_live_supported,
            #[cfg(target_os = "macos")]
            macos::glass_live_exclude,
            #[cfg(target_os = "macos")]
            macos::glass_live_start,
            #[cfg(target_os = "macos")]
            macos::glass_live_stop,
            #[cfg(target_os = "macos")]
            macos::colour::colour_pick,
            wallpaper::wallpaper_current,
            wallpaper::wallpaper_list,
            wallpaper::wallpaper_set,
            wallpaper::wallpaper_step,
            wallpaper::wallpaper_fit,
            wallpaper::wallpaper_folder,
            wallpaper::wallpaper_pack_download,
            wallpaper::wallpaper_pack_remove,
            agents::agents_list,
            mic::mic_mute,
            sharing::sharing_hide,
            ];
            move |invoke| {
                if !command_allowed(invoke.message.webview_ref().label(), invoke.message.command()) {
                    invoke.resolver.reject("not-allowed");
                    return true;
                }
                commands(invoke)
            }
        })
        // Tauri quits only once its last window is gone: a notch closed beside the bar or the settings left Crest running without it.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                match close_action(window.label()) {
                    CloseAction::Quit => {
                        api.prevent_close();
                        #[cfg(windows)]
                        on_exit(window.app_handle());
                        window.app_handle().exit(0);
                        // A close of every window (taskkill without /F) can destroy tao's hidden event target after the exit
                        // request was posted to it, and RunEvent::Exit never comes. on_exit already gave everything back, so end
                        // the process if the orderly exit has not, later than a recording's stop can take there (up to 10 s).
                        #[cfg(windows)]
                        std::thread::spawn(|| {
                            std::thread::sleep(std::time::Duration::from_secs(15));
                            std::process::exit(0);
                        });
                    }
                    CloseAction::Ignore => api.prevent_close(),
                    CloseAction::Close => {}
                }
            }
        })
        .setup(move |app| {
            // A menu bar app: no Dock icon, like skipTaskbar on Windows.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);
            shell::init(app);
            let window = portable::create_window(app)?;
            // Setup runs on the main thread, so this is in place before the first show.
            #[cfg(windows)]
            display::keep_out_of_alt_tab(&window);
            display::place(&window, &app.state::<display::DisplayState>())?;
            window.show()?;
            #[cfg(target_os = "macos")]
            macos::raise(&window);
            // Only after show(): this fails on a window that was never shown.
            window.set_ignore_cursor_events(true)?;
            #[cfg(windows)]
            drop::install(&window);
            #[cfg(windows)]
            camera::install(&window);
            hit_test::spawn(app.handle().clone(), window.clone());
            #[cfg(windows)]
            display::spawn(app.handle().clone(), window);
            mirror::spawn(app.handle().clone());
            media::spawn(app.handle().clone());
            clipboard::spawn(app.handle().clone());
            audio::spawn(app.handle().clone(), &app.state::<audio::AudioState>());
            #[cfg(windows)]
            sysevents::spawn(app.handle().clone());
            #[cfg(windows)]
            brightness::spawn(app.handle().clone());
            accent::watch(app.handle().clone());
            // A run that ended without restoring the Windows indicator (and whose guard was ended with it) is cleaned up here.
            #[cfg(windows)]
            osd::restore();
            // The same for Windows' taskbar, on its own thread (SHAppBarMessage waits on Explorer); it never runs after the
            // bar's first hide, which runs it first when it comes earlier.
            #[cfg(windows)]
            std::thread::spawn(taskbar::explorer::restore_at_start);
            // The bar's own pins, for a launch or the settings window's icons while the bar is off.
            #[cfg(windows)]
            taskbar::ownpins::load(app.handle());

            enable_autostart_once(app.handle());
            build_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Crest")
        .run(|app, event| {
            // tao turns WM_ENDSESSION(TRUE) into RunEvent::Exit, so this also runs at sign-out, Store updates and the installer's
            // Restart Manager close.
            if let tauri::RunEvent::Exit = event {
                #[cfg(windows)]
                on_exit(app);
                #[cfg(not(windows))]
                usage::save_tokens(app);
            }
        });
}

/// What Crest gives back as it quits (`RunEvent::Exit`). The notch's close runs it before it asks for the exit, which travels
/// through tao's hidden window: a close sent to every window of the process (taskkill without /F) destroys that one too, and
/// the exit with it. A second run finds nothing left to do.
#[cfg(windows)]
fn on_exit(app: &AppHandle) {
    // First, before a recording's finish can wait 5 s.
    taskbar::shutdown();
    taskbar::keys::on_exit(app);
    // A recording still running when Crest quits is finished, so the file is complete.
    capture::finish_on_exit(app);
    osd::set(false, false);
    power::keep_awake_stop();
    // Nothing pops notices up once Crest is gone; the next start hides the banners again.
    banners::restore();
    vault::clear_on_exit();
    // Last, after what shows on screen: on a busy PC this writes some MB.
    usage::save_tokens(app);
}

/// Window that was in the foreground before the shortcut opened the notch.
#[derive(Default)]
struct FocusState(Mutex<isize>);

/// Opened via shortcut → take focus (for Esc/typing).
/// Closed → give focus back to the previous app, otherwise typing goes nowhere.
#[cfg(windows)]
#[tauri::command]
fn keyboard_focus(focus: bool, window: WebviewWindow, state: State<'_, FocusState>) {
    let Ok(own) = window.hwnd() else { return };
    let own = own.0 as isize;
    let foreground = unsafe { GetForegroundWindow() }.0 as isize;
    let mut previous = state.0.lock().unwrap();

    if focus {
        if foreground != own {
            *previous = foreground;
        }
        let _ = window.set_focus();
        return;
    }
    if foreground == own && *previous != 0 {
        let _ = unsafe { SetForegroundWindow(HWND(*previous as *mut _)) };
        *previous = 0;
    }
    // Sent when the notch closes: a "hide" rule takes over again.
    display::closed(window.app_handle());
}

/// The same on a Mac, with the frontmost app's process id in place of the foreground window.
#[cfg(target_os = "macos")]
#[tauri::command]
fn keyboard_focus(focus: bool, window: WebviewWindow, state: State<'_, FocusState>) {
    let own = std::process::id() as isize;
    let foreground = macos::frontmost_pid() as isize;
    let mut previous = state.0.lock().unwrap();

    if focus {
        if foreground != own {
            *previous = foreground;
        } else if settings_window::focused() {
            *previous = SETTINGS_KEYBOARD;
        }
        let _ = window.set_focus();
        return;
    }
    if foreground == own {
        match std::mem::take(&mut *previous) {
            0 => {}
            SETTINGS_KEYBOARD => {
                if let Some(settings) = window.get_webview_window("settings") {
                    let _ = settings.set_focus();
                }
            }
            pid => {
                macos::activate_pid(pid as i32);
            }
        }
    }
    display::closed(window.app_handle());
}

/// On a Mac, FocusState's value when Crest's own settings window had the keyboard (a process id cannot name a window).
#[cfg(target_os = "macos")]
const SETTINGS_KEYBOARD: isize = -1;

/// A paste from the clipboard history (clipboard.rs): gives the keyboard back to the app that had it before the notch
/// opened, as closing the notch does. Returns that app's window, or None when there is none (0, or closed since).
#[cfg(windows)]
pub(crate) fn return_keyboard(app: &AppHandle) -> Option<isize> {
    let previous = std::mem::take(&mut *app.state::<FocusState>().0.lock().unwrap());
    let window = HWND(previous as *mut _);
    (previous != 0 && unsafe { IsWindow(Some(window)) }.as_bool() && unsafe { SetForegroundWindow(window) }.as_bool()).then_some(previous)
}

/// The same on a Mac, with the app's process id.
#[cfg(target_os = "macos")]
pub(crate) fn return_keyboard(app: &AppHandle) -> Option<isize> {
    let previous = std::mem::take(&mut *app.state::<FocusState>().0.lock().unwrap());
    (previous > 0 && macos::activate_pid(previous as i32)).then_some(previous)
}

/// The settings window opens: the notch closing behind it must not give the keyboard to the app it had before.
pub(crate) fn forget_focus(app: &AppHandle) {
    *app.state::<FocusState>().0.lock().unwrap() = 0;
}

/// The pointer came onto the notch or the pet: a click there activates the window, so note the app it takes the keyboard
/// from; closing the notch gives it back (keyboard_focus) and a paste goes there. By process: `hwnd()` waits for the main
/// thread, which the poll in hit_test.rs must not do. Crest's own settings window counts as an app here; the notch itself
/// keeps the app noted before it.
#[cfg(windows)]
fn remember_foreground(window: &WebviewWindow) {
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    let foreground = unsafe { GetForegroundWindow() };
    let mut pid = 0;
    unsafe { GetWindowThreadProcessId(foreground, Some(&mut pid)) };
    if pid != 0 && (pid != std::process::id() || settings_window::focused()) {
        *window.state::<FocusState>().0.lock().unwrap() = foreground.0 as isize;
    }
}

#[cfg(target_os = "macos")]
fn remember_foreground(window: &WebviewWindow) {
    let foreground = macos::frontmost_pid() as isize;
    let state = window.state::<FocusState>();
    let mut previous = state.0.lock().unwrap();
    if foreground != std::process::id() as isize {
        *previous = foreground;
    } else if settings_window::focused() {
        *previous = SETTINGS_KEYBOARD;
    }
}

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    startup::is_enabled(&app)
}

#[tauri::command]
fn autostart_set(enabled: bool, app: AppHandle, state: State<'_, TrayItems>) -> Result<(), String> {
    let result = startup::set(&app, enabled);
    // The tray check shows the real state, also when the switch was refused.
    if let Some(tray) = state.0.lock().unwrap().as_ref() {
        let _ = tray.autostart.set_checked(startup::is_enabled(&app));
    }
    result
}

/// The Crest menu's Quit, on the bar.
#[tauri::command]
fn app_quit(app: AppHandle) {
    app.exit(0)
}

/// Which build runs: the Microsoft Store one leaves updates to the Store. `taskbar`: the build offers Crest's taskbar, every
/// Windows build but the Store one, which never turns the bar on (taskbar/bar.rs).
#[tauri::command]
fn build_info() -> serde_json::Value {
    serde_json::json!({ "store": cfg!(feature = "store"), "taskbar": cfg!(windows) && !cfg!(feature = "store") })
}

/// For Copy diagnostics (Settings, General): Windows edition and build, the architecture of this build and of the PC
/// (an x64 build on an ARM PC runs emulated), each monitor's scale and Windows' Text size. Nothing about the user, the PC's name or a path.
#[tauri::command]
fn diagnostics_info(window: tauri::WebviewWindow) -> serde_json::Value {
    let scales: Vec<f64> = window.available_monitors().unwrap_or_default().iter().map(|m| m.scale_factor()).collect();
    serde_json::json!({
        "os": sysinfo::System::long_os_version(),
        "build": sysinfo::System::kernel_version(),
        "arch": std::env::consts::ARCH,
        "machine": native_machine(),
        "scales": scales,
        "textScale": text_scale::get(),
    })
}

/// The PC's own architecture, which GetSystemInfo hides from an emulated process.
#[cfg(windows)]
pub(crate) fn native_machine() -> Option<&'static str> {
    use windows::Win32::System::SystemInformation::{IMAGE_FILE_MACHINE, IMAGE_FILE_MACHINE_AMD64, IMAGE_FILE_MACHINE_ARM64};
    use windows::Win32::System::Threading::{GetCurrentProcess, IsWow64Process2};
    let (mut process, mut native) = (IMAGE_FILE_MACHINE::default(), IMAGE_FILE_MACHINE::default());
    unsafe { IsWow64Process2(GetCurrentProcess(), &mut process, Some(&mut native)) }.ok()?;
    match native {
        IMAGE_FILE_MACHINE_AMD64 => Some("x86_64"),
        IMAGE_FILE_MACHINE_ARM64 => Some("aarch64"),
        _ => Some("other"),
    }
}

/// Not read on a Mac yet (a Rosetta process would need sysctl.proc_translated).
#[cfg(not(windows))]
fn native_machine() -> Option<&'static str> {
    None
}

/// Opens the GitHub Sponsors page in the default browser. The address is fixed here, so the interface cannot open anything else.
#[tauri::command]
fn open_sponsors() -> Result<(), String> {
    open_url("https://github.com/sponsors/andrealo20")
}

/// The bug report form on GitHub, with this version already filled in (issue forms take field ids as query parameters).
#[tauri::command]
fn open_bug_report() -> Result<(), String> {
    let url = concat!("https://github.com/andrealo20/crest/issues/new?template=bug_report.yml&version=", env!("CARGO_PKG_VERSION"));
    open_url(url)
}

/// Crest's rating page in the Microsoft Store app; the buttons that call it show in the Store build only.
#[tauri::command]
fn open_store_review() -> Result<(), String> {
    open_url("ms-windows-store://review/?ProductId=9N2KXJ2924KS")
}

/// The search engines of Overview's search line, by the id the settings save.
const SEARCH_ENGINES: [(&str, &str); 4] = [
    ("google", "https://www.google.com/search"),
    ("bing", "https://www.bing.com/search"),
    ("duckduckgo", "https://duckduckgo.com/"),
    ("brave", "https://search.brave.com/search"),
];

/// The results page for `query` on `engine`; None for an unknown engine or an empty or very long query.
fn search_url(engine: &str, query: &str) -> Option<String> {
    let query = query.trim();
    if query.is_empty() || query.chars().count() > 2000 {
        return None;
    }
    let (_, base) = SEARCH_ENGINES.iter().find(|(id, _)| *id == engine)?;
    reqwest::Url::parse_with_params(base, &[("q", query)]).ok().map(String::from)
}

/// Overview's search line: the results in the default browser. The addresses are fixed here, so the interface opens nothing else.
#[tauri::command]
fn web_search(engine: String, query: String) -> Result<(), String> {
    open_url(&search_url(&engine, &query).ok_or("bad-search")?)
}

/// Enables autostart on the very first launch; after that the tray check and settings decide.
fn enable_autostart_once(app: &AppHandle) {
    // A portable copy writes nothing outside its folder unless asked to (tray or settings); in the Store build the user turns it on.
    if portable::is_portable() || cfg!(feature = "store") {
        return;
    }
    // The login item stores the running binary's path: one run from a dmg or Downloads would leave it dead after the move.
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").map(|h| std::path::Path::new(&h).join("Applications"));
        let installed = std::env::current_exe()
            .is_ok_and(|p| p.starts_with("/Applications") || home.is_some_and(|h| p.starts_with(h)));
        if !installed {
            return;
        }
    }
    let Ok(dir) = crate::portable::app_data_dir(app) else { return };
    let marker = dir.join("autostart-initialized");
    if marker.exists() {
        return;
    }
    if startup::set(app, true).is_ok() {
        let _ = std::fs::create_dir_all(&dir);
        let _ = std::fs::write(marker, "");
    }
}

/// The tray items whose check state or text changes at runtime ("Open Crest" lives in shell.rs with its shortcut).
#[derive(Default)]
struct TrayItems(Mutex<Option<Tray>>);

struct Tray {
    settings: MenuItem<tauri::Wry>,
    autostart: CheckMenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
}

#[derive(serde::Deserialize)]
struct TrayTexts {
    open: String,
    settings: String,
    autostart: String,
    quit: String,
}

/// The menu in the interface language, sent by the frontend with every language change; English until then.
#[tauri::command]
fn tray_texts(texts: TrayTexts, app: AppHandle, state: State<'_, TrayItems>) {
    if let Some(tray) = state.0.lock().unwrap().as_ref() {
        let _ = tray.settings.set_text(texts.settings);
        let _ = tray.autostart.set_text(texts.autostart);
        let _ = tray.quit.set_text(texts.quit);
    }
    shell::set_open_text(&app, texts.open);
}

/// Dark tray menu to match the notch instead of the light default.
/// uxtheme only exports this by ordinal: SetPreferredAppMode = 135, FlushMenuThemes = 136
/// (Windows 10 1903+). If missing, the menu just stays light.
#[cfg(windows)]
fn dark_menus() {
    use windows::core::{w, PCSTR};
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryW};
    const FORCE_DARK: i32 = 2;
    unsafe {
        let Ok(uxtheme) = LoadLibraryW(w!("uxtheme.dll")) else { return };
        if let Some(f) = GetProcAddress(uxtheme, PCSTR(135 as *const u8)) {
            let set_preferred_app_mode: extern "system" fn(i32) -> i32 = std::mem::transmute(f);
            set_preferred_app_mode(FORCE_DARK);
        }
        if let Some(f) = GetProcAddress(uxtheme, PCSTR(136 as *const u8)) {
            let flush_menu_themes: extern "system" fn() = std::mem::transmute(f);
            flush_menu_themes();
        }
    }
}

/// Without a taskbar entry, the tray is where you open, configure and quit.
/// Left click opens the notch, right click shows the menu.
fn build_tray(app: &App) -> tauri::Result<()> {
    #[cfg(windows)]
    dark_menus();
    let enabled = startup::is_enabled(app.handle());
    // Open has its shortcut right-aligned via tab, like Windows menus.
    let open = MenuItem::with_id(app, "open", shell::default_open_label(), true, None::<&str>)?;
    shell::set_tray_open(app, open.clone());
    let settings = MenuItem::with_id(app, "settings", "Settings …", true, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Crest", true, None::<&str>)?;
    *app.state::<TrayItems>().0.lock().unwrap() =
        Some(Tray { settings: settings.clone(), autostart: autostart.clone(), quit: quit.clone() });
    let menu = Menu::with_items(
        app,
        &[&open, &settings, &PredefinedMenuItem::separator(app)?, &autostart, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let autostart_item = autostart.clone();
    TrayIconBuilder::new()
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("Crest")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                shell::open(tray.app_handle(), None);
            }
        })
        .on_menu_event(move |app, event| match event.id().as_ref() {
            "open" => shell::open(app, None),
            "settings" => settings_window::open_settings(app, None),
            "quit" => app.exit(0),
            "autostart" => {
                // The check item toggles itself on click; read the new state.
                let on = autostart_item.is_checked().unwrap_or(false);
                // Windows can refuse (Store build: the user switched it off in Task Manager); the check then shows the real state.
                if startup::set(app, on).is_err() {
                    let _ = autostart_item.set_checked(startup::is_enabled(app));
                }
            }
            _ => {}
        })
        .build(app)?;
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn a_windows_build_outside_the_store_offers_the_taskbar_with_no_file_beside_it() {
        let info = super::build_info();
        assert_eq!(info["taskbar"], serde_json::json!(cfg!(windows) && !cfg!(feature = "store")));
        assert_eq!(info["store"], serde_json::json!(cfg!(feature = "store")));
    }

    #[test]
    fn native_machine_is_known_and_matches_a_native_build() {
        let native = super::native_machine();
        assert!(matches!(native, Some("x86_64" | "aarch64")), "{native:?}");
        // An arm64 build never runs emulated; an x64 one may, on an ARM PC.
        if cfg!(target_arch = "aarch64") {
            assert_eq!(native, Some("aarch64"));
        }
    }

    #[test]
    fn a_close_from_outside_quits_at_the_notch_and_never_takes_a_bar() {
        use super::{close_action, CloseAction::*};
        assert_eq!(close_action("notch"), Quit);
        assert!(["taskbar", "taskbar-1", "taskbar-12"].iter().all(|l| close_action(l) == Ignore));
        assert!(["settings", "timer", "mirror-1"].iter().all(|l| close_action(l) == Close));
    }

    #[test]
    fn only_the_notch_reaches_every_command() {
        use super::command_allowed as ok;
        assert!(ok("notch", "vault_reveal") && ok("notch", "terminal_write"));
        assert!(ok("timer", "timer_window_close") && !ok("timer", "terminal_write") && !ok("timer", "open_path"));
        assert!(ok("mirror-1", "mirror_picture") && !ok("mirror-1", "vault_reveal"));
        assert!(!ok("plugin", "secret_set") && !ok("", "mirror_picture"));
        assert!(ok("settings", "secret_set") && ok("settings", "settings_window_section") && ok("settings", "notch_open"));
        assert!(!ok("settings", "display_apply") && !ok("settings", "keyboard_focus") && !ok("settings", "hotkeys_apply"));
        // Focus mode makes the notch ignore the mouse: only the notch may turn that on.
        assert!(!ok("settings", "set_passthrough"));
        assert!(ok("taskbar", "taskbar_hit_rects") && ok("taskbar", "launcher_open") && ok("taskbar", "app_quit") && ok("taskbar-2", "notch_open"));
        assert!(!ok("taskbar", "taskbar_apply") && !ok("taskbar", "vault_reveal") && !ok("taskbar", "launcher_shortcuts") && !ok("taskbar", "set_hit_rect"));
        assert!(!ok("settings", "taskbar_apply") && !ok("settings", "taskbar_hit_rects") && ok("notch", "taskbar_apply"));
        // Only the notch follows Windows' pins and remembers them.
        assert!(!ok("settings", "taskbar_windows_pins") && ok("notch", "taskbar_windows_pins"));
        assert!(["glass_live_supported", "glass_live_exclude", "glass_live_start", "glass_live_stop"].iter().all(|c| ok("taskbar", c) && ok("taskbar-1", c)));
        assert!(!ok("settings", "glass_live_start") && !ok("timer", "glass_live_exclude"));
        // The bar reads the power state for its glass, but never sets what the status alerts watch.
        assert!(ok("taskbar", "status_seed") && ok("taskbar-1", "status_seed") && !ok("taskbar", "status_configure"));
        assert!(ok("notch", "status_bar") && !ok("taskbar", "status_bar") && !ok("taskbar-1", "status_bar") && !ok("settings", "status_bar"));
        assert!(ok("taskbar", "taskbar_panel") && ok("taskbar", "taskbar_ask") && ok("taskbar-1", "taskbar_panel"));
        // A settings window claiming a bar's panel would keep the notch's sources running.
        assert!(!ok("settings", "taskbar_panel") && !ok("settings", "taskbar_ask") && !ok("timer", "taskbar_ask"));
        // The tools' code reads the installed translation pairs as it loads in the bar (offlineEngine.ts).
        assert!(ok("taskbar", "translate_status"));
        // A click in the bar's Calendar, GitHub, LeetCode or Discord (join, the two profiles, mute, deafen, leave), and the tokens
        // Usage reads from the local logs while a card that shows them is on screen.
        assert!(ok("taskbar", "calendar_open_link") && ok("taskbar", "github_open_profile") && ok("taskbar", "leetcode_open_profile"));
        assert!(ok("taskbar", "discord_action") && ok("taskbar", "usage_tokens"));
        // What those tools show is fetched by the notch alone; the bar's Refresh and Retry ask it (taskbar_ask).
        assert!(!ok("taskbar", "usage_fetch") && !ok("taskbar", "github_contributions") && !ok("taskbar", "leetcode_stats"));
        assert!(!ok("taskbar", "calendar_fetch") && !ok("taskbar", "discord_state"));
        // Usage's renew runs in the notch's terminal: the bar never starts or types into a shell.
        assert!(!ok("taskbar", "terminal_info") && !ok("taskbar", "terminal_start") && !ok("taskbar", "terminal_write") && !ok("taskbar", "terminal_kill"));
        // A click on a row of the bar's Notices opens its app or copies its code. Deleting one or all asks the notch (taskbar_ask),
        // which holds the history and takes the notices out of Windows' notification centre too.
        assert!(ok("taskbar", "notices_open_app") && ok("taskbar", "notices_copy_code") && !ok("taskbar", "notices_remove_windows"));
        // The detached timer window is the notch's: the bar's Timer shows no button for it.
        assert!(!ok("taskbar", "timer_window_open") && !ok("taskbar", "timer_window_close"));
        // The bar's Hardware reads the power plans as it opens and switches them, asks a process row's icon, shows a process in
        // Explorer, and its ports sheet lists the ports, opens one in the browser and ends the process on one.
        assert!(ok("taskbar", "power_plans") && ok("taskbar", "power_plan_set") && ok("taskbar", "system_icon") && ok("taskbar", "reveal_file"));
        assert!(ok("taskbar", "ports_list") && ok("taskbar", "ports_open") && ok("taskbar", "ports_end"));
        // A click on its local IP opens ipconfig in a Command Prompt, one on the battery's health opens Windows' battery report.
        assert!(ok("taskbar", "system_ipconfig") && ok("taskbar", "system_battery_report"));
        // Its readings come from the notch alone: each call measures the CPU since the one before, and a call without the process
        // list drops it, so a second reader would falsify the notch's values.
        assert!(!ok("taskbar", "system_stats"));
        // The bar's Shelf reads its files, previews, opens, copies and drags out its cards (shelf.rs starts the drag from the window
        // that calls it), and takes what Ctrl+V or the paste button brings: files, a copied image it saves to Pictures, or text.
        assert!(ok("taskbar", "convert_probe") && ok("taskbar", "file_preview") && ok("taskbar", "open_path") && ok("taskbar", "copy_files"));
        assert!(ok("taskbar", "shelf_drag_out") && ok("taskbar", "clipboard_paste_files") && ok("taskbar", "shelf_clipboard_text"));
        // A phone share lives in Rust and in the view that started it, which stops it and knows its own lost event by its address:
        // the bar starts and stops its own.
        assert!(ok("taskbar", "phone_share_start") && ok("taskbar", "phone_share_stop"));
        // The bar's Now playing follows the song from Rust itself, its player, player menu and mixer act on a click (the mixer reads
        // the levels while it is open), and its lyrics are romanized there, and translated there when offline translation is on.
        assert!(ok("taskbar", "media_get") && ok("taskbar", "media_control") && ok("taskbar", "media_open_source") && ok("taskbar", "media_sources"));
        assert!(ok("taskbar", "mixer_list") && ok("taskbar", "volume_get") && ok("taskbar", "mixer_set") && ok("taskbar", "volume_set"));
        assert!(ok("taskbar", "lyrics_romanize") && ok("taskbar", "translate_file"));
        // The notch alone fetches the lyrics, which fill the cache the bar reads. The lyrics' position and the audio levels are plain
        // switches in Rust that only the notch turns, for a bar too, so a bar's panel closing never turns them off under the notch; the
        // pinned player is a setting the notch applies.
        assert!(!ok("taskbar", "lyrics_fetch") && !ok("taskbar", "media_lyrics") && !ok("taskbar", "audio_levels") && !ok("taskbar", "media_pin"));
        // The bar's Overview reads the playback devices, the brightness, focus and the quick controls while it shows and sets them on a
        // click, and its search line opens the results in the browser. The brightness is the calling window's monitor (brightness.rs),
        // so from the bar it is the bar's own.
        assert!(ok("taskbar", "audio_outputs") && ok("taskbar", "audio_set_output") && ok("taskbar", "brightness_get") && ok("taskbar", "brightness_set"));
        assert!(ok("taskbar", "focus_get") && ok("taskbar", "focus_set") && ok("taskbar", "quick_get") && ok("taskbar", "quick_radio"));
        assert!(ok("taskbar", "quick_dark") && ok("taskbar", "mic_mute") && ok("taskbar", "quick_power") && ok("taskbar", "web_search"));
        // The bar's Converter and Calculator read the public reference rates themselves; the crypto widget's coin is the notch's.
        assert!(ok("taskbar", "portfolio_prices") && ok("taskbar-1", "portfolio_prices"));
        assert!(!ok("taskbar", "portfolio_coin") && ok("notch", "portfolio_coin"));
        // The bar's Depot asks which keys are stored, reads the accounts with them and records its history, as the notch's does. It
        // never stores, reads or forgets a key: that is the settings' (secret_set, portfolio_forget), and the Vault's secrets stay
        // the notch's alone.
        assert!(ok("taskbar", "secret_has") && ok("taskbar", "portfolio_fetch") && ok("taskbar", "portfolio_record") && ok("taskbar-1", "portfolio_fetch"));
        assert!(!ok("taskbar", "secret_set") && !ok("taskbar", "portfolio_forget") && !ok("taskbar", "secret_get"));
        assert!(super::TASKBAR_ALLOWED.iter().all(|c| !c.starts_with("vault_") && !c.starts_with("terminal_")));
        // The bar's Agents lists the sessions, its Colour picks from the screen with the bar's window as the loupe's owner.
        assert!(ok("taskbar", "agents_list") && ok("taskbar", "colour_pick"));
        // Its Clipboard reads the history, copies, pastes and deletes from it; what the history records stays the notch's to set.
        assert!(["clipboard_list", "clipboard_copy", "clipboard_paste", "clipboard_preview", "clipboard_text", "clipboard_delete", "clipboard_clear"].iter().all(|c| ok("taskbar", c)));
        assert!(!ok("taskbar", "clipboard_mode"));
        // Its Ask streams its own conversation and stops it.
        assert!(ok("taskbar", "ai_chat") && ok("taskbar", "ai_cancel"));
        // Its Recorder lists, starts (sound only, capture_start), pauses, stops and deletes recordings; screenshots are the notch's.
        assert!(["capture_list", "capture_details", "capture_start", "capture_stop", "capture_pause", "capture_state", "capture_delete"].iter().all(|c| ok("taskbar", c)));
        assert!(!ok("taskbar", "capture_shot") && !ok("taskbar", "capture_sources") && !ok("taskbar", "find_scan"));
        // Keep awake's state lives in the notch, which shows it in the closed notch: a bar that set it in Rust would leave the notch
        // showing the old state, so the bar asks the notch (taskbar_ask).
        assert!(!ok("taskbar", "keep_awake_set"));
        // The widgets' hello, which has the notch send their data, and the clock's click. Their audio capture and lyrics switch are
        // the notch's (audio_levels and media_lyrics, refused above).
        assert!(ok("taskbar", "taskbar_hello") && ok("taskbar", "taskbar_calendar") && ok("taskbar-1", "taskbar_hello"));
        assert!(ok("taskbar", "taskbar_settings") && ok("taskbar-1", "taskbar_settings") && !ok("settings", "taskbar_settings"));
        assert!(ok("notch", "taskbar_import_pins") && ok("settings", "taskbar_import_pins") && !ok("taskbar", "taskbar_import_pins"));
        // Windows' pins reach the bar through the notch, which applies them to the settings.
        assert!(ok("notch", "taskbar_windows_pins") && !ok("taskbar", "taskbar_windows_pins"));
        // A bar pins a listed window, starts a new instance from one or shows its exe; only the notch forgets the own pins it no
        // longer has, and the settings window pins nothing.
        assert!(["taskbar_pin_window", "taskbar_launch_window", "taskbar_reveal"].iter().all(|c| ok("taskbar", c) && ok("taskbar-1", c) && !ok("settings", c)));
        assert!(ok("notch", "taskbar_own_pins_keep") && !ok("taskbar", "taskbar_own_pins_keep") && !ok("settings", "taskbar_own_pins_keep"));
        // The Launcher lists the Start menu's apps and pins an app from its file, in the notch or the bar; its Alt+1 to Alt+6 are the
        // notch's (launcher_shortcuts, refused above).
        assert!(ok("notch", "launcher_add_file") && ok("taskbar", "launcher_add_file") && ok("taskbar", "launcher_apps") && !ok("settings", "launcher_add_file"));
        assert!(ok("taskbar", "taskbar_front") && ok("taskbar-1", "taskbar_front") && !ok("taskbar", "taskbar_auto_hide"));
        assert!(ok("notch", "taskbar_auto_hide") && !ok("settings", "taskbar_auto_hide"));
        // The tray's spy runs while the notch says a bar shows the tray, as it applies the bar's other settings.
        assert!(ok("notch", "taskbar_tray_on") && !ok("taskbar", "taskbar_tray_on") && !ok("settings", "taskbar_tray_on"));
        // Every bar reads the tray's icons and their pictures and clicks them; a click places the app's menu by the calling bar,
        // which the settings window is not.
        assert!(ok("taskbar", "taskbar_tray") && ok("taskbar-1", "taskbar_tray_images") && ok("taskbar", "taskbar_tray_click"));
        assert!(ok("notch", "taskbar_tray_click") && !ok("settings", "taskbar_tray_click"));
        assert!(ok("taskbar", "taskbar_decor") && ok("taskbar-1", "taskbar_decor_images"));
        assert!(!ok("settings", "taskbar_decor") && !ok("settings", "taskbar_decor_images"));
        // The jump lists and the Recently opened menu, on every bar, never in the settings window; the commands refuse any window
        // but a bar's, the notch too.
        assert!(["taskbar_jump_list", "taskbar_jump_open", "taskbar_recent"].iter().all(|c| ok("taskbar", c) && ok("taskbar-1", c) && !ok("settings", c) && !ok("timer", c)));
        // The bar's Windows keys: set by the notch, read by the settings; the keyboard taken by a bar after one of them.
        assert!(ok("notch", "taskbar_keys") && !ok("settings", "taskbar_keys") && !ok("taskbar", "taskbar_keys"));
        assert!(ok("settings", "taskbar_keys_status") && !ok("taskbar", "taskbar_keys_status"));
        assert!(ok("taskbar", "taskbar_focus") && ok("taskbar-1", "taskbar_focus") && !ok("settings", "taskbar_focus"));
        // The Recycle Bin, the window and group menus, the previews' order and the disk widget's drives: the bars' own, never the settings window's.
        for c in ["taskbar_recycle", "taskbar_recycle_do", "taskbar_window_menu", "taskbar_arrange", "taskbar_window_order", "taskbar_disks", "taskbar_disk_open", "taskbar_disk_scan", "taskbar_disk_scan_stop"] {
            assert!(ok("taskbar", c) && ok("taskbar-1", c) && !ok("settings", c), "{c}");
        }
        // Windows of every desktop: a setting, so the notch's alone.
        assert!(ok("notch", "taskbar_all_desktops") && !ok("taskbar", "taskbar_all_desktops") && !ok("settings", "taskbar_all_desktops"));
        assert!(ok("notch", "taskbar_end_task") && !ok("taskbar", "taskbar_end_task") && !ok("settings", "taskbar_end_task"));
        // The input language is the bars' own: drawn by the main one, read by any as it starts.
        assert!(ok("taskbar-1", "taskbar_input") && ok("taskbar", "taskbar_input") && !ok("settings", "taskbar_input"));
        // A wheel step on an app's button: the bars' own.
        assert!(ok("taskbar", "taskbar_app_volume") && ok("taskbar-1", "taskbar_app_volume") && !ok("settings", "taskbar_app_volume"));
        // Which monitors get a bar and which windows each lists: a setting, so the notch's alone.
        assert!(ok("notch", "taskbar_spread") && !ok("taskbar", "taskbar_spread") && !ok("settings", "taskbar_spread"));
        // Each bar says when its page slid it off the screen, for its own label; no other window has a bar to slide.
        assert!(ok("taskbar", "taskbar_slid") && ok("taskbar-1", "taskbar_slid") && !ok("settings", "taskbar_slid"));
        // The settings' note on a bar that cannot slide away; the bar has no use for it.
        assert!(!ok("taskbar", "taskbar_slide_blocked") && ok("settings", "taskbar_slide_blocked"));
        // The settings' line on a docked bar another program keeps from reserving; the bar has no use for it.
        assert!(ok("settings", "taskbar_reserve_reachable") && !ok("taskbar", "taskbar_reserve_reachable"));
        // The Start button opens Windows' Start and its Win+X menu, the Windows buttons Search, Task view, the widgets, Show desktop
        // and the On-Screen Keyboard; no other window has them.
        assert!(ok("taskbar", "taskbar_shell") && ok("taskbar-1", "taskbar_shell") && !ok("settings", "taskbar_shell"));
        // The quick panel's Wi-Fi and Bluetooth pages, on every bar, never in the settings window; the commands refuse any window but a bar's,
        // the notch too, except taskbar_bt_devices, which the notch reads for Device batteries (taskbar/bluetooth.rs).
        assert!(["taskbar_wifi_scan", "taskbar_wifi_allow", "taskbar_wifi_focus", "taskbar_wifi_connect", "taskbar_wifi_disconnect", "taskbar_bt_devices"].iter().all(|c| ok("taskbar", c) && ok("taskbar-1", c) && !ok("settings", c) && !ok("timer", c)));
        // The window previews, on every bar, never in the settings window; the command refuses any window but a bar's, the notch too (taskbar/preview.rs).
        assert!(ok("taskbar", "taskbar_preview") && ok("taskbar-1", "taskbar_preview") && !ok("settings", "taskbar_preview") && !ok("timer", "taskbar_preview"));
        // Resizing and moving the notch's window follows the notch's own page.
        assert!(!ok("settings", "display_rescale"));
        // Screen Time: the bar's panel reads the days; recording is the notch's (the user's switch), deleting the settings'.
        assert!(ok("taskbar", "screentime_days") && ok("taskbar-1", "screentime_days") && ok("settings", "screentime_days"));
        assert!(!ok("taskbar", "screentime_set") && !ok("settings", "screentime_set") && ok("notch", "screentime_set"));
        assert!(!ok("taskbar", "screentime_clear") && ok("settings", "screentime_clear"));
        // Wallpapers runs whole in the bar's panel; the settings window, which has no such page, changes nothing of the desktop.
        assert!(ok("taskbar", "wallpaper_current") && ok("taskbar", "wallpaper_list") && ok("settings", "wallpaper_current") && ok("settings", "wallpaper_list"));
        for c in ["wallpaper_set", "wallpaper_step", "wallpaper_fit", "wallpaper_folder", "wallpaper_pack_download", "wallpaper_pack_remove"] {
            assert!(ok("taskbar", c) && ok("taskbar-1", c) && ok("notch", c) && !ok("settings", c) && !ok("timer", c), "{c}");
        }
        // The Unread widget's app icons: an icon is no data to keep from the bar.
        assert!(ok("taskbar", "notices_icon") && ok("taskbar-1", "notices_icon"));
        // The desktop's icons, ejecting a drive and the hotspot: the bars' Windows buttons, never the settings window's.
        for c in ["taskbar_desktop_icons", "taskbar_desktop_icons_set", "taskbar_eject", "taskbar_hotspot", "taskbar_hotspot_set"] {
            assert!(ok("taskbar", c) && ok("taskbar-1", c) && ok("notch", c) && !ok("settings", c) && !ok("timer", c), "{c}");
        }
    }

    #[test]
    fn web_search_opens_only_the_known_engines() {
        use super::search_url as url;
        assert_eq!(url("google", "  rust tauri "), Some("https://www.google.com/search?q=rust+tauri".into()));
        // The query stays one parameter, whatever it holds.
        assert_eq!(url("duckduckgo", "a&b=c #1"), Some("https://duckduckgo.com/?q=a%26b%3Dc+%231".into()));
        assert_eq!(url("brave", "caffè"), Some("https://search.brave.com/search?q=caff%C3%A8".into()));
        assert_eq!(url("bing", "x"), Some("https://www.bing.com/search?q=x".into()));
        assert_eq!(url("evil", "x"), None);
        assert_eq!(url("google", "   "), None);
        assert_eq!(url("google", &"x".repeat(2001)), None);
    }

    #[test]
    fn windows_stay_on_crests_own_pages() {
        let ok = |u: &str| super::own_page(&u.parse().unwrap());
        assert!(ok("http://tauri.localhost/index.html") && ok("tauri://localhost/") && ok("about:blank"));
        // A plugin page or a website dropped as a link.
        assert!(!ok("http://crestplugin.localhost/hello/index.html"));
        assert!(!ok("https://example.com/") && !ok("file:///C:/Windows/") && !ok("http://tauri.localhost.example.com/"));
    }
}
