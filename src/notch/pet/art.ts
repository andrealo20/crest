import type { PetId } from "../row/parts";

/*
 * The pets, drawn here as SVG markup on one rig in a 0..80 box: legs from y 62, body 46..70, head centred near (40, 32),
 * arms at the shoulders (27, 50) and (53, 50), the tail at (55, 62). Each pet draws its own parts; the same classes
 * (rig, body, head, arm-l, arm-r, leg-l, leg-r, tail, ear-l, ear-r, lids, eyes-open, eyes-happy, mouth, fx) take the
 * same animations (pet.css). Cartoon style: a base fill, a darker shadow side, a light side, a rim of light along the top
 * edge and an outline in the darkest tone. Built from constants only, never from user text, so it can go in as markup.
 */

interface Palette { base: string; dark: string; light: string; rim: string; line: string; belly: string; iris: string; accent: string }

export const PET_NAMES: Record<PetId, string> = {
  cat: "Schwarze Katze",
  cocker: "Schwarzer Cocker Spaniel",
  monkey: "Affe",
  sloth: "Faultier",
  samurai: "Samurai",
  robot: "Roboter",
  flame: "Flamme",
  zombie: "Zombie",
};

const P: Record<PetId, Palette> = {
  cat: { base: "#2b2f45", dark: "#14162a", light: "#4d5476", rim: "#8f98c8", line: "#07080f", belly: "#3a3f5c", iris: "#9cf06a", accent: "#ff8fb0" },
  cocker: { base: "#25232c", dark: "#100e15", light: "#4a4658", rim: "#9a93b8", line: "#060509", belly: "#33303d", iris: "#6b3b1c", accent: "#ff8a9e" },
  monkey: { base: "#a8653a", dark: "#6e3d1f", light: "#cf8a58", rim: "#f0b588", line: "#3a1e0d", belly: "#f3cfa8", iris: "#5a3417", accent: "#ff9e8a" },
  sloth: { base: "#b39874", dark: "#7c6447", light: "#d2bc98", rim: "#f1e2c6", line: "#3d2f1f", belly: "#efe0c4", iris: "#2a1c10", accent: "#ffb3a0" },
  samurai: { base: "#d23a35", dark: "#8c1c1f", light: "#f06a5f", rim: "#ffb0a6", line: "#3a0a0c", belly: "#ffe2c8", iris: "#2a2038", accent: "#ffb1a3" },
  robot: { base: "#b8c3dc", dark: "#7a86a6", light: "#e8eefc", rim: "#ffffff", line: "#252c40", belly: "#1c2235", iris: "#5ee8ff", accent: "#5ee8ff" },
  flame: { base: "#ff7a2e", dark: "#d4431b", light: "#ffb347", rim: "#ffe38a", line: "#6e1f08", belly: "#ffd25e", iris: "#3a1205", accent: "#ff5f6e" },
  zombie: { base: "#7fb37a", dark: "#4f7d4c", light: "#a6d39b", rim: "#d4f0c8", line: "#1d3320", belly: "#5a4a7a", iris: "#c9d68a", accent: "#b06a8a" },
};

