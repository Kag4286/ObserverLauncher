<div align="center">

<img src="build/icon.png" width="80" alt="ObserverLauncher icon">

# ObserverLauncher

**Desktop launcher and local server manager for Minecraft on Windows and Linux.**  
Set up Java or Rust servers locally, inspect player data and `.mca` world maps directly from disk, and share worlds over Playit or Pinggy without touching router settings.

[![Release](https://img.shields.io/github/v/release/Kag4286/ObserverLauncher?style=flat-square&logo=github&color=347d39)](https://github.com/Kag4286/ObserverLauncher/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Kag4286/ObserverLauncher/total?style=flat-square&logo=github&color=0969da)](https://github.com/Kag4286/ObserverLauncher/releases)
[![Build & Tests](https://img.shields.io/github/actions/workflow/status/Kag4286/ObserverLauncher/test.yml?branch=main&label=tests&style=flat-square&logo=githubactions&logoColor=white)](https://github.com/Kag4286/ObserverLauncher/actions/workflows/test.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square&logo=apache)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows_%7C_Linux-2ea44f?style=flat-square&logo=windows&logoColor=white)](https://github.com/Kag4286/ObserverLauncher/releases/latest)

[Releases](https://github.com/Kag4286/ObserverLauncher/releases/latest) · [Release Notes](release.md) · [Changelog](CHANGELOG.md) · [Contributing](CONTRIBUTING.md) · [Architecture](docs/architecture.md)

<br>

<img src="docs/screenshot-overview.png" width="850" alt="ObserverLauncher main dashboard interface">

</div>

---

## Why ObserverLauncher

Web panels such as Crafty Controller and Pterodactyl work well on dedicated Linux boxes and VPS hosts. When you only want to run a world on your own Windows or Linux PC for friends, or quickly test a modpack or a Rust server like Pumpkin locally, setting up Docker or hunting down matching Java versions adds friction.

ObserverLauncher runs as a self-contained desktop app with everything stored in local folders: no accounts, no analytics, and no cloud panel required.

## Quick Start

1. Download the Windows installer (`.exe`) or Linux `.AppImage` from [Releases](https://github.com/Kag4286/ObserverLauncher/releases/latest).
2. Click **Create new server**, pick a folder and server software (Vanilla, Paper, Fabric, Forge, Pumpkin, etc.), and choose a Minecraft version.
3. Click **Start**. For Java servers, the launcher checks the jar's required bytecode version and downloads a portable OpenJDK build (Java 8, 17, 21, or 25) if needed. Native Rust servers run directly without Java.
4. Share your LAN address for local play, or enable the built-in Playit.gg or Pinggy tunnel to let friends join over the internet without port forwarding.

## Key Capabilities

### Multi-Engine Server Management
- Runs Java servers (Paper, Purpur, Leaf, Folia, Fabric, Quilt, Forge, NeoForge, Spigot, Vanilla, Velocity) alongside native Rust engines ([Pumpkin](https://github.com/Pumpkin-MC/Pumpkin) and [Horizon](https://github.com/horizon-rust/horizon)), which typically idle around 100 to 250 MB RAM without a JVM.
- Checks mods and plugins before startup to catch duplicate mod IDs, missing dependencies, and wrong-loader jars (such as Forge mods placed in a Fabric server).
- Isolates multiple server instances per folder with separate settings, ports, schedules, and world backups.
- Inspects Geyser and Floodgate configurations for Bedrock crossplay and fixes common port or auth mismatches with automatic backups.

<p align="center">
  <img src="docs/screenshot-player-inspector.png" width="48%" alt="Player Inspector 3D Preview">
  &nbsp;
  <img src="docs/screenshot-inventory.png" width="48%" alt="Player Inventory Matrix">
</p>

### Offline & Live Player Inspector
- Renders a 3D player preview with Mojang skins, outer skin layers, and equipped armor (including modded armor layers when available in local jars).
- Inspects online players immediately via live session tracking even before a `.dat` file is written to disk, which is useful for first-time joins and native Rust servers.
- Displays the 9x4 player inventory and Ender Chest grid with item search, sorting, enchantments, and formatted item tooltips (`§` color codes).
- Supports offline `.dat` editing for health, hunger, XP, gamemode, and inventory clearing (when stopped), plus quick `/op`, `/whitelist`, `/tp`, `/kick`, and `/ban` actions while running.

<div align="center">
  <img src="docs/screenshot-worldmap.png" width="850" alt="World Map Interface">
</div>

### Disk-Based World Map
Reads Anvil `.mca` region files directly from disk without requiring Dynmap, BlueMap, or other heavy map plugins on the server:
- Renders biome boundaries, terrain elevation shading, surface blocks, and water across explored regions.
- Decodes Anvil compression scheme 4 (`LZ4Block`), supporting region files produced by Pumpkin as well as standard zlib/gzip regions.
- Detects structures in both legacy formats (1.12 to 1.17 `Level.Structures.Starts`) and modern formats (1.18 to 1.21+ `structures.starts`).
- Includes a Low-Resource mode (18-chunk query cap without relief pass) for lower-end PCs, plus an Overworld/Nether 1:8 portal coordinate helper.

## Supported Server Software

| Engine / Distribution | Runtime | Ecosystem | Telemetry |
|---|---|---|---|
| **Pumpkin** | Rust Native | Vanilla protocol clean-room | Process RAM/CPU, console TPS & MSPT |
| **Horizon** | Rust Native | MC 26.3 clean-room | Process RAM/CPU, native TOML sync |
| **Paper / Purpur / Leaf / Folia** | Java 17 to 25 | Bukkit / Spigot / Paper plugins | Real-time TPS, MSPT, heap memory |
| **Fabric / Quilt** | Java 8 to 25 | Fabric mods | Player metrics, process telemetry |
| **Forge / NeoForge** | Java 8 to 25 | Forge & NeoForge mods | Real-time TPS, mod dependency check |
| **Spigot / CraftBukkit** | Java 8 to 25 | Bukkit plugins | Heap memory, player list |
| **Vanilla** | Java 8 to 25 | Official Mojang server | Player list, console stream |
| **Velocity** | Java 17 to 25 | Multi-server proxy | Proxy routes, connection status |

## Headless CLI, Remote API & Tooling

Beyond the Electron UI, the backend can run headless for terminal workflows, scripts, or external tooling:

```bash
observer status                      # Check active server state
observer start --instance survival   # Start a specific instance
observer players                     # List online and cached players
observer backup create               # Create a world backup
```

Optional interfaces (disabled by default in Launcher settings):
- **Remote HTTP API:** Local loopback/LAN dashboard and REST endpoints (`/api/status`, `/api/logs`, `/api/command`) protected by token auth and CIDR IP allowlisting.
- **Prometheus Metrics:** Optional `/metrics` endpoint on loopback (`127.0.0.1`).
- **Local MCP Bridge:** Exposes 78 server-ops tools (`src/mcp/bridge.js`) over stdio/loopback HTTP with `read`, `write`, and `destroy` permission tiers and in-app confirmation prompts before destructive changes.

<div align="center">
  <img src="docs/screenshot-MCP.png" width="760" alt="Integrations and Automation Settings">
</div>

## Languages

The UI is translated into 7 languages (switch under **Launcher settings > Personal > Language**):

English (`en`), Vietnamese (`vi`), Spanish (`es`), Portuguese Brazil (`pt-BR`), German (`de`), Russian (`ru`), and Simplified Chinese (`zh-CN`).

## Scope & Limitations

- **Desktop OS only:** Prebuilt packages target Windows 10/11 (64-bit) and Linux `x86_64` (`.AppImage`). There is no macOS build yet.
- **Built for local PCs, not 24/7 VPS clusters:** If you run dedicated Linux servers in Docker/Proxmox around the clock for a large public network, a web panel such as Crafty Controller or Pterodactyl is a better fit.
- **Native Rust engines are upstream WIP:** Pumpkin and Horizon compatibility depends on upstream server progress; complex Bukkit/Paper plugins relying on JVM internals may not run identically to Paper.

## System Requirements

- **OS:** Windows 10/11 (64-bit) or Linux (`x86_64`, glibc 2.31+)
- **CPU:** 64-bit dual-core minimum (quad-core recommended for modded servers)
- **RAM:** 4 GB minimum (8 GB+ recommended for modded Java servers)
- **Disk:** ~1 GB for app assets and portable Java builds, plus space for worlds and backups
- **Java:** Optional (auto-downloaded if missing for Java servers; not used for Pumpkin or Horizon)

## Building from Source

ObserverLauncher uses Electron and Node.js with no bundler step (`src/` runs directly). NBT, Anvil region parsing, LZ4 decompression, and zip inspection are implemented in JavaScript.

```bash
git clone https://github.com/Kag4286/ObserverLauncher.git
cd ObserverLauncher

npm install
npm start          # Launch app in development mode
npm test           # Run unit and integration tests
npm run test:e2e   # Run Playwright Electron E2E tests

npm run build:win   # Windows installer (.exe)
npm run build:linux # Linux AppImage
```

## Security & Privacy

- No analytics, telemetry, or account sign-in; network calls happen only for server/mod/Java downloads, skin lookups, and user-configured tunnels or webhooks.
- Renderer windows run with `contextIsolation: true` and `nodeIntegration: false`, exposed strictly through `src/preload.js`.
- File operations normalize and verify target paths against the server root (`safeTarget`) to prevent path traversal and Zip-Slip attacks.
- Outbound downloads and webhook URLs pass SSRF filtering blocking loopback, link-local, and private network ranges.

## License

Licensed under [Apache-2.0](LICENSE).  
Minecraft is a trademark of Mojang Synergies AB. ObserverLauncher is an independent open-source project and is not affiliated with Mojang or Microsoft.
