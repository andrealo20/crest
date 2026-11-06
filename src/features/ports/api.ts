import { invoke } from "@tauri-apps/api/core";
import { demo } from "../../dev/showcase-data";
import { isNative } from "../../platform/native";
import type { EndOutcome, RawPort } from "./model";

/*
 * Bridge to src-tauri/src/ports.rs. In the browser a few sample listeners stand in, so the sheet can be designed
 * without the app; ending one removes it from the sample.
 */

const sock = (port: number, addr: string, pid: number, name: string, canEnd = true): RawPort => ({ port, addr, pid, name, path: canEnd ? `C:\\Users\\me\\dev\\${name}` : `C:\\Windows\\System32\\${name}`, canEnd });
let sample: RawPort[] = [
  sock(135, "0.0.0.0", 1084, "svchost.exe", false),
  sock(135, "::", 1084, "svchost.exe", false),
  sock(445, "0.0.0.0", 4, "System", false),
  sock(3000, "127.0.0.1", 18432, "node.exe"),
  sock(3000, "::1", 18432, "node.exe"),
  sock(5173, "::1", 20916, "node.exe"),
  sock(5432, "127.0.0.1", 4120, "postgres.exe", false),
  sock(8080, "0.0.0.0", 13376, "python.exe"),
  sock(9000, "192.168.1.20", 5555, "dotnet.exe"),
];

export function listPorts(): Promise<RawPort[]> {
  return isNative ? invoke<RawPort[]>("ports_list") : Promise.resolve(sample.map((s) => ({ ...s })));
}

export function endProcess(pid: number, port: number): Promise<EndOutcome> {
  if (isNative) return invoke<EndOutcome>("ports_end", { pid, port });
  const found = sample.some((s) => s.pid === pid && s.port === port && s.canEnd);
  sample = sample.filter((s) => !(s.pid === pid && s.port === port && s.canEnd));
  return Promise.resolve(found ? "ended" : "gone");
}

/** http://localhost:PORT in the default browser. Rust builds the address and checks the port listens on loopback or everywhere. */
export function openLocal(port: number): Promise<void> {
  if (isNative) return invoke("ports_open", { port });
  if (!demo) window.open(`http://localhost:${port}`, "_blank", "noopener");
  return Promise.resolve();
}
