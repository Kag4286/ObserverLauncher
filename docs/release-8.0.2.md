# ObserverLauncher 8.0.2

Welcome to **ObserverLauncher 8.0.2**!

This release delivers a comprehensive **Modpack Subsystem Overhaul**, **Velocity Proxy & World Cloning UI integration**, **Deep Security Hardening** across archive extraction and network downloads, and **WCAG 2.2 AA Accessibility improvements**.

For technical details and commit references, developers can read the [developer changelog](../CHANGELOG.md).

---

## 📦 Complete Modpack Experience (Modrinth & CurseForge)

- **One-Click Marketplace Modpacks:** Fixed an issue where Modpacks in the Marketplace were misidentified as single mods when opening the install dialog. Both **Modrinth (`.mrpack`)** and **CurseForge (`.zip`)** modpacks now install properly as full packs directly from the Marketplace.
- **Full Modpack Search Filters:** Searching for modpacks on Modrinth now respects your selected **Minecraft version**, **Mod loader**, and **Category** filters.
- **`server-overrides` Support:** Modrinth `.mrpack` archives that include server-specific configuration files in `server-overrides/` are now automatically applied alongside standard `overrides/`.
- **Clean Cancel & Rollback:** Canceling the file-overwrite confirmation prompt during a modpack import now cleanly rolls back all downloaded mod files so your `mods/` folder is never left half-installed.
- **Faster Local `.mrpack` Import:** Local `.mrpack` imports now extract the archive once instead of twice.

---

## 🌐 Velocity Proxy Servers & World Cloning

- **Velocity Backend Server Manager:** When managing a **Velocity proxy**, the **Server Properties** tab now displays a dedicated **Backend servers** panel where you can view, add, and remove backend servers (`lobby`, `survival`, etc.) without editing raw TOML by hand.
- **One-Click World Cloning:** Every world card on the **Worlds & Backups** tab now includes a **Clone** button, letting you duplicate an existing world (along with its Nether and End dimensions) under a new name while the server is stopped.

---

## 🛡️ Security Hardening

- **Redirect SSRF Protection:** All marketplace, modpack, and runtime downloads now validate every HTTP redirect hop to ensure a public link cannot redirect into local or private network addresses.
- **Archive Extraction Safety (Zip-Slip & Symlink Guards):** Modpack and backup extraction on both Windows and Linux now pre-validates every archive entry against path traversal, Windows drive-relative paths (`C:foo`), control characters, and symbolic links before extracting.
- **Offline Player Management:** Adding or removing players on the Whitelist, Ban list, or Operator list by name while the server is stopped now generates deterministic offline UUIDs and matches players case-insensitively.
- **Remote Dashboard Hardening:** Added strict `Content-Security-Policy` headers and closed empty `Host` header requests on the local Remote Dashboard server.

---

## ♿ Accessibility (WCAG 2.2 AA)

- **Screen Reader & Keyboard Support:** Added accessible labels to 24 form controls and action buttons across all tabs, added focus trapping and dialog labeling to the CurseForge manual-download modal, fixed heading order on the Console tab, and enlarged setup checklist chips to meet WCAG 2.2 AA touch/click target sizing.

---

## 🧪 Verification & Quality Gates

- **175 Automated Test Suites:** 100% passing across all 175 unit/regression test suites (including the new 61-assertion `security-and-modpack-audit.test.js` suite) plus Playwright Electron E2E smoke tests.
- **7 Languages:** 100% localization parity across English, Vietnamese, Spanish, Portuguese (Brazil), German, Russian, and Simplified Chinese.

