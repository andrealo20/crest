/** A listening socket as Rust reads it (src-tauri/src/ports.rs). */
export interface RawPort {
  port: number;
  /** "127.0.0.1", "::1", "0.0.0.0", "::" or the address of one interface. */
  addr: string;
  pid: number;
  /** Executable name; empty when the system does not tell. */
  name: string;
  path: string | null;
  /** Rust decided: the user's own program, not the system, not Crest. */
  canEnd: boolean;
}

/** `gone`: it no longer listens there. */
export type EndOutcome = "ended" | "denied" | "gone";

/** One program on one port, with its IPv4 and IPv6 listeners together. */
export interface PortRow {
  key: string;
  port: number;
  pid: number;
  name: string;
  path: string | null;
  canEnd: boolean;
  /** IPv4 first. */
  addrs: string[];
  /** Reachable from other machines: some listener is not on loopback. */
  exposed: boolean;
  /** http://localhost:PORT answers: some listener is on loopback or on every address. */
  openable: boolean;
}

export interface Outcome {
  row: PortRow;
  outcome: EndOutcome;
}

/** "::ffff:127.0.0.1" is 127.0.0.1. */
const plain = (addr: string) => addr.toLowerCase().replace(/^::ffff:/, "");
export const isLoopback = (addr: string) => {
  const a = plain(addr);
  return a === "::1" || /^127(\.\d{1,3}){3}$/.test(a);
};
export const isWildcard = (addr: string) => {
  const a = plain(addr);
  return a === "0.0.0.0" || a === "::";
};

/** The sockets of one program on one port become one row. */
export function group(raw: RawPort[]): PortRow[] {
  const rows = new Map<string, PortRow>();
  for (const r of raw) {
    const row = rows.get(`${r.pid}:${r.port}`);
    if (!row) {
      rows.set(`${r.pid}:${r.port}`, { key: `${r.pid}:${r.port}`, port: r.port, pid: r.pid, name: r.name, path: r.path, canEnd: r.canEnd, addrs: [r.addr], exposed: false, openable: false });
      continue;
    }
    if (!row.addrs.includes(r.addr)) row.addrs.push(r.addr);
    row.canEnd &&= r.canEnd;
  }
  for (const row of rows.values()) {
    row.addrs.sort((a, b) => Number(a.includes(":")) - Number(b.includes(":")) || a.localeCompare(b));
    row.exposed = row.addrs.some((a) => !isLoopback(a));
    row.openable = row.addrs.some((a) => isLoopback(a) || isWildcard(a));
  }
  return [...rows.values()];
}

/** By port in the direction asked; the same port twice (two programs) by PID. */
export function byPort(rows: PortRow[], dir: "asc" | "desc"): PortRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => sign * (a.port - b.port) || a.pid - b.pid);
}

/** The rows now listed plus the ones just ended that the system no longer lists, so their result stays on screen for a moment. */
export function withEnded(rows: PortRow[], outcomes: Record<string, Outcome>): PortRow[] {
  const listed = new Set(rows.map((r) => r.key));
  return [...rows, ...Object.values(outcomes).map((o) => o.row).filter((r) => !listed.has(r.key))];
}
