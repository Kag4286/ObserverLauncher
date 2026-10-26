# Release Notes

User-facing release notes for each version of ObserverLauncher are published with every release and archived under the `docs/` directory.

- Current Release: [ObserverLauncher 6.1.7](docs/release-6.1.7.md)
- Developer Changelog: [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#617--2026-10-26)

---

## ObserverLauncher 6.1.7 (Latest)

ObserverLauncher 6.1.7 introduces an intelligent JVM optimization engine for Java 21, Java 25, and modded servers, automatic crash diagnosis for Java version mismatches, hardened file extraction on Windows, and polished download indicators.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#617--2026-10-26).

### Highlights

1. **Smart JVM Optimization & Auto Pick:** 1-click automatic recommendation for optimal JVM flags based on your detected Java runtime, memory allocation, and modded status. Adds Shenandoah GC preset and modern Java 25 ZGC tuning.
2. **Plain-language Crash Doctor:** Translates confusing bytecode errors (like `class file version 69.0`) into clear explanations showing required Java 25 vs installed Java, with a direct button to open Java settings.
3. **Hardened Windows Extraction:** Enhances archive unpacking security on Windows to fail-closed on corrupt or unreadable archives, preventing partial extracts.
4. **Reliable Launch Scripts:** Ensures `run.bat` scripts launch cleanly even when the server folder contains spaces or special characters.
5. **Download Progress Polish:** Shows real megabytes and percentages when downloading marketplace plugins and jars.

For full release notes, please see [docs/release-6.1.7.md](docs/release-6.1.7.md).

---

## Previous Releases

- [ObserverLauncher 6.1.5](docs/release-6.1.5.md) — Cross-version Player Inspector (1.8–1.21+), EULA-compliant hybrid texture pipeline, layout fixes, marketplace active server lock, world map caching.
