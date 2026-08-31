# ObserverLauncher

**Host a Minecraft server without the headache.**

ObserverLauncher is a desktop app that turns hosting a Minecraft server into a point-and-click experience. No terminal commands, no manually editing config files, no juggling downloads. Just pick your server type, configure it, and press Start.

> **Platforms:** Windows & Linux (no macOS support)
> **Status:** Active development

## Why ObserverLauncher?

Hosting a Minecraft server usually means:
- Downloading a server jar from a website
- Creating a `run.bat` file and editing JVM arguments
- Opening `server.properties` in Notepad and guessing what each option does
- Searching the web for how to install plugins
- Watching a console window scroll while you wait for the server to start
- Figuring out why players can't connect

ObserverLauncher does all of that for you. Here's what you get:

- **One-click setup** — download Vanilla, Paper, Purpur, Fabric, Forge, and more from official sources
- **Live monitoring** — watch TPS, CPU, and RAM in real time, with plain-language explanations
- **Player management** — whitelist, ban, OP, and inspect player inventories without closing the app
- **Plugin marketplace** — search and install plugins from Modrinth, Hangar, and SpigotMC in a few clicks
- **Built-in file editor** — edit server configs with syntax highlighting and JSON validation
- **World backups** — create ZIP backups of your worlds on a schedule, safely
- **Auto-update** — the launcher checks for and installs new versions automatically

## Quick Start

1. **Install Node.js** (only needed if you're running from source):
   ```bash
   # Install dependencies
   npm install

   # Run the launcher
   npm start
   ```

2. **Or download a prebuilt binary** from the [Releases page](https://github.com/Kag4286/ObserverLauncher/releases):
   - Windows: `ObserverLauncher-0.1.0-setup.exe` (installer)
   - Linux: `ObserverLauncher-0.1.0.AppImage`

3. **Pick a server folder** and choose your server type. That's it.

## Features in Detail

### Server Setup

Choose from a wide range of server software:
- **Vanilla** — pure Minecraft, no plugins
- **Paper / Purpur / Leaf / Folia** — high-performance forks with plugin support
- **Fabric** — lightweight mod loader
- **Forge / NeoForge** — classic modding platform
- **Spigot / CraftBukkit** — compile from source with BuildTools
- **Velocity** — proxy server that connects multiple servers behind one IP

The wizard loads live version lists from each official API and verifies that your Java version matches what the server needs.

### Live Monitoring

See what's happening on your server at a glance:
- **TPS** — ticks per second (20.0 is perfect)
- **MSPT** — milliseconds per tick
- **CPU & RAM** — resource usage of the Java process
- **Player count** — who's online

Every metric has a "?" tooltip explaining what it means and what's normal.

### Player Management

Manage players without using console commands:
- View online/offline/whitelisted/banned/OP lists
- Whitelist, ban, or OP a player — even while the server is stopped
- Inspect a player's inventory, armor, and Ender Chest
- View real item icons (fetched from the PrismarineJS assets mirror)

### Plugin & Mod Marketplace

Find and install plugins without leaving the launcher:
- Search **Modrinth**, **Hangar**, and **SpigotMC**
- Filter by game version, loader, and sort by downloads
- Install with one click — progress bar shows download status
- Compatibility warnings if a plugin doesn't match your server

### Built-in File Editor

Edit configuration files right in the launcher:
- Syntax highlighting for YAML, JSON, properties, TOML, and JS
- JSON validation and auto-formatting
- Unsaved-change warnings and conflict detection
- Open any text file in your server folder

### World Backups

Never lose your world:
- Create manual ZIP backups with one click
- Schedule automatic backups (every 15m, 30m, 1h, or custom)
- Backups are safe — the server is saved before zipping

### Auto-Update

Stay on the latest version automatically:
- The launcher checks for updates on GitHub Releases
- When a new version is available, you'll get a notification
- Download and install updates with one click
- Windows: NSIS installer · Linux: AppImage

### 7 Languages

Interface available in:
- English
- Tiếng Việt
- Español
- Português (BR)
- Deutsch
- Русский
- 简体中文

## Requirements

- **Node.js 18+** (for running from source)
- **Java** (auto-detected, or install with one click from the launcher)
- **Git** (only needed for Spigot BuildTools)

## Development

If you want to contribute or build from source:

```bash
# Install dependencies
npm install

# Run in development mode
npm start

# Run tests
npm test

# Build for Windows
npm run build:win

# Build for Linux
npm run build:linux
```

## Project Structure

```
ObserverLauncher/
├── src/
│   ├── main.js          # Electron main process
│   ├── preload.js       # Bridge between main and renderer
│   ├── main/            # Backend logic (settings, java, server-files, etc.)
│   │   ├── adapters/    # Server software download resolvers
│   │   └── platform/    # Windows/Linux platform-specific code
│   └── renderer/        # UI (HTML, CSS, JS, translations)
├── tests/               # Unit tests
├── site/                # Landing page (deploys to GitHub Pages)
├── package.json
└── README.md
```

## Troubleshooting

**Java not detected?**
Install Java from the launcher (Settings → Java runtime → Install Java automatically), or set the path manually.

**TPS/MSPT showing "—"?**
Only Paper-like and Forge/NeoForge servers support TPS/MSPT. Vanilla and Fabric don't have a built-in command for it.

**Auto-update not working?**
Make sure you're using the NSIS installer (Windows) or AppImage (Linux), not a portable `.exe` or `.deb`.

**Spigot build fails?**
Spigot compiles from source and requires Git installed.

## Website

Check out the [landing page](https://kag4286.github.io/ObserverLauncher/) for a visual demo and download links.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)
