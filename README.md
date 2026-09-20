# ObserverLauncher

**Run a Minecraft server on your own computer — without touching a terminal.**

ObserverLauncher is a desktop app for Windows and Linux that handles the boring parts of hosting a Minecraft: Java Edition server: downloading the server software, installing Java, editing config files, opening the firewall, and backing up your world. You pick a folder, choose a server type, and press **Start**.

[![Release](https://img.shields.io/github/v/release/Kag4286/ObserverLauncher?label=release)](https://github.com/Kag4286/ObserverLauncher/releases/latest)
[![Tests](https://github.com/Kag4286/ObserverLauncher/actions/workflows/test.yml/badge.svg)](https://github.com/Kag4286/ObserverLauncher/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)](https://github.com/Kag4286/ObserverLauncher/releases/latest)

> From 1.0.0 onward the project prioritises **stability and polish over new features** — the focus is bug fixes, hardening and small improvements, not constant surface change. See the [CHANGELOG](CHANGELOG.md).

### Quick links

- **Just want to install it?** → [Install](#install) · [Quick start](#quick-start)
- **Hit a problem?** → [Troubleshooting](#troubleshooting) · [FAQ](#faq)
- **Want to build or contribute?** → [Architecture](#architecture) · [Development](#development)

---

## What is this?

Hosting a Minecraft server by hand means: find a `.jar`, write a `run.bat`, guess the JVM flags, edit `server.properties` in Notepad, match plugin versions, forward a router port, and stare at a black console to find out what went wrong.

ObserverLauncher turns all of that into one window. What used to take an afternoon takes a few minutes — and when something goes wrong, the app says *why* instead of showing a cryptic Java stack trace.

It is a **local** tool: it runs the server on your machine, has no account system, and no cloud component.

**Who it's for:** first-time server owners who don't want a terminal; people who already host but want a GUI for the tedious parts (metrics, backups, config editing, player management); and tinkerers running several server types from one place.

---

## Screenshots

Every tab shares one look — a header strip over a single surface — so the app feels like one instrument, not a pile of screens.

**Overview** — server identity, live status, TPS/RAM at a glance, quick actions and how friends can connect.

![ObserverLauncher Overview tab](docs/screenshot-overview.png)

**Console** — a dense live terminal with colour-coded levels, filters and one-click quick commands.

![ObserverLauncher Console tab](docs/screenshot-console.png)

**Players** — the roster: online/offline, whitelist, bans and operators, with quick actions that work even while the server is stopped.

![ObserverLauncher Players tab](docs/screenshot-players.png)

**Player inspector** — a tabbed view of a player's stats, equipment, inventory and ender chest, with live admin actions and an automatic `.dat` backup before any edit.

![ObserverLauncher player inspector](docs/screenshot-player-inspector.png)

**Performance** — live telemetry: TPS, MSPT, server CPU and RAM as KPI cards plus history charts and capability-aware diagnostics.

![ObserverLauncher Performance tab](docs/screenshot-performance.png)

**Content library** — one list with a Plugins / Mods / Datapacks switch and a filter box, so hundreds of jars are a single scroll.

![ObserverLauncher Content tab](docs/screenshot-content.png)

**Marketplace** — search Modrinth, Hangar and SpigotMC in one box and install straight into your server folder.

![ObserverLauncher Marketplace tab](docs/screenshot-marketplace.png)

**Worlds & backups** — world folders on top, and a full-width backup timeline with one-click restore and delete.

![ObserverLauncher Worlds and backups tab](docs/screenshot-worlds.png)

**World Map** — reads your real world save: seed, spawn, player positions, waypoints, real terrain and biomes, and explored chunks.

![ObserverLauncher World Map tab](docs/screenshot-worldmap.png)

**Built-in editor** — edit YAML, JSON, TOML and properties files in place, with syntax highlighting and change detection.

![ObserverLauncher built-in editor](docs/screenshot-editor.png)

---

## Requirements

| | Minimum | Recommended |
|---|---|---|
| **OS** | Windows 10 (64-bit) or a modern 64-bit Linux distro | Windows 11 / recent Ubuntu, Fedora, etc. |
| **RAM** | 4 GB (2 GB for the OS, 2 GB for the server) | 8 GB or more |
| **Disk** | ~1 GB free for the app + the server | 5 GB+ (worlds and modpacks grow) |
| **Java** | Any Java — the launcher **detects and can install it for you** | 64-bit Java 17 / 21 / 25, depending on your server version |
| **Git** | Only needed to compile Spigot from source | Install it if you plan to use Spigot |

**You do not need admin rights.** The launcher installs Java into your user folder and only asks for elevation if you choose to open the Windows Firewall for a port. Running from source additionally needs **Node.js 18 or newer**.

---

## Install

### Option A — Download the installer (recommended)

| Platform | File |
|---|---|
| Windows 10/11 (64-bit) | `ObserverLauncher-1.0.0-setup.exe` |
| Linux (AppImage) | `ObserverLauncher-1.0.0.AppImage` |

Grab the latest from the [Releases page](https://github.com/Kag4286/ObserverLauncher/releases/latest).

- **Windows:** run the `.exe` (a normal NSIS installer — you can choose the install location; it sets up auto-update).
- **Linux:** `chmod +x ObserverLauncher-1.0.0.AppImage` then run it. No installation, no root.

### Option B — Run from source

```bash
npm install
npm start
```

Starts the app in development mode (no packaging). See [Development](#development) for tests and builds.

### Auto-update

The launcher checks GitHub Releases on startup and shows a notification when a newer version exists. One-click install via the NSIS installer (Windows) or AppImage (Linux). It does **not** work with a portable `.exe` or `.deb`, and the release must be *published*, not a draft.

---

## Quick start

1. **Launch the app.** First run shows the Overview tab with a welcome card.
2. **Choose a folder** — click **Choose folder** (or **Create new server**, which suggests one under `Documents/ObserverLauncher Servers`). Pick an **empty** folder; the launcher never overwrites an existing server jar.
3. **Create a server** — the wizard asks for software (e.g. *Paper*) and Minecraft version, then downloads it. Spigot compiles from source and takes several minutes; the Console shows progress.
4. **Check the setup checklist.** The Overview hero lists problems only: missing folder, missing jar, missing Java, or unaccepted EULA. When everything is green, the list disappears.
5. **Accept the EULA.** Enable **Accept EULA automatically** in Settings, or edit `eula.txt` yourself.
6. **Set memory.** In the stats row, set **Allocate RAM** (min/max GB) and click **Apply**. Roughly half your system RAM is a good start — leave room for the OS.
7. **Press Start.** The status moves through *Starting → Running*. The first launch creates `server.properties` and the world folders — an initial `Failed to load properties` error is expected and harmless.
8. **Invite friends.** The *How friends can join* panel shows the address to share. Same Wi-Fi: use the local address as-is. Elsewhere: either forward the port on your router, or click **Share to internet** — the app can install and run the [Playit.gg](https://playit.gg) agent and give your server a public address with no router setup.

Everything else — plugins, players, backups, the world map — is optional.

---

## Features

### Server setup
- Downloads **Vanilla, Paper, Purpur, Leaf, Fabric, Forge, NeoForge, Folia, Velocity or Spigot** from official sources.
- Loads version lists **live** from each project's API, so new Minecraft releases appear without an app update.
- **Java check before start** — compares your installed Java against what the jar needs (a 26.x jar needs Java 25; an old 1.12.2 jar needs Java 8) and blocks the start with a clear message if it's too old.
- **Automatic Java install** — no admin rights, no separate download page.
- **Spigot from source** via BuildTools (requires Git; takes several minutes).

### Live monitoring
- Real-time **TPS, MSPT, CPU and RAM** graphs, with plain-language explanations on the **?** next to each KPI.
- Works natively for **Paper / Purpur / Leaf / Folia / Forge**; Vanilla and Fabric show player count only (TPS/MSPT stay `—`).

### Player management & inspector
- See who is **online, whitelisted, banned or OP** in one roster; toggle whitelist / ban / OP **even while the server is stopped**.
- **Player inspector, three tabs:**
  - **Overview** — read-only: stats, equipment, inventory and ender chest with real item names.
  - **Live actions** — runs as server commands **while the server is running** (gamemode, XP, give item, heal, feed, clear inventory, kick). The player must be online; destructive actions confirm first.
  - **Saved data (edit)** — edit health / XP / food / game mode in the `.dat` (server must be stopped). A backup is created automatically before writing.
- Works on modern (1.21.5+ / 26.x) servers too, where armor and the off-hand item moved into the `equipment` NBT tag.

### Marketplace
- Search **Modrinth, Hangar and SpigotMC** in one box.
- Shows **compatibility before you install** (game version, loader, server-side support) against the detected server.
- **Explicit version picker** with per-file download progress.
- **Import and export** standard Modrinth `.mrpack` files. Import checks the pack's declared MC version and loader and warns on a mismatch (never blocked — "Install anyway" is available). Export writes real dependencies so other launchers know what to build.

### Config editor
- Edit `server.properties`, `spigot.yml`, `whitelist.json`, plugin configs and more, in place.
- **Collapsible folder tree** (a server folder can hold hundreds of files); search still shows full paths.
- **Syntax highlighting** for YAML, JSON, TOML, properties and JS, with **JSON validation + auto-format**.
- **Conflict detection** — warns if the file changed on disk while you were editing.
- For Velocity proxies, a raw `velocity.toml` editor replaces the properties grid.

### Backups
- **Manual or scheduled** ZIP snapshots of world folders, using `save-off` / `save-all` / `save-on` so worlds are never archived mid-write.
- **Restore** from the launcher, with a zip-slip safety check on extraction.

### World Map
- Reads **real data** from your world save — not a mock-up.
- World **seed**, level name, version and spawn point from `level.dat`; **player positions** with a distinct spawn marker.
- **Real terrain + biome preview** — the map reads each chunk's own heightmap for relief and water, and the actual biome palette from your region files (1.18+ paletted containers), so hills shade and water reads as water. The spawn area is prefetched so it appears immediately.
- **Explored-chunk overlay** scanned from region files; half-generated chunks are filtered out.
- **Waypoints** you can add, name, jump to and delete, and **jump to coordinates** by typing `X Z`.
- **Export the current view as PNG.**
- A short note in the tab explains that the map is CPU-heavy and can briefly affect a running server's TPS.

### Console
- Real terminal view with timestamps, per-level colouring (info / warn / error / command) and **segmented filters**.
- **Command history** (↑/↓), a recent-commands row, and **export the log to a `.txt` file**.
- Auto-poll noise (`list`, `tps`, `tick query`) is filtered out so the log stays readable.

### Connect friends (tunnel)
- The **How friends can join** panel shows your LAN address instantly and looks up your public IP on demand.
- **Share to internet** starts the [Playit.gg](https://playit.gg) agent (auto-downloaded if missing) for a public address with **no router setup**, and can **auto-start with the server** so your address is live whenever the server is. Paste the address Playit gives you and copy it for friends.

### Server schedule
- **Start and stop the server automatically on a daily window** — optional start/stop times and weekdays (empty = every day).
- Uses the local clock (a skipped time if the PC is asleep). A scheduled stop never interrupts an in-flight backup, and a scheduled stop is treated as manual so auto-restart won't revive it.

### Resilient downloads
- Downloads **retry and resume** (HTTP Range) when the connection drops — a slow-but-alive download is never killed by a wall-clock timeout, and a dropped Wi-Fi connection costs seconds, not the whole download.
- **Cancellable downloads** in the wizard; Java installs into a staging folder so a failed extract never wipes a working Java.

### MCP / AI integration
- The app can act as an **MCP server** so an AI assistant (Claude Desktop, Cursor, …) can read and control the server in natural language. See [MCP / AI integration](#mcp--ai-integration).

---

## MCP / AI integration

ObserverLauncher can act as an **MCP server**, letting an MCP client read and control your server in natural language — status, console, files, plugins, modpacks, and more (40+ tools).

**Enable it:** Settings → **MCP / AI** → *Enable MCP server*. The launcher starts a **local-only** server (127.0.0.1, random port, a fresh token every launch) and writes its connection info to `mcp-bridge.json` in the launcher's data folder. The app must stay open while the client is used.

**Connect a client:** click **Copy MCP config** and paste it into your client's MCP settings. The exact JSON (with real paths filled in) goes on your clipboard. The launcher runs the bridge with its OWN binary (`ELECTRON_RUN_AS_NODE=1`), so **you don't need Node.js installed**.

**Permissions.** Tools are tiered: **read** run freely; **write** (install, edit files, send a command) ask for confirmation first — skippable with *Auto-allow write tools*; **destructive** (stop, delete, restore) always ask and can never be auto-approved.

> Nothing is exposed beyond `127.0.0.1`, and the token changes every launch.

---

## Supported server software

| Software | How it's obtained | Native TPS/MSPT? |
|---|---|---|
| **Vanilla** | Official Mojang version manifest | Player count only |
| **Paper / Folia / Velocity** | Official PaperMC Fill API | Yes (Velocity is a proxy — N/A) |
| **Purpur** | Official Purpur API | Yes |
| **Leaf** | Official Leaf API | Yes |
| **Fabric** | Official Fabric meta API | Player count only |
| **Forge / NeoForge** | Official installer (runs automatically) | Yes |
| **Spigot / CraftBukkit** | Compiled via BuildTools (requires Git) | Via Spigot config |

---

## Supported languages

English, **Tiếng Việt**, Español, Português (BR), Deutsch, Русский, 简体中文.

The interface is fully translated for all 7 languages. A missing key falls back to English automatically, so a partial translation still works.

---

## Where things live on your disk

### Your server folder

A typical Paper/Fabric server looks like:

```
MyServer/
├── paper-1.21.4.jar          # the server jar (or run.bat / run.sh for Forge/Fabric)
├── eula.txt                  # Minecraft EULA acceptance
├── server.properties         # main config
├── spigot.yml / bukkit.yml   # Spigot/Paper config (if applicable)
├── plugins/                  # plugins (.jar)
├── mods/                     # mods (.jar) for Forge/Fabric
├── world/                    # overworld + playerdata + datapacks
├── world_nether/             # nether
├── world_the_end/            # the end
├── logs/                     # server logs
├── usercache.json            # known players
├── whitelist.json / banned-players.json / ops.json
├── observerlauncher-backups/ # ZIP backups created by the launcher
└── observerlauncher-manifest.json  # tracks marketplace installs (for export)
```

> Newer Minecraft versions may store player data under `world/players/data/` instead of `world/playerdata/`. The launcher reads both.

### Launcher data (per user, not in your server folder)

| What | Where |
|---|---|
| Settings (`settings.json`) | Electron `userData` folder |
| Downloaded item/block icons | `userData/textures/<version>/…` |
| App preferences & update state | `userData` |

On Windows, `userData` is typically `C:\Users\<you>\AppData\Roaming\ObserverLauncher`. On Linux it is `~/.config/ObserverLauncher`.

---

## Troubleshooting

**Java not detected.** Install it from **Settings → Java runtime → Install Java automatically**, or set the path manually. If `java -version` doesn't work in a terminal, the launcher won't see it either.

**"This jar needs Java X+, detected Java Y".** The jar requires a newer Java. Use the **Fix Java** button, or install manually. Minecraft now uses calendar versioning: **26.x needs Java 25**, 1.20.5+/1.21.x need Java 21, 1.18+ need Java 17, older need Java 8.

**TPS / MSPT show "—".** Only **Paper, Purpur, Leaf, Folia and Forge** have a built-in TPS/MSPT command. For Vanilla and Fabric, install **Spark** from the Marketplace for profiling.

**The server won't start, no clear error.** Check the **Console** tab and scroll up — the real Java error is usually a few lines above. Common causes: Java version mismatch, too little RAM, or a corrupted jar (delete it and re-run the wizard).

**"Failed to load properties" on first start.** **Expected** — `server.properties` doesn't exist yet, the server complains once, creates it, and continues.

**Start button greyed out.** Hover it — the tooltip says why (no folder, no runnable jar, or Java not detected). The Overview checklist lists the same.

**Spigot build fails.** Spigot has no legal pre-built download; it's compiled locally with **BuildTools**, which needs **Git** on your PATH. Install Git from [git-scm.com](https://git-scm.com) and retry — it can take several minutes.

**Friends can't connect over the internet.** Opening the Windows Firewall is only half the job — you also need to forward the port on your router, **or** use the built-in **Share to internet** (Playit.gg) tunnel, which needs no router setup. If your ISP uses carrier-grade NAT, port forwarding may not work at all.

**The app is stuck on "Stopping…".** Use **Force stop** in the top bar — it kills the server process tree immediately (confirms first, since unsaved progress may be lost).

**Auto-update not working.** Make sure you installed via the **NSIS installer** or **AppImage**, not a portable `.exe` or `.deb`, and that the GitHub release is **published**, not a draft.

---

## FAQ

**Do I need to own Minecraft to run a server?** The server software is free. Players need a legitimate Java Edition account *if* the server runs in online mode (the default). Turning online mode off allows cracked clients — think twice.

**Does the launcher host the server for me?** No. It runs on your computer; the launcher is only the control panel.

**Can I run more than one server?** Yes — point the launcher at a different folder. Settings are shared (one active set, not per-folder): RAM, Java path, JVM args apply to whichever folder is loaded.

**Where are my backups?** In your server folder, under `observerlauncher-backups/`, as `.zip` files.

**Can I use this on a Mac?** Not officially. Windows and Linux only.

**Does it work with Bedrock?** No — Java Edition only.

**How much RAM should I allocate?** For a few friends, 2–4 GB is plenty; leave at least 2 GB for the OS. The launcher defaults to roughly half your system RAM (capped at 8 GB).

**Can I edit configs by hand?** Absolutely — everything is a normal file. The launcher even detects external changes while a file is open in its editor.

---

## Data & privacy

ObserverLauncher is a local tool with **no account, no telemetry, no analytics**.

**Downloads (only when you ask):** server jars from official Mojang / PaperMC / Purpur / Leaf / Fabric / Forge endpoints; plugins and mods from Modrinth, Hangar and SpigotMC; item/block icons from the public **PrismarineJS** mirror (cached locally — no Mojang assets are bundled or redistributed); Java runtimes when you use auto-install; update metadata from GitHub Releases.

**Never:** uploads your world, configs or player data anywhere; collects usage statistics; runs a background service once the app is closed.

All requests go directly from your machine to the official sources.

---

## Known limitations

- **Windows and Linux only.** No macOS build.
- **TPS/MSPT need a supported server.** Vanilla and Fabric report player count only.
- **Spigot needs Git** (and a full JDK) and compiles slowly.
- **Velocity proxies don't tick a world**, so their TPS/MSPT panel shows N/A by design.
- **Auto-update requires the packaged installer/AppImage** (not a portable `.exe` or `.deb`).
- **Port forwarding is still on you by default.** The launcher cannot configure your router. The optional **Share to internet** feature (Playit.gg) avoids the router entirely, but it links the machine to a Playit account.
- **The World Map is CPU-heavy.** Panning, zooming and biome loading can stutter the app and briefly lower a running server's TPS; a note in the tab says so.

### Linux notes

Linux is supported. **It has not yet been verified on real hardware** — the platform code is code-analysed and unit-tested only, so treat the Linux build as less battle-tested than Windows. Known differences:

- **Firewall is not opened for you.** The button copies `sudo ufw allow <port>/tcp` to your clipboard; the launcher never requests sudo.
- **Backups need `zip` or `tar`.** If neither is present, the launcher tells you what to install.
- **Auto-update works only for the AppImage** (not a `.deb`/`.rpm`).
- **Stopping uses SIGTERM** (plus a `/proc` walk and SIGKILL fallback).
- **Spigot's BuildTools needs a JDK**, not just the JRE the auto-installer provides.

---

## Architecture

The app is a clean three-layer split.

```
┌─────────────────────────────────────────────────────────────┐
│  RENDERER  (src/renderer/)  — UI only, no Node access       │
│  index.html loads css/* → locales/* → js/* in NUMERIC order  │
│  js/00-core … js/12-wizard (classic scripts, no bundler)     │
└───────────────────────────┬─────────────────────────────────┘
                            │  window.observer.*  (IPC)
┌───────────────────────────┴─────────────────────────────────┐
│  PRELOAD  (src/preload.js) — contextBridge, the only bridge  │
│  contextIsolation ON · nodeIntegration OFF · sandbox ON      │
└───────────────────────────┬─────────────────────────────────┘
                            │  ipcMain.handle(...)
┌───────────────────────────┴─────────────────────────────────┐
│  MAIN  (src/main.js) — thin composition root                 │
│  creates ctx, registers feature modules:                      │
│   context · server-lifecycle · backups · players ·            │
│   marketplace · modpacks · wizard · settings-handlers ·       │
│   content-handlers · tunnel · app-lifecycle                   │
│                                                               │
│  Pure/stateless helpers (testable without Electron):          │
│   java · server-files · settings · fs-utils · http ·          │
│   editor · worldmap · textures · validate · migrations        │
│  Per-software download resolvers:  adapters/                  │
│  Per-OS process/metrics/firewall:  platform/ (win32, linux)   │
│  Optional MCP/AI server + stdio bridge:  mcp/                 │
└───────────────────────────────────────────────────────────────┘
```

**Key ideas:**

- `src/main/context.js` holds the single shared mutable state object (`ctx`) plus helpers like `send`, `appendLog`, `setServerStatus`. Every status transition goes through `setServerStatus`, keeping the UI state machine consistent.
- **IPC channel names are stable** and shared with `preload.js`. Don't rename them; the renderer depends on them.
- Most `src/main/*` modules are plain, side-effect-free functions you can `require()` in a test with no Electron window.
- The renderer has **no `require()`** — it mirrors input validation manually (see `validate.js` vs `js/00-core.js`), and the backend re-validates as defense in depth.

---

## Development

### Run tests

```bash
npm test          # unit tests (plain Node, no framework)
npm run test:e2e  # Playwright end-to-end (real Electron app)
```

The unit suite covers boot state, editor safety rails, force-stop, input validation, Java/version mapping, metric parsing, marketplace/poll suppression, world map (incl. heightmap helpers), player equipment (old and new NBT layouts), download resume, explored-chunk filtering, the scheduler, modpack compatibility, and MCP (tool registry, HTTP server, stdio bridge). E2E boots the real app and asserts every tab renders and the language switch works.

### Build

```bash
npm run build:win     # Windows NSIS installer
npm run build:linux   # Linux AppImage
npm run build:all     # both
```

Releases are automated via GitHub Actions when you push a `v*` tag.

### Code conventions

- **English only** in code comments, commit messages, and the `en` locale block.
- **One concern per pull request.**
- Explain the *why*, not just the *what*, in PR descriptions — especially for bug fixes.
- Test on **Windows** if you can; several paths (`powershell.exe`, `cmd.exe`, `run.bat`) are Windows-specific.

### Project structure

```
ObserverLauncher/
├── src/
│   ├── main.js          # Electron main process (thin wiring)
│   ├── preload.js       # Safe IPC bridge
│   ├── main/            # Backend modules (see Architecture above)
│   │   ├── adapters/    # Server software download resolvers
│   │   └── platform/    # Windows/Linux process + metrics + firewall
│   └── renderer/        # UI
│       ├── index.html   # Shell (loads css/*, locales/*, js/* in order)
│       ├── js/          # Frontend per tab (00-core … 12-wizard)
│       ├── css/         # Styles per area (01-tokens … 09-pulse)
│       └── locales/     # One file per language (meta.js first)
├── tests/               # Unit tests (node tests/run.js)
├── docs/                # Screenshots
├── build/               # App icons
└── package.json
```

---

## Contributing

Issues and pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) first — it covers the development setup, the one-concern-per-PR rule, and how to add a language.

The most useful bug report includes **what you clicked, what you expected, and the actual Console output** (the launcher's Console tab, or `logs/latest.log` if the server itself failed).

---

## AI contributions

This project is developed with the assistance of AI tools (such as DeepSeek, Claude, ChatGPT and Qwen) for code generation, debugging and documentation. AI contributions accelerate development and improve code quality; all AI-generated code is reviewed and tested by humans before merging.

---

## License

[MIT](LICENSE) © ObserverLauncher contributors.

---

## Disclaimer

ObserverLauncher is an **unofficial** tool and is **not affiliated with, endorsed by, or associated with Mojang, Microsoft, or any server-software project** (Paper, Purpur, Fabric, Forge, Spigot, etc.). Minecraft is a trademark of Mojang Synergies AB.

Running a Minecraft server requires accepting the [Minecraft End User License Agreement](https://www.minecraft.net/en-us/eula). No Mojang game assets are bundled in this repository; item/block icons are fetched at runtime to your machine from a public mirror.
