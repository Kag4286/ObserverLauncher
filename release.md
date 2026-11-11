# ObserverLauncher 8.0.1

Welcome to **ObserverLauncher 8.0.1**!

This maintenance and security update focuses on verified Java downloads, faster modpack verification, network safety guards, and tool parity across the entire app.

For technical details and commit references, developers can read the [developer changelog](CHANGELOG.md).

---

## 🔒 Verified Java Downloads (Adoptium SHA-256)

When ObserverLauncher automatically downloads Java runtimes for your servers:
- **Hash Verification:** The launcher queries Adoptium's official release metadata and checks the SHA-256 checksum of the downloaded archive before extracting or running `java.exe`.
- **Integrity Guarantee:** Any corrupted or incomplete download is rejected immediately, keeping your machine safe from broken or tampered binaries.

---

## ⚡ Faster Modpack Verification

- **Smart File Matching:** When checking user-dropped files for CurseForge modpacks, the launcher now looks up exact filename matches first instead of scanning and hashing every unrelated file in your `mods/` directory.
- **Huge I/O Savings:** Large modpacks (with 300–500 mods) now verify missing or blocked files in seconds rather than locking disk activity for minutes.

---

## 🛡️ Network & Server Safety Guards

- **Remote API Exposure Prompt:** If you enable the Remote Dashboard on an off-loopback address (`0.0.0.0`) with an empty IP allowlist, ObserverLauncher now displays an explicit confirmation dialog before applying settings, ensuring you don't expose your server to public networks by accident.
- **World Name Sanitization:** Creating or renaming worlds now guards against Windows-reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`) and trailing dots that could cause operating system errors.
- **Ephemeral Tunnel Tokens:** The Pinggy tunnel helper now uses a random per-session token and automatically cleans up its temporary launch script when exiting.
- **Skin Mirror Verification:** The fallback player skin fetcher validates the official 8-byte PNG file signature, preventing network errors or captive portal HTML pages from being saved as skins.

---

## 🤖 MCP & Automation Parity

- **80 Server-Management Tools:** All 80 server tools are now verified by automated tests to ensure exact synchronization between live tools and the offline bridge fallback.
- **Metadata Route Protection:** The local MCP server now rate-limits discovery routes (`/tools`, `/prompts`, `/resources`) to prevent excessive CPU consumption from tight client polling loops.
- **Bridge File Size Bounds:** The bridge configuration reader now enforces strict file size and token length limits.

---

## 📦 Test Suite & Quality Gates

- **174 Automated Test Suites:** 100% passing rate across all 174 test suites, with 4 new dedicated test suites added for Adoptium verification, tool synchronization, world name sanitization, and modpack lookup performance.
- **Clean Architecture:** Zero duplicate CSS/JS code blocks and 100% string parity across all 7 supported languages.
