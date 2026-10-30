<div align="center">

<img src="build/icon.png" width="80" alt="ObserverLauncher icon">

# ObserverLauncher

**Host your own Minecraft: Java Edition server on Windows or Linux.**  
No terminal, no monthly cloud bills, no accounts. Pick a folder, select a version, and press Start.

[![Release](https://img.shields.io/github/v/release/Kag4286/ObserverLauncher?style=flat-square&logo=github&color=347d39)](https://github.com/Kag4286/ObserverLauncher/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Kag4286/ObserverLauncher/total?style=flat-square&logo=github&color=0969da)](https://github.com/Kag4286/ObserverLauncher/releases)
[![Build & Tests](https://img.shields.io/github/actions/workflow/status/Kag4286/ObserverLauncher/test.yml?branch=main&label=tests&style=flat-square&logo=githubactions&logoColor=white)](https://github.com/Kag4286/ObserverLauncher/actions/workflows/test.yml)
[![Status](https://img.shields.io/badge/status-active-success?style=flat-square&logo=git&logoColor=white)](https://github.com/Kag4286/ObserverLauncher/pulse)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square&logo=apache)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows_%7C_Linux-2ea44f?style=flat-square&logo=windows&logoColor=white)](https://github.com/Kag4286/ObserverLauncher/releases/latest)
<br>
[![Minecraft Support](https://img.shields.io/badge/Minecraft-1.8_%E2%86%92_26.x-brightgreen?style=flat-square&logo=minecraft&logoColor=white)](https://github.com/Kag4286/ObserverLauncher)
[![Java Runtimes](https://img.shields.io/badge/Java-8_%7C_17_%7C_21_%7C_25-ED8B00?style=flat-square&logo=openjdk&logoColor=white)](https://github.com/Kag4286/ObserverLauncher)
[![Languages](https://img.shields.io/badge/languages-7_supported-informational?style=flat-square&logo=translate&logoColor=white)](https://github.com/Kag4286/ObserverLauncher#supported-languages)
[![MCP Ready](https://img.shields.io/badge/MCP-78_Tools_Ready-8A2BE2?style=flat-square&logo=anthropic&logoColor=white)](https://github.com/Kag4286/ObserverLauncher#mcp--ai-integration)
[![Remote API](https://img.shields.io/badge/Remote_API-HTTP_%2B_Bearer-blueviolet?style=flat-square)](https://github.com/Kag4286/ObserverLauncher#remote-management--api)
[![Zero Cloud](https://img.shields.io/badge/hosting-100%25_Local_%7C_No_Cloud-informational?style=flat-square)](https://github.com/Kag4286/ObserverLauncher)
[![Contributions Welcome](https://img.shields.io/badge/contributions-welcome-orange?style=flat-square&logo=github)](CONTRIBUTING.md)

[Releases](https://github.com/Kag4286/ObserverLauncher/releases/latest) &nbsp;·&nbsp; [Changelog](CHANGELOG.md) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md) &nbsp;·&nbsp; [Documentation](docs/)

<img src="docs/screenshot-overview.png" width="800" alt="ObserverLauncher overview screen">

</div>

---

## What is ObserverLauncher?

ObserverLauncher is a **server hosting application** designed to run directly on your own computer. It replaces confusing terminal commands and wikis with a simple, friendly interface: downloading server files, finding the right Java version, letting friends join over the internet, warning you if mods conflict, and taking automatic world backups.

Everything runs locally on your PC. There are no paid subscriptions, no account signups, and zero tracking.

---

## Quick Start

1. **Download & Install:** Grab the installer for Windows (`.exe`) or Linux (`.AppImage`) from [Releases](https://github.com/Kag4286/ObserverLauncher/releases/latest).
2. **Create Server:** Click **Create new server**, choose what kind of server you want (Paper, Fabric, Forge, NeoForge, Spigot, Vanilla, etc.), and pick your Minecraft version.
3. **Start Playing:** Click **Start**. The launcher makes sure the right Java is installed, handles the Minecraft EULA agreement, and turns on your server.
4. **Invite Friends:** If friends are on your home Wi-Fi, share your local address. If they are playing from anywhere else, turn on the built-in internet tunnel (Playit.gg / Pinggy) for an instant link—**no router port forwarding needed**.

---

## Key Features

### Simple & Friendly for Everyday Use

- **1-Click Server Creation:** Choose from Paper, Purpur, Leaf, Folia, Fabric, Forge, NeoForge, Spigot, Vanilla, or Velocity. New Minecraft versions appear right inside the menu without needing app updates.
- **Automatic Java Setup:** Never worry about which Java to install. The launcher automatically detects what Java version your server needs (Java 8, 17, 21, or 25) and downloads it for you with 1 click.
- **Easy Internet Play:** Play with friends over the internet without touching messy router settings. Built-in Playit.gg and Pinggy integration creates a shareable link in seconds.
- **Built-in Mod & Plugin Store:** Browse and install mods, plugins, and datapacks directly from Modrinth, Hangar, and SpigotMC. The app checks if mods match your server before installing and lets you rollback updates with one click.
- **Automatic Mod Conflict Checks:** Warns you before your server starts if mods are missing required dependencies, duplicate, built for the wrong mod loader, or made for an incompatible Minecraft version.
- **Player Inspector & 3D Skins:** View online and offline players, browse player inventories and equipment with real game icons, and preview interactive 3D skins.
- **Safe World Backups:** Back up your worlds to ZIP files anytime or on an automatic schedule. Backups pause world saving for a split second so your saves never get corrupted.
- **Live World Map:** Explore your generated world terrain, surface biomes, and custom waypoints in real-time.
- **Friendly Crash Explanations:** If your server crashes due to a wrong Java version, the launcher explains the problem in plain English (e.g. *"This server requires Java 21, but Java 17 is selected"*) and gives you a button to fix it immediately.
- **Safety History for Settings:** If you make a mistake editing server properties, easily restore previous versions with a 1-click history rewind.
- **Discord Alerts:** Send messages to your Discord channel whenever your server starts, stops, crashes, or when players join.

<p align="center">
  <img src="docs/screenshot-player-inspector.png" width="48%" alt="Player Inspector">
  &nbsp;
  <img src="docs/screenshot-worldmap.png" width="48%" alt="World Map">
</p>

---

## Supported Languages

ObserverLauncher comes with full, native translations for **7 languages** across all menus, tools, and error messages:

- 🇬🇧 **English** (`en`)
- 🇻🇳 **Tiếng Việt** (`vi`)
- 🇪🇸 **Español** (`es`)
- 🇧🇷 **Português (Brasil)** (`pt-BR`)
- 🇩🇪 **Deutsch** (`de`)
- 🇷🇺 **Русский** (`ru`)
- 🇨🇳 **简体中文** (`zh-CN`)

You can switch languages anytime from **Launcher settings &rarr; Personal &rarr; Language**.

---

## Advanced Capabilities

ObserverLauncher provides robust infrastructure for experienced server operators, homelabs, and developers:

- **Multi-Instance Management:** Run several servers simultaneously. Each instance maintains isolated server directories, Java runtimes, ports, schedules, automated backups, and tunnels.
- **Remote Management API:** Dedicated loopback HTTP server with long-lived Bearer tokens, IP allowlisting (single IPs, wildcards, CIDR subnets), and an optional strict read-only mode. Pair with Tailscale, ZeroTier, or a tunnel to securely manage and monitor your servers from mobile devices, external web dashboards, or scripts.
  - Endpoints: Live server status, real-time console log stream, player list, and safe single-line console commands.
- **Model Context Protocol (MCP):** Operates as an MCP server with 78 structured tools, enabling AI coding assistants and autonomous agents to safely inspect logs, run diagnostic tools, configure settings, and manage content under strict confirmation tiers.
- **CLI Mode (`observer`):** Full headless command-line interface for scripting and server environments without a desktop:
  ```bash
  observer status
  observer start --instance survival-server
  observer players
  observer install luckperms
  ```
- **Prometheus Metrics:** Exposes live server TPS, MSPT, CPU, memory, and player counts via a local `/metrics` endpoint for Grafana dashboards.
- **Docker Export & Headless:** Generate standard, production-ready `Dockerfile` and `docker-compose.yml` configurations directly from your instance settings to deploy anywhere.
- **Bedrock Crossplay (Geyser/Floodgate):** Automatically detects Geyser and Floodgate, validates network configurations, and provides one-click compatibility fixes and Pinggy UDP tunneling.
- **In-App Text & Config Editor:** Safe in-launcher editor for configuration and datapack files (`.json`, `.yml`, `.properties`, `.toml`, `.mcfunction`, `.snbt`) featuring mtime conflict detection and atomic writes.

---

## Supported Server Software

| Software | Mod/Plugin Support | Live TPS / MSPT | Pre-flight Scan |
|---|---|---|---|
| **Paper / Purpur / Leaf / Folia** | Bukkit / Spigot / Paper plugins | Yes | Plugin conflicts |
| **Fabric / Quilt** | Fabric mods | Player count | Mod & Dep scan |
| **Forge / NeoForge** | Forge / NeoForge mods | Yes | Mod & Dep scan |
| **Spigot / Bukkit** | Spigot / Bukkit plugins | Via config | Plugin conflicts |
| **Vanilla** | Datapacks only | Player count | N/A |
| **Velocity** | Proxy plugins | N/A (Proxy) | Proxy config |

---

## System Requirements

- **Operating System:** Windows 10/11 (64-bit) or modern 64-bit Linux distribution.
- **Memory:** 4 GB RAM minimum (8 GB+ recommended for modded servers).
- **Disk:** ~1 GB for launcher and dependencies; additional space for world saves.
- **Java:** Any Java 8–25 runtime. The app detects existing installations and can automatically download OpenJDK runtimes.

---

## Building from Source

ObserverLauncher is built with Electron and Node.js. It adheres to a zero-dependency philosophy for core save data parsing (NBT, Region ANVIL files, and zip extraction are implemented cleanly without heavy third-party native binaries).

```bash
# Clone the repository
git clone https://github.com/Kag4286/ObserverLauncher.git
cd ObserverLauncher

# Install dependencies
npm install

# Run the app in development mode
npm start

# Run unit and integration tests (154 test suites)
npm test

# Run end-to-end tests
npm run test:e2e

# Build production installers
npm run build:win      # Windows installer (.exe)
npm run build:linux    # Linux AppImage
```

---

## Privacy & Security

ObserverLauncher operates 100% locally on your machine.
- **No telemetry, analytics, or tracking.**
- **No required logins or accounts.**
- **Defense-in-depth security:** Context-isolated Electron windows, strict path traversal guards (`safeTarget`), SSRF filters covering IPv4/IPv6 loopback & private subnets, timing-safe token comparisons, and atomic file transactions.
- All downloads (server jars, plugins, Java builds, and textures) come directly from official public APIs and mirrors.
- Minecraft assets and vanilla textures are never bundled into the installer, strictly respecting Mojang's EULA.

---

## License

ObserverLauncher is licensed under the [Apache-2.0 License](LICENSE).  
Minecraft is a trademark of Mojang Synergies AB. ObserverLauncher is an independent open-source project and is not affiliated with Mojang or Microsoft.
