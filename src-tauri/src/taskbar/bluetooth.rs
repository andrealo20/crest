//! The quick panel's Bluetooth page: the paired devices, with their connection and battery, from the same read of Windows'
//! device store the status alerts use (sysevents.rs `BT_PAIRED`). Never a watcher on association endpoints, which kept the
//! radio searching for devices and broke Bluetooth audio on some PCs (issue #48). Only bars call it (`bar::from_bar`).

use serde::Serialize;
use tauri::WebviewWindow;
use windows::core::{GUID, HSTRING};
use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationKind};

use super::bar;
use crate::sysevents;

/// One row of the page.
#[derive(Serialize, Debug, PartialEq)]
pub struct BtRow {
    id: String,
    name: String,
    /// Windows' device categories ("Audio.Headphone", "Input.Mouse"), for the icon.
    categories: Vec<String>,
    connected: bool,
    battery: Option<u8>,
}

/// One row per device, connected first, then by name. Windows may keep a device as two nodes (classic and LE) in one container:
/// they make one row, the connected node's (else the first), connected if either is, with the battery the first one has.
fn rows(list: Vec<(BtRow, Option<GUID>)>) -> Vec<BtRow> {
    let mut merged: Vec<(BtRow, Option<GUID>)> = Vec::new();
    for (row, container) in list {
        match merged.iter_mut().find(|(_, c)| container.is_some() && *c == container) {
            Some((kept, _)) => {
                let (connected, battery) = (kept.connected || row.connected, kept.battery.or(row.battery));
                if row.connected && !kept.connected {
                    *kept = row;
                }
                kept.connected = connected;
                kept.battery = battery;
            }
            None => merged.push((row, container)),
        }
    }
    let mut rows: Vec<BtRow> = merged.into_iter().map(|(row, _)| row).collect();
    rows.sort_by_key(|r| (!r.connected, r.name.to_lowercase()));
    rows
}

/// The paired devices, read once from the device store (no watcher, no radio search); the battery only for connected ones.
#[tauri::command]
pub async fn taskbar_bt_devices(window: WebviewWindow) -> Result<Vec<BtRow>, String> {
    bar::from_bar(&window)?;
    crate::quick::blocking(|| {
        let all = DeviceInformation::FindAllAsyncWithKindAqsFilterAndAdditionalProperties(&HSTRING::from(sysevents::BT_PAIRED), &sysevents::bt_props(), DeviceInformationKind::Device)
            .and_then(|op| op.join())
            .map_err(|_| "failed".to_string())?;
        // A device whose read fails is left out.
        let list = all
            .into_iter()
            .filter_map(|d| {
                let id = d.Id().ok()?.to_string();
                let (connected, dev) = sysevents::read_device(&d)?;
                let battery = if connected { sysevents::battery(&dev.address, dev.container) } else { None };
                Some((BtRow { id, name: dev.name, categories: dev.categories, connected, battery }, dev.container))
            })
            .collect();
        Ok(rows(list))
    })
    .await
    .map_err(|_| "failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, name: &str, connected: bool, battery: Option<u8>) -> BtRow {
        BtRow { id: id.into(), name: name.into(), categories: vec![], connected, battery }
    }

    #[test]
    fn paired_devices_are_one_row_each_connected_first() {
        let buds = GUID::from_u128(1);
        let list = rows(vec![
            (row("a", "Mouse", false, None), None),
            (row("b", "Buds", false, None), Some(buds)), // the classic node
            (row("c", "Buds", true, Some(70)), Some(buds)), // the LE node of the same buds
            (row("d", "keyboard", true, None), None),
        ]);
        assert_eq!(
            list.iter().map(|r| (r.id.as_str(), r.connected, r.battery)).collect::<Vec<_>>(),
            [("c", true, Some(70)), ("d", true, None), ("a", false, None)]
        );
    }

    #[test]
    fn a_merged_device_keeps_the_battery_either_node_has() {
        let g = GUID::from_u128(2);
        let list = rows(vec![(row("x", "Pods", true, None), Some(g)), (row("y", "Pods", false, Some(40)), Some(g))]);
        assert_eq!(list, [BtRow { id: "x".into(), name: "Pods".into(), categories: vec![], connected: true, battery: Some(40) }]);
    }
}
