# ObserverLauncher 4.1.0

4.1.0 is a small **clean-up release**. Nothing in the interface changes, and your servers and settings
stay exactly as they are — this release just removes leftover text that was no longer used anywhere in
the app, and adds an automatic check so unused text cannot pile up again.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#410--2026-10-07).

---

## What changed

- **A new Restart button.** While your server is running, the top bar now shows **Restart** — one
  click stops the server cleanly and starts it again, instead of you having to hit Stop and wait.
  (Force stop is still there while the server is starting or stopping, for when a normal stop hangs.)

- **The status is now accurate.** Previously the launcher could say **Running** a few seconds after
  start, even though a big modpack was still loading. Now it waits until the server has actually
  finished loading (it goes quiet) before saying Running, so you always know when it is truly ready.

- **Tidied up unused interface text.** Over the last few redesigns, some labels and helper lines were
  replaced but their old translations were left behind — about 50 strings across all seven languages
  that no screen showed anymore. They are now removed. **You will not see any difference**: every label
  you actually see is still there, in your language.

- **Added a check so this stays clean.** The project's automated tests now flag any interface text that
  is not used anywhere, so dead strings cannot quietly build up again in a future release.

- **Nicer listing in Linux app stores** *(Linux only)*. The AppImage now includes standard app
  metadata, so catalogs like AppImageHub, GNOME Software and KDE Discover show a proper description
  and real screenshots of the app instead of a placeholder. Windows users are unaffected.

## What is NOT in this release

- No new features and no visual changes. The interface, all tabs, the Player Inspector and the New
  Server wizard are exactly as they were in 4.0.0.
- No settings migration — nothing about your setup is touched.

## Upgrading

Just install 4.1.0 over your current version. Your servers, settings and worlds are not touched. If you
use the AI/MCP features, no client changes are needed.
