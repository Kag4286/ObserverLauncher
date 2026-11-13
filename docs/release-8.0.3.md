# ObserverLauncher 8.0.3

Welcome to **ObserverLauncher 8.0.3**!

This release focuses on **Security Hardening**, **Protocol & Archive Resilience**, **Velocity Proxy Configuration Clarity**, and **Full WCAG 2.2 AA Accessibility Coverage** across both the desktop app and the Remote Web Dashboard.

For technical details and commit references, developers can read the [developer changelog](../CHANGELOG.md).

---

## 🛡️ Security & Resilience Hardening

- **Webhook Redirect SSRF Protection:** Outgoing Discord and generic webhooks now validate every HTTP redirect hop (`3xx`) against the public-host safety rules, blocking redirects to local loopback, LAN, or cloud metadata addresses.
- **Protected Backup & Git Directories in Text Editor:** Opening or saving files inside protected folders (`observerlauncher-backups/`, `.git/`, `libraries/`, `logs/`, `cache/`, `versions/`) or hidden dotfiles is now blocked consistently across both file listing and direct open/save paths.
- **RCON Stream Protection:** Added a strict 2 MB incoming packet buffer cap to the built-in Source RCON client so malformed or flooded streams cannot exhaust memory.
- **Horizon Zip Archive Safety:** Horizon native runtime `.zip` installers now pre-validate every archive entry for path traversal (`zip-slip`) before any file is written, matching `.tar.gz` behavior.

---

## 🌐 Velocity Proxy Configuration Polish

- **Clear Section Separation:** Added a dedicated localized heading (**Configuration file (`velocity.toml`)**) above the raw TOML editor to clearly separate the Backend Servers manager from advanced direct TOML editing, consistent with the launcher's design guidelines across all 7 languages.

---

## ♿ Complete Accessibility (WCAG 2.2 AA)

- **Zero Unlabeled Inputs:** Added accessible screen-reader labels (`aria-label`) to all 14 remaining form inputs across Overview, Content, File Browser, Marketplace, World Map, Settings, and the New Server Wizard.
- **Accessible Modal Dialogs:** Added standard `role="dialog"`, `aria-modal="true"`, and `aria-labelledby` attributes to the Onboarding and New Server Wizard modals.
- **Remote Web Dashboard:** Added accessible labels for the language selector, instance switcher, console command field, and token prompt, plus dialog semantics for the sign-in overlay.

---

## 🧪 Verification & Quality Gates

- **176 Automated Test Suites:** All 176 unit/regression test suites pass (including the new 50-assertion `v803-audit.test.js` suite) alongside zero-duplication (`no-dup.test.js`) checks.
- **7 Languages:** Full translation parity across English, Vietnamese, Spanish, Portuguese (Brazil), German, Russian, and Simplified Chinese.

