# ObserverLauncher

A beginner-friendly desktop launcher for hosting a Minecraft server on your own computer — simple
enough for a first-time host, capable enough for someone who wants full control.

> **Status:** 0.1.0-alpha — actively developed. Windows and Linux.

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
  with plain-language "?" explanations of every metric.
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
- **7 languages** — English, Tiếng Việt, Español, Português (BR), Deutsch, Русский, 简体中文.
- **Auto-updating item icons** — icons are never bundled; they are fetched per-version at runtime
  from the public PrismarineJS assets mirror, so brand-new Minecraft versions get icons without a
  launcher update.

## Getting started

```bash
npm install
npm start
```

Requires [Node.js](https://nodejs.org). Java is auto-detected — or install it with one click from
the launcher (no admin rights needed).

### Run the tests

```bash
npm test
```

### Build

```bash
npm run build:portable   # Windows portable .exe
npm run build:linux      # Linux AppImage + .deb
npm run build:all
```

## Website

The landing page lives in [`site/`](site/index.html) and deploys automatically to GitHub Pages via
a workflow on every push that touches it — live at
`https://<your-username>.github.io/ObserverLauncher/` once Pages is enabled
(**Settings → Pages → Source: GitHub Actions**).

To feature your own demo recording on the site, drop a GIF at `site/assets/demo.gif` — it replaces
the animated CSS mockup automatically (see `SITE_CONFIG` at the top of `site/index.html`).

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

## Contributing

Issues and pull requests are welcome. Keep changes to one concern per pull request; if you're
fixing a bug, a one-line repro or console log helps a lot. Run `npm test` before submitting.

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
