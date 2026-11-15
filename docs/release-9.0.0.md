# ObserverLauncher 9.0.0 — Architectural Redesign & Fluid Motion 2.0

ObserverLauncher 9.0.0 completely rebuilds the visual identity and motion language of the desktop launcher and remote web dashboard. Everything keeps our familiar dark canvas (`#0C0D0F`) and emerald green brand color (`#22C55E`), while trading heavy boxes and bouncy popups for clean structural hairlines, crisp hierarchy, and fast precision transitions.

## What's New
- **Clean Architectural Workspace (Less Clutter, More Signal):**
  - Removed overlapping bordered card boxes across Overview, Content, Worlds, Backups, Marketplace, and Settings in favor of crisp `1px` dividers, open whitespace, and clear visual alignment.
  - Replaced heavy stat boxes with compact 4-column telemetry strips using aligned tabular numbers (`tabular-nums`) for CPU, RAM, TPS, players, and uptime.
  - Streamlined Launcher Settings into a single readable editorial column with clear topic spacing and sharp controls.
- **Sharp Modals & Streamlined Navigation:**
  - Removed distracting background particle/glow canvases and heavy drop-shadow chrome on panels.
  - Added a fluid gliding active-tab indicator bar inside the `220px` sidebar rail that follows you smoothly across every workspace view.
  - Updated the Player Inspector, World Map dismiss controls, Modrinth/CurseForge marketplace grid, and custom dropdown menus with cohesive contrast tiers and sharp corners (`4px–12px`).
- **Motion 2.0 — Precision Hydraulics (Zero Bounce, GPU-Only):**
  - Replaced elastic bounce curves with fast exponential deceleration so panels, tabs, modals, and accordions settle crisply without stalling or wobbling.
  - Added smooth curtain tab transitions, smooth `0fr -> 1fr` accordion expansion, and subtle focus line traces while respecting both OS **Reduced Motion** and ObserverLauncher's **Lite animation mode**.
- **Synchronized Remote Web Dashboard:**
  - Updated the LAN/Remote dashboard (`remote-ui`) to share the exact same obsidian + emerald Architectural tokens, flat telemetry bar, and crisp mobile layout.
- **Native Rust Engines (`Pumpkin 0.2.2` & `Horizon`):**
  - Updated Pumpkin (`0.2.2`) and Horizon native Rust server support with zero Java required, faster release fetching, and checksum verification.
- **Paginated Content Manager (`25 items / page`):**
  - Large mod, plugin, and datapack folders now paginate cleanly at 25 items per page with Previous/Next controls while keeping search and enable/disable toggles instant.
- **Minecraft `1.21.5–1.21.11` & `26.1–26.3` Support + Player Inspector Improvements:**
  - Full compatibility for Minecraft `1.21.5` through `1.21.11` and `26.1–26.3` saves, datapacks, resource packs, and automatic **Java 25** validation.
  - Improved modded armor and item icon detection in the 3D Player Inspector, plus a clear notice when a mod uses custom 3D armor geometry.
- **Sidebar & Accessibility Polish:**
  - Cleaned up the server Instances sidebar so long names and missing-folder badges stay tidy on one line with hover-revealed action buttons.
