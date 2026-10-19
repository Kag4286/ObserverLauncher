# ObserverLauncher 6.0.0

Bedrock players can join a Java server without editing config files by hand, and your metrics history now reaches back a month instead of a day.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#600--unreleased).

---

## Bedrock players can join

GeyserMC lets people on phones and consoles join a Java server. The app has been able to spot Geyser for a while, but it could only point at the problems in your config. Now it can fix them.

Open the **Bedrock crossplay** panel on Overview. If your Geyser `config.yml` has one of the common mistakes, an **Apply fix** button appears. It changes only the values that are wrong, keeps every comment and every other setting exactly as it was, and copies the original file to `config.yml.bak-<timestamp>` first. You are asked before anything is written.

The button only appears for fixes that are safe to make automatically. A wrong Bedrock port still shows up as a note, because changing it also changes which port your tunnel has to use, and that is your call.

## A second tunnel, so both kinds of player fit

Playit's free plan can open a Java tunnel or a Bedrock tunnel, but not both at once. Java needs one protocol, Bedrock needs another. This is the reason crossplay used to stop at the door.

The Bedrock crossplay panel now has a **Start Bedrock tunnel** button that uses Pinggy instead of Playit, so the Bedrock side gets its own tunnel next to the Java one from Playit. You do not need an account: the free tier works from the command line tool that already ships with Windows, and the app handles the login step for you.

Two things to know about the free tier. The tunnel lasts about an hour, and the app restarts it before it expires, so it keeps running. The address changes when it restarts, so if you share it, share the current one.

## A month of history

The Performance tab used to go back a day. It now goes back a week, and a month. Old samples are averaged down (one per minute for the week, one per hour for the month) so the history does not grow into a huge file.

This is worth knowing: the longer ranges fill up over time. Right after updating, the week view has whatever your machine has recorded since the update. Give it a few days before the week view looks full, and a few weeks before the month view does.

## A few things that are safer now

Removing a server asks what you mean. You can remove just the entry from the launcher, or remove the entry and delete the server folder. The second choice is permanent and says so, and the app will not delete a folder that looks like the wrong one.

Installing a modpack is all or nothing. If one file in the pack fails to download or does not match its checksum, the whole install is undone instead of leaving half a mods folder behind.

Downloads stop wasting time. When a server answers that a file does not exist, the app now gives up instead of retrying four times, and it checks that it received the whole file before trusting it.

Updates follow your choice. Settings has a new update policy: Automatic, Ask me first, or Off. Automatic downloads a new version as soon as it is found and asks before installing; Off skips the startup check and leaves the manual button working.

## A Java process that used to linger

Some of you noticed Java processes still running in Task Manager after stopping a server. That was a real bug. Force Stop killed the wrapper script on Windows but could leave the actual Java server behind, and quitting the app only cleaned up the server you had open.

Now Force Stop ends the Java process too, quitting closes every running server, and the next launch finds a Java process that survived a crash instead of forgetting it.

## Server settings got easier

A few things in the settings side are new.

The memory field on Overview has quick buttons for 2, 4, 6 or 8 GB. They set the amount; you still press Apply. A button larger than your machine's RAM is greyed out.

The `motd` field shows a live preview with the colors and formatting you type, so you can see the server-list message before you save it.

Server properties now keeps a history. Before every change, the old file is saved as a snapshot. A History button opens a list, shows you a line-by-line diff against the current file, and lets you restore an older version. Restoring is safe to undo, because the current file is saved first.

The JVM arguments field has presets: Aikar's flags (the usual recommendation for Paper and Purpur), G1 tuned, and ZGC for very large servers. Pick one and it fills the arguments from your current memory. A small help button explains the difference.

## Game rules, without the command line

Game rules such as keep-inventory or the daylight cycle live inside the world, not in `server.properties`, and normally you set them one at a time through `/gamerule` while the server runs. The World Map tab now has a Game rules panel that lists every rule at once. Flip what you need and save; the server must be stopped, and `level.dat` is backed up first.

## Save a setup as a template

If you built a setup you like, a Save as template button in Server properties captures the software, memory, port and properties under a name. When you create a new server, your templates appear in the wizard next to the built-in ones.

## When the server crashes, the app reads the crash report for you

If the server stops on its own (not because you pressed Stop), the app now finds the newest crash report and reads it. It opens the Console tab with a short banner: the likely cause in plain words (out of memory, wrong Java, two mods that conflict, a missing dependency, the port already in use, or a corrupt file) and a few things to try. The full stack trace is there behind a link if you want it. The app tells you what it thinks went wrong; it does not change your files on its own.

## Get a message when something happens

Settings has a Notifications section that can post to a Discord webhook. Paste a webhook address from your Discord server, pick which events you care about (start, stop, crash, player joins), and press Send test to check it works. It only sends from your own computer, and a bad address is ignored quietly instead of breaking anything.

## Start or stop all your servers at once

When you have more than one server in the rail, two buttons appear under the list: Start all and Stop all. The app skips a server that is already running, already booting, or whose folder is missing, so you are never starting a server twice. Booting them one at a time keeps your machine responsive.

## Alerts when the server starts to struggle

