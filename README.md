# ObserverLauncher

A beginner-friendly desktop launcher for hosting a Minecraft server on your own computer — simple
enough for a first-time host, capable enough for someone who wants full control.

> **Status:** 0.1.0 — actively developed. Windows and Linux (no macOS support).

## Why

Hosting a local Minecraft server usually means juggling a terminal, a `run.bat` file,
`server.properties` in a text editor, and separate downloads for the server jar and every plugin.
ObserverLauncher puts all of that in one window: download a server, configure it, watch live
TPS/CPU/RAM, manage players and plugins, edit config files, and back up your world — without
leaving the app.

## Features

- **One-click server setup** — download Vanilla, Paper, Purpur, Leaf, Fabric, NeoForge, Forge or
  Folia from their official APIs, or compile Spigot via BuildTools. Velocity proxy supported.
  The wizard loads version lists **live from each official API** and verifies Java requirements
  against Mojang's own manifest.
- **Guided first run** — a welcome flow for first-time hosts: create a new server or point the
  launcher at one you already have.
- **Live server monitoring** — real TPS, MSPT, CPU and RAM sampled from the running Java process,
  with plain-language "?" explanations of every metric. TPS/MSPT works on Paper-like and
  Forge/NeoForge servers; vanilla servers show player count only.
- **Player management** — Online / Offline / Whitelisted / Banned / Operators, with whitelist and
  ban actions that work even while the server is stopped. Inspect a player's inventory, equipment
  and Ender Chest with real item icons.
- **Plugin & mod marketplace** — search and install from Modrinth, Hangar and SpigotMC. The
  install dialog shows compatibility against your detected server (game version, loader,
  server-side support), an exact version picker, warnings, and real per-file download progress.
- **Built-in file editor** — edit `spigot.yml`, plugin configs, `whitelist.json` and other text
  files right in the Content tab: syntax highlighting for YAML/JSON/properties/TOML/JS, line
  numbers, JSON validation and formatting, unsaved-change guards and disk-conflict detection.
- **Backups** — manual or scheduled ZIP snapshots of your world folders (save-off safe).
- **Advanced tuning** — Aikar's flags preset, custom JVM arguments with a live launch-command
  preview, auto-restart on crash, Java version validation per server type (including Minecraft
  26.x → Java 25).
- **World Map** — real data from your world save (seed, spawn, player positions) plus per-server
  waypoints. Terrain preview is an approximation.
- **7 languages** — English, Tiếng Việt, Español, Português (BR), Deutsch, Русский, 简体中文.
- **Auto-updating item icons** — icons are never bundled; they are fetched per-version at runtime
  from the public PrismarineJS assets mirror, so brand-new Minecraft versions get icons without a
  launcher update.
- **Auto-update** — the launcher checks for new versions on GitHub Releases and can install them
  automatically (Windows via NSIS installer, Linux via AppImage).

## Download

