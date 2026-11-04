# ObserverLauncher 7.0.1

ObserverLauncher 7.0.1 is a comprehensive maintenance, security hardening, and reliability release. It brings full custom mod armor rendering and visibility toggles to the **3D Player Inspector**, polymorphic multi-engine diagnostics for the **Horizon Dedicated Server**, hardened security boundaries and new workflows for the **MCP (Model Context Protocol)** AI integration, multi-instance network tunnel isolation, and key platform bug fixes.

For developer-level technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#701---2026-11-02).

---

## 3D Player Inspector: Custom Mod Armor & Clean Previews

- **Modded Armor Texture Rendering:** Players wearing armor from popular Minecraft mods (such as Ice and Fire, Botania, or custom modpacks) now have their armor textures loaded and rendered directly from active mod files onto the 3D player model.
- **Symmetric Armor UV Mirroring:** Left arm, left leggings, and left boot textures now mirror horizontal U coordinates and map outer faces correctly, eliminating transparent outer shoulders that revealed underlying skin.
- **Stat Float Precision Formatting:** Health and Saturation values from NBT data are now rounded to at most 1 decimal place, preventing awkward text wrapping and overlapping numbers in the inspector header.
- **Armor Decoupling & Independent Layers:** Each armor slot (helmet, chestplate, leggings, boots) loads and binds its respective texture layer independently, correctly supporting mixed sets and custom 64x64 or 64x32 UV layouts.
- **Alex / Slim Model Alignment:** Adjusted arm positions for slim skin models by 0.5 units, completely eliminating visual mesh clipping between player sleeves and 3D armor geometry.
- **3D Armor Visibility Toggle:** Added a dedicated toggle button (`#pd3dToggleArmor`) allowing users to easily hide or show 3D armor on the player preview. Outer skin layers are cleanly managed to avoid Z-fighting artifacts.

---

## Horizon Native Engine: Polymorphic Diagnostics & Docker Export

- **Engine Polymorphic Health Checks:** The built-in Doctor subsystem and MCP diagnostic tools now recognize native server engines (such as Horizon). Java-specific requirements (JRE runtime, Java version matching, JVM heap flags, Mojang EULA file) are automatically bypassed on native servers.
- **Rust Panic Detection:** Crash analyzers now recognize native engine termination signatures, stack traces, and Rust panics, offering helpful guidance pointing to server logs.
- **Slim Docker Container Export:** When exporting a Docker setup for Horizon, the launcher generates a lightweight container configuration based on `node:20-bookworm-slim` without any heavy Java runtime packages.

---

## MCP (Model Context Protocol) AI Integration: Hardened Security & New Workflows

- **Path Traversal Elimination:** Enhanced file deletion validation (`delete_content`) to prevent directory traversal escapes out of mod and plugin directories.
- **Fast-Path Security Gates:** Parameter validation in destructive tools now executes immediately before user confirmation prompts, rejecting traversal attempts in under 1 second without stalling for 60-second GUI confirmation timeouts.
- **Virtual Resources & Crash Report Aliases:** Direct file reads (`read_file`) seamlessly resolve virtual resources like `server/status` and `crash-reports/latest`. Crash report tools automatically resolve `latest`, `latest.txt`, and `newest` aliases to the newest report file on disk without requiring filesystem symlinks.
- **Human-Readable Instance Targeting:** Instance selection and snapshot queries (`get_instance_snapshot`) now support matching by instance display name (such as "Servertest") and unambiguous ID prefixes, allowing AI agents to target servers easily without copying raw hex IDs.
- **Credential Protection & Content Preservation:** Direct file reads (`read_file`, `read_many_files`, and file resource templates) automatically mask sensitive configuration keys (`rcon.password`, Velocity forwarding secrets) with `[redacted]`. Fixed bridge payload unwrap so masked file contents are fully preserved and transmitted to connected AI clients.
- **Tool-Based Prompt Discovery:** Added `list_prompts` and `get_prompt` tools along with offline fallbacks so AI agents using tool-only interfaces can discover and trigger ready-made diagnostic workflows directly.
- **Privilege Escalation Defense:** Removed internal write-approval toggles from MCP-settable launcher settings, guaranteeing that an AI agent cannot self-grant write permissions without GUI user confirmation.
- **Subscription Rate-Limit Stability:** Resolved an issue where background resource subscriptions could consume request quotas and trigger HTTP 429 rate limits, ensuring smooth polling and real-time updates.
- **New Workflow Prompts:**
  - `recover_corrupted_world`: Diagnoses crash reports or log files for corrupted region files or ticking entities, creates an immediate backup, and guides safe recovery.
  - `update_minecraft_version`: Verifies Java runtime requirements and mod/plugin compatibility before assisting with Minecraft version upgrades.
  - `setup_geyser_bedrock`: Guides setup and configuration for GeyserMC and Floodgate, allowing Minecraft Bedrock players on mobile and console to join Java servers.
- **Expanded Resource Templates:** Added direct resource templates for reading per-instance properties (`observer://instance/{id}/properties`), player lists (`observer://instance/{id}/players`), and the latest crash report (`observer://crash-reports/latest`).

---

## Subsystem & Platform Improvements

- **Cross-Platform Path Traversal Hardening:** File operations treat both forward slash `/` and backslash `\` as path separators across Windows and Linux, preventing traversal escapes and ensuring 100% CI pass rates on Ubuntu.
- **World Map Dimension Switcher:** Fixed dimension selector button handlers to properly toggle views without throwing JavaScript console errors.
- **Player Inspector Reliability:** Added support for alternative player NBT stats on modded and Horizon servers to eliminate `undefined` stat labels. Expanded item texture resolution with inverted names, subfolder scanning, and common tag namespaces.
- **Multi-Instance Tunnel Isolation:** Manual Playit tunnel addresses are now isolated strictly per server instance in configuration rather than shared globally across instances, and Pinggy tunnel status updates immediately upon switching instances.
- **Pinggy Error Messaging:** Added dedicated status message banner for Pinggy tunnels to surface actionable error descriptions when SSH port forwarding fails.
- **Accurate Blocks Mined Stats:** Updated player analytics to count all mined blocks across individual block categories, resolving an issue where mined totals were underreported on certain server builds.
- **Player Leave Webhook Notifications:** Added Discord-compatible webhook notifications whenever a player leaves the server.
- **World Map Coordinate Switching:** Added 1:8 coordinate conversion when switching between Overworld and Nether views on the interactive world map, with centered navigation for The End.
- **CLI Startup Ordering:** Fixed CLI flag parsing so flags like `--fg` and `--foreground` function properly regardless of argument order.
- **Headless Resource Cleanup:** Gracefully shuts down active network tunnels and Prometheus metrics listeners when stopping headless server instances.
