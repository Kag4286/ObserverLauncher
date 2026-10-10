# ObserverLauncher 5.2.1

A small fix release. If you never had trouble telling friends how to join, this update changes
nothing for you.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#521--2026-10-10).

---

## Fixed: the shared address could be a virtual one

The app shows an address you can send to friends so they can join (the "Your server is running!"
card, and the "How friends can join" panel). On some PCs it could show the **wrong** address — one
from a virtual network adapter.

If your computer has a VPN, Docker, a virtual machine, WSL, or a similar tool installed, Windows
creates extra "virtual" network adapters. The app used to pick whichever address it saw first, which
could be one of those — an address your friends cannot reach.

Now the launcher **prefers your real WiFi or Ethernet address** and only falls back to a virtual one
if there is nothing else. Copy the address again and it should be the one that works on your network.

## Upgrading

Install 5.2.1 over your current version. No settings change, no migration.
