# ObserverLauncher 6.1.7

ObserverLauncher 6.1.7 delivers a major visual and user experience overhaul across the **Settings** and **Content** tabs, robust **SSRF defense-in-depth** across all network endpoints, automatic **Spigot & Bukkit** loader recognition, a **smart JVM optimization engine** for Java 21/25 and modded workloads, plain-language **Java mismatch crash diagnosis**, and flicker-free interface animations.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#617--2026-10-29).

---

## Redesigned Settings Experience (Anti-Card-Slop)

Previous versions of the Settings interface spread every small toggle and option across individual isolated cards, leading to visual clutter and excessive vertical scrolling.

ObserverLauncher 6.1.7 completely reworks all 6 Settings panels (Setup, Personal, Automation, Integrations, AI, Advanced):

- **Cohesive Topic Surfaces:** Related features and configurations are now grouped into clean, unified surfaces with clear topic headers and descriptions.
- **Two-Column Setting Rows:** Every option uses a standardized two-column layout with clean label and description on the left, and right-aligned controls (toggles, inputs, dropdowns, action buttons).
- **Hairline Dividers:** Subtle visual separators keep sub-features distinct without adding card borders.
- **Full Localization:** Preserves 100% of all existing settings keys with zero dead keys across English, Vietnamese, Spanish, Portuguese, German, Russian, and Chinese.

---

## Modernized Content Library

Managing installed plugins, mods, and datapacks is faster, clearer, and more compact:

- **Unified Header & Search:** Integrated real-time search directly alongside category counters (`Plugins (x)`, `Mods (y)`, `Datapacks (z)`) and primary actions.
- **Accurate Mod Loader Badges:** Mods now clearly display their detected loader (`Forge`, `Fabric`, `NeoForge`) parsed authoritatively from their internal descriptors.
- **Responsive Version Badges:** Version pill widths and overflow have been refined so version strings and file names render cleanly without cut-off digits or badge overlapping.
- **Streamlined Item Rows:** Clean status indicators, quick configuration file opening, and 1-click enable/disable and deletion.

---

## Zero-Flicker Interface Motion

- **Scoped Animations:** Entrance animations are now strictly scoped to initial tab transitions. Background data sync, live resource polling, and auto-refresh cycles no longer re-trigger fade-in animations or cause UI elements to flicker.
- **DOM Signature Verification:** Background UI sync checks content signatures before updating DOM trees, eliminating redundant re-renders.

---

## Security Hardening: SSRF Defense-in-Depth

ObserverLauncher validates all remote download and webhook endpoints before making any outgoing connection:

- **IPv6 SSRF Mitigation:** Hardened URL validation against IPv6 bypass techniques, blocking unspecified IPv6 (`[::]`), loopback variants (`[0:0:0:0:0:0:0:1]`), IPv4-mapped IPv6 loopbacks (`[::ffff:127.0.0.1]`), link-local (`fe80::/10`), unique local private LAN (`fc00::/7`), and multicast addresses.
- **IPv4 Protection:** Blocks loopback, private ranges (10.x, 192.168.x, 172.16-31.x), link-local cloud metadata (169.254.x), CGNAT, and multicast/reserved ranges.
- **Protected Features:** Secures Discord webhooks, Marketplace downloads, .mrpack modpack resolution, and MCP tool invocations.

---

## Server Compatibility & Robustness

- **Spigot & Bukkit Auto-Detection:** Server jars named `spigot-*.jar`, `bukkit-*.jar`, or `craftbukkit-*.jar` are now instantly identified as loader `paper` (the Bukkit/Spigot plugin family) even before first launch, ensuring plugin compatibility checks and conflict detection work from the moment you place the jar.
- **Safe Datapack Extraction:** Strengthened archive unpacking to reject edge-case filenames that could evaluate to empty paths.

---

## Smart JVM Optimization & 1-Click Auto Pick

Fine-tuning Java flags usually requires searching community forums and pasting confusing command-line flags. ObserverLauncher now configures this automatically:

- **1-Click Auto Pick:** In Settings > Advanced JVM arguments, click "Auto pick" to automatically apply the best flags for your setup. It checks your installed Java version, memory allocation, and whether your server runs mods to select the right preset.
- **Shenandoah low-pause preset:** Added a dedicated Shenandoah GC preset designed for medium to large modded servers (Forge, Fabric, NeoForge). It keeps server tick times steady without noticeable garbage collection stutters.
- **Java 25 and modern ZGC optimization:** The ZGC preset now automatically adapts to your runtime. On Java 25 (used by Minecraft 26.x), obsolete experimental flags are dropped cleanly to ensure smooth server startup without warning prompts.

---

## Plain-language Crash Doctor for Java Mismatches

When running modern Minecraft releases (such as 26.x or 1.21.x) with an older Java version, the server previously halted with confusing technical messages like `UnsupportedClassVersionError: class file version 69.0`.

- **Friendly error explanations:** ObserverLauncher translates bytecode numbers into everyday language. For instance, `class file version 69.0` is clearly explained as "Requires Java 25 (detected Java 21). Minecraft 26.x requires Java 25."
- **Direct fix button:** The crash alert panel now displays an "Open Settings > Java" button so you can switch or install the correct Java version immediately.

---

## Windows Reliability & Process Launching

- **Safe file extraction:** Hardened archive extraction on Windows to verify all contents before unpacking, preventing corrupted archives from extracting partial or unsafe files.
- **Spaces in server paths:** Startup scripts (`run.bat`) now launch reliably even when placed inside folders that contain spaces or special characters in their name.
- **Marketplace download feedback:** Downloading individual plugins or server jars now displays clean progress feedback with actual megabytes and percentages.
