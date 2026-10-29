# Release Notes

User-facing release notes for each version of ObserverLauncher are published with every release and archived under the `docs/` directory.

- Current Release: [ObserverLauncher 6.1.7](docs/release-6.1.7.md)
- Developer Changelog: [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#617--2026-10-29)

---

## ObserverLauncher 6.1.7 (Latest)

ObserverLauncher 6.1.7 delivers a major visual overhaul across **Settings** and the **Content Library**, robust **SSRF defense-in-depth** for downloads and webhooks, automatic **Spigot & Bukkit** loader recognition, a **smart JVM optimization engine** for Java 21/25 and modded workloads, plain-language **Java mismatch crash diagnosis**, and flicker-free interface animations.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#617--2026-10-29).

### Highlights

1. **Redesigned Settings Interface (Anti-Card-Slop):** Replaces scattered individual cards across all 6 Settings panels with cohesive topic surfaces, 2-column setting rows, and clean hairline dividers.
2. **Modernized Content Library:** Clean, compact layout with real-time search, category item counts (`Plugins`, `Mods`, `Datapacks`), accurate mod loader badges (`Forge`, `Fabric`, `NeoForge`), and responsive version chips.
3. **Flicker-Free Interface Motion:** Scoped animations to tab navigation only, preventing background data polling and live updates from triggering unwanted fade-in effects.
4. **SSRF Defense-in-Depth:** Blocks IPv6 loopback variants, link-local, unique local private LAN, IPv4-mapped loopback/private, and multicast addresses across webhooks and download handlers.
5. **Spigot & Bukkit Auto-Detection:** Automatically identifies freshly downloaded Spigot and Bukkit server jars as loader `paper` before first run, ensuring plugin compatibility checks work out of the box.
6. **Smart JVM Optimization & Auto Pick:** 1-click automatic recommendation for optimal JVM flags based on your detected Java runtime, memory allocation, and modded loader status. Adds Shenandoah GC preset and modern Java 25 ZGC tuning.
7. **Plain-Language Crash Doctor:** Translates confusing bytecode errors (like `class file version 69.0`) into clear explanations showing required Java 25 vs installed Java, with a direct button to open Java settings.
8. **Hardened Windows Extraction & Space-Safe Paths:** Enhances archive unpacking security to fail-closed on corrupt archives and ensures `run.bat` launch scripts run reliably in folders with spaces.

For full release notes, please see [docs/release-6.1.7.md](docs/release-6.1.7.md).

---

## Previous Releases

- [ObserverLauncher 6.1.5](docs/release-6.1.5.md) — Cross-version Player Inspector (1.8–1.21+), EULA-compliant hybrid texture pipeline, layout fixes, marketplace active server lock, world map caching.
- [ObserverLauncher 6.1.0](docs/release-6.1.0.md) — Pre-flight mod conflict scanner, duplicate modId detector, missing dependency resolver, and unified conflict reporting.
- [ObserverLauncher 6.0.0](docs/release-6.0.0.md) — Multi-instance architecture, Prometheus metrics, Discord webhooks, Pinggy Bedrock tunneling, and server.properties history.