const ln = (c: Palette, w = 1.6) => `stroke="${c.line}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

function eyes(c: Palette, { y = 33, gap = 11, rx = 5.2, ry = 6, brows = 0, lazy = false } = {}): string {
  const xs = [40 - gap / 2, 40 + gap / 2];
  const one = (x: number, i: number) => {
    const sx = lazy && i === 1 ? 0.82 : 1;
    return `<ellipse cx="${x}" cy="${y}" rx="${rx * sx}" ry="${ry * sx}" fill="#fff" ${ln(c)}/>
    <g class="pupils"><ellipse cx="${x + 0.6}" cy="${y + 0.6}" rx="${rx * 0.66 * sx}" ry="${ry * 0.72 * sx}" fill="${c.iris}"/>
    <ellipse cx="${x + 0.8}" cy="${y + 0.9}" rx="${rx * 0.36 * sx}" ry="${ry * 0.42 * sx}" fill="#0b0b12"/>
    <circle cx="${x - rx * 0.26}" cy="${y - ry * 0.32}" r="${rx * 0.27 * sx}" fill="#fff"/><circle cx="${x + rx * 0.32}" cy="${y + ry * 0.36}" r="${rx * 0.11}" fill="#fff"/></g>`;
  };
  const lid = (x: number) => `<path d="M${x - rx - 0.6} ${y} a${rx + 0.6} ${ry + 0.6} 0 0 1 ${2 * rx + 1.2} 0 a${rx + 0.6} ${ry * 0.5} 0 0 1 ${-(2 * rx + 1.2)} 0 Z" fill="${c.base}" ${ln(c)}/>`;
  const happy = (x: number) => `<path d="M${x - rx} ${y + 1} q${rx} ${-ry * 1.1} ${2 * rx} 0" fill="none" ${ln(c, 2.2)}/>`;
  const brow = brows
    ? `<path d="M${xs[0] - rx} ${y - ry - 2.5 - brows} q${rx} -2 ${2 * rx} ${brows * 0.5}" fill="none" ${ln(c, 1.8)}/><path d="M${xs[1] + rx} ${y - ry - 2.5 - brows} q${-rx} -2 ${-2 * rx} ${brows * 0.5}" fill="none" ${ln(c, 1.8)}/>`
    : "";
  return `<g class="eyes-open">${one(xs[0], 0)}${one(xs[1], 1)}<g class="lids">${lid(xs[0])}${lid(xs[1])}</g></g><g class="eyes-happy">${happy(xs[0])}${happy(xs[1])}</g>${brow}`;
}

/** The robot's eyes: two LED pills on its screen, with the same states (blink, happy arcs, closed). */
function ledEyes(c: Palette, y = 33): string {
  const pill = (x: number) => `<rect x="${x - 2.6}" y="${y - 4.6}" width="5.2" height="9.2" rx="2.6" fill="${c.iris}"/><rect x="${x - 1.6}" y="${y - 3.6}" width="1.6" height="3" rx=".8" fill="#fff" opacity=".8"/>`;
  const lid = (x: number) => `<rect x="${x - 3.2}" y="${y - 5.2}" width="6.4" height="10.4" rx="3" fill="${c.belly}"/>`;
  const happy = (x: number) => `<path d="M${x - 3} ${y + 1} q3 -4.5 6 0" fill="none" stroke="${c.iris}" stroke-width="2.4" stroke-linecap="round"/>`;
  return `<g class="eyes-open"><g class="pupils">${pill(34)}${pill(46)}</g><g class="lids">${lid(34)}${lid(46)}</g></g><g class="eyes-happy">${happy(34)}${happy(46)}</g>`;
}

function mouth(c: Palette, y = 42, { fang = false, led = false } = {}): string {
  if (led)
    return `<g class="mouth">
    <path class="m-smile" d="M35 ${y} q5 3 10 0" fill="none" stroke="${c.iris}" stroke-width="1.8" stroke-linecap="round"/>
    <rect class="m-open" x="35" y="${y - 1.5}" width="10" height="4" rx="2" fill="${c.iris}"/>
    <circle class="m-o" cx="40" cy="${y + 0.5}" r="2" fill="${c.iris}"/>
    <path class="m-sleep" d="M37 ${y + 0.5} h6" stroke="${c.iris}" stroke-width="1.6" stroke-linecap="round" opacity=".6"/></g>`;
  return `<g class="mouth">
    <path class="m-smile" d="M36.5 ${y} q3.5 3 7 0" fill="none" ${ln(c)}/>
    <g class="m-open"><path d="M35.5 ${y - 0.5} q4.5 6.5 9 0 Z" fill="#7a1f2e" ${ln(c)}/><path d="M37.6 ${y + 2.4} q2.4 1.6 4.8 0" fill="#ff8a9e"/>${fang ? `<path d="M37.5 ${y - 0.3} l1 1.8 1 -1.8 Z" fill="#fff"/>` : ""}</g>
    <ellipse class="m-o" cx="40" cy="${y + 1}" rx="2" ry="2.4" fill="#7a1f2e" ${ln(c)}/>
    <ellipse class="m-sleep" cx="40" cy="${y + 1}" rx="1.2" ry=".9" fill="${c.line}"/></g>`;
}

const cheeks = (c: Palette, y = 39) => `<ellipse cx="28.5" cy="${y}" rx="3" ry="1.8" fill="${c.accent}" opacity=".5"/><ellipse cx="51.5" cy="${y}" rx="3" ry="1.8" fill="${c.accent}" opacity=".5"/>`;

/** A shape lit from the upper left: base, shadow side, light side, a rim of light along the top edge, the outline. `key` keeps clip ids apart. */
function shaded(c: Palette, d: string, key: string, rim = true): string {
  const id = `pet-${key}`;
  return `<clipPath id="${id}"><path d="${d}"/></clipPath>
    <path d="${d}" fill="${c.base}"/>
    <g clip-path="url(#${id})"><ellipse cx="56" cy="66" rx="30" ry="26" fill="${c.dark}" opacity=".6"/><ellipse cx="25" cy="17" rx="19" ry="13" fill="${c.light}" opacity=".7"/>
    ${rim ? `<path d="${d}" fill="none" stroke="${c.rim}" stroke-width="2.4" opacity=".35" transform="translate(.9 1.1)"/>` : ""}</g>
    <path d="${d}" fill="none" ${ln(c)}/>`;
}

function legs(c: Palette, { leg = c.base, paw = c.dark } = {}): string {
  return `
    <g class="leg-l"><rect x="31" y="62" width="7" height="11" rx="3.5" fill="${leg}" ${ln(c)}/><ellipse cx="34.5" cy="73" rx="4.8" ry="2.5" fill="${paw}" ${ln(c)}/></g>
    <g class="leg-r"><rect x="42" y="62" width="7" height="11" rx="3.5" fill="${leg}" ${ln(c)}/><ellipse cx="45.5" cy="73" rx="4.8" ry="2.5" fill="${paw}" ${ln(c)}/></g>`;
}

function arms(c: Palette, { arm = c.base, paw = c.dark, pad = "" } = {}): { l: string; r: string } {
  const one = (cls: string, d: string, x: number, extra: string) =>
    `<g class="${cls}"><path d="${d}" fill="none" stroke="${c.line}" stroke-width="7.4" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${arm}" stroke-width="4.8" stroke-linecap="round"/><circle cx="${x}" cy="62.5" r="3.1" fill="${paw}" ${ln(c)}/>${extra}</g>`;
  return { l: one("arm-l", "M28 49 C22 52 20 58 22 62", 22, pad ? pad.replaceAll("$X", "25") : ""), r: one("arm-r", "M52 49 C58 52 60 58 58 62", 58, pad ? pad.replaceAll("$X", "55") : "") };
}

