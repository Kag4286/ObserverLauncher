# ObserverLauncher 6.1.6

ObserverLauncher 6.1.6 delivers smarter mod and modpack compatibility checks, full support for Minecraft releases in 2026 (including version 26.1 and Java 25), significantly faster and lighter AI assistant integration (MCP), safer file management on Windows, and duplicate mod detection to prevent server startup crashes.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#616--2026-10-26).

## Smarter mod and modpack compatibility

Previously, checking mods could trigger false warnings when mod filenames retained older version tags even though they run smoothly on newer game versions. ObserverLauncher now inspects the real configuration inside each mod file:

- **No more false warning alerts:** Mods built for minor companion updates run seamlessly without incompatibility warnings. For example, Forge and Fabric mods built for 1.16.4 run on 1.16.5, 1.20 runs on 1.20.1, 1.21 runs on 1.21.1, and 1.21.2 runs on 1.21.3.
- **Inspects internal mod files:** Reads actual requirements directly from mod metadata (`mods.toml`, `fabric.mod.json`, and legacy `mcmod.info`) rather than guessing from the `.jar` filename.
- **Duplicate mod detection:** Automatically alerts you if two different copies of the same mod exist in your mods folder before you launch the server, preventing common startup crashes.
- **Accurate version matching:** Treats versions like `1.21` and `1.21.0` as identical, preventing accidental rejections due to formatting differences.

## Ready for Minecraft in 2026 (Version 26.1+)

Mojang transitioned Minecraft updates to a year-based release system starting in 2026. ObserverLauncher is fully prepared for this new format:

- **2026 release support:** Full compatibility with new 2026 updates (such as `26.1` and its companion patch `26.1.1`).
- **Java 25 auto-detection:** Automatically configures and verifies the required Java 25 runtime for 2026 servers, while preserving Java 21 for 1.20.5 and 1.21.x servers.
- **Updated player data and datapacks:** Correctly recognizes the modern player data and stats folders used in newer Minecraft versions.
- **Modern NeoForge compatibility:** Properly detects and organizes modern NeoForge builds without confusion.

## Faster AI assistants and lower data usage (MCP)

If you use the built-in Model Context Protocol (MCP) to manage your server through AI assistants like Claude Desktop or Cursor:

- **Up to 99% less data usage:** Marketplace version lookups now deliver clean, focused summaries instead of sending massive lists of hundreds of old builds. This avoids context limits and saves substantial token usage.
- **Faster response times:** Server diagnostic tools and performance graphs transfer compact, relevant data so your AI client responds in seconds.

## Safer file management and routine upgrades

- **Windows running file protection:** If you try to delete a mod or plugin while your server is actively running, ObserverLauncher now protects your files and gives a helpful reminder to stop the server first, avoiding locked file errors.
- **Flexible server scheduling:** The automated server scheduler now easily recognizes both numbers and standard weekday names (Monday through Sunday) for automated starts and stops.
- **Multi-server isolation:** When running multiple servers, settings and AI diagnostic tools remain cleanly separated for each server instance.
