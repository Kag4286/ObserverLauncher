# ObserverLauncher 8.0.0

ObserverLauncher 8.0.0 is a major milestone release combining **Player Inspector 2.0** — a comprehensive visual and functional redesign of the player administration suite — with native support for the high-concurrency **Pumpkin** Minecraft server written in Rust, interactive LZ4 chunk cartography on the **World Map**, authentic procedural 3D block and item rendering, and extensive performance and telemetry enhancements.

For developer-level technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#800---2026-11-07).

---

## Player Inspector 2.0: Spatial Character Stage

Built strictly around ObserverLauncher's core design philosophy ("Soft machinery + living worlds + editorial composition"), Player Inspector 2.0 eliminates card spam in favor of an authentic Spatial Character Stage:

- **Integrated Equipment Brackets:** Sleek 38×38px slot frames flank the 3D player canvas. The left rail houses vertical armor slots (`Helmet`, `Chestplate`, `Leggings`, `Boots`), while the right rail presents `Mainhand`, `Offhand`, and a dynamically computed Armor Defense rating badge.
- **Ambient Dimension Glow:** The 3D model viewport reacts dynamically to the player's world location, applying an ambient spatial aura reflecting the Overworld, Nether, or The End.
- **Micro-Durability & Rich Tooltip Telemetry:** Each equipment slot features an unobtrusive durability bar and instant tooltip metadata with glowing enchantments, durability ratings, and monospace item identifiers without obscuring the canvas.
- **Harmonized Typography & Layout:** Telemetry cards feature an unified typographic hierarchy using `--font-ui` and `--font-mono`, presenting clear stat readouts without visual clutter.

---

## High-Legibility Telemetry HUD & World Map Bridge

- **10-Segment Precision Meters:** Health and Food are rendered with calibrated 10-segment visual meters, accurately representing in-game HP (with absorption highlights) and hunger levels (with saturation indicators) alongside raw numerical values.
- **Experience Progress Bar:** An in-game styled XP progress bar accompanied by a prominent neon level numeral and total experience points.
- **Tactical Location & World Map Bridge:** Tactical coordinates (X, Y, Z) now feature a one-click **`[↗ Map]`** jump button that transitions directly to the World Map tab and centers the camera on the player's exact real-time coordinates.
- **Active Potion Effects:** Active effects render as a clean horizontal pill strip with icons, Roman numeral potency amplifiers, and remaining countdown timers.

---

## Unified Inventory Matrix & Editorial Lore Drawer

- **Unified 9×4 Inventory Grid:** Main Inventory (rows 1–3) and Hotbar (row 4) are integrated into a single cohesive 9-column matrix, reflecting the natural layout players are familiar with.
- **Segmented Ender Chest Switch:** Seamlessly switch between the player's regular 36-slot inventory and their 27-slot Ender Chest using a sleek segmented controller.
- **Expanded Item Slots:** Enlarged 54px inventory cells with 40px crisp pixelated icons make viewing items effortless.
- **Editorial Lore Drawer:** Clicking or focusing any item slot opens an editorial inspection drawer that renders custom item names, formatted enchantment stacks, lore text with full Minecraft section-sign (`§`) color code support, and NBT tags.
- **Instant Search & Sort:** Real-time filtering by item name and sorting by slot, name, or stack count across both inventories.

---

## Intention-Clustered Live Admin & Offline NBT Editor

- **Grouped Command Tiles:** Live server commands are organized into focused intention clusters:
  - *Player Recovery:* One-click Heal, Feed, and Extinguish.
  - *Gamemode Switch:* Instant segmented switch between Survival, Creative, Adventure, and Spectator.
  - *Experience Management:* Quick level adjust buttons (`+1`, `+5`, `+30`, Clear) and custom level assignment.
  - *Item Dispenser:* Interactive item grant dialog with count stepper.
  - *Teleportation:* Quick teleport to World Spawn, Custom Coordinates, or another Player.
- **Safety Isolation Zone:** Destructive operations (Kick, Ban, Clear Inventory) are visually separated in an isolated safety zone with double-confirmation dialogs.
- **Validated Offline NBT Editor:** Clean, structured editor for `.dat` files with input range validation and automated backup safety nets.

---

## Native Rust Engine: Pumpkin Server Integration

