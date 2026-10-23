# ObserverLauncher 6.1.0

ObserverLauncher 6.1.0 adds mod conflict detection in the Content tab, bulk content updates with automated file backups and rollback, an automatic crash-recovery rollback guard, and internal version inspection for loose jar files.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#610--2026-10-23).

## Content conflict detection

The Content tab now scans installed mods and plugins before you launch your server. It detects and flags five common setup issues:

- Duplicate mod IDs installed under different file names.
- Loader mismatches, such as Fabric mods placed inside a Forge or NeoForge server.
- Missing mandatory dependencies required by installed mods.
- Declared incompatible mod conflicts.
- Client-only mods placed in a dedicated server folder.

When issues are found, a banner appears above the content list detailing each problem, and warning badges appear next to the affected files.

## Bulk updates with backup and rollback

You can now update all outdated plugins and mods in a single action from the Content tab menu.

Before any file is replaced, the launcher saves a copy of the old file into `observerlauncher-content-backups/`. After updating, you can undo the batch immediately from the completion notification, or use the "Roll back update" option in the menu at any time before starting the server.

## Crash recovery stability guard

If your server crashes shortly after updating mods or plugins, the launcher detects the unstable exit and automatically restores the previously installed versions. This prevents crash loops when an update is incompatible with your existing world or configurations.

## Version display for loose jars

Jar files copied directly into your `mods/` or `plugins/` folders without using the Marketplace now display their version numbers in the Content list. The launcher reads the metadata embedded inside the jar files rather than showing a blank version column.
