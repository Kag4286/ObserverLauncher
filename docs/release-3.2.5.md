# ObserverLauncher 3.2.5

3.2.5 is a **fix and polish** release. No new features — it fixes a few things that could go wrong when
you run more than one server, corrects the World Map colours on some worlds, and makes the app a little
lighter to run.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#325--2026-10-02).

---

## Running more than one server is safer now

If you manage several servers in one window, three rough edges are fixed:

- **Switching servers no longer shows the wrong file.** Before, if you had a config file open in the
  Content tab and switched to another server, the editor still showed the first server's file — and
  saving could write it into the wrong folder. Now the editor returns to its list when you switch, and
  the settings panel refreshes for the server you just opened.
- **You cannot delete a server that is running.** If a server is running in the background and you try
  to remove it, the app now stops you with a clear message instead of leaving a hidden Java process
  behind. Stop the server first, then remove it.
- **Deleting the server you are viewing no longer confuses the app.** Removing the active server now
  cleanly moves you to the next one.

Two servers can also no longer share the same name — the second one becomes "Name (2)".

## The World Map shows the right colours

On some worlds, **The End** was drawn with the wrong colours (green and blue, like the Overworld).
This happened because chunks that were still being generated carry a temporary placeholder biome. The
map now reads a biome only from fully generated chunks, so The End looks like The End. Colour data is
also kept separate per dimension, so switching between Overworld, Nether and The End can never mix
colours.

## A lighter World Map

- Panning and zooming the map now redraw only once per frame, so it feels smoother.
- The map uses **less memory** on big worlds — its chunk/biome caches are capped.
- The background refresh (every 45 seconds while a server runs) no longer re-reads every region file,
  so it does not cause a stutter.
- **New buttons:** zoom in / zoom out and **Fit spawn** (centre the map on the world spawn).
- **Touch and pen now work** on the map, not just the mouse.

## Behind the scenes

- **CI is more reliable:** a temporary outage of the Paper download service now *skips* the boot test
  instead of failing it; the Docker image is built and checked on every change (so the old "container
  that could not start" class of bug cannot come back); and publishing uses a single workflow, so a
  release always gets both the installers and the modpack file.
- **Less duplicated code:** a new automated check scans for copy-pasted blocks across the codebase and
  fails the build when it finds one. It already removed nine real duplicates.
- A long note that was accidentally repeated six times in the 2.2.0 changelog was cleaned up.

**Nothing to migrate.** The settings file format is unchanged (still v4).
