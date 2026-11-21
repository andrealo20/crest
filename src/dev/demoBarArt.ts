/*
 * The site's full-screen demo: the pictures of its bar, drawn here so the site ships no real app's icon. The apps' icons, two tray icons,
 * and a picture of each window for the previews, as a live thumbnail of it would look (src/dev/demoBar.tsx places them).
 */

const svg = (viewBox: string, body: string) => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`)}`;

const ICONS: Record<string, string> = {
  "demo:explorer":
    '<path d="M5 13a4 4 0 0 1 4-4h9.5l4 4H39a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#d9981f"/>' +
    '<path d="M5 19a4 4 0 0 1 4-4h30a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" fill="#ffc94d"/>',
  "demo:terminal":
    '<rect x="4" y="8" width="40" height="32" rx="6" fill="#1d2330"/><path d="M4 14a6 6 0 0 1 6-6h28a6 6 0 0 1 6 6v1H4z" fill="#394052"/>' +
    '<path d="M12 22l6 5-6 5" fill="none" stroke="#6ee7a0" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M22 33h12" stroke="#d7dce5" stroke-width="3" stroke-linecap="round"/>',
  "demo:notepad":
    '<rect x="9" y="5" width="30" height="38" rx="4" fill="#f4f6f9"/><path d="M9 9a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v5H9z" fill="#3b82f6"/>' +
    '<path d="M15 21h18M15 27h18M15 33h12" stroke="#9aa3b2" stroke-width="2.4" stroke-linecap="round"/>',
  "demo:calculator":
    '<rect x="8" y="4" width="32" height="40" rx="5" fill="#2b303b"/><rect x="12" y="8" width="24" height="9" rx="2" fill="#a7f3d0"/>' +
    [21, 28, 35].flatMap((y) => [12, 21, 30].map((x) => `<rect x="${x}" y="${y}" width="6" height="5" rx="1.5" fill="${x === 30 && y === 35 ? "#fb923c" : "#5b6475"}"/>`)).join(""),
  "demo:photos":
    '<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#60c5ff"/><stop offset="1" stop-color="#2f7cf6"/></linearGradient>' +
    '<clipPath id="c"><rect x="5" y="7" width="38" height="34" rx="6"/></clipPath></defs>' +
    '<g clip-path="url(#c)"><rect x="5" y="7" width="38" height="34" fill="url(#s)"/><circle cx="33" cy="17" r="4" fill="#ffd54a"/>' +
    '<path d="M5 36l11-12 8 9 6-6 13 12v2H5z" fill="#21c07a"/></g>',
};

/** An app's icon on the demo's bar, null for an app it does not know. */
export const appIcon = (id: string): string | null => (ICONS[id] ? svg("0 0 48 48", ICONS[id]) : null);

/** The demo's tray: a backup that is up to date and a chat with news. */
export const TRAY = [
  {
    id: "demo-backup",
    tip: "Backup: up to date",
    picture: svg("0 0 16 16", '<path d="M4.5 12.5h7.2a3 3 0 0 0 .4-6 4 4 0 0 0-7.7 1A2.5 2.5 0 0 0 4.5 12.5z" fill="#3b82f6"/><path d="M6 9.4l1.5 1.5L10.4 8" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'),
  },
  {
    id: "demo-chat",
    tip: "Chat: 2 new messages",
    picture: svg("0 0 16 16", '<path d="M3 3h10a1.5 1.5 0 0 1 1.5 1.5v5A1.5 1.5 0 0 1 13 11H8l-3 2.5V11H3a1.5 1.5 0 0 1-1.5-1.5v-5A1.5 1.5 0 0 1 3 3z" fill="#8b5cf6"/><circle cx="6" cy="7" r="1" fill="#fff"/><circle cx="10" cy="7" r="1" fill="#fff"/>'),
  },
];

/** Bars of text, widths in px, in the order a page fills. */
const LINES = [120, 96, 140, 72, 128, 104, 60, 136, 88, 116];
const bars = (x: number, y: number, step: number, n: number, color: string, scale = 1, from = 0) =>
  Array.from({ length: n }, (_, i) => `<rect x="${x}" y="${y + i * step}" width="${LINES[(i + from) % LINES.length] * scale}" height="3" rx="1.5" fill="${color}"/>`).join("");
/** A window's title bar, its three controls on the right. */
const titleBar = (bg: string, fg: string) =>
  `<rect width="192" height="12" fill="${bg}"/>` + [160, 170, 180].map((x) => `<rect x="${x}" y="5" width="5" height="1.6" rx=".8" fill="${fg}"/>`).join("");

