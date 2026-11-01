# Crest privacy policy

Last updated: 1 November 2026.

Crest is a free, open-source Windows app by Andrea Loroni. It has no account, no server of its own, no analytics and no tracking. Nothing is sent to the developer.

## What Crest keeps on your PC

- Settings, to-dos, notes, timer presets, themes, the lyrics cache and the other tool data, in the app's data folders under your Windows profile (`%APPDATA%\io.github.andrealo20.crest` and `%LOCALAPPDATA%\io.github.andrealo20.crest`), or in the `data` folder next to Crest.exe for the portable build.
- API keys and other secrets, in the Windows Credential Manager under "Crest/…". They are never written to a plain file.
- The vault (passwords and 2FA codes, off by default), in one file encrypted with Windows DPAPI and readable only under your Windows account. With Windows Hello turned on it is additionally sealed with a TPM-backed key.
- Screenshots and recordings you take, in *Pictures\Crest\Screenshots* and *Videos\Crest\Recordings*.
- A crash log (`crash.log` in the `logs` folder), written only when the app crashes or hits an uncaught error. It is not sent anywhere.

The clipboard history and the history of live notices are kept in memory only and are gone when Crest quits.

To remove your data, delete those folders (or the portable folder) and the "Crest/…" entries in the Credential Manager.

## Which network requests it makes, and when

Every request goes straight from your PC to the service named here. On by default are the AI usage rings, the weather in Overview and the daily update check. Everything else makes no request until you set it up or turn it on.

| Feature | Sent to | When |
| --- | --- | --- |
| AI usage | api.anthropic.com, chatgpt.com, cursor.com (with your existing local login for each), openrouter.ai, api.deepseek.com, api.z.ai (with the key you entered); the `agy` CLI on your PC asks Google for Antigravity | While the quota rings show or the tool is open, at most every 2 to 5 minutes, and only for services you are signed in to or have a key for |
| Ask (AI chat) | The provider you chose: api.anthropic.com, api.openai.com, openrouter.ai or your own endpoint | Only when you send a message |
| Portfolio | Each broker you set up, plus api.coingecko.com (coin symbols) and api.frankfurter.dev (currency codes) | After you set up an account |
| Weather | api.open-meteo.com (coordinates), geocoding-api.open-meteo.com (the city you search), get.geojs.io or ipwho.is (approximate location from your IP) | While the weather shows; the location lookup once per start, and never after you pick a city |
| Discord | The Discord app on your PC, discord.com (sign-in), cdn.discordapp.com (avatars) | After you connect it, while you are in a call |
| GitHub activity | github.com, or api.github.com with a token | Once an hour while it shows, after you set a username |
| Hardware | ICMP ping to 1.1.1.1 | Every 2 seconds while the Hardware tool is open |
| Lyrics | lrclib.net (title, artist and length of the song) | While the lyrics panel is open or a lyrics option of the closed notch is on |
| Updates | github.com and raw.githubusercontent.com (anonymous) | Once a day; can be turned off in **Settings → General → Updates** |

Live notices read other apps' Windows notifications on your PC, after you allow it, and never send them anywhere. `crest-notify` talks to Crest over a local named pipe and makes no network request.

The services above have their own privacy policies. Crest sends them only what the feature needs, as described in the [README](README.md#what-goes-over-the-network-and-when).

## Contact

Questions about privacy: open an issue at [github.com/andrealo20/crest/issues](https://github.com/andrealo20/crest/issues).
