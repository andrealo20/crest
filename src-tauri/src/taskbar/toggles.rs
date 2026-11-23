//! Windows buttons of the bar that switch something of Windows (design K): the desktop's icons and the mobile hotspot.

/// Whether the desktop shows its icons; "desktop" while Explorer's desktop cannot be found.
#[tauri::command]
pub async fn taskbar_desktop_icons() -> Result<bool, String> {
    Err("unsupported".into())
}

/// Shows or hides the desktop's icons.
#[tauri::command]
pub async fn taskbar_desktop_icons_set(show: bool) -> Result<(), String> {
    let _ = show;
    Err("unsupported".into())
}

/// The mobile hotspot's state and how many devices use it; never the network's name, its password or the devices' names.
#[tauri::command]
pub async fn taskbar_hotspot() -> Result<(), String> {
    Err("unsupported".into())
}

/// Turns the mobile hotspot on or off.
#[tauri::command]
pub async fn taskbar_hotspot_set(on: bool) -> Result<(), String> {
    let _ = on;
    Err("unsupported".into())
}
