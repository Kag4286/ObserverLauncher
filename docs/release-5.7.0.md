# ObserverLauncher 5.7.0

The internet tunnel sets itself up now, and Bedrock players can join a Java server without guesswork.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#570--2026-10-15).

---

## A note on the tunnel address

Sharing your server over the internet uses Playit.gg, and you still copy the public address from the Playit dashboard into the app, as before.

We looked into filling that address in automatically by reading it from the Playit agent on your PC. It turned out Playit does not keep the address anywhere local. The command-line tool has no way to list tunnels, the config file only holds a secret key, and the agent's log only reports how many tunnels exist, never their names or addresses. The address lives only on the Playit dashboard. So the app keeps the copy-paste step, and there is nothing to fix here until Playit changes how its agent works.

## Bedrock players can join (GeyserMC)

GeyserMC lets people on Bedrock (phones, consoles) join a Java server. If your server has Geyser installed, the app now notices and shows a **Bedrock crossplay** panel with the exact steps.

The important catch: Playit's free plan cannot open a TCP tunnel and a UDP tunnel at the same time. Java needs TCP, Bedrock needs UDP. So you create a second, separate UDP tunnel for Bedrock on port 19132. The panel walks through it, and mentions that a paid Playit plan can combine the two into one.

## Upgrading

Install 5.7.0 over your current version. No settings change, no migration. Your servers, worlds and settings are untouched.