const FOLDER = (x: number, y: number) => `<path d="M${x} ${y + 3}a2 2 0 0 1 2-2h6l2 2h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H${x + 2}a2 2 0 0 1-2-2z" fill="#ffc94d"/>`;

const PICTURES: Record<string, (title: string) => string> = {
  "demo:explorer": (title) =>
    '<rect width="192" height="120" fill="#1f1f1f"/>' + titleBar("#2b2b2b", "#9a9a9a") + '<rect y="12" width="192" height="11" fill="#262626"/>' +
    '<rect y="23" width="44" height="97" fill="#1b1b1b"/>' + bars(8, 30, 9, 9, "#5a5a5a", 0.22) +
    (title === "Downloads"
      ? Array.from({ length: 8 }, (_, i) => `<rect x="52" y="${31 + i * 11}" width="6" height="7" rx="1.5" fill="${["#ef4444", "#3b82f6", "#22c55e", "#a855f7"][i % 4]}"/>`).join("") + bars(63, 33, 11, 8, "#6b6b6b", 0.7, 3)
      : [0, 1, 2, 3].flatMap((c) => [0, 1].map((r) => FOLDER(54 + c * 34, 32 + r * 40) + `<rect x="${54 + c * 34}" y="${54 + r * 40}" width="22" height="3" rx="1.5" fill="#6b6b6b"/>`)).join("")),
  "demo:terminal": () =>
    '<rect width="192" height="120" fill="#0c0c0c"/><rect width="192" height="14" fill="#1f1f1f"/><rect x="6" y="3" width="54" height="11" rx="2" fill="#0c0c0c"/>' +
    [0, 2, 5, 7].map((i) => `<rect x="8" y="${24 + i * 10}" width="34" height="3" rx="1.5" fill="#6ee7a0"/>`).join("") +
    bars(46, 24, 20, 2, "#d7dce5", 0.6) + bars(8, 34, 10, 1, "#8b93a5", 0.9, 4) + bars(8, 64, 10, 1, "#8b93a5", 1, 2) + bars(8, 84, 10, 1, "#8b93a5", 0.8, 7) +
    '<rect x="46" y="94" width="5" height="7" fill="#d7dce5"/>',
  "demo:notepad": () =>
    '<rect width="192" height="120" fill="#fbfbfb"/>' + titleBar("#efefef", "#8a8a8a") + '<rect y="12" width="192" height="9" fill="#f5f5f5"/>' + bars(10, 15, 0, 1, "#c4c4c4", 0.4) +
    bars(10, 30, 9, 9, "#7a7a7a"),
  "demo:calculator": () =>
    '<rect width="192" height="120" fill="#202020"/>' + titleBar("#202020", "#9a9a9a") + '<rect x="112" y="22" width="72" height="13" rx="2" fill="#f2f2f2"/>' +
    [0, 1, 2, 3, 4].flatMap((r) => [0, 1, 2, 3].map((c) => `<rect x="${8 + c * 46}" y="${42 + r * 15}" width="42" height="12" rx="2" fill="${r === 4 && c === 3 ? "#4cc2ff" : r === 0 || c === 3 ? "#2b2b2b" : "#3b3b3b"}"/>`)).join(""),
  "demo:photos": () =>
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffb46b"/><stop offset=".55" stop-color="#ff8a7a"/><stop offset="1" stop-color="#c06aa8"/></linearGradient></defs>' +
    '<rect width="192" height="120" fill="url(#sky)"/><circle cx="132" cy="58" r="13" fill="#ffe3a3"/><rect y="78" width="192" height="42" fill="#2f5d9c"/>' +
    '<path d="M0 78V60h14v-8h12v12h10V48h16v30z" fill="#7a3b3b"/><path d="M150 78V56h12v-6h14v10h16v18z" fill="#6b3245"/>' +
    '<rect x="118" y="86" width="30" height="2" rx="1" fill="#ffe3a3" opacity=".7"/><rect x="124" y="94" width="18" height="2" rx="1" fill="#ffe3a3" opacity=".5"/>' +
    titleBar("#1f1f1f", "#9a9a9a"),
};

/** A picture of a window, as its live thumbnail would show it, null for an app it does not know. */
export const windowPicture = (id: string, title: string): string | null => (PICTURES[id] ? svg("0 0 192 120", PICTURES[id](title)) : null);
