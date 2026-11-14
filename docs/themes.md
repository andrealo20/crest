# Themes

A theme colours the open panel: its background, text, menus, accents and the warning and critical colours. Pick one under **Settings › Themes**. The closed notch stays black in every theme, so it still blends into the screen edge; a theme can opt in to colour it too.

Built in: Dark (the default), Light, One Dark Pro, GitHub Dark, GitHub Light, Dracula, Night Owl, Catppuccin Mocha, Catppuccin Latte, Nord, Rosé Pine, Rosé Pine Dawn, Gruvbox Dark, Solarized Light and Everforest. All but the first two use the colours of their original palettes under the MIT License, with the few that missed a contrast minimum moved just far enough to pass; the notices are in [`licenses/theme-palettes-MIT.txt`](../licenses/theme-palettes-MIT.txt).

## Changing colours

**Settings › Themes › Colours › Edit** starts from the current theme. Background, foreground, accent, warning and critical each open a colour picker (a square for saturation and brightness, a hue strip, a hex field, arrow keys work on both). Every change shows at once on the whole panel. A new background or foreground also brings new secondary text, tertiary text and menu colours; a background that turns a dark theme light brings a dark foreground if the old one would not read.

**Undo** steps back (a drag across the square is one step), **Discard** drops every change. **Save as new** keeps the changes as a theme of your own; **Overwrite** writes them into the custom theme you started from. Unsaved changes are kept while Crest runs.

## Day and night

**Switch by time of day** picks one theme for the day and one for the night, with the start of each in half hours. A day may run past midnight (20:00 to 08:00). While it is on, choosing a theme card changes the theme of the period you are in.

**At sunrise and sunset** starts the day at sunrise and the night at sunset instead, at the place set under **Settings → General → Weather**. Crest works the two times out on your computer, with no request to any service, and shows today's in place of the two menus. Without a place, and on a day the sun does not rise or set there, the two set times apply.

## Windows high contrast

With a Windows contrast theme on, Crest uses the system colours whatever theme is chosen: window text on the window colour, gray text for quiet text, the highlight colour for accents. The theme comes back when contrast is turned off.

## Theme files

A theme is a JSON file. **Export** writes the theme on screen (the unsaved colours too, while editing) to `%APPDATA%\io.github.andrealo20.crest\themes\<id>.json` (in a portable copy that is `data\themes` next to `Crest.exe`, on a Mac `~/Library/Application Support/io.github.andrealo20.crest/themes`). **Import** reads every `.json` file in that folder (**Open folder** opens it, at most 100 files are read) and adds the valid ones to your themes. It never replaces a theme: a file equal to one you have is skipped, and a different file with the id of one of yours comes in beside it as `<id>-2`, so an old export cannot undo later edits. An export of a built-in theme is skipped; a file that reuses a built-in id with other colours is refused. Each file that cannot be used is listed with the reason.

```json
{
  "format": 1,
  "id": "midnight-teal",
  "name": "Midnight teal",
  "colors": {
    "background": "#04161a",
    "foreground": "#e6f4f1",
    "accent": "#2dd4bf",
    "warning": "#f5b94a",
    "critical": "#ff6b6b"
  },
  "closedNotch": "black"
}
```

