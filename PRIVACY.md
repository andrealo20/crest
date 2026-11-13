# Crest privacy policy

Last updated: 13 November 2026.

Crest is a free, open-source Windows and Mac app by Andrea Loroni. It has no account, no server of its own, no analytics and no tracking. Nothing is sent to the developer.

## What Crest keeps on your PC

- Settings, to-dos, notes, timer presets, themes, the lyrics cache and the other tool data, in the app's data folders under your Windows profile (`%APPDATA%\io.github.andrealo20.crest` and `%LOCALAPPDATA%\io.github.andrealo20.crest`), or in the `data` folder next to Crest.exe for the portable build. On a Mac they are in `~/Library/Application Support/io.github.andrealo20.crest`.
- API keys and other secrets, in the Windows Credential Manager (the login Keychain on a Mac) under "Crest/…". They are never written to a plain file. Calendar links and CalDAV app passwords are kept there too, as "Crest/calendar.…".
- The events of your calendars from two months back to about three months ahead (titles, places and times), the span the month view can show, in `calendar-cache.json` in the app's data folder, so the agenda shows offline. Removing a calendar drops its events from the file at the next refresh.
- The vault (passwords and 2FA codes, off by default), in one file encrypted with Windows DPAPI and readable only under your Windows account. With Windows Hello turned on it is additionally sealed with a TPM-backed key.
- Screenshots and recordings you take, in *Pictures\Screenshots* and *Videos\Crest\Recordings*; audio-only recordings of the Recorder tool (off by default; the microphone, the system audio or both, only while you record) in *Music\Crest\Recordings*. They stay on the PC.
- Backups you make (Settings, General), in *Documents\Crest\Backups* (*~/Documents/Crest/Backups* on a Mac): your settings, notes, to-dos and the tools' data as plain JSON, without keys, passwords, calendar links or the vault. Crest sends them nowhere; a Documents folder that OneDrive or iCloud Drive syncs takes them along.
- Plugins you install, in the `plugins` folder of the app's data folder, and the data of those that keep any, in `plugin-data`.
- A crash log (`crash.log` in the `logs` folder), written only when the app crashes or hits an uncaught error. It is not sent anywhere.

The clipboard history and the history of live notices are kept in memory only and are gone when Crest quits.

Send to phone (Shelf) opens a small web server on your computer's local network address, only when you press it. It serves the files you picked to whoever opens its link, which holds a random token and is shown as a QR code, and stops after 10 minutes, when the Shelf closes or when you stop it; a download already running finishes. It is plain HTTP, so the files are not encrypted on the Wi-Fi, and nothing goes through a server of anyone else or leaves your network. Your firewall may ask to allow it.

The Camera tool (off by default) shows the camera picture only on your screen, while the tool is open. It never records, saves or sends it.

Find on screen reads your screens with Windows' own text recognition, on your PC: the screen copies are dropped as soon as they are read, and the text stays in memory until the page closes. Nothing is saved or sent.

Glass (Settings, Themes; off by default, Windows only) copies the part of the screen under Crest's window into memory to draw the open panel as glass: when the pointer rests on the notch (also when it then leaves without opening the panel) or the panel opens another way (a shortcut, the tray menu), again when the panel opens more than 2 seconds after that copy, and again, while the panel is open, if the notch is moved or the glass turns back on without a copy (Glass switched on, presentation mode ended, Crest shown again). The copy is never saved or sent and never shown in a later opening; it is dropped when the panel closes or the pointer leaves the notch, and when presentation mode starts or Crest is hidden. While the panel stays open the copy is kept, also while the glass is hidden for a moment, so the glass keeps showing what was behind it when the panel opened, also in a screenshot or a screen share started meanwhile. While it copies, Crest's notch is left out of other apps' screenshots and screen shares for a few hundredths of a second (about 30 ms, up to about 50 on a 60 Hz screen).

Glass on the closed notch and the capsule (Settings, Themes, **Also the closed notch and capsule** under Glass; off by default; Windows 11 24H2 or later on x64, not in the Microsoft Store version for now) keeps a live copy of the screen just around the closed notch or the capsule, renewed up to 10 times a second and only when something there changes, using Windows' own screen capture without the yellow border. Windows hands Crest the part of the screen from its top left corner to the far corner of that area (for the notch, a band along the top edge; for a capsule low on the screen, most of the screen); Crest reads only the part around the notch or the capsule, keeps it in memory, and each copy replaces the one before. Nothing is saved or sent, and plugins never see it. The capture stops when the pointer rests on the notch and while the panel is open (the panel takes its own copy, as above), when the notch is hidden, dragged or shown as a line, in presentation mode, over a fullscreen app or in gaming mode, while the screen is off or locked or the PC sleeps, in a remote session, with energy saver on, a contrast theme or transparency effects off, and when Glass or this setting is turned off. Then the last copy is dropped (when the capture stopped because the pointer rests on the notch, once the panel opens). While Glass and this setting are both on (from a moment after Crest starts), Crest's notch and capsule, open or closed, are left out of every screenshot, recording and screen share, Crest's own included, also while the capture is stopped. That holds for the notch's own window only: the copies of the notch on other monitors and the floating timer stay in captures, unless Hide Crest from screen sharing is on, which leaves every Crest window out. Software that looks for windows hidden from screen capture may flag Crest or close it while the setting is on, as it may with Hide Crest from screen sharing; turn the setting off before using such software.

To remove your data, delete those folders (or the portable folder) and the "Crest/…" entries in the Credential Manager (the Keychain on a Mac).

