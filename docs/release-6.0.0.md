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

## Smaller additions

- The RAM field on Overview has quick buttons (2, 4, 6 or 8 GB). They set the amount; you still press Apply.
- The `motd` field in Server properties shows a live preview with the colors and formatting you typed.
- Player names in the console are now clickable and open that player's card.
- A new server created from the wizard shows a short note about Bedrock crossplay when the software you picked supports it.

## Upgrading

Install 6.0.0 over your current version. No settings change, no migration. Your servers, worlds and settings are untouched.