/** A stroke with an outline: the ink below, the colour on top. */
const inked = (c: Palette, d: string, w: number, color: string, cls = "") => `<path${cls ? ` class="${cls}"` : ""} d="${d}" fill="none" stroke="${c.line}" stroke-width="${w + 2.4}" stroke-linecap="round"/><path${cls ? ` class="${cls}"` : ""} d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;

const BODY = "M27 58 C27 49 33 45 40 45 C47 45 53 49 53 58 C53 66 47 70 40 70 C33 70 27 66 27 58 Z";
const HEAD = "M20 32 C20 19 29 13 40 13 C51 13 60 19 60 32 C60 43 51 49 40 49 C29 49 20 43 20 32 Z";

const FX = `<g class="fx">
  <text class="note" x="60" y="22" font-size="11" font-weight="700" fill="#ffd36a">&#9835;</text><text class="note b" x="12" y="24" font-size="10" font-weight="700" fill="#9fd8ff">&#9834;</text>
  <path class="speed" d="M8 42 h9" stroke="#9fb2ff" stroke-width="2" stroke-linecap="round"/><path class="speed b" d="M4 52 h10" stroke="#9fb2ff" stroke-width="2" stroke-linecap="round"/><path class="speed c" d="M9 61 h7" stroke="#9fb2ff" stroke-width="2" stroke-linecap="round"/>
  <g class="dust"><circle cx="30" cy="74" r="2.6" fill="#c9cfe6"/><circle cx="27" cy="72.5" r="1.8" fill="#c9cfe6"/></g>
  <g class="dust b"><circle cx="41" cy="74.5" r="2.4" fill="#c9cfe6"/><circle cx="38" cy="73" r="1.6" fill="#c9cfe6"/></g>
  <g class="bang"><circle cx="64" cy="14" r="7" fill="#ffcf3a" stroke="#7a5200" stroke-width="1.4"/><path d="M64 9.5 v5.5" stroke="#5a3b00" stroke-width="2.4" stroke-linecap="round"/><circle cx="64" cy="18" r="1.3" fill="#5a3b00"/></g>
  <path class="spark" d="M14 16 l1.6 3.6 3.6 1.6 -3.6 1.6 -1.6 3.6 -1.6 -3.6 -3.6 -1.6 3.6 -1.6 Z" fill="#ffe36a"/>
  <path class="spark b" d="M66 12 l1.3 3 3 1.3 -3 1.3 -1.3 3 -1.3 -3 -3 -1.3 3 -1.3 Z" fill="#9ff0ff"/>
  <path class="spark c" d="M70 34 l1 2.4 2.4 1 -2.4 1 -1 2.4 -1 -2.4 -2.4 -1 2.4 -1 Z" fill="#ffb3e6"/>
  <text class="z" x="58" y="18" font-size="11" font-weight="800" fill="#b9c2ea">z</text><text class="z b" x="64" y="11" font-size="8" font-weight="800" fill="#b9c2ea">z</text>
