# Live notices

Crest can show notifications in the closed notch: the app's logo, its name, the title and the first line of the text, for 6 seconds. The open notch gets a **Notices** page with everything that arrived since Crest started, each with a short time ("Now", "5 min", "14:05").

Turn it on under **Settings → Notices → Live notices**. It is off by default because it reads other apps' notifications.

## Sources

| Source | What it is | Default |
| --- | --- | --- |
| Windows notifications | The toast notifications Windows shows for your account, from any app | On once live notices are on |
| crest-notify | A small command line program for scripts, builds and coding agents | On once live notices are on |

### How Crest reads Windows notifications

Windows lets apps read the notifications in the action centre through its notification listener, after you allow it once (the **Allow access** button, or **Windows Settings → Privacy & security → Notifications**). The listener's "a notification arrived" event only reaches apps installed as a package, and Crest is a plain desktop program, so Crest watches a different signal: for every notification delivered to your account, Windows' push notification service writes an entry to the event log **Applications and Services Logs → Microsoft → Windows → PushNotification-Platform → Operational**. The entry holds the notification's number and the app's id. Crest subscribes to that log, filtered to your account, and reads that one notification through the listener. It checks that the notification belongs to the app the entry names, so an entry never brings up another app's text.

Nothing waits on a timer while this works: Crest does no work until Windows writes an entry. When the log is turned off (some company policies do that) or the subscription fails, Crest reads the list every 5 seconds instead; **Settings → Notices** says which of the two is in use.

The first reading after starting is a baseline: what is already in the action centre is not shown again.

Crest only reads. It never removes, dismisses or changes a notification, never touches the action centre or other apps' notification settings, and never opens links from a notification.

Other ways were considered and left out. Reading Windows' notification database file (`wpndatabase.db`) depends on an undocumented format that changes between Windows builds and on a file the notification service keeps locked. Registering Crest as a package only to receive the event would need Developer Mode or a signed package.

## Rules and quiet hours

- **Per app**: every app that sent a notice is listed under **Settings → Notices → Apps** with **Show** (pops up), **Mute** (history only) or **Off** (dropped). The buttons next to a notice on the Notices page do the same.
- **Presentation mode**: while it is on (by hand or during a screen recording), notices go to the history without popping up, and the history page hides their text.
- **Every day**: a daily quiet window, for example 22:00 to 07:00, works the same way.

In the closed notch a finished timer and status alerts come first, then notices, then quota alerts and new songs. Notices do not show on the line look or in focus mode; they still go to the history.

## crest-notify

`crest-notify.exe` is installed next to `crest.exe`, by default in `%LOCALAPPDATA%\Crest`. Add that folder to your `PATH`, or call it by its full path.

```text
# a notice
crest-notify "Build finished" -b "Tests passed"
# the same -r key updates the same notice, here with a progress ring
crest-notify "Deploying" -r deploy -p 40
crest-notify "Deployed" -r deploy -p 100
# run a command, then notify its exit code and how long it took
crest-notify run -s Tests -- cargo test
```

| Option | Meaning |
| --- | --- |
| `-b`, `--body <text>` | The text under the title |
| `-s`, `--source <name>` | Who sends it, shown as the app name; rules apply per source |
| `-r`, `--replace <key>` | A later notice from the same source with the same key replaces this one |
| `-p`, `--progress <0-100>` | Shows a progress ring |
| `-j`, `--json <text or ->` | Takes the body from an agent's event (`message` or `last-assistant-message`); `-` reads it from standard input. `--body` is used when the JSON has neither |

`run` starts the command with your console, waits for it, sends the result and returns the command's own exit code. Commands that are `.cmd` scripts (npm, yarn) are started through `cmd` when Windows cannot start them directly.

Exit codes: 0 delivered (also when your rules keep it quiet), 1 usage error, 2 rejected (malformed, or more than 200 notices in 10 seconds), 3 Crest is not running, live notices or crest-notify are off, or Crest did not answer within 3 seconds.

Titles are cut to 256 characters, texts to 4000, a message to 64 KB. Control characters and the characters that reverse text direction are removed.

### Hooks for coding agents

Crest does not change any agent's configuration; copy what you need.

**Claude Code** (`hooks` in `~/.claude/settings.json` or a project's `.claude/settings.json`): a notice when it needs your input and when it finishes a turn. Both events write their details to standard input; `--json -` takes the message from there, and `-b` is the text when there is none.

```json
{
  "hooks": {
    "Notification": [
      { "hooks": [{ "type": "command", "command": "crest-notify \"Claude Code\" -s \"Claude Code\" -r claude-code -b \"Needs your input\" --json -" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "crest-notify \"Claude Code\" -s \"Claude Code\" -r claude-code -b \"Finished\" --json -" }] }
    ]
  }
}
```

**Codex** (`~/.codex/config.toml`): Codex runs the `notify` program at the end of each turn and adds its event as the last argument, which fills `--json`.

```toml
notify = ["crest-notify", "Codex", "-s", "Codex", "-r", "codex", "-b", "Turn finished", "--json"]
```

If `crest-notify` is not on your `PATH`, put the full path in its place, for example `C:/Users/you/AppData/Local/Crest/crest-notify.exe`.

## Privacy

- Everything happens on this PC. No notification, title or text is sent anywhere.
- The history is kept in memory only, at most 100 notices and 24 hours, and is gone when Crest quits or live notices are switched off. Notification texts are never written to disk. The settings keep the names and ids of the apps that sent notices, so their rules can be set.
- App logos come from Windows; nothing is downloaded.
- The crest-notify channel is a named pipe that only your Windows account can open: its access list grants your user and nobody else, connections from other computers are refused, and the pipe name includes your session and user id. Crest only opens the channel when no other program holds that name; if one does, crest-notify stays off and the settings keep showing it as starting.
- A notice's text is only ever shown as text; it is never run.
