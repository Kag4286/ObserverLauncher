# ObserverLauncher 9.1.0 — Server Doctor, Version Upgrades & Smarter Automation

ObserverLauncher 9.1.0 is a major quality-of-life and reliability update that brings powerful server-administration tools straight into the desktop app—no AI client or command line required—while fixing background shutdown and metrics bugs for reconnected and native Rust servers.

## What's New
- **Guided Minecraft Version Upgrade Assistant:**
  - Open **Upgrade version** on Overview to check Java requirements and scan every installed plugin or mod against your target Minecraft version before touching a single file.
  - Automatically backs up your world first, archives your old server JAR safely (restoring it if anything goes wrong), downloads the new build with SHA-256 verification, updates compatible plugins/mods, and can temporarily disable incompatible ones so your first boot stays crash-free.
- **Interactive Server Doctor (Right in the App):**
  - Click **Server Doctor** on Overview anytime to scan for port conflicts, memory leaks or high RAM usage, crash loops, and missing mod dependencies.
  - Every suggested repair explains what it will change and asks for your confirmation before running.
- **Smarter Daily Schedules & In-Game Countdown Warnings:**
  - Set a daily **Restart** time alongside Start and Stop, with automatic in-game countdown notices (`5m`, `1m`, `30s`, `10s`) so players never get kicked mid-fight—and an option to skip the countdown immediately when nobody is online.
  - Add custom daily rules to trigger scheduled world backups or run console commands (such as `say` announcements or `save-all`) at exact times of day, with crash-safe tracking so restarting the launcher won't run a rule twice.
- **Cross-Instance World Cloning:**
  - Clicking **Clone** on any world now lets you copy it either inside the same server or straight into another registered server instance in your sidebar.
- **1-Click Missing Dependency Installer & Custom Template Management:**
  - When the Content tab flags a missing mod/plugin dependency, click **Install** right on the warning row to resolve and install it with confirmation.
  - Delete user-saved custom templates directly inside the Create Server Wizard, and install a template's recommended plugins/mods in one click right after server creation.

## Fixes & Improvements
- **Reliable Scheduled Stops & Backups on Reconnected Servers:** Scheduled stops now properly reach reconnected servers over RCON and automatically force-terminate stalled shutdowns instead of hanging forever; world backups also flush chunks (`save-off` / `save-all` / `save-on`) reliably over RCON.
- **Accurate Metrics & Startup Checks for Pumpkin Servers:** Native Rust Pumpkin servers now report real process RAM/CPU metrics cleanly and skip Java startup checks even before the binary is placed.
- **Complete Feature Documentation:** Updated `README.md` to document every desktop, CLI, MCP, security, analytics, and template capability shipped across recent releases.
