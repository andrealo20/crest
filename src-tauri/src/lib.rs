pub mod ai;
mod audio;
mod brightness;
mod calendar;
mod capture;
mod clipboard;
mod controls;
pub mod convert;
mod discord;
mod display;
mod drop;
mod fps;
mod github;
mod hit_test;
mod loopback;
mod launcher;
mod media;
mod media_pick;
mod memory;
mod mixer;
mod notices;
mod notify_wire;
mod osd;
pub mod portable;
mod privacy;
mod screen_policy;
pub mod secrets;
mod shelf;
mod shell;
mod startup;
mod system;
mod sysevents;
mod timer_window;
mod terminal;
mod themes;
mod trading;
pub mod usage;
mod vault;

use std::sync::Mutex;

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Emitter, Manager, State, WebviewWindow};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};

/// For main.rs: elevated "Unlock FPS" call (see fps::fps_unlock).
pub fn fps_elevated_unlock(sid: &str) -> i32 {
    fps::elevated_unlock(sid)
}

/// For main.rs: the process that puts the Windows volume and brightness indicator back after Crest (see osd.rs).
pub fn osd_guard(pid: &str) -> i32 {
    osd::guard(pid)
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
    builder
        .plugin(tauri_plugin_process::init())
        // Shortcuts are set in the settings (shell.rs).
        .plugin(tauri_plugin_global_shortcut::Builder::new().with_handler(shell::on_shortcut).build())
        .manage(shell::Hotkeys::default())
        .manage(hit_test::HitState::default())
        .manage(media::MediaState::default())
        .manage(mixer::MixerState::default())
        .manage(clipboard::ClipboardState::default())
        .manage(FocusState::default())
        .manage(TrayItems::default())
        .manage(audio::AudioState::default())
        .manage(ai::AiState::default())
        .manage(trading::TradingState::default())
        .manage(usage::UsageState::default())
        .manage(system::SystemState::default())
        .manage(display::DisplayState::default())
        .manage(discord::DiscordState::default())
        .manage(vault::VaultState::default())
        .manage(terminal::TerminalState::default())
        .manage(launcher::LauncherState::default())
        .manage(github::GithubState::default())
        .manage(calendar::CalendarState::default())
        .manage(notices::NoticesState::default())
        .manage(capture::CaptureState::default())
        .invoke_handler(tauri::generate_handler![
            hit_test::set_hit_rect,
            hit_test::set_pinned,
            hit_test::set_passthrough,
            media::media_get,
            media::media_control,
            media::media_pin,
            media::media_sources,
            media::media_lyrics,
            memory::memory_low,
            clipboard::clipboard_list,
            clipboard::clipboard_mode,
            clipboard::clipboard_copy,
            clipboard::clipboard_delete,
            clipboard::clipboard_clear,
            clipboard::clipboard_preview,
            clipboard::clipboard_paste_files,
            keyboard_focus,
            audio::audio_levels,
            ai::ai_chat,
            ai::ai_cancel,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_has,
            trading::portfolio_fetch,
            trading::portfolio_prices,
            trading::portfolio_record,
            trading::portfolio_forget,
            usage::usage_fetch,
            usage::usage_tokens,
            system::system_stats,
            sysevents::status_seed,
            sysevents::status_configure,
            system::system_icon,
            convert::convert_probe,
            convert::reveal_file,
            convert::open_path,
            convert::copy_files,
            convert::file_preview,
            display::display_monitors,
            display::display_apply,
            display::display_screen,
            display::display_raise,
            display::display_apps,
            shell::hotkeys_apply,
            shell::crash_log,
            fps::gaming_fps,
            fps::fps_unlock,
            controls::volume_get,
            controls::volume_set,
            mixer::mixer_list,
            mixer::mixer_set,
            mixer::media_open_source,
            tray_focus,
            controls::focus_get,
            controls::focus_set,
            privacy::privacy_state,
            discord::discord_configure,
            discord::discord_action,
            discord::discord_state,
            vault::vault_status,
            vault::vault_setup,
            vault::vault_unlock,
            vault::vault_lock,
            vault::vault_save_password,
            vault::vault_add_totp,
            vault::vault_delete,
            vault::vault_reveal,
            vault::vault_copy,
            vault::vault_codes,
            vault::vault_options,
            vault::vault_change_pin,
            vault::vault_reset,
            vault::vault_scan,
            vault::vault_hello_supported,
            vault::vault_hello_unlock,
            vault::vault_hello_enable,
            vault::vault_hello_disable,
            autostart_get,
            autostart_set,
            build_info,
            diagnostics_info,
            open_sponsors,
            timer_window::timer_window_open,
            timer_window::timer_window_close,
            shelf::shelf_drag_out,
            shelf::shelf_clipboard_text,
            terminal::terminal_info,
            terminal::terminal_start,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_kill,
            terminal::terminal_clipboard_text,
            themes::themes_folder,
            themes::themes_read,
            themes::themes_write,
            launcher::launcher_apps,
            launcher::launcher_icons,
            launcher::launcher_open,
            launcher::launcher_shortcuts,
            github::github_contributions,
            github::github_open_profile,
            calendar::calendar_fetch,
            notices::notices_configure,
            notices::notices_status,
            notices::notices_request_access,
            portable::portable_info,
            portable::portable_check,
            portable::portable_install,
            capture::capture_sources,
            capture::capture_shot,
            capture::capture_state,
            capture::capture_start,
            capture::capture_pause,
            capture::capture_stop,
            capture::capture_list,
            capture::capture_details,
            capture::capture_delete,
        ])
        .setup(move |app| {
            shell::init(app);
            let window = portable::create_window(app)?;
            display::place(&window, &app.state::<display::DisplayState>())?;
            window.show()?;
            // Only after show(): this fails on a window that was never shown.
            window.set_ignore_cursor_events(true)?;
            drop::install(&window);
            hit_test::spawn(app.handle().clone(), window.clone());
            display::spawn(app.handle().clone(), window);
            media::spawn(app.handle().clone());
            clipboard::spawn(app.handle().clone());
            audio::spawn(app.handle().clone(), &app.state::<audio::AudioState>());
            sysevents::spawn(app.handle().clone());
            brightness::spawn(app.handle().clone());
            // A run that ended without restoring the Windows indicator (and whose guard was ended with it) is cleaned up here.
            osd::restore();

            enable_autostart_once(app.handle());
            build_tray(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to start Crest")
        .run(|app, event| {
            // A recording still running when Crest quits is finished, so the file is complete.
            if let tauri::RunEvent::Exit = event {
                capture::finish_on_exit(app);
                osd::set(false);
            }
        });
}

/// Window that was in the foreground before the shortcut opened the notch.
#[derive(Default)]
struct FocusState(Mutex<isize>);

/// Opened via shortcut → take focus (for Esc/typing).
/// Closed → give focus back to the previous app, otherwise typing goes nowhere.
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

#[tauri::command]
fn autostart_get(app: AppHandle) -> bool {
    startup::is_enabled(&app)
}

#[tauri::command]
fn autostart_set(enabled: bool, app: AppHandle) -> Result<(), String> {
    startup::set(&app, enabled)
}

/// Which build runs: the Microsoft Store one leaves updates to the Store.
#[tauri::command]
fn build_info() -> serde_json::Value {
    serde_json::json!({ "store": cfg!(feature = "store") })
}

/// For Copy diagnostics (Settings, General): Windows edition and build, the architecture of this build and of the PC
/// (an x64 build on an ARM PC runs emulated), and each monitor's scale. Nothing about the user, the PC's name or a path.
#[tauri::command]
fn diagnostics_info(window: tauri::WebviewWindow) -> serde_json::Value {
    let scales: Vec<f64> = window.available_monitors().unwrap_or_default().iter().map(|m| m.scale_factor()).collect();
    serde_json::json!({
        "os": sysinfo::System::long_os_version(),
        "build": sysinfo::System::kernel_version(),
        "arch": std::env::consts::ARCH,
        "machine": native_machine(),
        "scales": scales,
    })
}

/// The PC's own architecture, which GetSystemInfo hides from an emulated process.
fn native_machine() -> Option<&'static str> {
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

/// Opens the GitHub Sponsors page in the default browser. The address is fixed here, so the interface cannot open anything else.
#[tauri::command]
fn open_sponsors() -> Result<(), String> {
    std::process::Command::new("explorer").arg("https://github.com/sponsors/andrealo20").spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Enables autostart on the very first launch; after that the tray check and settings decide.
fn enable_autostart_once(app: &AppHandle) {
    // A portable copy writes nothing outside its folder unless asked to (tray or settings); in the Store build the user turns it on.
    if portable::is_portable() || cfg!(feature = "store") {
        return;
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

/// The focus-mode tray item, whose check state changes at runtime.
#[derive(Default)]
struct TrayItems(Mutex<Option<CheckMenuItem<tauri::Wry>>>);

/// The frontend owns focus mode; the tray check only mirrors it.
#[tauri::command]
fn tray_focus(on: bool, state: State<'_, TrayItems>) {
    if let Some(focus) = state.0.lock().unwrap().as_ref() {
        let _ = focus.set_checked(on);
    }
}

/// Dark tray menu to match the notch instead of the light default.
/// uxtheme only exports this by ordinal: SetPreferredAppMode = 135, FlushMenuThemes = 136
/// (Windows 10 1903+). If missing, the menu just stays light.
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
    dark_menus();
    let enabled = startup::is_enabled(app.handle());
    // Open has its shortcut right-aligned via tab, like Windows menus.
    let open = MenuItem::with_id(app, "open", shell::default_open_label(), true, None::<&str>)?;
    shell::set_tray_open(app, open.clone());
    let settings = MenuItem::with_id(app, "settings", "Settings …", true, None::<&str>)?;
    // The real state follows right after start (the frontend calls tray_focus).
    let focus = CheckMenuItem::with_id(app, "focus", "Focus mode", true, false, None::<&str>)?;
    let autostart = CheckMenuItem::with_id(app, "autostart", "Start with Windows", true, enabled, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Crest", true, None::<&str>)?;
    *app.state::<TrayItems>().0.lock().unwrap() = Some(focus.clone());
    let menu = Menu::with_items(
        app,
        &[&open, &settings, &PredefinedMenuItem::separator(app)?, &focus, &autostart, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    let autostart_item = autostart.clone();
    let focus_item = focus.clone();
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
            "settings" => shell::open(app, Some("settings")),
            "quit" => app.exit(0),
            "focus" => {
                // The click already toggled the check; the frontend applies it and mirrors it back.
                let on = focus_item.is_checked().unwrap_or(false);
                let _ = app.emit("notch://focus-set", on);
            }
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

#[cfg(test)]
mod tests {
    #[test]
    fn native_machine_is_known_and_matches_a_native_build() {
        let native = super::native_machine();
        assert!(matches!(native, Some("x86_64" | "aarch64")), "{native:?}");
        // An arm64 build never runs emulated; an x64 one may, on an ARM PC.
        if cfg!(target_arch = "aarch64") {
            assert_eq!(native, Some("aarch64"));
        }
    }
}
