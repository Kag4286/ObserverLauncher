# ObserverLauncher 8.0.1

ObserverLauncher 8.0.1 is a security hardening, supply-chain verification, and performance optimization patch following the major 8.0.0 release.

For developer-level technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#801---2026-11-11).

---

## 🔒 Verified Java Downloads (Adoptium SHA-256)

When ObserverLauncher automatically installs a Java runtime:
- **Checksum Verification:** The launcher fetches Adoptium's official `/v3/assets/latest/{major}/hotspot` release metadata and validates the SHA-256 checksum of the downloaded archive before extracting or configuring `java.exe`.
- **Integrity Guarantee:** Any corrupted or mismatched download is immediately rejected and cleaned up from temporary storage.

---

## ⚡ Faster Modpack Verification

- **Targeted File Matching:** When verifying user-dropped files for CurseForge modpacks, `verifyBlockedFiles()` now checks candidates by exact filename first instead of computing SHA-1 hashes across all unrelated JARs in `mods/`.
- **Reduced Disk I/O:** Scanning large modpacks with 300–500 mods now completes in seconds instead of saturating disk I/O.

---

## 🛡️ Network & Server Safety Guards

- **Remote API Exposure Confirmation:** Enabling the Remote Dashboard on an off-loopback address (`0.0.0.0`) with an empty IP allowlist now presents an explicit confirmation dialog before saving, preventing accidental public exposure.
- **World Name Sanitization:** `sanitizeWorldName()` now strictly rejects Windows-reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) and trailing dots.
- **Ephemeral Tunnel Tokens:** The Pinggy helper script generates a random per-process dummy token and registers an exit handler to unlink the helper file automatically.
- **Skin Mirror Signature Check:** Fallback skin fetching verifies the 8-byte PNG magic header (`89 50 4E 47 0D 0A 1A 0A`) before caching or serving `steve.png`.

---

## 🤖 MCP & Automation Parity

- **80 Server-Management Tools:** Automated test parity locks all 80 tools between `src/mcp/tools.js` and `STATIC_TOOLS` in `src/mcp/bridge.js`.
- **Metadata Rate Limiting:** MCP discovery endpoints (`/tools`, `/prompts`, `/resources`, `/resource-templates`) are now protected by a 120 req/min rate limiter.
- **Bounded Configuration:** Bridge config parsing strictly limits file size (`<= 4096 bytes`), port numbers, and token length.

---

## 📦 Quality Gates & Test Suites

- **174 Automated Test Suites Passing:** All 174 test suites pass with 100% success rate, including 4 new automated suites (`adoptium-hash.test.js`, `mcp-bridge-tools-sync.test.js`, `world-name-sanitize.test.js`, `curseforge-blocked-perf.test.js`).
- **Full E2E Pass:** Playwright Electron smoke test suite passes.