Prebuilt binaries are available on the [Releases page](https://github.com/Kag4286/ObserverLauncher/releases):

- **Windows:** `ObserverLauncher-0.1.0-setup.exe` (NSIS installer — supports auto-update)
- **Linux:** `ObserverLauncher-0.1.0.AppImage` (supports auto-update)

You can also download the latest build from the [website](https://kag4286.github.io/ObserverLauncher/).

## Getting started (from source)

Requirements: [Node.js](https://nodejs.org) 18+ (Electron 37) and [Git](https://git-scm.com) for Spigot.

```bash
# Install dependencies
npm install

# Run in development mode
npm start
```

Java is auto-detected — or install it with one click from the launcher (no admin rights needed).

### Run the tests

```bash
npm test
```

### Build

```bash
npm run build:win      # Windows NSIS installer (x64)
npm run build:linux    # Linux AppImage (x64)
npm run build:all      # Both platforms
```

## Supported server software

| Software | How it's obtained |
|---|---|
| Vanilla | Official Mojang version manifest |
| Paper / Folia / Velocity | Official PaperMC Fill API |
| Purpur | Official Purpur API |
| Fabric | Official Fabric meta API |
| Forge / NeoForge | Official installer, run automatically |
| Spigot / CraftBukkit | Compiled locally via BuildTools (requires Git) |
| Leaf | Official Leaf API |

## Supported languages

English · Tiếng Việt · Español · Português (BR) · Deutsch · Русский · 简体中文

Adding a language = one new dictionary in `src/renderer/locales.js` plus an entry in
`LOCALES_META` — missing keys fall back to English automatically.

## Architecture

The app is plain Electron — no bundler, no build step for development.

- **`src/main.js`** — Electron main process entry point: window creation, IPC wiring, stateful
  server/timer orchestration, marketplace, backups, modpack import/export, auto-update.
- **`src/main/`** — mostly-stateless logic modules (`settings.js`, `fs-utils.js`, `http.js`,
  `java.js`, `server-files.js`, `network.js`, `editor.js`, `worldmap.js`, `textures.js`,
  `migrations.js`) and per-software download resolvers (`adapters/`).
- **`src/main/platform/`** — Windows (`win32.js`) / Linux (`linux.js`) backends for process-tree
  walking, metrics, backups and firewall.
- **`src/renderer/`** — UI (`index.html` + `app.js` + `style.css` + `locales.js`).
- **`src/preload.js`** — the only bridge between main and renderer (`contextIsolation` is on, so
  the renderer never touches Node APIs directly).

See [DESIGN.md](DESIGN.md) for the full design system (colors, typography, components, motion).

## Auto-update

The launcher uses [`electron-updater`](https://www.electron.build/auto-update) to check for and
install new versions automatically:

- On launch (packaged builds only), it checks GitHub Releases for a newer version.
- If a new version is available, the user sees a notification and can choose to download and
  install it.
- Windows builds use **NSIS** (installer) — portable `.exe` files are not supported for auto-update.
- Linux builds use **AppImage** — `.deb`/`.rpm` are not supported.

Releases are published automatically via [GitHub Actions](.github/workflows/release.yml) when a
`v*` tag is pushed.

## Website

The landing page lives in [`site/`](site/index.html) and deploys automatically to GitHub Pages via
a workflow on every push that touches it — live at
`https://kag4286.github.io/ObserverLauncher/` once Pages is enabled
(**Settings → Pages → Source: GitHub Actions**).

To feature your own demo recording on the site, drop a GIF at `site/assets/demo.gif` — it replaces
the animated CSS mockup automatically (see `SITE_CONFIG` at the top of `site/index.html`).

## Troubleshooting

- **Java not detected** — install Java from the launcher (Settings → Java runtime → Install Java
  automatically) or set a valid path. The launcher verifies Java before every launch.
- **TPS/MSPT showing "—"** — Vanilla and Fabric servers have no built-in TPS/MSPT command; only
  Paper-like and Forge/NeoForge servers report it. Install [Spark](https://spark.lucko.me) for
  advanced profiling.
- **Auto-update not working** — ensure you downloaded the NSIS installer (Windows) or AppImage
  (Linux), not a portable `.exe` or `.deb`. Also make sure the release is published (not a draft).
- **BuildTools fails** — Spigot compiles from source and requires Git installed on the system.

## Releasing a new version

Releases are published automatically via GitHub Actions when a `v*` tag is pushed. To release
version `0.2.0`:

1. Update `"version"` in `package.json` to `0.2.0`.
2. Commit and push:
   ```bash
   git add package.json
   git commit -m "chore: bump version to 0.2.0"
   git push origin main
   ```
3. Create and push the tag:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
4. GitHub Actions will build the Windows NSIS installer and Linux AppImage, then create a draft
   release. Go to the [Releases page](https://github.com/Kag4286/ObserverLauncher/releases), edit
the release notes, and click **Publish** (not Draft).

After publishing, users with the launcher installed will see a notification that a new version
is available and can update automatically.

## Contributing

Issues and pull requests are welcome. Keep changes to one concern per pull request; if you're
fixing a bug, a one-line repro or console log helps a lot. Run `npm test` before submitting.

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines (English-only comments, one concern
per PR, testing on Windows, adding a language, etc.).

## Attribution & third-party assets

- **Minecraft item/block icons** are **not included in this repository**. At runtime the launcher
  fetches them to the user's machine from the public
  [PrismarineJS/minecraft-assets](https://github.com/PrismarineJS/minecraft-assets) mirror.
  Minecraft is a trademark of Mojang Synergies AB; this project is not affiliated with Mojang or
  Microsoft.
- **Marketplace sources** are public APIs operated by Modrinth, Hangar (PaperMC) and SpigotMC.
  Their logos/names belong to their respective owners and are used for identification only.
- Server software is always downloaded from its official distribution channel.

## Disclaimer

ObserverLauncher is an independent, unofficial tool. Running a Minecraft server still requires
accepting Mojang's EULA, which this launcher surfaces but does not alter.

## License

[MIT](LICENSE)
