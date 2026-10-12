# ObserverLauncher 5.4.0

The Performance tab now keeps a full day of history, and that history is still there after you close and reopen the app.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#540--2026-10-12).

---

## A 24 hour chart range

The Performance tab had range buttons for the last 15 minutes, 1 hour and 6 hours. There is now a 24h button beside them, so you can look at a whole day of server activity on one chart.

## Your history survives a restart

Before this release, the performance history only lived in memory. Close the app and it was gone, and the next launch started the charts from empty.

Now the launcher saves the samples to a small file on disk as it collects them. When you open the app again, the charts load that history back. A 24h chart that you looked at yesterday will be filled in today, not blank.

The saving is done in small batches about once a minute, so it does not slow the app down or wear out your disk. If you remove a server instance, its saved history is deleted with it.

## Upgrading

Install 5.4.0 over your current version. No settings change, no migration. Your servers, worlds and settings are untouched.