## Which network requests it makes, and when

Every request goes straight from your PC to the service named here. On by default are the AI usage rings, the weather in Overview and the update check every 4 hours. Everything else makes no request until you set it up or turn it on.

| Feature | Sent to | When |
| --- | --- | --- |
| AI usage | api.anthropic.com, chatgpt.com, cursor.com (with your existing local login for each), claude.ai (with the session key you pasted), openrouter.ai, api.deepseek.com, api.z.ai (with the key you entered); the `agy` CLI on your PC asks Google for Antigravity | While the quota rings show or the tool is open, at most every 2 to 5 minutes, and only for services you are signed in to or have a key for |
| Ask (AI chat) | The provider you chose: api.anthropic.com, api.openai.com, openrouter.ai or your own endpoint (a local server such as LM Studio or Ollama keeps the messages on your PC) | Only when you send a message |
| Portfolio | Each broker you set up, plus api.coingecko.com (coin symbols) and api.frankfurter.dev (currency codes) | After you set up an account |
| Converter (currencies) | api.frankfurter.dev (reference rates of the European Central Bank and other central banks, no personal data) | When you open the Currency tab, at most once a minute |
| Calc (currencies) | api.frankfurter.dev (reference rates of the European Central Bank and other central banks, no personal data; what you type in the sheet is not sent) | Only when a line names a currency; the rates are then kept for 30 minutes |
| Weather | api.open-meteo.com (coordinates), geocoding-api.open-meteo.com (the city you search), get.geojs.io or ipwho.is (approximate location from your IP) | While the weather shows; the location lookup once per start, and never after you pick a city |
| Discord | The Discord app on your PC, discord.com (sign-in), cdn.discordapp.com (avatars) | After you connect it, while you are in a call |
| GitHub activity | github.com, or api.github.com with a token; github.com and avatars.githubusercontent.com (profile picture) | Once an hour while it shows, after you set a username |
| Calendar | The hosts of the ICS links and CalDAV servers you add (for example calendar.google.com, outlook.office365.com or outlook.live.com, p01-caldav.icloud.com or caldav.icloud.com), with your user name and app password for CalDAV; only the time range is sent, nothing else about you | When you add or edit a calendar, then every 12 minutes while the Calendar tool is on, and when you refresh |
| Hardware | ICMP ping to 1.1.1.1 | Every 2 seconds while the Hardware tool is open |
| Lyrics | The sources you turned on in **Settings → Display → Lyrics**, in their order, each with the title, artist and length of the song: lrclib.net (on by default), lyrics.kugou.com (Kugou) and music.163.com (NetEase Cloud Music), both unofficial APIs and off by default | While the lyrics panel is open or a lyrics option of the closed notch is on, for songs up to 20 minutes; each answer is cached |
| Lyrics translation | firefox.settings.services.mozilla.com, firefox-settings-attachments.cdn.mozilla.net (Mozilla's translation engine and models, anonymous; the lyrics are translated on your PC and never sent) | Only when you download the engine and a language's models for **Translate offline** |
| Kanji dictionary | github.com and release-assets.githubusercontent.com (a fixed JMdict release, anonymous) | Only when you press **Download** under Romanisation |
| Updates | github.com and raw.githubusercontent.com (anonymous) | 15 seconds after Crest starts, then every 4 hours; can be turned off in **Settings → General → Updates** |
| Plugins | Only the hosts each plugin you install declares in its `crest-plugin.json`, over https, with whatever the plugin sends them | When the plugin's tool is open and it asks; Crest shows these hosts before you install it |

For Claude, AI usage reads the sign-in that Claude Code keeps in `~/.claude/.credentials.json`. On Windows, once that sign-in has expired, it reads the one the Claude desktop app keeps in its own folder, decrypting it on your PC as the app itself does, with the key Windows keeps for your account (DPAPI). Crest only reads these sign-ins: it never renews, changes or saves them, and sends them only to api.anthropic.com to ask for your usage. A claude.ai session key you paste instead stays in the Credential Manager (the Keychain on a Mac) and is sent only to claude.ai.

Send to phone (Shelf) serves the files you picked on your PC's Wi-Fi or Ethernet address for 10 minutes, behind a random link that the QR code holds; nothing goes through a server of anyone else, and the files travel unencrypted over your network. The first time, Windows Defender Firewall asks whether Crest may use private networks: allow it, or the phone cannot connect. Windows keeps that rule after the 10 minutes and after Crest is uninstalled; remove it under Windows Security, Firewall & network protection, Allow an app through firewall (if you cancelled the prompt, the same page lets you allow Crest).

The web search in Overview (off by default) makes no request itself: Enter opens the results page of the engine you chose in your default browser, which sends the query to that engine.

Live notices read other apps' Windows notifications on your PC, after you allow it, and never send them anywhere. `crest-notify` talks to Crest over a local named pipe and makes no network request.

Plugins you install can contact only the hosts they declare, which Crest lists before you confirm the install; their pages cannot reach the network themselves, and Crest refuses requests to other hosts, to IP addresses and to addresses on your PC or local network. Plugins cannot read your files, keys, vault, clipboard, settings or other plugins. A plugin with storage keeps its data in the `plugin-data` folder of Crest's data folder, removed with the plugin. No plugin is installed by default.

The services above have their own privacy policies. Crest sends them only what the feature needs, as listed above.

## Contact

Questions about privacy: open an issue at [github.com/andrealo20/crest/issues](https://github.com/andrealo20/crest/issues).
