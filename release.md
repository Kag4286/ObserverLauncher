# ObserverLauncher 7.0.2

ObserverLauncher 7.0.2 is a major capability, engine expansion, and rendering performance release. It introduces full native support for **Pumpkin** (high-concurrency Minecraft server written in Rust), authentic procedural 3D block and item rendering for modded inventories, seamless LZ4 chunk loading on the interactive **World Map**, clean engine-specific UX in the **Content** tab, and the elimination of background re-render loops in the **Player Inspector**.

For developer-level technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#702---2026-11-05).

---

## Native Rust Server Engine: Pumpkin Integration

- **Native Server Architecture:** Full support for [Pumpkin](https://github.com/Pumpkin-MC/Pumpkin), the blazingly fast Minecraft server written in Rust. Runs as a standalone compiled binary directly on your OS with zero Java or JVM heap requirement.
- **Dedicated Setup Wizard:** New server creation wizard includes Pumpkin under the Native & Proxy filters, featuring an ultra-lightweight dynamic working set (~100 MB) view instead of rigid JVM heap allocation.
- **Two-Way Configuration Synchronization:** Seamless two-way synchronizer between the launcher's Server Properties UI and `Pumpkin.toml`, with full coverage of standard Minecraft properties, sane defaults, and zero missing fields.
- **High-Speed Binary Resolution:** Automatic multi-platform binary downloading (`pumpkin-X64-Windows.exe`, `pumpkin-X64-Linux`, `pumpkin-ARM64-macOS`) with mirrored fallback URLs to prevent download stalls or rate limits.

---

## Interactive World Map: Pumpkin LZ4 Chunk Cartography

- **Anvil LZ4 Decompression:** Implemented built-in decoding for Minecraft Anvil compression algorithm 4 (`LZ4Block`), completely resolving the infinite `loading biomes…` hang and `PartialReadError` on Pumpkin region files.
- **Full 3D Terrain & Biome Rendering:** Over 8,500+ explored Pumpkin chunks now render with full 4x4 relief heights, water bodies, real biome boundaries, and authentic surface blocks (ice, grass, stone, sand).
- **Empty-World Guidance HUD:** When a world is newly created and no chunks have been generated on disk yet, the map cleanly displays a radar grid, spawn marker, and informative HUD card explaining that Pumpkin generates chunks as players explore.

---

## Content Tab: Clean Native Engine UX

- **Native Plugin Management:** Content library automatically adapts when inspecting native engines (Pumpkin and Horizon). Inappropriate prompts to install Java `.jar` plugins (EssentialsX, LuckPerms, Vault) are replaced with clear native instructions and a one-click `[Open plugins folder ↗]` action button.
- **Subtab & Tool Pruning:** The `Mods` subtab and `Modpack tools` (.mrpack) are automatically hidden for native servers, preventing confusion since Java mod loaders (Forge/Fabric/NeoForge) do not apply to native Rust binaries.
- **Complete Internationalization:** Fully translated notices and empty states across all 7 supported languages (`en`, `vi`, `es`, `pt-BR`, `de`, `ru`, `zh-CN`).

---

## 3D Player Inspector & Procedural Inventory Rendering

- **Render Cascade Elimination:** Fixed a re-render loop where lightweight vanilla inventory items (< 2048 bytes) triggered continuous background re-downloads and IPC events. Icons arrival is now batched with a 120ms debounce.
- **Procedural 3D Canvas Renders:** Missing mod icons for complex items (waystones, backpacks, chipped anvils, TNT) are procedurally rendered in authentic 3D isometric perspective using directional shading and block paletting.
- **Fallback Texture Reliability:** Clean fallback icons ensure items always render clearly even when texture packs or mod jar assets are unavailable.

---

## Subsystem & Platform Improvements

- **Step 1 Wizard Navigation:** Folder selection immediately enables the Next button, and subfolder fields are clearly marked as optional.
- **Headless Quality Gates:** 100% test pass across 165 test suites, 0 duplicate CSS/JS blocks, strict headless execution, and 0 missing i18n keys across all 7 locales.
