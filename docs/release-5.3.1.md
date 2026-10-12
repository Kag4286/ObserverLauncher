# ObserverLauncher 5.3.1

A small fix-and-polish release. Two things change: the language setting now waits for the Apply
button like every other setting, and the last few screens that were still in English are now fully
translated.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](https://github.com/Kag4286/ObserverLauncher/blob/main/CHANGELOG.md#531--2026-10-12).

---

## Fixed: the language no longer switches on its own

In Settings, the **Language** dropdown used to change the whole interface the instant you picked a
new language. That was inconsistent: the **Interface animation** and **Beginner mode** settings
wait for you to press **Apply**, but language did not.

Now language behaves like the rest. Pick a language, and nothing changes until you press **Apply**.
If you change your mind, the **unsaved changes** hint clears once you switch back.

This also fixes a smaller annoyance: if you had not chosen a server folder yet (a fresh install),
pressing Apply used to refuse with "server folder is required", which could stop you from changing
the language at all. Preference settings now save fine without a folder.

## Everything is translated now

A few screens were still showing English even when you had selected another language. They are now
fully translated into all seven languages:

- The **welcome screen** and the **New Server wizard**.
- The **server properties** editor (all 47 settings, with their hints).
- Backup rows, the world-map error message, and a couple of smaller labels.

A few technical hints that are examples rather than sentences (like `minecraft:diamond` or a JVM
flag) stay as they are, because translating them would be more confusing than helpful.

## Upgrading

Install 5.3.1 over your current version. No settings change, no migration — your servers, worlds and
settings are untouched.
