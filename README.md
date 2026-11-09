<div align="center">

<img src="build/icon.png" width="80" alt="ObserverLauncher icon">

# ObserverLauncher

**Desktop launcher and local management tool for Minecraft servers on Windows and Linux.**  
Download files, configure runtimes, inspect player data, and host multiplayer worlds locally without cloud accounts or subscription fees.

[![Release](https://img.shields.io/github/v/release/Kag4286/ObserverLauncher?style=flat-square&logo=github&color=347d39)](https://github.com/Kag4286/ObserverLauncher/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/Kag4286/ObserverLauncher/total?style=flat-square&logo=github&color=0969da)](https://github.com/Kag4286/ObserverLauncher/releases)
[![Build & Tests](https://img.shields.io/github/actions/workflow/status/Kag4286/ObserverLauncher/test.yml?branch=main&label=tests&style=flat-square&logo=githubactions&logoColor=white)](https://github.com/Kag4286/ObserverLauncher/actions/workflows/test.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache_2.0-blue?style=flat-square&logo=apache)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows_%7C_Linux-2ea44f?style=flat-square&logo=windows&logoColor=white)](https://github.com/Kag4286/ObserverLauncher/releases/latest)
[![Minecraft Support](https://img.shields.io/badge/Minecraft-1.8_%E2%86%92_26.x-brightgreen?style=flat-square&logo=minecraft&logoColor=white)](https://github.com/Kag4286/ObserverLauncher)
[![Java Runtimes](https://img.shields.io/badge/Java-8_%7C_17_%7C_21_%7C_25-ED8B00?style=flat-square&logo=openjdk&logoColor=white)](https://github.com/Kag4286/ObserverLauncher)
[![Native Engines](https://img.shields.io/badge/Native_Engines-Horizon_%7C_Pumpkin_(Rust)-dea584?style=flat-square&logo=rust&logoColor=white)](https://github.com/Pumpkin-MC/Pumpkin)
[![Languages](https://img.shields.io/badge/languages-7_supported-informational?style=flat-square&logo=translate&logoColor=white)](#supported-languages)
[![MCP Ready](https://img.shields.io/badge/MCP-78_Tools-8A2BE2?style=flat-square&logo=anthropic&logoColor=white)](#developer-and-automation-interfaces)

[Releases](https://github.com/Kag4286/ObserverLauncher/releases/latest) &nbsp;·&nbsp; [Release Notes](release.md) &nbsp;·&nbsp; [Technical Changelog](CHANGELOG.md) &nbsp;·&nbsp; [Contributing](CONTRIBUTING.md) &nbsp;·&nbsp; [Documentation](docs/)

<br>

<img src="docs/screenshot-overview.png" width="850" alt="ObserverLauncher main dashboard interface">

</div>

---

## Overview

ObserverLauncher is a self-contained desktop application designed to simplify hosting, maintaining, and monitoring local Minecraft servers. It automates server binary downloads, Java environment resolution, port forwarding alternatives, mod conflict scanning, and world backup routines.

### Core Principles
- **Local-first operation:** All processes, configuration files, and world data remain strictly on your machine.
- **Zero telemetry:** No analytics collection, telemetry beacons, or third-party tracking scripts.
- **No account requirements:** The application functions fully offline without account registration.
- **Multi-engine compatibility:** Runs both traditional Java-based servers (Paper, Fabric, Forge) and native compiled Rust engines (Pumpkin, Horizon).

---

## Quick Start

1. **Install:** Download the Windows setup executable (`.exe`) or Linux package (`.AppImage`) from [Releases](https://github.com/Kag4286/ObserverLauncher/releases/latest).
2. **Create a Server:** Click **Create new server**, select a software distribution (e.g., Paper, Fabric, Vanilla, or native Pumpkin), and choose a Minecraft release.
3. **Launch:** Click **Start**. The launcher automatically configures the appropriate Java runtime (or runs natively for Rust engines), accepts the Minecraft EULA, and initiates the process.
4. **Connect:** Players on your local network connect via your local IP address. For internet play without router configuration, activate the integrated Playit.gg or Pinggy reverse tunnel.

---

## Features

### Server Lifecycle and Multi-Engine Hosting
- **Native Rust Engine Support:** Run clean-room compiled servers including [Pumpkin](https://github.com/Pumpkin-MC/Pumpkin) and [Horizon](https://github.com/horizon-rust/horizon). These binaries execute directly on the operating system without a Java Virtual Machine, maintaining an active working set of approximately 100 MB to 250 MB RAM with sub-second launch times.
- **Automated Java Management:** Evaluates server jar bytecode version requirements and provisions matching OpenJDK builds (Java 8, 17, 21, or 25) on demand.
- **Pre-flight Conflict Scanner:** Inspects installed mod archives for missing dependencies, mismatched mod loader targets (e.g., loading Forge mods under Fabric), and duplicate mod identifiers prior to boot.
- **Multi-Instance Isolation:** Host multiple servers concurrently with isolated working directories, network ports, backup schedules, and configuration states.

<p align="center">
  <img src="docs/screenshot-player-inspector.png" width="48%" alt="Player Inspector 3D Preview">
  &nbsp;
  <img src="docs/screenshot-inventory.png" width="48%" alt="Player Inventory Matrix">
</p>

### Player Administration (Player Inspector 2.0)
- **Interactive 3D Preview:** Visualizes player character models with Mojang skin fetching, secondary clothing layers, and equipped armor sets.
- **Live Online Inspection:** Inspects connected players in real time without requiring offline `.dat` files on disk, ensuring immediate compatibility with native servers and first-time player sessions.
- **Full Inventory Matrix:** Displays player inventories and Ender Chest contents in a standard 9×4 grid. Includes live search, slot sorting, and an editorial item drawer supporting formatted enchantments and section-sign (`§`) color codes.
- **Operational Controls:** Send `/op`, `/deop`, `/whitelist`, `/tp`, `/kick`, and `/ban` commands directly from the toolbar with safety confirmations for destructive actions.
- **Vitals HUD:** Displays 10-segment calibrated health, hunger, and experience gauges with absorption and saturation indicators.

<p align="center">
  <img src="docs/screenshot-worldmap.png" width="48%" alt="World Map Interface">
  &nbsp;
  <img src="docs/screenshot-MCP.png" width="48%" alt="MCP and AI Tools Integration">
</p>

### World Map and Region Cartography
- **Real-Time Terrain Cartography:** Parses Anvil `.mca` region files into an interactive map displaying 4×4 relief elevation, surface blocks, biome boundaries, and water bodies.
- **Native LZ4 Region Decompression:** Built-in decompression for Anvil compression scheme 4 (`LZ4Block`), supporting region files generated by Pumpkin and modern high-concurrency servers.
- **Multi-Version Structure Detection:** Identifies structure bounding boxes across both legacy Minecraft 1.12–1.17 formats (`Level.Structures.Starts`) and modern 1.18–1.21+ formats (`structures.starts`), including trial chambers, ancient cities, villages, and nether fortresses.
- **Low-Resource Mode:** Limits active chunk queries to an 18-chunk radius and skips elevation rendering to minimize CPU and RAM usage on low-spec hardware.
- **Portal Link Calculator:** Calculates coordinate correspondences between Overworld and Nether dimensions with a 16-block safety radius indicator.

### Network and Connectivity
- **No-Port-Forwarding Tunnels:** Built-in integration with Playit.gg and Pinggy generates secure public domain endpoints for players outside your local network.
- **Bedrock Edition Crossplay:** Detects Geyser and Floodgate plugins, validates UDP port alignment, and provides one-click network repairs.
- **LAN Discovery:** Surfaces local IP addresses and broadcast states for local multiplayer.

---

## Supported Server Software

| Engine / Distribution | Runtime | Ecosystem | Telemetry Support |
|---|---|---|---|
| **Pumpkin** | Rust Native | Protocol 777 / 1.26.51 clean-room | Process RAM/CPU, console TPS & MSPT |
| **Horizon** | Rust Native | MC 26.3 clean-room | Process RAM/CPU, native TOML sync |
| **Paper / Purpur / Leaf / Folia** | Java 17–25 | Bukkit, Spigot, Paper plugins | Real-time TPS, MSPT, heap memory |
| **Fabric / Quilt** | Java 8–25 | Fabric mods | Player metrics, process telemetry |
| **Forge / NeoForge** | Java 8–25 | Forge & NeoForge mods | Real-time TPS, mod dependency check |
| **Spigot / CraftBukkit** | Java 8–25 | Bukkit plugins | Heap memory, player list |
| **Vanilla** | Java 8–25 | Official Mojang server | Player list, console stream |
| **Velocity** | Java 17–25 | Multi-server proxy | Proxy routes, connection status |

---

## Developer and Automation Interfaces

### Model Context Protocol (MCP)
ObserverLauncher acts as an MCP server with 78 structured tools. Coding assistants and automation agents can inspect server logs, diagnose crashes, adjust configuration files, and manage content under strict permission tiers.

```json
{
  "mcpServers": {
    "observer-launcher": {
      "command": "node",
      "args": ["src/mcp/bridge.js"]
    }
  }
}
```

### Headless CLI (`observer`)
Manage servers directly from a shell or terminal:

```bash
observer status                      # Check active server state
observer start --instance survival   # Start a specific instance
observer players                     # List online and cached players
observer backup create               # Create an instant world backup
```

### Remote Management REST API
A local HTTP daemon protected by token authentication and CIDR IP allowlisting:
- `GET /api/status`: Process state, active instance metadata, system metrics.
- `GET /api/logs`: Real-time streaming console output.
- `POST /api/command`: Execute validated single-line console commands.

---

## Supported Languages

The user interface is fully localized across 7 languages:

| Language | Code | Native Name |
|---|---|---|
| **English** | `en` | English |
| **Vietnamese** | `vi` | Tiếng Việt |
| **Spanish** | `es` | Español |
| **Portuguese (Brazil)** | `pt-BR` | Português (Brasil) |
| **German** | `de` | Deutsch |
| **Russian** | `ru` | Русский |
| **Simplified Chinese** | `zh-CN` | 简体中文 |

Language selection is available under **Launcher settings &rarr; Personal &rarr; Language**.

---

## System Requirements

- **Operating System:** Windows 10/11 (64-bit) or modern Linux distribution (x86_64, glibc 2.31+).
- **Processor:** 64-bit dual-core processor minimum (quad-core recommended for modded servers).
- **Memory:** 4 GB system RAM minimum (8 GB or more recommended for heavily modded environments).
- **Storage:** ~1 GB available disk space for launcher assets and runtime environments; additional space for world saves and backups.
- **Java:** Optional. The launcher detects existing Java installations and downloads required OpenJDK builds automatically. Native Rust servers (Pumpkin and Horizon) require no Java.

---

## Building from Source

ObserverLauncher is built using Electron and Node.js. Core parsing logic (NBT, Anvil Region data, and ZIP operations) uses clean JavaScript implementations without external native binary dependencies.

```bash
# Clone repository
git clone https://github.com/Kag4286/ObserverLauncher.git
cd ObserverLauncher

# Install dependencies
npm install

# Start in development mode
npm start

# Run unit and integration tests (170 test suites)
npm test

# Build production distributables
npm run build:win      # Windows installer (.exe)
npm run build:linux    # Linux AppImage
```

---

## Privacy and Security Policy

- **No telemetry or data exfiltration:** The application makes network requests solely for software downloads, skin fetching from official APIs, and user-initiated mod browsing.
- **Sandboxed execution:** Electron renderer windows run with `contextIsolation` enabled and direct `nodeIntegration` disabled.
- **Path traversal prevention:** All disk access verifies target boundaries using canonical path checking (`safeTarget`).
- **Network safety:** Reverse tunnels and webhook endpoints enforce SSRF filters blocking loopback, link-local, and private subnets.
- **Mojang EULA compliance:** Proprietary game assets and vanilla textures are never packaged into the installer.

---

## License

ObserverLauncher is licensed under the [Apache-2.0 License](LICENSE).  
Minecraft is a trademark of Mojang Synergies AB. ObserverLauncher is an independent open-source tool and is not affiliated with Mojang or Microsoft.
