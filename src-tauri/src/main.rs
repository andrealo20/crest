// No console window in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Elevated helper call from "Unlock FPS": grant rights and exit. Must run
    // before run(), otherwise single-instance would hand it to the running app.
    let args: Vec<String> = std::env::args().collect();
    // Run by the uninstaller (src-tauri/windows/hooks.nsh).
    #[cfg(windows)]
    if args.get(1).is_some_and(|a| a == "--restore-banners") {
        crest_lib::restore_banners();
        std::process::exit(0);
    }
    #[cfg(windows)]
    if let [_, flag, value] = args.as_slice() {
        if flag == "--fps-unlock" {
            std::process::exit(crest_lib::fps_elevated_unlock(value));
        }
        // Started by Crest while it hides the Windows volume indicator: restores it once Crest ends (value: its pid).
        if flag == "--osd-guard" {
            std::process::exit(crest_lib::osd_guard(value));
        }
    }
    // A portable copy that just updated itself waits for the old process to exit first.
    crest_lib::portable::after_update(&args);
    crest_lib::run()
}
