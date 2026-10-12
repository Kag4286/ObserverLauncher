# ObserverLauncher 5.4.0

The Performance tab now keeps a full day of history, and that history is still there after you close and reopen the app. Adding a server is one clear choice instead of two buttons, and the launcher warns you when a server folder goes missing.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#540--2026-10-12).

---

## A 24 hour chart range

The Performance tab had range buttons for the last 15 minutes, 1 hour and 6 hours. There is now a 24h button beside them, so you can look at a whole day of server activity on one chart.

## Your history survives a restart

Before this release, the performance history only lived in memory. Close the app and it was gone, and the next launch started the charts from empty.

Now the launcher saves the samples to a small file on disk as it collects them. When you open the app again, the charts load that history back. A 24h chart that you looked at yesterday will be filled in today, not blank.

The saving is done in small batches about once a minute, so it does not slow the app down or wear out your disk. If you remove a server instance, its saved history is deleted with it.

## One button to add a server

Adding a server used to mean choosing between two buttons in the sidebar, and it was easy to pick the wrong one. There is now a single **Add server** button that asks what you want: create a fresh server, or point the launcher at a folder you already have. The choice is the first thing you see, so there is nothing to guess.

## A warning when a server folder is gone

If you delete or move a server folder outside the launcher, the instance used to stay in the list as if nothing happened. Now the launcher notices. The instance is greyed out, tagged **folder not found**, and the Start button is disabled with a clear reason.

You have two ways out. Point the instance at the folder's new location with **Relink folder**, which keeps your settings and history. Or remove the instance from the list. The launcher never deletes an instance on its own, because a folder can be missing only for a moment, like an external drive that is not plugged in.

## Save on the Properties tab is more reliable

On Windows, saving `server.properties` could fail with a permission error when another program was holding the file for a moment. That is fixed. The launcher now retries the save and falls back to a safe copy, so a passing lock no longer turns into a failed save.

## The Properties tab shows when you have unsaved edits

The **Apply changes** button on the Properties tab now shows the same pulsing cue that Settings uses when you edit a field. It appears when you change a text field, a dropdown or a switch, and it clears once you save. If you change a value and then change it back, the cue clears too, because there is nothing left to save.

This is only a visual cue. The launcher still writes `server.properties` only when you press Apply.

## Server names stay readable

A very long server name, or one with a line break, could look broken in the sidebar. Names are now cleaned up and capped at 60 characters, both when you add a server and when you rename one.

## Upgrading

Install 5.4.0 over your current version. No settings change, no migration. Your servers, worlds and settings are untouched.
