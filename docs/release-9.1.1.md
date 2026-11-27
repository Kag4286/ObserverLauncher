# ObserverLauncher 9.1.1 — Horizon & Pumpkin Upstream Maintenance Release

ObserverLauncher 9.1.1 updates native Rust engine support to stay aligned with recent upstream changes in both **Pumpkin** and **Horizon Dedicated Server**.

## What's Improved
- **Pumpkin WebAssembly (`.wasm`) Plugin Compatibility:**
  - The Content scanner no longer flags Pumpkin's native `.wasm` plugins inside `plugins/` as corrupted JAR archives.
  - Saving server settings with Online Mode enabled now automatically keeps packet encryption enabled in `pumpkin.toml`, preventing startup errors in newer Pumpkin builds (`0.2.2+` / `master`).
  - Improved RAM budget and force-stop process tracking consistency for Pumpkin servers.
- **Clearer Horizon Upstream Handling:**
  - Because `github.com/horizon-rust/horizon` is currently unavailable (`404`) for fresh downloads, creating a new Horizon server now displays a clear explanation instead of a generic error—while existing local Horizon servers continue to launch and run normally when imported via **Add existing folder**.