| Key | Use | Minimum contrast |
| --- | --- | --- |
| `background` | The open panel: opaque, or the veil over the glass when **Glass** is on (see below) | |
| `foreground` | Titles and main text | 7:1 on the background and menus |
| `secondary` | Labels | 4.5:1 |
| `tertiary` | Hints and small notes | 2.8:1 (Dark's own is 2.9:1) |
| `accent` | Focus, and the music colour when nothing plays | 3:1 |
| `link` | Links and badges; follows `accent` when left out | 3:1 |
| `warning` | Warnings, also as text | 4.5:1 |
| `critical` | Errors and critical levels, also as text | 4.5:1 |
| `success` | Switches, checks and gains, also as text | 4.5:1 |
| `elevated` | Menus and pop-ups | |

Every colour is optional; what a file leaves out follows from the background (dark or light) and the foreground. Colours are `#rgb`, `#rrggbb`, `#rrggbbaa` (alpha last, as in CSS) or `rgb(r g b / a)`. `closedNotch` is `"black"` (the default) or `"background"`. `id` (letters, digits, `-`, `_`, `.`) is made from `name` when left out. `description`, `author`, `license` and `homepage` are kept; other fields are ignored. The file is plain JSON (no comments) and at most 64 KB. An unknown colour key, a value that is not a colour, or a newer `format` makes the file unusable.

## Readability

A theme decides how the panel looks, never whether it can be read. Each colour is checked against the backgrounds it is drawn on (the panel, the menus and the button fills). One that misses its minimum is made lighter or darker along its own hue, whichever needs the smaller change, just far enough to pass; a colour that passes is used as written. The editor lists every change it made. The colour taken from the album cover gets the same check against the panel's background, so it stays visible on a light theme. Every built-in theme passes as written.

## Glass

**Settings › Themes › Glass** (off by default, Windows only for now) draws the open panel as glass: the screen behind it shows through, bent along the sides, blurred in the middle, with a light rim. It works while the open panel hangs from the top edge of the screen, from the notch or from the line, and on the capsule, whose panel is glass all round when it floats away from the edge; the other edges and the Mac keep the opaque panel.

The glass shows a copy of the screen taken as the panel opens, so a video or a page scrolling behind it stays still. Crest copies the area under its window when the pointer rests on the notch (also when it then leaves without opening the panel) or the panel opens another way (a shortcut, the tray menu), again when the panel opens more than 2 seconds after that copy, and again, while the panel is open, if the notch is moved or the glass turns back on without a copy (Glass switched on, presentation mode ended, Crest shown again). The copy stays in memory until the panel closes. Nothing is saved or sent ([PRIVACY.md](../PRIVACY.md)).

The theme still decides the text. Under the content the panel keeps the theme's background as a veil, at the least opacity at which titles, labels and hints keep their minimum over any backdrop, white or black: 78% for Dark, 80% for Light, more for themes whose text is close to its minimum (Catppuccin Latte and Rosé Pine Dawn stay opaque). On buttons and other fills text can come out a little below its minimum. Under the glass the warning, error and success colours are moved just far enough to keep 4.5:1 over the veil. At the Transparency mark only the 16 px bands along the sides, where nothing is written, go down to 35%; the tool bar stays at 35% wherever the slider is (see below). The strip at the top keeps the closed notch's colour, so the open panel still hangs from it, and its title takes the closed notch's ink. A floating capsule has no such strip. The album-art tint is left out while the glass shows.

With Glass on, four sliders appear under it, and the glass follows them as they move. Transparency starts at a mark, the theme's safe point: the veil described above, where 22% of the screen shows through with Dark and 20% with Light. To the left the panel covers more, side bands included, up to fully opaque, and every text keeps its minimum. To the right more of the screen shows through, up to the point where the main text keeps 4.5:1 and labels 3:1 over any backdrop (41% with Dark, 44% with Light); past the mark text, links and coloured icons can be harder to read over light or striped backdrops (the setting says so for text). The warning, error and success colours stay as worked out for the mark. Refraction sets how far the rim bends what is behind it and how much the drop in the tool bar magnifies, Frost how much the middle is blurred, Rim light how bright the edges shine; each goes from 0 to twice its default.

Over the glass the tool bar is a capsule of clear glass, with its own bent rim and light, resting on the panel's bottom edge. Its veil is the side bands' (65% of the screen shows through), and Transparency leaves it as it is in both directions; Refraction, Frost and Rim light apply to it as to the rest of the glass. No colour keeps 3:1 over every backdrop through so clear a veil, and one as light as the backdrop behind it disappears, so the icons, the current tool's mark and the update dot take one ink, white on dark themes and black on light ones, coloured icons included: no colour reads better over its worst backdrop. With Dark the icons keep 2.43:1 over a white page (2.07:1 under the drop), with Light 2.95:1 over black (2.65:1). A custom theme with a mid grey background gets the ink that does better at its worst, which can be the wrong one for the backdrop it mostly sits on: black over a dark desktop, or white over a white page. A drop of glass marks the current tool. Under the pointer, or the keyboard's focus, it slides to the tool pointed at, rises a little out of the bar, magnifies the icon and catches the light; a click squashes it and it bounces back; when the pointer leaves it goes back to the current tool. With reduced motion it jumps from tool to tool, and neither rises nor squashes. Where the glass does not show (Glass off, the Mac, the other edges, or the cases below that turn it off) the drop is a brighter pill that moves the same way: it rises only as far as the bar's top, and the icon under it grows by 15% whatever Refraction is set to.

**Also the closed notch and capsule**, under Glass (off by default; Windows 11 24H2 or later on x64, not in the Microsoft Store version for now), draws the closed notch on the top edge and the capsule as glass too, over a live copy of the screen just around them, which Crest renews up to 10 times a second when something there changes. The closed row keeps its ink: under it the veil is the closed notch's colour, black unless the theme colours it, at the opacity that keeps that text readable over any backdrop (78% with the black notch), and Transparency moves it as it moves the panel's. Over it the album colour, links, the readings' yellow and coloured icons are moved just far enough to keep 3:1, and the warning, error and success colours 4.5:1. The rim is thinner than the panel's and casts no shadow inward, so it stays clear of the row. Until the first copy comes, and whenever the copy stops for good, the closed shapes keep their usual colour; while the pointer rests on the notch they keep the last copy. As the panel closes the notch takes its colour for a moment, and the glass comes back once the panel has gone. The line, the other edges and the copies of the notch on other monitors stay as they are.

While Glass and the switch are on, the notch and the capsule, open or closed, are left out of every screenshot, recording and screen share, Crest's own included, also while the live copy is stopped: whoever sees your shared screen sees the desktop where the notch is, on the monitor the notch itself is on. The copies of the notch on other monitors and the floating timer stay in other apps' captures, unless Hide Crest from screen sharing and recordings is on, which leaves every Crest window out. The notch stays out with the line, the notch on a side edge or WebGL only in software too, where nothing is drawn as glass. Windows that keep themselves out of captures and protected video come out missing or black in the glass. Software that looks for windows hidden from screen capture may flag Crest while the switch is on ([PRIVACY.md](../PRIVACY.md)).

The live copy costs, measured on a Radeon 890M at 10 frames a second: under half a percent of a core in Crest whenever anything on that screen changes, about 1% whenever something under the notch redraws (the notch itself, or a window there, even one covered by another), a few MB of graphics memory with the notch or the capsule near the top edge (tens of MB with a capsule far down the screen, since the copy then spans the screen down to it), and from 3 to 11 points of a core in Windows' compositor whenever anything on that screen changes, which a lower frame rate would not reduce. While what shows behind the notch keeps changing Crest draws each new copy too, and its processes together then take about 7% of a core. That is why the switch carries a note about the battery. On battery the copy keeps running; with energy saver on it stops, as all of the glass does. It also stops while the pointer rests on the notch or the panel is open (the panel takes its own copy), while the notch is hidden, dragged or shown as a line, in presentation mode, over a fullscreen app or in gaming mode, with a contrast theme or transparency effects off, while the screen is off or locked or the PC sleeps, and in a remote session. On a screen in HDR the copy is in SDR: a video or a game in HDR behind the notch comes out cut at SDR white.

Glass turns itself off with a Windows contrast theme, with transparency effects off or energy saver on, in a remote session, in presentation mode, over a fullscreen app or in gaming mode, while the album cover fills the panel on a light theme (the panel then takes light text, which a light veil would not carry; on a dark theme the cover stays, partly see-through over the glass), while the notch is dragged, and on a PC that runs WebGL only in software. It needs Windows 10 version 2004 or later.
