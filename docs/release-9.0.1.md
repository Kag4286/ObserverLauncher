# ObserverLauncher 9.0.1 — Accurate Mod & Datapack Checks, Smarter Marketplace & 3D Armor Polish

ObserverLauncher 9.0.1 is a quality-of-life and accuracy update focused on fixing false compatibility warnings, tightening Marketplace version recommendations, making Java settings save cleanly, and clarifying 3D modded armor previews.

## What's Improved
- **Fewer False Mod Warnings (`Wrong loader` & `Missing dependency`):**
  - Universal / multi-loader mod `.jar` files (mods built for Fabric, Forge, and NeoForge in a single download) now match your server's active loader automatically instead of reporting fake loader mismatches.
  - Library and datapack-wrapped mods with quirks in their internal metadata (such as multiline descriptions like BlueLib) are now read reliably, preventing false missing-dependency warnings for mods that are already installed.
  - Disabled `.disabled` mods no longer trigger misleading dependency errors, and shared dependency search handles common aliases cleanly.
- **Accurate Datapack Format Checking:**
  - Updated the built-in Minecraft datapack format table across versions `1.13` through `26.3` (fixing checks for `1.18–1.21.1` servers, including format `48` for `1.21–1.21.1` and `15`/`26`/`41` for `1.20.x`).
  - Added full support for modern `min_format`/`max_format` ranges and all `supported_formats` styles inside `pack.mcmeta`.
- **Smarter Marketplace & Version Picker:**
  - Automatically detects and locks Marketplace filters to your active server's Minecraft version and loader (including Fabric, Quilt, and Paper servers with renamed jars).
  - Fixed Modrinth modpack search so full modpack catalogs show up cleanly instead of only a few entries.
  - The Install modal now puts compatible builds first, adds quick search and stable-only filters, and **never tags incompatible versions (like `26.1` builds on a `1.21.1` server) as `Recommended`**.
- **Consistent Java Settings Flow:**
  - The **Installed runtimes** dropdown now stays in sync with **Executable path** (showing `Auto-detect from PATH` or custom paths accurately instead of appearing locked onto an unrelated runtime like Java 8).
  - Changing the dropdown previews Java compatibility live and waits for you to click **Apply settings**, instead of applying silently without saving.
- **Better 3D Modded Armor Preview & Clearer Notices:**
  - Expanded 3D Player Inspector support for modded armor folder layouts (`/armour/`, nested armor folders, and `1.21.2+` equipment assets) plus additional item naming conventions (`_helm`, `_visor`, `_hauberk`, `_chausses`, `_sabatons`, and more).
  - Added a scope caption under the 3D view and clear slot-by-slot notices whenever equipped gear uses a custom 3D model, non-standard texture layout, or wearable items like elytra that cannot be previewed on the humanoid rig.
- **Smarter AI Assistant (MCP):**
  - Added curated modpack stacking guidance, client-only safety filtering, automatic required dependency expansion during planning, and post-install compatibility checks.