ObserverLauncher expands its native engine support by integrating [Pumpkin](https://github.com/Pumpkin-MC/Pumpkin) alongside Horizon as a first-class native server software:

- **Zero Java / JVM Required:** Pumpkin is compiled directly to native machine code (`pumpkin-X64-Windows.exe`, `pumpkin-X64-Linux`, `pumpkin-ARM64-macOS`). It requires no Java installation, no JVM tuning, and no garbage collection pauses.
- **Ultra-Low Memory Footprint (~100 MB):** Starts instantly and operates within an astonishingly compact ~100 MB working set. The wizard memory step dynamically explains Pumpkin's dynamic memory allocation without misleading presets.
- **Resilient Multi-Source Downloads:** Features automatic fallback mirror routing (`ghfast.top`) and release tag reconciliation, ensuring lightning-fast and stall-free binary downloads worldwide.
- **Two-Way `Pumpkin.toml` Synchronization:** Settings edited in the launcher (port, max players, online-mode, MOTD, difficulty, gamemode, hardcore, pvp, allow-nether, whitelist, spawn protection, view distance, simulation distance, seed, compression, resource pack) automatically sync to `Pumpkin.toml` and `server.properties` with zero missing fields or save errors.
- **Dedicated Native Settings & Content UI:** Launcher Settings and Content views dynamically reflect Pumpkin identity and runtime instructions without Horizon branding leaks or static i18n clobbering, displaying accurate executable badges and native notice banners.
- **Native Plugin Management:** Content library automatically adapts when inspecting native engines (Pumpkin and Horizon). Inappropriate prompts to install Java `.jar` plugins are replaced with clear native instructions and a one-click `[Open plugins folder ↗]` action button.

---

## Interactive World Map: Pumpkin LZ4 Chunk Cartography

- **Anvil LZ4 Decompression:** Implemented built-in decoding for Minecraft Anvil compression algorithm 4 (`LZ4Block` used by `lz4-java` and Pumpkin), completely resolving the infinite `loading biomes…` hang and `PartialReadError` on Pumpkin region files.
- **Full 3D Terrain & Biome Rendering:** Explored Pumpkin chunks render with full 4x4 relief heights, water bodies, real biome boundaries, and authentic surface blocks.
- **Empty-World Guidance HUD:** When a world is newly created and zero `.mca` chunks exist on disk yet, the confusing jagged noise bands and misleading prompts are replaced with a sleek radar grid, spawn marker, and informative HUD card explaining that Pumpkin generates chunks as players explore.

---

## Authentic 3D Block & Mod Item Rendering

- **Multi-Face 3D TNT Rendering:** TNT renders with authentic multi-face geometry: the iconic red dynamite bundle with central fuse on top, and shaded `TNT` labeled sticks on the sides, completely replacing flat 2D sprites.
- **Procedural 3D Waystones:** Waystones from the Waystones mod render as 32x32 isometric stone pillars with centered glowing purple warp crystals.
- **Tiered Mod Backpacks:** Backpacks from Sophisticated Backpacks render with authentic leather textures and tier-colored metallic buckles (Leather, Copper, Iron, Gold, Diamond, Netherite).
- **Offline-First 0ms Response:** Built-in procedural rendering operates completely offline without network latency, rendering instantly on the very first frame.
- **Loop Stabilization & Performance:** Eliminated infinite re-render cascades on vanilla items (< 2 KB) with a 120ms debounce window and accurate alpha-corner pre-render inspection.

---

## Multi-Language & Quality Assurance

- **100% Locale Coverage:** All new Player Inspector 2.0, Pumpkin, and native configuration strings are translated across all 7 supported interface languages: English (`en`), Tiếng Việt (`vi`), Español (`es`), Português do Brasil (`pt-BR`), Deutsch (`de`), Русский (`ru`), and 简体中文 (`zh-CN`).
- **Live Online Player Inspection:** Online players can be inspected and managed in real-time even when offline `.dat` files have not been saved to disk yet (Pumpkin, Horizon, or newly joined players).
- **Online Filter Stability:** User filter selections in the roster are strictly respected and no longer overridden by automatic fallbacks when zero players are online.
- **Robust Log Parsing:** Universal regex pattern captures player join and leave events across both colon-delimited (`[INFO]:`) and modern simple-log formats (`[INFO]`) used by native engines.
- **World Map Layout Refinement:** Player cards reposition health indicators to row 2, providing maximum horizontal width for player names. Structure detection automatically resolves icons across 1.12–1.21+ Anvil formats.
- **Zero External Runtime Dependencies:** All vector icons, HUD meters, 3D math, and layout bridges are implemented with pure HTML5, vanilla CSS, and standard Electron IPC.
- **Comprehensive Quality Gates:** 100% pass rate across automated test suites, strictly complying with headless integrity, duplicate code guards, and i18n key consistency.
