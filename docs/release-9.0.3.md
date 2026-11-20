# ObserverLauncher 9.0.3 — Security Hardening Release

ObserverLauncher 9.0.3 is a focused security and reliability update resulting from a full codebase audit. There are no breaking changes to your servers, worlds, or settings—just stronger protection behind the scenes when importing modpacks, connecting AI tools, viewing skins, and sharing packs with friends.

## What's Improved
- **Safer Modpack Imports & Exports:**
  - Automatically blocks unexpected executable or script files (such as `.bat`, `.sh`, `.ps1`, `.exe`, or `.dll`) when importing `.mrpack` or CurseForge modpacks, while keeping normal mods, configs, datapacks, and KubeJS scripts working as usual.
  - Automatically strips sensitive server settings—including your RCON password, RCON port, server IP, and API tokens—when exporting a `.mrpack` so you never accidentally share private credentials with friends.
- **Stronger Network & Download Protection:**
  - Downloads, redirects, skin fetches, and webhooks now verify that target addresses resolve to public servers (protecting your local network and router from crafted links or DNS tricks), while fixing a rare bug where valid public domains starting with `ff` could be blocked.
- **Hardened Player Skin & File Handling:**
  - Skin downloads from Mojang and SkinsRestorer now enforce strict file-path checks, a 512 KB image cap, and valid PNG verification.
  - Clicking "Open" on a file in the launcher now opens text configs and images normally, while safely revealing scripts or executables in your file explorer instead of running them accidentally.
- **Hardened Local AI (MCP) & Desktop App Guards:**
  - Added failed-token lockout, stricter local-only verification, and request timeouts to the local MCP server, along with stricter safety checks on AI-supplied JVM flags, file edits, file searches (now redacting secrets), and kick commands.
  - Tightened Electron window navigation and browser permission guards, improved POSIX `0600` file permissions for saved settings, and fixed cross-instance world cloning checks.
