# Contributing to Crest

Bug reports, ideas and pull requests are welcome. For anything larger than a small fix, open an issue first so we can agree on the approach. Before a pull request, run `npm run typecheck`, `npm test`, `npm run i18n` and `cargo test`, and keep interface text in English. Contributions are released under the GPL-3.0, like the rest of the project.

## Build from source

Built with **Tauri 2, React 19, TypeScript, Motion and Tailwind 4**. The app uses WebView2 instead of bundling Chromium, which keeps the release build at a few megabytes. Animations stay smooth because the window itself never resizes. Only the content inside it moves.

Prerequisites:

- Node.js 24. Node 22 or newer builds the app; `npm test` runs the TypeScript test files directly, which needs Node 22.18 or later.
- Rust (stable).
- WebView2 (part of Windows 11; on Windows 10 the installer fetches it).
- On Windows, the Visual Studio Build Tools with the C++ workload and a Windows 11 SDK, required for linking.

```bash
npm install
npm run dev        # browser with a fake desktop, ?slow=4 slows animations for tuning
npm run tauri dev  # the real app, run it in PowerShell
npm test           # frontend tests
npm run typecheck  # before every commit
npm run i18n       # finds missing English strings (add --fix for TODO entries)
cd src-tauri && cargo test   # backend tests
```

In the browser, `?showcase` switches to English with curated demo data (music, Discord call, portfolio, chat).

To build a standalone executable:

```bash
npx tauri build --no-bundle   # result: src-tauri/target/release/crest.exe
```

Run Tauri and Cargo commands from PowerShell. In Git Bash, `/usr/bin/link` shadows the MSVC linker and the build fails.

### Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`). Bump the version, commit and push:

```bash
npm run bump 0.2.0
git commit -am "Release 0.2.0"
git push
```

The workflow builds the signed installer and publishes release `v0.2.0` with the installer, its signature and `latest.json`, which installed apps use to offer the update. Pushes without a version bump don't create a release. The signing key lives in the repository secret `TAURI_SIGNING_PRIVATE_KEY`.

### Project layout

```
src/            React frontend: notch shape, tools, design tokens, i18n
src-tauri/      Rust backend: window, hit testing, tray and the Windows APIs
scripts/        Helper scripts such as the version bump and the i18n check
docs/           Longer guides, such as live notices and crest-notify
```
