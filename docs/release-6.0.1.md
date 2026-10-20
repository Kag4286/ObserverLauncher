# ObserverLauncher 6.0.1

A polish release. The server message preview finally shows the colours your players will see, Spigot plugins finally name their author, and a failed modpack install no longer leaves half a pack behind.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#601--2026-10-20).

---

## The server message preview shows the real thing

The server message, the line players see in the server list, has always been a little field with a coloured preview under it. The preview was not much use. It showed the raw text, including the escape sequences, instead of the colours.

The reason is worth knowing, because it is not a bug in your file. Minecraft stores the server message with the colour code written as an escape sequence. That is how the game itself reads it. The app was showing you the file's spelling rather than the game's interpretation.

Now the app reads the file the way the game does, so the preview shows the colours. If you edit the message, the app writes it back in the form the game expects, so the server keeps reading it correctly.

Nothing to do. If your server message already had colours, the preview now shows them.

## Spigot plugins tell you who made them

Open a Spigot plugin in the Marketplace and the install window said "Unknown author" for every project, even though the name was already on the card behind it.

The name was being filled in after the card was drawn, and the install window was reading a copy made before that happened. Both the card and the window now share the same name.

## A modpack install that fails leaves nothing behind

Importing a CurseForge modpack was not all or nothing. If one of the files failed to download, the ones that had already arrived stayed in your mods folder, with no way to tell what was half-installed. The same was true of the configuration files a pack brings with it.

That is now the same behaviour the Modrinth pack import has had since 6.0.0. If anything fails, the whole import is undone: the new files are removed and the ones that were overwritten are put back the way they were.

One more thing came out of this. Mods and plugins imported from CurseForge were not being recorded in the app's install list at all, so the app had no way of knowing they were there and could not offer updates for them. That is fixed too.

## Spigot builds install again

Picking a particular build of a Spigot plugin could not work, because the endpoint that would serve that specific build refuses the request. Spigot only serves the latest build of a plugin.

The install now uses the endpoint that answers. The list of available builds is still there, because it tells you which Minecraft versions the plugin supports, but the window no longer offers a choice it cannot honour.

## A download that is not a plugin no longer looks like a success

If a registry answered with an error page instead of the plugin file, the app would save that page as the plugin, say the install worked, and leave you to work out why the plugin would not load.

The app now checks that what it downloaded really is a plugin file. If it is not, the file is removed and you are told what happened.

## Two smaller things

The Bedrock tunnel could ask you to set an SSH path that had no field to set it in. There is a field now, next to the Playit path, with a Browse button.

The button on Overview that read "Get Spark" only took you to the Marketplace tab. It now reads "Install Spark", which is what it does. Actually installing and running Spark is still on the list for a later release.

## What comes next

6.0.1 is a polish release, and 6.0.0 still carries some planned work that did not fit. Here is what is not in this version, and why.

**Version 6.1.0**

- Bulk content updates with rollback. Updating many mods at once, with a rollback if the server does not come back up, is not in this release. Today you update one item at a time, and the launcher already records whether a start succeeded.
- A conflict panel in the Content tab. Finding duplicate mods, loader mismatches and missing dependencies is already available to an AI client through the app's MCP tools, but there is no screen for it yet.
- Spark profiling from the Performance tab. The button still takes you to the Marketplace so you can install it. Running the profiler from inside the app and showing the result needs a real server to check the output against, and that check did not happen before this release.
- More headless endpoints and local event hooks, so an external script can watch start, stop, crash and player join events.
- A fix for one known limit in update checking: a jar you dropped into `mods` or `plugins` by hand has no marketplace id recorded, so it is reported as unknown instead of being matched by guesswork.
- The Pinggy tunnel's SSH path now has a field in Settings. A path that is not on the default list, and no way to point at one, is a problem the app used to report without offering a way to solve it.

**Version 6.2.0**

- Resource pack support in the player inspector. Reading a resource pack at runtime to override item icons is planned, and it needs its own round of testing before it ships.
- World map extensions: cave mode, Nether and End dimensions, entity markers, and PNG export of a region.
- World operations: rename a world, edit the display seed, delete one dimension, and import or export a world between servers.
- Waypoint sharing between servers, including import from the Xaero and JourneyMap formats.

**Still waiting on a first look**

- A LuckPerms permissions editor. The plugin stores data differently by version, so the format has to be inspected on a real install before any code is written.
- Cloud backup to S3, Google Drive or WebDAV. Whether this needs a heavy third-party library has not been decided, and adding one is a decision for you, not the app.

Smaller bug fixes and polish will keep landing between these releases.

---

## Upgrading

There is nothing to migrate and nothing new to configure. Replace the app and carry on. Your servers, settings and install history are untouched.

If you were waiting for a CurseForge modpack import to finish before, you can retry it now.
