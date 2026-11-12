# Themes

A theme colours the open panel: its background, text, menus, accents and the warning and critical colours. Pick one under **Settings › Themes**. The closed notch stays black in every theme, so it still blends into the screen edge; a theme can opt in to colour it too.

Built in: Dark (the default), Light, One Dark Pro, GitHub Dark, GitHub Light, Dracula, Night Owl, Catppuccin Mocha, Catppuccin Latte, Nord, Rosé Pine, Rosé Pine Dawn, Gruvbox Dark, Solarized Light and Everforest. All but the first two use the colours of their original palettes under the MIT License, with the few that missed a contrast minimum moved just far enough to pass; the notices are in [`licenses/theme-palettes-MIT.txt`](../licenses/theme-palettes-MIT.txt).

## Changing colours

**Settings › Themes › Colours › Edit** starts from the current theme. Background, foreground, accent, warning and critical each open a colour picker (a square for saturation and brightness, a hue strip, a hex field, arrow keys work on both). Every change shows at once on the whole panel. A new background or foreground also brings new secondary text, tertiary text and menu colours; a background that turns a dark theme light brings a dark foreground if the old one would not read.

**Undo** steps back (a drag across the square is one step), **Discard** drops every change. **Save as new** keeps the changes as a theme of your own; **Overwrite** writes them into the custom theme you started from. Unsaved changes are kept while Crest runs.

## Day and night

**Switch by time of day** picks one theme for the day and one for the night, with the start of each in half hours. A day may run past midnight (20:00 to 08:00). While it is on, choosing a theme card changes the theme of the period you are in.

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

**Settings › Themes › Glass** (off by default, Windows only for now) draws the open panel as glass: the screen behind it shows through, bent along the sides, blurred in the middle, with a light rim. It works while the open panel hangs from the top edge of the screen, from the notch or from the line at the edge; a capsule, the other edges and the Mac keep the opaque panel.

The glass shows a copy of the screen taken as the panel opens, so a video or a page scrolling behind it stays still. Crest copies the area under its window when the pointer rests on the notch (also when it then leaves without opening the panel) or the panel opens another way (a shortcut, the tray menu), again when the panel opens more than 2 seconds after that copy, and again, while the panel is open, if the notch is moved or the glass turns back on without a copy (Glass switched on, presentation mode ended, Crest shown again). The copy stays in memory until the panel closes. Nothing is saved or sent ([PRIVACY.md](../PRIVACY.md)).

The theme still decides the text. Under the content the panel keeps the theme's background as a veil, at the least opacity at which titles, labels and hints keep their minimum over any backdrop, white or black: 78% for Dark, 80% for Light, more for themes whose text is close to its minimum (Catppuccin Latte and Rosé Pine Dawn stay opaque). On buttons and other fills text can come out a little below its minimum. Under the glass the warning, error and success colours are moved just far enough to keep 4.5:1 over the veil. At the Transparency mark only the 16 px bands along the sides, where nothing is written, go down to 35%. The strip at the top keeps the closed notch's colour, so the open panel still hangs from it, and its title takes the closed notch's ink. The album-art tint is left out while the glass shows.

With Glass on, four sliders appear under it, and the glass follows them as they move. Transparency starts at a mark, the theme's safe point: the veil described above, where 22% of the screen shows through with Dark and 20% with Light. To the left the panel covers more, side bands included, up to fully opaque, and every text keeps its minimum. To the right more of the screen shows through, up to the point where the main text keeps 4.5:1 and labels 3:1 over any backdrop (41% with Dark, 44% with Light); past the mark text can be harder to read over light or striped backdrops, and the setting says so. The warning, error and success colours stay as worked out for the mark. Refraction sets how far the rim bends what is behind it, Frost how much the middle is blurred, Rim light how bright the edges shine; each goes from 0 to twice its default.

Glass turns itself off with a Windows contrast theme, with transparency effects off or energy saver on, in a remote session, in presentation mode, over a fullscreen app or in gaming mode, while the album cover fills the panel, while the notch is dragged, and on a PC that runs WebGL only in software. It needs Windows 10 version 2004 or later.
