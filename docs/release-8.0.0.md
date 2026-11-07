# ObserverLauncher 8.0.0

ObserverLauncher 8.0.0 introduces **Player Inspector 2.0** — a comprehensive visual and functional redesign of the player administration suite. Built strictly around ObserverLauncher's core design philosophy ("Soft machinery + living worlds + editorial composition"), this release eliminates card spam in favor of an authentic Spatial Character Stage, a high-legibility telemetry HUD, a unified 9×4 inventory matrix with an editorial item lore drawer, a direct World Map jump bridge, and intention-clustered Live Admin controls.

For developer-level technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#800---2026-11-07).

---

## Player Inspector 2.0: Spatial Character Stage

The centerpiece of Player Inspector 2.0 is the **Spatial Character Stage**, which eliminates the detached, oversized cards of previous versions:

- **Integrated Equipment Brackets**: Minimalist 38×38px slot frames flank the 3D model. The left rail houses vertical armor slots (`Helmet`, `Chestplate`, `Leggings`, `Boots`), while the right rail presents `Mainhand`, `Offhand`, and an Armor Defense rating badge.
- **Ambient Dimension Glow**: The 3D model viewport reacts dynamically to the player's world location, applying an ambient spatial aura reflecting the Overworld, Nether, or The End.
- **Micro-Durability & Hover Telemetry**: Each equipment cell displays an unobtrusive durability bar and instant tooltip metadata without obscuring the canvas.

---

## High-Legibility Telemetry HUD & World Map Bridge

- **10-Segment Precision Meters**: Health and Food are rendered with calibrated 10-segment visual meters, accurately representing in-game HP and hunger levels alongside raw numerical values.
- **Experience Progress Bar**: An in-game styled XP progress bar accompanied by a prominent neon level numeral and total experience points.
- **Tactical Location & World Map Bridge**: Tactical coordinates (X, Y, Z) now feature a one-click **`[↗ Map]`** jump button that transitions directly to the World Map tab and centers the camera on the player's exact real-time coordinates.
- **Active Potion Effects**: Active effects render as a clean horizontal strip with icons, Roman numeral potency amplifiers, and remaining countdown timers.

---

## Unified Inventory Matrix & Editorial Lore Drawer

- **Unified 9×4 Inventory Grid**: Main Inventory (rows 1–3) and Hotbar (row 4) are now integrated into a single cohesive 9-column matrix, reflecting the natural layout players are familiar with.
- **Segmented Ender Chest Switch**: Seamlessly switch between the player's regular inventory and their 27-slot Ender Chest using a sleek segmented controller.
- **Editorial Lore Drawer**: Clicking or focusing any item slot opens an editorial inspection drawer that renders custom item names, formatted enchantment stacks, lore text with full Minecraft section-sign (`§`) color code support, and NBT tags.
- **Instant Search & Sort**: Real-time filtering by item name and sorting by slot, name, or stack count across both inventories.

---

## Intention-Clustered Live Admin & Offline NBT Editor

- **Grouped Command Tiles**: Live server commands are organized into focused intention clusters:
  - *Player Recovery*: One-click Heal, Feed, and Extinguish.
  - *Gamemode Switch*: Instant segmented switch between Survival, Creative, Adventure, and Spectator.
  - *Experience Management*: Quick level adjust buttons (`+1`, `+5`, `+30`, Clear) and custom level assignment.
  - *Item Dispenser*: Interactive item grant dialog with count stepper.
  - *Teleportation*: Quick teleport to World Spawn, Custom Coordinates, or another Player.
- **Safety Isolation Zone**: Destructive operations (Kick, Ban, Clear Inventory) are visually separated in an isolated safety zone with double-confirmation dialogs.
- **Validated Offline NBT Editor**: Clean, structured editor for `.dat` files with input range validation and automated backup safety nets.

---

## Multi-Language & Quality Assurance

- **100% Locale Coverage**: All new Player Inspector 2.0 strings are synchronized across all 7 supported interface languages: English (`en`), Tiếng Việt (`vi`), Español (`es`), Português do Brasil (`pt-BR`), Deutsch (`de`), Русский (`ru`), and 简体中文 (`zh-CN`).
- **Zero External Dependencies**: All vector icons, HUD meters, and layout bridges are implemented with pure HTML5, vanilla CSS, and standard Electron IPC.
- **Comprehensive Quality Gates**: 100% test pass rate across all 167 automated test suites.