</g>`;

interface Parts { back: string; body: string; arms: { l: string; r: string }; legs: string; head: string }

const art: Record<PetId, (c: Palette) => Parts> = {
  cat: (c) => ({
    back: `<path class="tail" d="M52 64 C62 64 66 54 62 46 C61 44 63 42 65 44 C70 52 66 68 53 68 Z" fill="${c.base}" ${ln(c)}/>`,
    body: shaded(c, BODY, "cat-b") + `<ellipse cx="40" cy="60" rx="7" ry="7.5" fill="${c.belly}"/>`,
    arms: arms(c),
    legs: legs(c, { paw: "#3a3f5c" }),
    head: `<path d="M22 25 L22 8 L35 16 Z" fill="${c.base}" ${ln(c)}/><path d="M25 20 L25 12.5 L31 16.5 Z" fill="${c.accent}" opacity=".7"/>
      <path d="M58 25 L58 8 L45 16 Z" fill="${c.base}" ${ln(c)}/><path d="M55 20 L55 12.5 L49 16.5 Z" fill="${c.accent}" opacity=".7"/>
      ${shaded(c, HEAD, "cat-h")}${eyes(c)}<path d="M38.4 38.4 h3.2 l-1.6 1.8 Z" fill="${c.accent}" ${ln(c, 1)}/>${mouth(c, 41.5)}
      <path d="M12 36 h8 M12.5 40 l7.5 -1.5 M68 36 h-8 M67.5 40 l-7.5 -1.5" stroke="#cfd5f5" stroke-opacity=".6" stroke-width="1" stroke-linecap="round"/>`,
  }),
  cocker: (c) => {
    // Long ears in waves of curls, hanging past the jaw: the breed's look.
    const ear = (cls: string, x: number, dir: number) => `<g class="${cls}"><path d="M${x} 20 C${x - 9 * dir} 22 ${x - 12 * dir} 34 ${x - 11 * dir} 44 C${x - 13 * dir} 47 ${x - 10 * dir} 50 ${x - 7 * dir} 49 C${x - 6 * dir} 52 ${x - 2 * dir} 52 ${x - dir} 49 C${x + 2 * dir} 50 ${x + 3 * dir} 46 ${x + dir} 43 C${x + 3 * dir} 36 ${x + 3 * dir} 26 ${x} 20 Z" fill="${c.base}" ${ln(c)}/>
      <path d="M${x - 8 * dir} 32 q${-2 * dir} 3 0 6 M${x - 6 * dir} 40 q${-2 * dir} 3 0 6 M${x - 3 * dir} 28 q${-2 * dir} 3 0 6" fill="none" stroke="${c.rim}" stroke-width="1" opacity=".4" stroke-linecap="round"/></g>`;
    return {
      back: inked(c, "M52 62 C58 60 61 55 60 51", 3.6, c.base, "tail"),
      body: shaded(c, BODY, "cocker-b") + `<ellipse cx="40" cy="60" rx="7" ry="7.5" fill="${c.belly}"/>`,
      arms: arms(c),
      legs: legs(c),
      head: `${shaded(c, HEAD, "cocker-h")}
        <path d="M30 40 C30 35 34 33 40 33 C46 33 50 35 50 40 C50 45 45 47 40 47 C35 47 30 45 30 40 Z" fill="${c.light}" opacity=".55"/>
        ${eyes(c, { y: 30.5, gap: 12, rx: 4.6, ry: 5.2, brows: 0.5 })}
        <ellipse cx="40" cy="37.5" rx="3.4" ry="2.4" fill="#0b0a0e" ${ln(c, 1)}/><ellipse cx="39" cy="36.7" rx="1.1" ry=".6" fill="#fff" opacity=".7"/>
        ${mouth(c, 41.5)}${ear("ear-l", 23, 1)}${ear("ear-r", 57, -1)}
        <path d="M31 15 q9 -5 18 0" fill="none" stroke="${c.rim}" stroke-width="1.2" opacity=".45" stroke-linecap="round"/>`,
    };
  },
  monkey: (c) => ({
    back: inked(c, "M52 64 C64 66 68 56 63 50 C60 47 56 50 59 53", 3.2, c.base, "tail"),
    body: shaded(c, BODY, "monkey-b") + `<ellipse cx="40" cy="60" rx="8" ry="8" fill="${c.belly}" ${ln(c)}/>`,
    arms: arms(c),
    legs: legs(c),
    head: `<g class="ear-l"><circle cx="18.5" cy="32" r="6.5" fill="${c.base}" ${ln(c)}/><circle cx="18.5" cy="32" r="3.6" fill="${c.belly}"/></g>
      <g class="ear-r"><circle cx="61.5" cy="32" r="6.5" fill="${c.base}" ${ln(c)}/><circle cx="61.5" cy="32" r="3.6" fill="${c.belly}"/></g>
      ${shaded(c, HEAD, "monkey-h")}
      <path d="M26 34 C26 24 33 23 40 27 C47 23 54 24 54 34 C54 42 47 46 40 46 C33 46 26 42 26 34 Z" fill="${c.belly}" ${ln(c)}/>
      ${eyes(c, { y: 32, gap: 10.5, rx: 4.6, ry: 5.2 })}${cheeks(c, 39)}
      <path d="M38 37.5 h4" stroke="${c.line}" stroke-width="1.4" stroke-linecap="round"/>${mouth(c, 41)}
      <path d="M34 15 q6 -4 12 0" fill="none" ${ln(c, 1.4)}/>`,
  }),
  sloth: (c) => ({
    back: "",
    body: shaded(c, BODY, "sloth-b") + `<ellipse cx="40" cy="59" rx="8" ry="8.5" fill="${c.belly}"/>`,
    arms: arms(c, { paw: "#efe0c4" }),
    legs: legs(c, { paw: "#efe0c4" }),
    head: `${shaded(c, HEAD, "sloth-h")}
      <path d="M24 33 C24 24 31 21 40 21 C49 21 56 24 56 33 C56 42 49 47 40 47 C31 47 24 42 24 33 Z" fill="${c.belly}" ${ln(c)}/>
      <path d="M26.5 33.5 C27 28 33.5 27.5 35 32 C34.5 37 28 38 26.5 33.5 Z M53.5 33.5 C53 28 46.5 27.5 45 32 C45.5 37 52 38 53.5 33.5 Z" fill="#6b5034"/>
      ${eyes(c, { y: 32.6, gap: 13, rx: 3.6, ry: 4 })}
      <ellipse cx="40" cy="38" rx="3" ry="2" fill="#3d2f1f"/><ellipse cx="39.2" cy="37.4" rx="1" ry=".5" fill="#fff" opacity=".6"/>${mouth(c, 42)}`,
  }),
  samurai: (c) => {
    // Lacquered armour: a dark kabuto with a flared neck guard and gold crescent horns, a do with gold trim and red lacing,
    // shoulder plates on the arms (they move with them), plated tassets, and the katana at the left hip.
    const k: Palette = { ...c, base: "#262a40", dark: "#11131f", light: "#4a5072", rim: "#9aa3d8" };
    const skin: Palette = { ...c, base: "#ffe2c8", dark: "#e5b994", light: "#fff4e8", rim: "#fff" };
    const lace = (x1: number, x2: number, y: number) => `<path d="M${x1} ${y} H${x2}" stroke="#d23a35" stroke-width="1.6"/>`;
    const sode = `<path d="M$X 46 m-6 0 h12 v4 h-12 Z M$X 50.5 m-6.4 0 h12.8 v4 h-12.8 Z M$X 55 m-6.8 0 h13.6 v4 h-13.6 Z" fill="${k.base}" ${ln(c, 1.3)}/>
      <path d="M$X 48 m-5.5 0 h11 M$X 52.5 m-6 0 h12 M$X 57 m-6.3 0 h12.6" stroke="#d23a35" stroke-width="1.1"/><path d="M$X 46 m-6 0 h12" stroke="#e2b43c" stroke-width="1.4"/>`;
    const DO = "M28 52 C28 47 33 45 40 45 C47 45 52 47 52 52 L51 62 C51 64 46 65.5 40 65.5 C34 65.5 29 64 29 62 Z";
    return {
      back: `${inked(c, "M25 66 L54 56", 3, "#1d1b2a")}
        <path d="M54 56 L61 53.5" stroke="${c.line}" stroke-width="4.4" stroke-linecap="round"/><path d="M54 56 L61 53.5" stroke="#e9e2d0" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="1.6 1.2"/>
        <path d="M52.4 54 L54.4 59" stroke="#e2b43c" stroke-width="2.4" stroke-linecap="round"/>`,
      body: `<path d="M30 62 h20 l1.5 8 h-23 Z" fill="${k.base}" ${ln(c, 1.3)}/><path d="M30 65 h20.6 M29.3 68 h21.6" stroke="#d23a35" stroke-width="1.2"/><path d="M35 62 v8 M40 62 v8 M45 62 v8" stroke="${c.line}" stroke-width="1"/>`
        + shaded(k, DO, "samurai-b") + `<path d="M29 51 Q40 47 51 51" fill="none" stroke="#e2b43c" stroke-width="1.6"/>${lace(30, 50, 55)}${lace(29.6, 50.4, 58.5)}${lace(29.4, 50.6, 62)}
          <circle cx="40" cy="51.5" r="2.4" fill="#d23a35" stroke="#e2b43c" stroke-width="1"/>`,
      arms: arms(c, { arm: "#3a3f5c", paw: "#ffe2c8", pad: sode }),
      legs: legs(c, { leg: "#1d1b2a", paw: "#0f0d18" }),
      head: `<path d="M14 30 C14 36 18 42 24 44 L26 36 Z M66 30 C66 36 62 42 56 44 L54 36 Z" fill="${k.base}" ${ln(c, 1.3)}/>
        <path d="M15.5 34 l9 3 M17.5 39 l7.5 2 M64.5 34 l-9 3 M62.5 39 l-7.5 2" stroke="#d23a35" stroke-width="1.1"/>
        ${shaded(skin, "M23 34 C23 25 30 21 40 21 C50 21 57 25 57 34 C57 43 50 48 40 48 C30 48 23 43 23 34 Z", "samurai-f")}
        ${eyes(c, { y: 35, gap: 11, rx: 4.2, ry: 4.8 })}
        <path d="M30.5 28.5 l7.5 3 M49.5 28.5 l-7.5 3" stroke="${c.line}" stroke-width="2.6" stroke-linecap="round"/>
        ${cheeks(c, 41.5)}${mouth(c, 44)}
        ${shaded(k, "M15 31 C15 14 26 8 40 8 C54 8 65 14 65 31 C58 26.5 49 25 40 25 C31 25 22 26.5 15 31 Z", "samurai-h")}
        <path d="M17 31 C24 27 32 26 40 26 C48 26 56 27 63 31" fill="none" stroke="#e2b43c" stroke-width="1.8"/>
        <path d="M24 19 Q40 13 56 19" fill="none" stroke="#d23a35" stroke-width="1.2" opacity=".8"/>
        <path d="M37 21 C30 17 24 9 25 1 C29 7 34 12 40 16 C46 12 51 7 55 1 C56 9 50 17 43 21 Z" fill="#f2c24a" ${ln(c, 1.3)}/>
        <path d="M27 4 C29 9 33 13 38 16" fill="none" stroke="#fff3c4" stroke-width="1" opacity=".8" stroke-linecap="round"/>
        <circle cx="40" cy="19.5" r="3.4" fill="#d23a35" stroke="#e2b43c" stroke-width="1.4"/><circle cx="39" cy="18.6" r=".9" fill="#ffb3a8"/>`,
    };
  },
  robot: (c) => {
    const SCREEN = "M25 31 C25 24 30 21 40 21 C50 21 55 24 55 31 C55 39 50 43 40 43 C30 43 25 39 25 31 Z";
    return {
      back: "",
      body: shaded(c, "M28 57 C28 49 32 46 40 46 C48 46 52 49 52 57 L52 64 C52 68 48 70 40 70 C32 70 28 68 28 64 Z", "robot-b")
        + `<rect x="34" y="53" width="12" height="9" rx="3" fill="${c.belly}" ${ln(c, 1.2)}/><circle cx="37.5" cy="57.5" r="1.4" fill="#ff6b8a"/><circle cx="42.5" cy="57.5" r="1.4" fill="${c.iris}"/>`,
      arms: arms(c, { arm: "#8792b0", paw: c.dark }),
      legs: legs(c, { leg: "#8792b0", paw: c.dark }),
      head: `${inked(c, "M40 13 V6", 1.6, "#8792b0")}
        <circle class="bulb" cx="40" cy="5" r="3" fill="${c.iris}" ${ln(c, 1.2)}/>
        <rect x="16" y="27" width="5" height="10" rx="2.5" fill="#8792b0" ${ln(c)}/><rect x="59" y="27" width="5" height="10" rx="2.5" fill="#8792b0" ${ln(c)}/>
        ${shaded(c, "M20 30 C20 18 28 13 40 13 C52 13 60 18 60 30 C60 42 52 47 40 47 C28 47 20 42 20 30 Z", "robot-h")}
        <path d="${SCREEN}" fill="${c.belly}" ${ln(c, 1.4)}/>
        <path d="M28 25 q6 -3 14 -2" fill="none" stroke="#fff" stroke-width="1.4" opacity=".25" stroke-linecap="round"/>
        ${ledEyes(c, 31)}${mouth(c, 38.5, { led: true })}`,
    };
  },
  flame: (c) => {
    // A flame for a head and body, in two flickering layers, on ember feet.
    const OUTER = "M40 4 C46 12 55 19 57 31 C59 44 54 57 47 64 C44 68 36 68 33 64 C26 57 21 44 23 31 C24 24 28 20 31 16 C31 22 33 26 36 27 C35 19 36 11 40 4 Z";
    const INNER = "M40 20 C44 26 49 32 49 41 C49 51 45 58 40 58 C35 58 31 51 31 41 C31 34 34 30 37 27 C37 31 38 33 40 34 C39 29 39 24 40 20 Z";
    return {
      back: "",
      body: "",
      arms: arms(c, { arm: c.light, paw: c.belly }),
      legs: legs(c, { leg: "#8a3a14", paw: "#5a2208" }),
      head: `<g class="flicker">${shaded({ ...c, rim: "#fff3b0" }, OUTER, "flame-o")}</g>
        <g class="flicker b"><path d="${INNER}" fill="${c.belly}"/><path d="${INNER}" fill="none" stroke="#fff6c8" stroke-width="1.2" opacity=".6"/></g>
        ${eyes(c, { y: 41, gap: 10, rx: 3.8, ry: 4.4 })}${cheeks({ ...c, accent: "#ff5f4a" }, 47)}${mouth(c, 50)}`,
    };
  },
  zombie: (c) => ({
    back: "",
    body: shaded({ ...c, base: c.belly, dark: "#3a2f52", light: "#7a68a0", rim: "#b8a8e0" }, BODY, "zombie-b")
      + `<path d="M28 60 l4 3 -3 3 M52 58 l-4 4 3 3" fill="none" ${ln(c, 1.2)}/><path d="M37 50 v14" stroke="#3a2f52" stroke-width="1.4" stroke-dasharray="2 2"/>`,
    arms: arms(c),
    legs: legs(c, { leg: "#4a3d66", paw: "#2b2340" }),
    head: `${shaded(c, HEAD, "zombie-h")}
      <path d="M24 22 l4 -7 3 5 3 -8 3 7 4 -6 2 6 4 -5 2 7" fill="none" ${ln(c, 2)}/>
      <path d="M47 18 l3 6 M46 21 l4 -1" stroke="${c.line}" stroke-width="1.2" stroke-linecap="round"/>
      ${eyes(c, { y: 32, gap: 12, rx: 5, ry: 5.6, lazy: true })}
      <ellipse cx="29" cy="39.5" rx="3" ry="1.8" fill="${c.dark}" opacity=".6"/>
      ${mouth(c, 42, { fang: true })}
      <path d="M44 44 l1.2 2 M46 44 l1.2 2 M48 43.5 l1.2 2" stroke="${c.line}" stroke-width="1" stroke-linecap="round"/>`,
  }),
};

const cache = new Map<PetId, string>();

/** The pet's markup inside an 80x80 viewBox, built once per pet. */
export function petMarkup(id: PetId): string {
  let m = cache.get(id);
  if (!m) {
    const a = art[id](P[id]);
    m = `<ellipse class="shadow" cx="40" cy="76" rx="17" ry="3" fill="#000" opacity=".5"/>
      <g class="rig">${a.back}${a.legs}${a.arms.l}<g class="body">${a.body}</g>${a.arms.r}<g class="head">${a.head}</g></g>${FX}`;
    cache.set(id, m);
  }
  return m;
}
