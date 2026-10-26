# ObserverLauncher 6.1.7

ObserverLauncher 6.1.7 introduces a smart JVM optimization engine tailored for Java 21, Java 25, and heavily modded servers, automatic crash diagnosis for Java version mismatches, hardened file extraction on Windows, and polished download indicators.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#617--2026-10-26).

## Smart JVM Optimization and 1-Click Auto Pick

Fine-tuning Java flags usually requires searching community forums and pasting confusing command-line flags. ObserverLauncher now configures this automatically:

- **1-Click Auto Pick:** In Settings > Advanced JVM arguments, click "Auto pick" to automatically apply the best flags for your setup. It checks your installed Java version, memory allocation, and whether your server runs mods to select the right preset.
- **Shenandoah low-pause preset:** Added a dedicated Shenandoah GC preset designed for medium to large modded servers (Forge, Fabric, NeoForge). It keeps server tick times steady without noticeable garbage collection stutters.
- **Java 25 and modern ZGC optimization:** The ZGC preset now automatically adapts to your runtime. On Java 25 (used by Minecraft 26.x), obsolete experimental flags are dropped cleanly to ensure smooth server startup without warning prompts.

## Plain-language Crash Doctor for Java Mismatches

When running modern Minecraft releases (such as 26.x or 1.21.x) with an older Java version, the server previously halted with confusing technical messages like `UnsupportedClassVersionError: class file version 69.0`.

- **Friendly error explanations:** ObserverLauncher translates bytecode numbers into everyday language. For instance, `class file version 69.0` is clearly explained as "Requires Java 25 (detected Java 21). Minecraft 26.x requires Java 25."
- **Direct fix button:** The crash alert panel now displays an "Open Settings > Java" button so you can switch or install the correct Java version immediately.

## Windows Security and Launch Reliability

- **Safe file extraction:** Hardened archive extraction on Windows to verify all contents before unpacking, preventing corrupted archives from extracting partial or unsafe files.
- **Spaces in server paths:** Startup scripts (`run.bat`) now launch reliably even when placed inside folders that contain spaces or special characters in their name.
- **Marketplace download feedback:** Downloading individual plugins or server jars now displays clean progress feedback with actual megabytes and percentages.
