# ObserverLauncher 5.7.0

The internet tunnel sets itself up now, and Bedrock players can join a Java server without guesswork.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#570--2026-10-15).

---

## The tunnel address fills itself in

Sharing your server over the internet uses Playit.gg. Before, after starting the tunnel you had to open the Playit dashboard, find the address it gave you, copy it, and paste it back into the app. That was the fiddly part.

Now the app reads the address from the Playit agent's own log and fills it in for you. Start the tunnel and the address appears. If it does not show up for some reason, there is a **Detect** button to scan the log again, and the paste box is still there as a backup. Nothing breaks if the agent changes how it prints its log.

## Bedrock players can join (GeyserMC)

GeyserMC lets people on Bedrock (phones, consoles) join a Java server. If your server has Geyser installed, the app now notices and shows a **Bedrock crossplay** panel with the exact steps.

The important catch: Playit's free plan cannot open a TCP tunnel and a UDP tunnel at the same time. Java needs TCP, Bedrock needs UDP. So you create a second, separate UDP tunnel for Bedrock on port 19132. The panel walks through it, and mentions that a paid Playit plan can combine the two into one.

## Upgrading

Install 5.7.0 over your current version. No settings change, no migration. Your servers, worlds and settings are untouched.
