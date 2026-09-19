# ObserverLauncher

**Run a Minecraft server on your own computer — without touching a terminal.**

ObserverLauncher is a desktop app for Windows and Linux that handles the boring parts of hosting a Minecraft server for you: downloading the server software, installing Java, editing config files, opening the firewall, and backing up your world. You pick a folder, choose a server type, and press **Start**.

[![Release](https://img.shields.io/github/v/release/Kag4286/ObserverLauncher?label=release)](https://github.com/Kag4286/ObserverLauncher/releases/latest)
[![Tests](https://github.com/Kag4286/ObserverLauncher/actions/workflows/test.yml/badge.svg)](https://github.com/Kag4286/ObserverLauncher/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20Linux-lightgrey)](https://github.com/Kag4286/ObserverLauncher/releases/latest)

> ⚠️ **Status: Experimental.** This project is under active development and is **not yet stable**. Things may change, break, or behave unexpectedly. Use it at your own risk. Bug reports and suggestions are very welcome.

### Highlights

- **One window, zero terminal** — download the server, install Java, edit configs, open the firewall and start, all from the GUI.
- **10 server types** — Vanilla, Paper, Purpur, Leaf, Folia, Velocity, Fabric, Forge, NeoForge, Spigot.
- **Live monitoring** — TPS, MSPT, CPU and RAM graphs with plain-language explanations.
- **Player inspector** — view and edit inventory, armor, off-hand and ender chest, with automatic backups.
- **Real world map** — biome preview read from your actual save files, plus players, waypoints and explored chunks.
- **Marketplace** — search Modrinth, Hangar and SpigotMC in one box and install straight into the server folder.
- **Resilient downloads** — retry and resume downloads automatically when the connection drops.
- **Runs locally** — no account, no telemetry, no cloud. Your world never leaves your PC.

### Quick links

- **Just want to install it?** → [Install](#install) · [Quick start (5 minutes)](#quick-start-5-minutes)
- **Hit a problem?** → [Troubleshooting](#troubleshooting) · [FAQ](#faq)
- **Want to build or contribute?** → [Architecture](#architecture-for-contributors) · [Development](#development)

---

## Table of contents

- [What is this?](#what-is-this)
- [Who is it for?](#who-is-it-for)
- [Screenshots](#screenshots)
- [Requirements](#requirements)
- [Install](#install)
- [Quick start (5 minutes)](#quick-start-5-minutes)
- [Feature tour](#feature-tour)
- [Supported server software](#supported-server-software)
- [Supported languages](#supported-languages)
- [Where things live on your disk](#where-things-live-on-your-disk)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Data & privacy](#data--privacy)
- [Known limitations](#known-limitations)
- [Roadmap](#roadmap)
- [Architecture (for contributors)](#architecture-for-contributors)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)
- [Disclaimer](#disclaimer)

---

## What is this?

Hosting a Minecraft server usually means following a long, error-prone tutorial:

1. Find and download a server `.jar` from some website.
2. Create a `run.bat` file by hand.
3. Edit JVM arguments and hope you got them right.
4. Open `server.properties` in Notepad and guess what `view-distance` does.
5. Download plugins one by one, matching versions to your server type.
6. Forward ports on your router and poke holes in your firewall.
7. Watch a black console scroll for 10 minutes to find out whether it worked.

ObserverLauncher turns all of that into a single window. What used to take an afternoon now takes about three minutes — and if something goes wrong, the app tells you *why* instead of showing a cryptic Java stack trace.

It is a **local** tool. It runs the server on your machine; it does not host anything for you, and it has no account system or cloud component.

---

## Who is it for?

- **First-time server owners** who want to play with friends and don't want to learn the command line.
- **People who already host manually** but want a GUI for the tedious parts (metrics, backups, config editing, player management).
- **Tinkerers** who want to run several server types (Paper, Fabric, Forge…) from one place.

If you are comfortable with a terminal and want maximum control, you may not need this — but the monitoring and backup features are still convenient.

---

## Screenshots

Every tab shares one look — a header strip (icon, section label, title, actions) over a single
surface, so the app feels like one instrument rather than a pile of screens.

**Overview** — the control panel: server identity, live status, TPS/RAM at a glance, quick actions and how friends can connect.

![ObserverLauncher Overview tab](docs/screenshot-overview.png)

**Console** — a dense live terminal with colour-coded levels (warn/error/command), filters and one-click quick commands.

![ObserverLauncher Console tab](docs/screenshot-console.png)

**Players** — the roster: online/offline, whitelist, bans and operators, with a quick-action bar that works even while the server is stopped.

![ObserverLauncher Players tab](docs/screenshot-players.png)

**Player inspector** — a two-column view of a player's stats, equipment, inventory and ender chest, with an automatic `.dat` backup before any edit.

![ObserverLauncher player inspector](docs/screenshot-player-inspector.png)

**Performance** — live telemetry: TPS, MSPT, server CPU and RAM as KPI cards plus history charts and capability-aware diagnostics.

![ObserverLauncher Performance tab](docs/screenshot-performance.png)

**Content library** — one list with a Plugins / Mods / Datapacks switch and a filter box, so hundreds of jars are a single scroll.

![ObserverLauncher Content tab](docs/screenshot-content.png)

**Marketplace** — search Modrinth, Hangar and SpigotMC in one box, filter by type and version, and install straight into your server folder.

![ObserverLauncher Marketplace tab](docs/screenshot-marketplace.png)

**Worlds & backups** — world folders on top, and a full-width backup timeline with one-click restore and delete.

![ObserverLauncher Worlds and backups tab](docs/screenshot-worlds.png)

**World Map** — reads your real world save: seed, spawn, player positions, waypoints, and explored chunks.

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

**You do not need admin rights.** The launcher installs Java into your user folder and only asks for elevation if you choose to open the Windows Firewall for a port.

Running from source additionally requires **Node.js 18 or newer**.

---

## Install

### Option A — Download the installer (recommended)

| Platform | File |
|---|---|
| Windows 10/11 (64-bit) | `ObserverLauncher-0.8.0-setup.exe` |
| Linux (AppImage) | `ObserverLauncher-0.8.0.AppImage` |

Grab the latest from the [Releases page](https://github.com/Kag4286/ObserverLauncher/releases/latest).

- **Windows:** run the `.exe`. It is a normal NSIS installer — you can choose the install location, and it sets up auto-update.
- **Linux:** `chmod +x ObserverLauncher-0.8.0.AppImage` then run it. No installation, no root required.

### Option B — Run from source

```bash
npm install
npm start
```

This starts the app in development mode (no packaging step). See [Development](#development) for tests and builds.

### Auto-update

The launcher checks GitHub Releases on startup and shows a notification when a newer version exists. One-click install:

- **Windows** — via the NSIS installer.
- **Linux** — via the AppImage.

> Auto-update does **not** work with a portable `.exe` or a `.deb`. Use the NSIS installer or AppImage. The release must also be *published*, not a draft.

---

## Quick start (5 minutes)

1. **Launch the app.** On first run you'll see the Overview tab with a welcome card.
2. **Choose a folder** — click **Choose folder** (or **Create new server**, which suggests a folder under `Documents/ObserverLauncher Servers`). Pick an **empty** folder; the launcher will not overwrite an existing server jar.
3. **Create a server** — click **Create new server** to open the wizard. Choose the software (e.g. *Paper*) and the Minecraft version, then let it download. Spigot compiles from source and takes several minutes — the Console tab shows progress.
4. **Check the setup checklist.** The Overview hero shows problems only: missing folder, missing jar, missing Java, or unaccepted EULA. When everything is green, the list disappears.
5. **Accept the EULA.** Minecraft servers require accepting Mojang's EULA. The launcher can write `eula=true` for you (enable **Accept EULA automatically** in Settings), or you can edit `eula.txt` yourself.
6. **Set memory.** In the stats row, set **Allocate RAM** (min / max in GB) and click **Apply**. A good rule of thumb is roughly half your system RAM, but leave room for the OS.
7. **Press Start.** The status pill moves through *Starting → Running*. The first launch creates `server.properties` and world folders — an initial `Failed to load properties` error is expected and harmless.
8. **Invite friends.** The *How friends can join* panel shows the address to share. On the same Wi-Fi, use the local address as-is. Over the internet, you also need to forward the port on your router — the **Allow this port through Windows Firewall** button only opens the OS firewall, it does not touch your router.

That's it. Everything else — plugins, players, backups, the world map — is optional.

---

## Feature tour

### Server setup

- Downloads **Vanilla, Paper, Purpur, Leaf, Fabric, Forge, NeoForge, Folia, Velocity or Spigot** from official sources.
- Loads version lists **live** from each project's API, so new Minecraft releases show up without an app update.
- **Java check before start** — compares your installed Java against what the jar actually needs (e.g. a 26.x jar needs Java 25; an old 1.12.2 jar needs Java 8) and blocks the start with a clear message if it's too old.
- **Automatic Java install** — no admin rights, no separate download page.
- **Spigot from source** via BuildTools (requires Git; takes several minutes).

### Live monitoring

- Real-time **TPS, MSPT, CPU and RAM** graphs.
- **Plain-language explanations** for each metric — hover the **?** next to a KPI.
- Works natively for **Paper / Purpur / Leaf / Folia / Forge**; for Vanilla and Fabric it shows the player count but TPS/MSPT stay `—` (those servers don't expose the data without a plugin like Spark).

### Player management

- See who is **online, whitelisted, banned or OP** in one roster.
- Whitelist / ban / OP players **even while the server is stopped** (the launcher edits the JSON files directly).
- **Open a player's inventory, armor, offhand and ender chest** with real item names, in a two-column inspector (stats + equipment on the left, inventory + ender chest on the right).
- Works on modern (1.21.5+ / 26.x) servers too, where armor and the off-hand item moved into the `equipment` NBT tag.
- Editing a player's health, XP, food or game mode creates a backup of the `.dat` file first.

### Plugin & mod marketplace

- Search **Modrinth, Hangar and SpigotMC** in one box.
- Shows **compatibility before you install** (game version, loader, server-side support) against the server the launcher detected.
- **Explicit version picker** with per-file download progress.
- **Import and export** standard Modrinth `.mrpack` files. Import checks the pack's declared Minecraft version and mod loader against your server and warns before installing a mismatch (never blocked — "Install anyway" is always available). Export writes real dependencies so other launchers know what to build.

### Config editor

- Edit `server.properties`, `spigot.yml`, `whitelist.json`, plugin configs and more, in place.
- **Collapsible folder tree** — a server folder can hold hundreds of editable files; the browser groups them by folder instead of one long flat list (search still shows full paths).
- **Syntax highlighting** for YAML, JSON, TOML, properties and JS.
- **JSON validation + auto-format**.
- **Conflict detection** — if the file changes on disk while you're editing, the launcher warns you instead of silently overwriting.
- For Velocity proxies, a raw `velocity.toml` editor replaces the properties grid.

### Backups

- **Manual or scheduled** ZIP snapshots of your world folders.
- Uses `save-off` / `save-all` / `save-on` so worlds are never archived mid-write.
- **Restore** from the launcher, with a zip-slip safety check on extraction.

### World Map

- Reads **real data** from your world save — not a mock-up.
- World **seed**, level name, version and spawn point from `level.dat`.
- **Player positions** with their last-saved time, plus a distinct spawn marker.
- **Real biome preview** — the map reads the actual biome data from your region files (1.18+ paletted containers) and colours each chunk by its real surface biome, not a guess. The spawn area is prefetched so it shows immediately.
- **Explored-chunk overlay** scanned from region files (`.mca`); chunks left half-generated by a crash are filtered out.
- **Waypoints** you can add, name, jump to and delete.
- **Jump to coordinates** — type `X Z` in the toolbar to center the map there.
- **Export the current view as PNG.**

### Console

- A real terminal view with timestamps, per-level colouring (info / warn / error / command) and **segmented filters**.
- **Command history** (↑ / ↓) and a one-click **recent commands** row.
- Auto-poll noise (`list`, `tps`, `tick query`) is filtered out so the log stays readable.

### Resilient downloads

- Downloads **retry automatically** and **resume from where they left off** (HTTP Range) when the connection drops, instead of starting over. A slow-but-alive download is never killed by a wall-clock timeout.
- Partial data is kept in a `.part` file between attempts, so a dropped Wi-Fi connection costs you seconds, not the whole download.
- **Cancellable downloads** in the create-server wizard: a Cancel button stops an in-progress download immediately (with a clear message), instead of forcing you to wait or close the app.
- Installing Java extracts into a staging folder first — a failed extract never wipes a working Java install.

### Launcher settings

- A single, numbered column for server folder, Java, reliability, preferences and updates.
- The **Apply button stays pinned** while you scroll, so you never lose it.

### Server schedule

- **Start and stop the server automatically on a daily window** — set an optional start time, an
  optional stop time, and the weekdays it applies to (leave days empty for every day).
- Uses the local system clock; if the computer is asleep at the scheduled time the action is skipped.
- A scheduled stop never interrupts an in-flight backup, and a scheduled start only runs when the
  server is fully stopped — it never fights a transition already in progress. A scheduled stop is
  treated as a manual stop, so auto-restart-on-crash will not revive it.

### Auto-update

- Checks GitHub Releases on launch and installs with one click (see [Install](#install)).
- Failures are shown clearly (offline, missing asset, bad signature) instead of leaving the button stuck on "Checking…".
- Installing while a server is running asks for confirmation first.

---

## MCP / AI integration

ObserverLauncher can act as an **MCP server**, so an AI assistant (Claude Desktop, Cursor, or any
MCP client) can read and control your server in natural language — check status, read the console,
manage files, install plugins, import modpacks, and more.

**Enable it:** Settings → **MCP / AI** → *Enable MCP server*. The launcher starts a **local-only**
server (127.0.0.1, random port, a fresh token every launch) and writes its connection info to
`mcp-bridge.json` in the launcher's data folder. The app must stay open while the client is used.

**Connect a client:** click **Copy MCP config** and paste it into your client's MCP settings, e.g.:

```json
{
  "mcpServers": {
    "observerlauncher": {
      "command": "<path-to-ObserverLauncher>",
      "args": ["<userData>/mcp/bridge.js"],
      "env": { "ELECTRON_RUN_AS_NODE": "1", "OBSERVER_MCP_USERDATA": "<userData>" }
    }
  }
}
```

The exact JSON (with the real paths filled in) is what the **Copy MCP config** button puts on your
clipboard — paste that. The launcher runs the bridge with its OWN binary (`ELECTRON_RUN_AS_NODE=1`),
so **you do not need Node.js installed**.

**Permissions.** Tools are tiered: **read** tools run freely; **write** tools (install, edit files,
send a command) ask for confirmation in the app first — you can switch on *Auto-allow write tools*
to skip that; **destructive** tools (stop, delete, restore) always ask and can never be auto-approved.

> MCP needs the launcher to be running and the integration enabled. Nothing is exposed beyond
> `127.0.0.1`, and the token changes every launch.

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

The interface is fully translated for all 7 languages. Any missing key falls back to English automatically, so a partial translation still works.

---

## Where things live on your disk

### Your server folder

This is the folder you chose in the launcher. A typical Paper/Fabric server looks like:

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

### Java not detected

Install Java from the launcher (**Settings → Java runtime → Install Java automatically**), or set the path manually in Settings. If you already have Java, make sure `java -version` works in a terminal — if it doesn't, the launcher won't see it either.

### "This jar needs Java X+, detected Java Y"

The server jar requires a newer Java than you have. Use the **Fix Java** button in the banner, or install a newer Java manually. Note that Minecraft moved to calendar versioning: **26.x servers need Java 25**, 1.20.5+/1.21.x need Java 21, 1.18+ need Java 17, and very old versions need Java 8.

### TPS / MSPT show "—"

Only **Paper, Purpur, Leaf, Folia and Forge** have a built-in TPS/MSPT command. Vanilla and Fabric don't expose it. Install **Spark** from the Marketplace if you need deep profiling on those.

### The server won't start and I see no clear error

Check the **Console** tab and scroll up — the real Java error is usually a few lines above. The most common causes are a Java version mismatch, too little allocated RAM, or a corrupted/partial jar download (delete the jar and re-run the wizard).

### "Failed to load properties" on first start

This is **expected** on the very first launch. `server.properties` doesn't exist yet, so the server complains once, creates the file, and continues.

### Start button is greyed out

Hover it — the tooltip says why. Usually one of: no folder chosen, no runnable `.jar`/`run.bat` in the folder, or Java not detected. The Overview setup checklist lists the same problems.

### CPU or RAM shows 0 / "—" on a non-English Windows

This was a real bug (fixed in 0.3.0): PowerShell printed decimals with a comma (`45,6712`) on locales like vi-VN or de-DE, which broke the metric parser. Make sure you are on **0.3.0 or later**. If it still happens, please open an issue with your Windows display language.

### Spigot build fails

Spigot has no legal pre-built download — it is compiled locally with **BuildTools**, which needs **Git** installed and on your PATH. Install Git from [git-scm.com](https://git-scm.com) and try again. The build can take several minutes; watch the Console tab.

### Auto-update not working

Make sure you installed via the **NSIS installer** (Windows) or **AppImage** (Linux) — not a portable `.exe` or `.deb`. Also confirm the GitHub release is **published**, not a draft.

### Backup is empty or fails

Check that your world folders exist and are named as expected (the launcher follows `level-name` from `server.properties`). On Linux, backups need **`zip` or `tar`** available on the system. Restores refuse archives that contain unsafe paths (absolute paths or `..`) as a safety measure.

### Friends can't connect over the internet

Opening the Windows Firewall (the button in the launcher) is only **half** the job. You also need to **forward the port on your router** to your PC's local IP. If your ISP uses carrier-grade NAT, port forwarding may not work at all — consider a tunnel service or a rented host instead.

### The app is stuck on "Stopping…"

Use the **Force stop** button in the top bar. It kills the server process tree immediately. Unsaved progress may be lost, so it confirms first — but it is exactly the escape hatch for a frozen server.

---

## FAQ

**Do I need to own Minecraft to run a server?**
The server software is free. Players need a legitimate Minecraft: Java Edition account *if* the server runs in online mode (the default). You can turn online mode off in `server.properties`, but that allows cracked clients — think twice before doing so.

**Does the launcher host the server for me?**
No. The server runs on your own computer. The launcher is only the control panel.

**Can I run more than one server?**
Yes — just point the launcher at a different folder. Settings are shared (one active set, not stored per-folder): the RAM allocation, Java path, JVM arguments and other options apply to whichever folder is currently loaded, so switching folders switches servers but keeps your settings.

**Where are my backups?**
Inside your server folder, in `observerlauncher-backups/`, as `.zip` files.

**Can I use this on a Mac?**
Not officially. It is built and tested for Windows and Linux. macOS is not a supported target.

**Does it work with Bedrock?**
No. This is for **Minecraft: Java Edition** servers only.

**How much RAM should I allocate?**
For a small server with a few friends, 2–4 GB is plenty. Leave at least 2 GB for the OS. The launcher defaults to roughly half your system RAM (capped at 8 GB).

**Can I edit configs by hand instead of in the app?**
Absolutely. Everything is a normal file in your server folder. The launcher even detects when a file changes on disk while it's open in its editor.

---

## Data & privacy

ObserverLauncher is a local tool. It has **no account, no telemetry, and no analytics**.

**What it downloads (only when you ask it to):**
- Server jars from the official Mojang / PaperMC / Purpur / Leaf / Fabric / Forge Maven endpoints.
- Plugins and mods from Modrinth, Hangar and SpigotMC when you install them.
- Item/block icons from the public **PrismarineJS** mirror, cached on your machine (no Mojang assets are bundled or redistributed).
- Java runtimes, when you use the automatic Java installer.
- Update metadata from GitHub Releases.

**What it never does:**
- It does not upload your world, configs, or player data anywhere.
- It does not collect usage statistics.
- It does not run any background service once the app is closed.

All requests are made directly from your machine to the official sources.

---

## Known limitations

- **Windows and Linux only.** No macOS build.
- **Not stable.** See the warning at the top — expect rough edges.
- **TPS/MSPT need a supported server.** Vanilla and Fabric report player count only.
- **Spigot needs Git** and compiles slowly.
- **Velocity proxies don't tick a world**, so their TPS/MSPT panel shows N/A by design.
- **No macOS auto-update path**, and auto-update requires the packaged installer/AppImage.
- **Port forwarding is still on you** — the launcher cannot configure your router.
- **Spigot needs a JDK.** The one-click Java install fetches a JRE, which runs a server but cannot compile Spigot's BuildTools — install a full JDK if you plan to use Spigot.

### Linux notes

Linux is supported, and 0.5.0 fixed the biggest gaps (the Java auto-installer and .mrpack import/export used to be Windows-only and silently broken on Linux). That said, **Linux has not yet been verified on real hardware** — the fixes are code-analysed and unit-tested only, so treat the Linux build as newer and less battle-tested than Windows. Known differences from Windows:

- **Firewall is not opened for you.** Windows gets a one-click UAC prompt; on Linux the button copies `sudo ufw allow <port>/tcp` to your clipboard so you can run it yourself. The launcher never requests sudo.
- **Backups and archives need `zip` or `tar` installed.** If neither is present, the launcher tells you what to install instead of failing silently. Most distros have `tar`; `zip` may need `sudo apt install zip`.
- **Auto-update works only for the AppImage.** A `.deb`/`.rpm` build would not auto-update.
- **Stopping the server uses SIGTERM** (plus a `/proc` walk and SIGKILL fallback), which is slightly less immediate than Windows' `taskkill /T /F`.
- **The window uses your desktop's own title bar** (no integrated overlay like on Windows).
- **Spigot's BuildTools needs a JDK**, not just the JRE the auto-installer provides.

---

## Roadmap

Planned / under consideration (not promises):

- Broader i18n coverage for strings not yet wired to `data-i18n`.
- More per-software adapters and version schemes.
- Further world-map layers (e.g. structures, higher-resolution biome detail).
- Better error surfacing for rare Java/OS edge cases.

See the [CHANGELOG](CHANGELOG.md) for what has already shipped.

---

## Architecture (for contributors)

The app follows a clean three-layer split. Understanding it makes contributing much easier.

```
┌─────────────────────────────────────────────────────────────┐
│  RENDERER  (src/renderer/)  — UI only, no Node access       │
│  index.html loads css/* → locales/* → js/* in NUMERIC order  │
│  js/00-core … js/12-wizard (classic scripts, no bundler)     │
└───────────────────────────┬─────────────────────────────────┘
                            │  window.observer.*  (IPC)
┌───────────────────────────┴─────────────────────────────────┐
│  PRELOAD  (src/preload.js) — contextBridge, the only bridge  │
│  contextIsolation ON · nodeIntegration OFF                    │
└───────────────────────────┬─────────────────────────────────┘
                            │  ipcMain.handle(...)
┌───────────────────────────┴─────────────────────────────────┐
│  MAIN  (src/main.js) — thin composition root                 │
│  creates ctx, registers 9 feature modules:                    │
│   context · server-lifecycle · backups · players ·            │
│   marketplace · modpacks · wizard · settings-handlers ·       │
│   content-handlers · app-lifecycle                            │
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

- `src/main/context.js` holds the single shared mutable state object (`ctx`) plus helpers like `send`, `appendLog`, `setServerStatus`. Every status transition goes through `setServerStatus`, so the UI state machine stays consistent.
- **IPC channel names are stable** and shared with `preload.js`. Don't rename them; the renderer depends on them.
- Most `src/main/*` modules are plain, side-effect-free functions you can `require()` in a test with no Electron window.
- The renderer has **no `require()`** — it mirrors input validation manually (see `validate.js` vs `js/00-core.js`), and the backend re-validates as defense in depth.

---

## Development

### Run tests

```bash
npm test
```

Runs every `tests/*.test.js` through `tests/run.js` (plain Node, no framework) and fails fast. The suite covers boot state, the editor safety rails, force-stop, input validation, Java/version mapping, metric parsing, marketplace/poll suppression, textures, world-map wiring, player equipment (old and new NBT layouts), download resume, explored-chunk filtering, the scheduler, modpack compatibility, MCP (tool registry, HTTP server, and the stdio bridge over a real child process) and more.

### Run end-to-end tests

```bash
npm run test:e2e
```

Launches the real Electron app with Playwright (`tests/e2e/`) against a throwaway user-data folder, then asserts the renderer boots, every tab renders and the language switch works. Kept separate from the unit suite. On headless Linux CI these run under `xvfb-run` (already wired in `.github/workflows/test.yml`).

### Build

```bash
npm run build:win     # Windows NSIS installer
npm run build:linux   # Linux AppImage
npm run build:all     # both
```

### Release

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

When reporting a bug, the most useful report includes **what you clicked, what you expected, and the actual Console output** (the launcher's Console tab, or `logs/latest.log` if the server itself failed).

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
