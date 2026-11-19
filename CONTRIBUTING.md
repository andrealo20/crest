# Contributing to Crest

Bug reports, ideas and pull requests are welcome. For anything larger than a small fix, open an issue first so we can agree on the approach. Before a pull request, run `npm run typecheck`, `npm test`, `npm run i18n` and `cargo test`. Interface text goes through `t()` with the German text as its id; the English text goes in `src/i18n/en.json` and the other languages in their own file in that folder. Contributions are released under the GPL-3.0, like the rest of the project.

## Build from source

Built with **Tauri 2, React 19, TypeScript, Motion and Tailwind 4**. The app uses WebView2 instead of bundling Chromium, which keeps the release build at a few megabytes. Animations stay smooth because the window itself never resizes. Only the content inside it moves.

Motion uses the springs in `src/design/motion.ts` and moves transform and opacity where it can. The panel is never blurred with CSS as it opens or switches tools: a blur over the whole panel cost a 50-70 ms frame on every open in WebView2 at 200%. The glass (`src/notch/glass`) blurs without CSS: it blurs each copy of the screen once, into the mip levels of a WebGL texture (1-2 ms), and each frame only reads them, in about 0.1 ms of GPU; its canvas is sized at the start of a transition, never per frame.

Prerequisites:

- Node.js 24. Node 22 or newer builds the app; `npm test` runs the TypeScript test files directly, which needs Node 22.18 or later.
- Rust (stable).
- WebView2 (part of Windows 11; on Windows 10 the installer fetches it).
- On Windows, the Visual Studio Build Tools with the C++ workload and a Windows 11 SDK, required for linking.
- On Linux, the libraries listed under [Linux](#linux) below instead of WebView2 and the Visual Studio Build Tools.

```bash
npm install
npm run dev        # browser with a fake desktop, ?slow=4 slows animations for tuning
npm run tauri dev  # the real app, run it in PowerShell
npm run site:dev   # the project page; its demo is the app served by npm run dev, which must be running
npm test           # frontend tests
npm run typecheck  # before every commit
npm run i18n       # finds German text outside t() and ids missing from en.json (add --fix for TODO entries)
cd src-tauri && cargo test   # backend tests
```

In the browser, `?showcase` switches to English with curated demo data (music, Discord call, portfolio, chat).

To build a standalone executable:

```bash
npx tauri build --no-bundle   # result: src-tauri/target/release/crest.exe
```

Run Tauri and Cargo commands from PowerShell. In Git Bash, `/usr/bin/link` shadows the MSVC linker and the build fails.

### Linux

The Linux port is experimental and community-maintained: the setup it has been tried on is GNOME on Wayland, through XWayland. An X11 session and other desktops (KDE, Xfce, tiling window managers) are built to work but have not been tried. CI builds and tests it on Ubuntu. Build libraries (the Ubuntu or Debian names; other distributions ship the same libraries):

```bash
sudo apt install libwebkit2gtk-4.1-dev libasound2-dev libudev-dev libxdo-dev libayatana-appindicator3-dev librsvg2-dev
# Fedora (names not tried): webkit2gtk4.1-devel alsa-lib-devel systemd-devel libxdo-devel libayatana-appindicator-gtk3-devel librsvg2-devel
# Arch (names not tried):   webkit2gtk-4.1 alsa-lib systemd-libs xdotool libayatana-appindicator librsvg
```

TLS is rustls on Linux, so there is no `libssl-dev`. `npm run tauri dev` and `cargo test --lib` run as above. At run time the mixer, equalizer and microphone use PipeWire's `wpctl`, `pw-dump` and `pw-record`, the music uses MPRIS and saved keys use the desktop's Secret Service (GNOME Keyring, KWallet or KeePassXC), each only matters for its own feature.

A Wayland client cannot place its own window or read the pointer, so on a Wayland session Crest runs through XWayland (`GDK_BACKEND=x11`, set in `main.rs`). `CREST_WAYLAND=1` keeps native Wayland, where the notch will not stay at the screen edge. The Rust side of the port is `src-tauri/src/linux/`, which mirrors `macos/`; call sites reach either through the `native` alias in `lib.rs`. The app does not look for updates on Linux (`latest.json` has no Linux entry).

### Microsoft Store build

The Store gets its own package, built with the `store` Cargo feature:

```powershell
powershell -File scripts/store-package.ps1               # result: dist-store/Crest-<version>-x64.msix
powershell -File scripts/store-package.ps1 -Arch arm64   # dist-store/Crest-<version>-arm64.msix
powershell -File scripts/store-package.ps1 -Bundle       # both, and dist-store/Crest-<version>.msixbundle
powershell -File scripts/store-package.ps1 -TestSign     # also a self-signed copy to install on this PC
```

An arm64 package cross-compiles on an x64 PC when Visual Studio has the "MSVC ARM64 build tools" and "C++ Clang compiler for Windows" components (ring, a TLS dependency, compiles its ARM64 code with clang). Partner Center takes the x64 and arm64 `.msix` side by side in one submission, or the `.msixbundle` in their place; the steps are at the top of the script.

The script needs a Windows SDK for `makeappx` and `signtool` and takes the newest one under `C:\Program Files (x86)\Windows Kits\10\bin`. It builds into `src-tauri/target-store`, apart from the normal build, and gives the package the version from `tauri.conf.json` with a fourth part of 0. The manifest is `packaging/store/AppxManifest.xml`; Crest's entry also carries an alias for crest-notify, so `crest-notify` runs by name from any terminal once the package is installed. Upload the unsigned `.msix` to Partner Center, which signs Store packages itself.

The Store build never updates itself: the updater plugin is not loaded, and Settings, General, Updates says that updates come from the Microsoft Store instead of offering a check. It is never portable, whatever sits next to the exe. Start with Windows goes through the package's startup task, which Task Manager lists under Startup apps, and stays off until the user turns it on. If the user switched it off there, Windows keeps it off and Settings tells them where to turn it back on.

`-TestSign` creates a self-signed certificate in your user store the first time, with the package's Publisher as its subject, exports it to your temp folder and signs a copy of the package. Installing that copy needs the certificate in `LocalMachine\TrustedPeople`, which takes an elevated PowerShell. The script prints that command and the install command but runs nothing elevated.

### Releasing

Releases are built by GitHub Actions (`.github/workflows/release.yml`). First write the notes: an entry for the version at the top of `src/changelog.json` (the app's What's new screen), `docs/releases/v0.2.0.md` (shown on the release page) and, for a feature release, the README's "New in" section. Then bump the version, commit and push; the bump refuses to run while the changelog entry or the release notes file is missing:

```bash
npm run bump 0.2.0
git commit -am "Release 0.2.0"
git push
```

In the release that ships what the project page marks "Coming in", remove those `next` notes from `site/src/data.ts` and rewrite the FAQ answer about the demo, which names the download version.

The workflow builds the signed installers and portable zips for x64 and arm64 (arm64 cross-compiled on the x64 runner) and publishes release `v0.2.0` with them, their signatures and `latest.json`, which installed apps and portable copies use to offer the update. A last job adds `SHA256SUMS` with the SHA-256 of every file of the release. Pushes without a version bump don't create a release. The signing key lives in the repository secret `TAURI_SIGNING_PRIVATE_KEY`.

### Project layout

```
src/            React frontend: notch shape, tools, design tokens, i18n
src-tauri/      Rust backend: window, hit testing, tray and the Windows APIs
scripts/        Helper scripts such as the version bump and the i18n check
docs/           Longer guides, such as live notices and crest-notify
```
