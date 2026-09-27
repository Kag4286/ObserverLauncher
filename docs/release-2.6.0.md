# ObserverLauncher 2.6.0

A polish release. Nothing looks different — no new buttons, no rearranged screens — but the launcher *feels* better to use. It is harder to break by clicking too fast, friendlier to the keyboard, and it remembers where you were.

> This is the plain-English release note. Developers: see the full technical changelog in [CHANGELOG.md](../CHANGELOG.md#260--2026-09-27).

---

## The launcher no longer double-fires when you click fast

Some buttons start something that takes a moment — Start server, Stop, Save settings, Apply properties, Create backup, Check for updates, install a mod, and the op / whitelist / ban / kick buttons on a player. If you clicked one twice because nothing seemed to happen yet, it could run the action twice.

Now the button disables itself the instant you press it and only comes back when the job is done. One click, one action — no matter how impatient you are.

## You can always get out of a dialog with the keyboard

Before, if you opened a confirmation box and pressed Tab, focus could slip out to the page behind it — you would be typing into a screen that is not really there. Every dialog now keeps the keyboard inside it while it is open, and when you close it, your cursor goes back to the button you clicked to open it.

We also made two more things work without a mouse:

- **The player list** — click a player row once and you can move up and down with the arrow keys.
- **The little "?" help bubbles** next to the numbers — you can now reach them with Tab and open them with Enter or Space.

## Each tab remembers where you were

Scroll halfway down your Players list, switch to the Console and come back — you land exactly where you left off, instead of snapping to the top. The Console is the one exception: it always follows the newest line, because that is what a console is for.

And when you go to the **next page** of Marketplace results or the player list, it jumps to the top of the new page instead of leaving you at the bottom of the old one.

## Oops, wrong one? Undo.

If you remove a server from the instance list by mistake, the confirmation now comes with an **Undo** button in the corner. One click puts it back. (This was never dangerous — removing an instance never deletes your server folder — but it is easier than re-adding the folder by hand.)

## Error messages in plain language

When something fails — a flaky connection, a full disk, a file another program is using — you used to sometimes see the raw technical error. These are now turned into short, readable sentences in your language, so you know what happened and what to try next.

## The small stuff

- The TPS number now eases to its new value the same way CPU and memory already did, so the readouts move together instead of one of them jumping.
- A handful of buttons that used to change state before their action finished now wait for the real result first.

## A note on what did *not* change

No screens, buttons, colours or layouts were touched in this release. If 2.6.0 looks identical to 2.5.0, that is on purpose — the improvement is in how it behaves, not how it looks.

---

*Developer notes: `npm test` (58 files) and `npm run test:e2e` (12 tests) both pass. The motion-token ratchet is unchanged. 2.6.0 adds shared helpers (`withBusy`, `trapFocus`/`releaseFocus`, `friendlyError`, toast actions) and 8 new localized strings.*
