# ObserverLauncher 2.4.0

A performance and telemetry polish release, driven by real use: hosting a NeoForge modpack server.
If the launcher felt heavy while a server was running, or the in-app Performance tab showed nothing useful, this one is for you.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#240--2026-09-26).

---

## The launcher is much lighter now

The app was quietly burning **~17% CPU even when the server was idle** — because it started a fresh PowerShell process **every single second** just to read the server's memory/CPU. That is gone:

- The app now keeps **one** background PowerShell helper and reuses it, instead of spawning a new one every second.
- Reading the server's process tree is cheaper and more reliable.
- When the window is hidden, its timers are throttled.

Result: idle CPU drops dramatically, and you no longer see a pile of "Console Window Host"/"Windows PowerShell" processes next to the app.

## The Performance tab now actually shows your server

If you host a server started by **`run.bat`** (NeoForge / Forge with no `.jar`), the Performance tab used to show **0% CPU and 0 MB** — because it was measuring `cmd.exe` (the script runner) instead of the real Java process. It now tracks the actual JVM, so the CPU and RAM graphs match what the server is really using (your 4 GB, etc.).

## TPS / MSPT show up on NeoForge

NeoForge rejects the old `forge tps` command, so the launcher gave up on TPS and the graphs stayed empty — even with **Spark** installed. Now:

- When the native TPS command is rejected, the launcher automatically uses **`spark tps`** instead.
- If Spark is in your `mods/` or `plugins/`, TPS and MSPT will appear on the Performance tab like on Paper servers.

## What to watch out for

- Nothing to configure — these are automatic. Just make sure Spark is installed if you want TPS on a NeoForge server that doesn't support `forge tps`.
- Everything else (wizard, Java handling, backups, MCP/AI tools) is unchanged from 2.3.0.

---

**Full technical changelog (for developers):** see [`CHANGELOG.md` → `[2.4.0]`](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#240--2026-09-26).
