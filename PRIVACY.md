# Crest privacy policy

Last updated: 1 November 2026.

Crest is a free, open-source Windows app by Andrea Loroni. It has no account, no server of its own, no analytics and no tracking. Nothing is sent to the developer.

## What Crest keeps on your PC

- Settings, to-dos, notes, timer presets, themes, the lyrics cache and the other tool data, in the app's data folders under your Windows profile (`%APPDATA%\io.github.andrealo20.crest` and `%LOCALAPPDATA%\io.github.andrealo20.crest`), or in the `data` folder next to Crest.exe for the portable build.
- API keys and other secrets, in the Windows Credential Manager under "Crest/…". They are never written to a plain file. Calendar links and CalDAV app passwords are kept there too, as "Crest/calendar.…".
- The events of your calendars from two months back to about three months ahead (titles, places and times), the span the month view can show, in `calendar-cache.json` in the app's data folder, so the agenda shows offline. Removing a calendar drops its events from the file at the next refresh.
- The vault (passwords and 2FA codes, off by default), in one file encrypted with Windows DPAPI and readable only under your Windows account. With Windows Hello turned on it is additionally sealed with a TPM-backed key.
- Screenshots and recordings you take, in *Pictures\Screenshots* and *Videos\Crest\Recordings*.
- Plugins you install, in the `plugins` folder of the app's data folder, and the data of those that keep any, in `plugin-data`.
- A crash log (`crash.log` in the `logs` folder), written only when the app crashes or hits an uncaught error. It is not sent anywhere.

The clipboard history and the history of live notices are kept in memory only and are gone when Crest quits.

The Camera tool (off by default) shows the camera picture only on your screen, while the tool is open. It never records, saves or sends it.

Find on screen reads your screens with Windows' own text recognition, on your PC: the screen copies are dropped as soon as they are read, and the text stays in memory until the page closes. Nothing is saved or sent.

To remove your data, delete those folders (or the portable folder) and the "Crest/…" entries in the Credential Manager.

## Which network requests it makes, and when

Every request goes straight from your PC to the service named here. On by default are the AI usage rings, the weather in Overview and the daily update check. Everything else makes no request until you set it up or turn it on.

| Feature | Sent to | When |
| --- | --- | --- |
| AI usage | api.anthropic.com, chatgpt.com, cursor.com (with your existing local login for each), openrouter.ai, api.deepseek.com, api.z.ai (with the key you entered); the `agy` CLI on your PC asks Google for Antigravity | While the quota rings show or the tool is open, at most every 2 to 5 minutes, and only for services you are signed in to or have a key for |
| Ask (AI chat) | The provider you chose: api.anthropic.com, api.openai.com, openrouter.ai or your own endpoint | Only when you send a message |
| Portfolio | Each broker you set up, plus api.coingecko.com (coin symbols) and api.frankfurter.dev (currency codes) | After you set up an account |
| Converter (currencies) | api.frankfurter.dev (the European Central Bank's reference rates, no personal data) | When you open the Currency tab, at most once a minute |
| Weather | api.open-meteo.com (coordinates), geocoding-api.open-meteo.com (the city you search), get.geojs.io or ipwho.is (approximate location from your IP) | While the weather shows; the location lookup once per start, and never after you pick a city |
| Discord | The Discord app on your PC, discord.com (sign-in), cdn.discordapp.com (avatars) | After you connect it, while you are in a call |
| GitHub activity | github.com, or api.github.com with a token; github.com and avatars.githubusercontent.com (profile picture) | Once an hour while it shows, after you set a username |
| Calendar | The hosts of the ICS links and CalDAV servers you add (for example calendar.google.com, outlook.office365.com or outlook.live.com, p01-caldav.icloud.com or caldav.icloud.com), with your user name and app password for CalDAV; only the time range is sent, nothing else about you | When you add or edit a calendar, then every 12 minutes while the Calendar tool is on, and when you refresh |
| Hardware | ICMP ping to 1.1.1.1 | Every 2 seconds while the Hardware tool is open |
| Lyrics | The sources you turned on in **Settings → Display → Lyrics**, in their order, each with the title, artist and length of the song: lrclib.net (on by default), lyrics.kugou.com (Kugou) and music.163.com (NetEase Cloud Music), both unofficial APIs and off by default | While the lyrics panel is open or a lyrics option of the closed notch is on, for songs up to 20 minutes; each answer is cached |
| Lyrics translation | The Ask provider you chose, with your key: the lyric lines of the song | Only with **Translate with Ask** on, once per song without a translation from its source |
| Kanji dictionary | github.com and release-assets.githubusercontent.com (a fixed JMdict release, anonymous) | Only when you press **Download** under Romanisation |
| Updates | github.com and raw.githubusercontent.com (anonymous) | Once a day; can be turned off in **Settings → General → Updates** |
| Plugins | Only the hosts each plugin you install declares in its `crest-plugin.json`, over https, with whatever the plugin sends them | When the plugin's tool is open and it asks; Crest shows these hosts before you install it |

Send to phone (Shelf) serves the files you picked on your PC's Wi-Fi or Ethernet address for 10 minutes, behind a random link that the QR code holds; nothing goes through a server of anyone else, and the files travel unencrypted over your network. The first time, Windows Defender Firewall asks whether Crest may use private networks: allow it, or the phone cannot connect. Windows keeps that rule after the 10 minutes and after Crest is uninstalled; remove it under Windows Security, Firewall & network protection, Allow an app through firewall (if you cancelled the prompt, the same page lets you allow Crest).

Live notices read other apps' Windows notifications on your PC, after you allow it, and never send them anywhere. `crest-notify` talks to Crest over a local named pipe and makes no network request.

Plugins you install can contact only the hosts they declare, which Crest lists before you confirm the install; their pages cannot reach the network themselves, and Crest refuses requests to other hosts, to IP addresses and to addresses on your PC or local network. Plugins cannot read your files, keys, vault, clipboard, settings or other plugins. A plugin with storage keeps its data in the `plugin-data` folder of Crest's data folder, removed with the plugin. No plugin is installed by default.

The services above have their own privacy policies. Crest sends them only what the feature needs, as described in the [README](README.md#what-goes-over-the-network-and-when).

## Contact

Questions about privacy: open an issue at [github.com/andrealo20/crest/issues](https://github.com/andrealo20/crest/issues).
