# ObserverLauncher 8.1.1 — Process Hygiene & Ultra-Low RAM

ObserverLauncher 8.1.1 eliminates lingering background PowerShell memory usage, tightens process/timer cleanup on stop and exit, and reduces idle Electron RAM consumption.

## What's Improved
- **No More Lingering PowerShell Process (~45–50 MB RAM saved):**
  - The Windows metrics helper (`ps-host`) now automatically shuts down after **15 seconds of inactivity**, and shuts down **immediately** when all Minecraft servers are stopped (`Stop` or `Force Stop`) or after startup orphan checks finish. If you start a server again, it respawns seamlessly.
- **Cleaner Shutdown & Force Stop:**
  - `Force Stop` now cancels any pending graceful-shutdown escalation timer immediately and releases all stdout/stderr listeners cleanly on exit.
  - Exiting the app (`before-quit`) now explicitly sweeps timers and file watchers across **every** instance, not just the active tab.
- **Lower Electron & Idle RAM Footprint:**
  - Applied Chromium memory-saving flags (`renderer-process-limit=1`, bounded V8 heap `--max-old-space-size=256`, `disable-gpu-program-cache`), trimmed transient image/biome caches when minimizing the window, deferred idle memory probes, and capped rendered console DOM nodes at 600 lines.
- **Isolated World Map Worker (Automatic Memory Reclamation):**
  - Heavy World Map region scanning and NBT/LZ4 decompression now run inside a separate background Worker Thread that automatically terminates after 20 seconds of inactivity (or immediately when leaving/minimizing the map), keeping the main launcher responsive and preventing map RAM spikes from lingering.
- **Zero-Buffer Streaming Downloads:**
  - Server JAR, Modpack, and Java downloads now stream directly to disk in bounded 64 KB chunks with proper backpressure instead of buffering large files in RAM.
