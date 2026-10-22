# ObserverLauncher 6.0.2

ObserverLauncher 6.0.2 is a maintenance release. It fixes version selection for Hangar plugins, adds Velocity proxy plugin support to the Marketplace, cleans up mouse listeners in the 3D player inspector, and bounds level.dat backups.

For technical details, see the [developer changelog](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#602--2026-10-22).

## Picking a Hangar plugin version installs that build

When installing a plugin from Hangar, picking a specific build from the version list in the install window now installs that build. Previously, Hangar downloads always fetched the newest build regardless of what was selected in the list.

If you do not choose a specific version, the app now selects the build that matches your server's Minecraft release.

## Proxy plugins for Velocity servers

If you run a Velocity proxy server, you can now search and install proxy plugins directly from Modrinth and Hangar. The Marketplace recognises Velocity as a compatible platform and downloads the proxy-specific jar file.

## Console player links and offline profiles

Clicking a player's name in the console log now matches names regardless of capitalisation, and checks your whitelist, operators and ban lists. On offline-mode servers where a player does not yet have a Mojang UUID recorded, the app reads the player's offline profile and opens the inspector.

## 3D player viewer resource cleanup

Closing the player inspector now detaches all mouse drag listeners from the canvas and releases the WebGL graphic buffers. This stops background drag events from accumulating when inspecting multiple players or reloading textures.

## Limited world backup files

Saving game rules or changing the order of datapacks makes a safety backup of your `level.dat` file before writing changes. The app now keeps only the 5 newest backup files in the world folder instead of leaving every historical backup file behind.

## Server message colour buttons

Editing the Message of the Day (MOTD) in the Server Properties tab now includes quick buttons for the 16 Minecraft colours and text formats (bold, italic, underline, reset). Clicking a button inserts the colour code at your text cursor and updates the live preview below the field.
