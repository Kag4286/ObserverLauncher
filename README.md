# ObserverLauncher

Run a Minecraft server on your own computer, without the terminal.

ObserverLauncher is a desktop app for Windows and Linux. It handles the boring parts of hosting: downloading the server, installing Java, editing configs, opening the firewall, backing up your world. You pick a folder, choose a server type, press Start.

> **Status: Experimental.** This project is under active development and is **not yet stable**. Things may change, break, or not work as expected. Use at your own risk. Bug reports and suggestions are welcome.

## Why not just do it manually?

Hosting a Minecraft server usually means following a long tutorial:

1. Download a server jar from a website
2. Create a `run.bat` file
3. Edit JVM arguments by hand
4. Open `server.properties` in Notepad and guess what each option means
5. Download plugins one by one, check versions, copy files into folders
6. Open ports on your router and firewall
7. Watch a console scroll for 10 minutes to see if it worked

ObserverLauncher does all of that in one window. What used to take an afternoon now takes about three minutes.

## What it does

### Server setup

- Downloads Vanilla, Paper, Purpur, Leaf, Fabric, Forge, NeoForge, Folia, or Spigot from official sources
- Loads version lists live from each project's API
- Checks that your Java version matches the server's requirement before starting
- Can install Java for you (no admin rights needed)
- Compiles Spigot from source via BuildTools if you pick that option

### Live monitoring

- Real-time TPS, MSPT, CPU, and RAM graphs
- Plain-language explanations for each metric (hover the ?)
- Works for Paper/Purpur/Forge; shows player count on Vanilla/Fabric

### Player management

- See who is online, whitelisted, banned, or OP
- Whitelist / ban / OP players even while the server is stopped
- Open a player's inventory, armor, and ender chest with real item icons

### Plugin & mod marketplace

- Search Modrinth, Hangar, and SpigotMC in one box
- Shows compatibility before you install (game version, loader, server-side support)
- Explicit version picker with per-file download progress
- Imports and exports standard Modrinth `.mrpack` files

### Config editor

- Edit `server.properties`, `spigot.yml`, `whitelist.json`, plugin configs
- Syntax highlighting for YAML, JSON, TOML, properties, JS
- JSON validation + auto-format
- Detects conflicts when the file changes on disk

### Backups

- Manual or scheduled ZIP snapshots of world folders
- Uses `save-off` / `save-all` / `save-on` so worlds never get archived mid-write
- Restore from the launcher

### Auto-update

- Checks GitHub Releases on launch
- Shows a notification when a new version exists
- One-click install (Windows via NSIS installer, Linux via AppImage)

## Download

| Platform | File | Link |
|----------|------|------|
| Windows 10/11 (64-bit) | `ObserverLauncher-0.1.0-setup.exe` | [Releases](https://github.com/Kag4286/ObserverLauncher/releases/latest) |
| Linux (AppImage) | `ObserverLauncher-0.1.0.AppImage` | [Releases](https://github.com/Kag4286/ObserverLauncher/releases/latest) |

Requirements: Windows 10+ or a modern Linux distro. No admin rights needed. Java is auto-detected or installed by the launcher.

## Quick Start

1. Download the installer for your platform.
2. Run it.
3. Pick a folder where the server files will live.
4. Choose your server type and version.
5. Press **Start**.

The launcher downloads the server, configures it, opens the firewall (if needed), and shows you the address to share with friends.

## Run from Source

If you prefer to run from source:

```bash
npm install
npm start
```

Requires Node.js 18+.

## Supported server software

| Software | How it's obtained |
|---|---|
| Vanilla | Official Mojang version manifest |
| Paper / Folia / Velocity | Official PaperMC Fill API |
| Purpur | Official Purpur API |
| Leaf | Official Leaf API |
| Fabric | Official Fabric meta API |
| Forge / NeoForge | Official installer (runs automatically) |
| Spigot / CraftBukkit | Compiled via BuildTools (requires Git) |

## Supported languages

English, Tiếng Việt, Español, Português (BR), Deutsch, Русский, 简体中文

The interface is fully translated for all 7 languages. Missing translations fall back to English.

## Project Structure

```
ObserverLauncher/
├── src/
│   ├── main.js          # Electron main process
│   ├── preload.js       # Safe IPC bridge
│   ├── main/            # Backend modules (settings, java, server-files, etc.)
│   │   ├── adapters/    # Server software download resolvers
│   │   └── platform/    # Windows/Linux process management
│   └── renderer/        # UI (HTML + JS + CSS + translations)
├── tests/               # Unit tests
├── site/                # Marketing website (GitHub Pages)
└── package.json
```

## Development

Run tests:

```bash
npm test
```

Build for Windows:

```bash
npm run build:win
```

Build for Linux:

```bash
npm run build:linux
```

Build both:

```bash
npm run build:all
```

Releases are automated via GitHub Actions when you push a `v*` tag.

## Troubleshooting

**Java not detected**

Install Java from the launcher (Settings > Java runtime > Install Java automatically), or set the path manually.

**TPS/MSPT show "—"**

Only Paper/Purpur/Forge servers have a built-in TPS/MSPT command. Vanilla and Fabric don't expose it. Install Spark if you need deep profiling.

**Auto-update not working**

Make sure you're using the NSIS installer (Windows) or AppImage (Linux), not a portable `.exe` or `.deb`. Also ensure the release is published, not a draft.

**Spigot build fails**

Spigot needs Git installed on the system. Install Git and try again.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## AI Contributions

This project is developed with the assistance of AI tools (such as DeepSeek) for code generation, debugging, and documentation. AI contributions are used to accelerate development and improve code quality. All AI-generated code is reviewed and tested by humans before merging.

## Website

Marketing site and live demo are at [kag4286.github.io/ObserverLauncher](https://kag4286.github.io/ObserverLauncher/).

## License

[MIT](LICENSE)

## Disclaimer

ObserverLauncher is an unofficial tool, not affiliated with Mojang or Microsoft. Running a Minecraft server requires accepting the Minecraft EULA.