The Performance tab now shows a banner when the server's tick rate drops sharply or when the memory it uses keeps climbing. The tick banner suggests a likely cause from the numbers it already has (a slow tick, a jump in players, or memory pressure). The memory banner reports the growth rate so you can decide whether to restart before the server stalls. Both banners disappear on their own when the numbers recover.

## Manage several servers at once

The rail now lets you tag a server with a short group name (for example, one group for a friends server and one for a build server). With two or more groups, a row of chips appears so you can show only one group at a time. This is only a view: the Start all and Stop all buttons still act on every server, so a filtered rail cannot start a server you cannot see.

The Overview tab gets an All servers table when you have more than one server. One row per server with its status, TPS, memory, player count and uptime. Click a row to switch to that server.

## Datapacks get a manager of their own

A datapack in the Content tab now has a Check button that reads its `pack.mcmeta` and tells you whether it matches the server's Minecraft version before you start. A .zip datapack has an Extract button that unpacks it into a folder next to the zip so you can edit its files. A folder datapack is also faster to load and easier to edit than a zip.

Under the datapack list there is a Datapack load order panel. Minecraft applies datapacks in order, and a later pack overrides a function from an earlier one when both define the same thing. The panel shows the current order with arrows to move a pack up or down. Saving needs the server stopped. The world is backed up first.

## Scrape your server metrics with Prometheus

If you run Grafana, Settings > Advanced now has a Prometheus section. Turn it on and the app serves a `/metrics` endpoint on `127.0.0.1` in the standard Prometheus format: TPS, MSPT, CPU, RAM, player count and uptime for every server, labelled by instance. Point Prometheus at `http://127.0.0.1:<port>/metrics` and the numbers land in Grafana. The endpoint never leaves your machine.

The section tells you what it is doing as you touch it. Flip the switch and it says the endpoint will start when you press Apply. After Apply it names the port it is listening on and shows a Copy URL button, so you never have to copy a port by hand.

## Export a server as a Docker setup

If you want to move a server to a Linux VPS, Settings > Advanced now has an Export as Docker button. Pick a folder, and the app writes a Dockerfile, a docker-compose.yml, a .dockerignore and a short README that run the same headless backend in a container. The image bundles Java, mounts your server folder and the launcher's data folder as volumes, and includes a healthcheck. Nothing leaves your machine until you copy the folder to the VPS yourself.

## Manage a proxy's backend servers

If you run a Velocity proxy, the Properties tab now lists the backend servers it forwards to. Add one by name and address, or remove an old one. The file is edited at the line level, so any comments and spacing you put in `velocity.toml` yourself are kept exactly as they were.

## A player card that shows the player

Open a player from the Players tab and the Overview now leads with a rotatable 3D model of that player, wearing whatever armor they have on. Drag to turn it. The four numbers you actually look at (online or offline, gamemode, health, food) sit beside the model at a readable size, and the rest of the saved values wait behind an **All stats** section you can open. It opens the same way the other collapsible rows in the app do, with the same background and the same motion.

Equipment is a row of item icons rather than a list of names, so you can see a diamond helmet at a glance. Enchanted items show their enchantments and level when you hover. Damaged tools and armor show a durability bar under the icon.

This works for players who are offline. The app reads their save file, so nothing needs the server to be running. If the server is running, it asks the server to write the file first, so you are not looking at data from fifteen minutes ago.

## Skins work on offline servers now

An offline-mode server has no Mojang account behind its player names, so the app used to show a default Steve for everyone. If you run SkinsRestorer, the app now reads the skins the plugin stores on disk and shows the skin your players actually see. It looks in the plugin folder itself, so there is nothing to configure.

If SkinsRestorer is not installed, the app still finds a skin when it can. It checks Mojang, then your own Minecraft client's files, then a public texture mirror, and finally falls back to a colored tile with the player's first letter. A player never shows a broken image.

## Item icons, including modded ones

Inventory and ender chest show every slot, the way the game does. Empty slots are outlined, so you can tell a full inventory from a short one. A stack of more than one item shows the count.

Items added by mods used to show only a text label. The app now reads the icon straight out of the mod's own jar file on your server, so a Create wrench or an AE2 cable has a picture like anything else. Vanilla items come from the same public mirror the launcher already uses for block and item icons.

A few items have no texture file of their own, because the game draws them from another texture plus a glow. The enchanted golden apple is one of these. Those items now show the right picture instead of a blank square.

## Smaller additions

- Player names in the console are now clickable and open that player's card.
- A new server created from the wizard shows a short note about Bedrock crossplay when the software you picked supports it.
- The update policy in Settings (Automatic, Ask me first, Off) uses the app's own dropdown, not the system one.
- The two dropdowns inside the player card (gamemode) now use the app's own dropdown, and the up and down arrows on number fields are gone. Both were the last places the operating system drew a control instead of the app.
- Several small typography problems inside the player card are fixed: coordinates, the dimension line and the name no longer share three different text sizes and colors on one row, and the equipment row keeps every tile the same height when a slot is empty.

## Upgrading

Install 6.0.0 over your current version. No settings change, no migration. Your servers, worlds and settings are untouched.
