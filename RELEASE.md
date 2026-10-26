# Release Notes

User-facing release notes for each version of ObserverLauncher are published with every release and archived under the `docs/` directory.

- Current Release: [ObserverLauncher 6.1.6](docs/release-6.1.6.md)
- Developer Changelog: [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#616--2026-10-26)

---

## ObserverLauncher 6.1.6 (Latest)

ObserverLauncher 6.1.6 brings smarter mod compatibility checks, full support for Minecraft's 2026 release cycle (including version 26.1 and Java 25), faster and more token-efficient AI assistant integration (MCP), Windows file protection, and duplicate mod prevention.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#616--2026-10-26).

### Highlights

1. **Smarter Mod Compatibility:** No more false incompatibility warnings for companion updates (such as 1.16.4/1.16.5, 1.20/1.20.1, 1.21/1.21.1, and 1.21.2/1.21.3). The launcher reads internal mod files directly and catches duplicate mods before startup.
2. **Ready for Minecraft in 2026:** Full support for 2026 releases (such as `26.1`), modern NeoForge builds, and automatic detection for the required Java 25 runtime.
3. **Faster AI Assistants (MCP):** Streamlined mod version queries reduce data usage by up to 99%, keeping your AI chats fast and responsive without exceeding token limits.
4. **Safer File Deletion on Windows:** Prevents locked file errors when deleting mods on a running server by providing clear guidance to stop the server first.
5. **Flexible Scheduling:** Server schedules now smoothly accept both day numbers and weekday names (Monday through Sunday).

For full release notes, please see [docs/release-6.1.6.md](docs/release-6.1.6.md).

---

## Previous Releases

- [ObserverLauncher 6.1.5](docs/release-6.1.5.md) — Cross-version Player Inspector (1.8–1.21+), EULA-compliant hybrid texture pipeline, layout fixes, marketplace active server lock, world map caching.
