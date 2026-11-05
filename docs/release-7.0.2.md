# ObserverLauncher 7.0.2

ObserverLauncher 7.0.2 introduces native support for the high-concurrency **Pumpkin** Minecraft server written in Rust, resolves infinite rendering loops in the **Player Inspector**, and adds authentic procedural 3D block and item rendering for both vanilla blocks and popular mod items.

For developer-level technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#702---2026-11-05).

---

## Native Rust Engine: Pumpkin Server Integration

ObserverLauncher expands its native engine support by integrating [Pumpkin](https://github.com/Pumpkin-MC/Pumpkin) alongside Horizon as a first-class native server software:

- **Zero Java / JVM Required:** Pumpkin is compiled directly to native machine code (`pumpkin-X64-Windows.exe`, `pumpkin-X64-Linux`, `pumpkin-ARM64-macOS`). It requires no Java installation, no JVM tuning, and no garbage collection pauses.
- **Ultra-Low Memory Footprint:** Starts instantly and operates within an astonishingly compact ~100 MB working set.
- **Two-Way `Pumpkin.toml` Synchronization:** Settings edited in the launcher (port, max players, online-mode, MOTD, difficulty, view distance, simulation distance, seed, hardcore) automatically sync to `Pumpkin.toml` and vice versa.
- **1-Click Wizard Setup:** Create a Pumpkin server with one click under **Create new server** > **Featured** / **Native & Proxy**.
- **Complete Headless & Process Management:** Background process monitoring, CPU/RAM telemetry, graceful stop, and orphan process adoption seamlessly support native Pumpkin processes.

---

## Player Inspector: Loop Stabilization & Performance

- **Eliminated Infinite Re-render Cascade:** Fixed a critical issue where vanilla items under 2 KB (arrows, sticks, bones, seeds) repeatedly re-triggered background downloads and IPC notifications on cache hits, causing the Player Inspector and 3D preview to flicker or enter an infinite loading state.
- **Debounced Icon Refresh:** Added a 120 ms debounce window to `onIconsUpdate` so arriving icons are batched smoothly into a single render pass.
- **Accurate Pre-Render Inspection:** Fixed client-side pre-render detection to verify transparent background corners rather than assuming all images larger than 32px are pre-rendered 3D blocks. This guarantees that flat CDN textures are properly converted into clean isometric 3D cubes.

---

## Authentic 3D Block & Mod Item Rendering

- **Multi-Face 3D TNT Rendering:** TNT now renders with authentic multi-face geometry: the iconic red dynamite bundle with central fuse on top, and shaded `TNT` labeled sticks on the sides, completely replacing flat 2D sprites.
- **Procedural 3D Waystones:** Waystones from the Waystones mod render as 32x32 isometric stone pillars with centered glowing purple warp crystals.
- **Tiered Mod Backpacks:** Backpacks from Sophisticated Backpacks render with authentic leather textures and tier-colored metallic buckles (Leather, Copper, Iron, Gold, Diamond, Netherite).
- **Offline-First 0ms Response:** Built-in procedural rendering operates completely offline without network latency, rendering instantly on the very first frame.

---

## Multi-Language & Quality Assurance

- **100% Locale Coverage:** All new Pumpkin and native configuration strings are translated across all 7 supported interface languages: English (`en`), Tiếng Việt (`vi`), Español (`es`), Português do Brasil (`pt-BR`), Deutsch (`de`), Русский (`ru`), and 简体中文 (`zh-CN`).
- **Comprehensive Quality Gates:** 100% pass rate across 165 test suites, strictly complying with headless integrity, duplicate code guards, and i18n key consistency.
