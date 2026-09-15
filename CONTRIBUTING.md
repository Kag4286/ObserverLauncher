# Contributing to ObserverLauncher

Thanks for taking a look. This project is small, so the process is intentionally light.

## Before you start

- For a bug fix or small change, just open a pull request.
- For a new feature or anything that touches the app's architecture (process launching, metrics
  sampling, IPC channels), open an issue first so we can agree on the approach before you spend time
  on it.

## Development setup

```bash
npm install
npm start     # launch the app in development mode
npm test      # run the full test suite
```

The app is plain Electron — **no bundler, no build step for development**. There are three layers:

- **Main process** (`src/main.js`) — the Electron entry point. It is a thin composition root: it
  creates the shared state object and registers feature modules. Almost all logic lives in
  `src/main/`:
  - Feature modules (stateful, take `ipcMain` + `ctx`): `context.js`, `server-lifecycle.js`,
    `backups.js`, `players.js`, `marketplace.js`, `modpacks.js`, `wizard.js`, `settings-handlers.js`,
    `content-handlers.js`, `app-lifecycle.js`.
  - Plain helpers (testable without an Electron window): `settings.js`, `fs-utils.js`, `http.js`,
    `java.js`, `server-files.js`, `network.js`, `editor.js`, `worldmap.js`, `textures.js`,
    `validate.js`, `migrations.js`, `kill.js`.
  - `adapters/` — per-software download resolvers (vanilla, papermc, purpur, leaf, fabric, forge,
    spigot, mojang).
  - `platform/` — Windows/Linux process-tree walking, metrics and firewall (`win32.js`, `linux.js`,
    dispatched by `index.js`).

  Each of these modules is a plain `require()`-able file with no dependency on a running window, so
  it can be unit-tested in isolation.

- **Preload** (`src/preload.js`) — the **only** bridge between main and renderer. It exposes
  `window.observer.*` over `contextBridge`. `contextIsolation` is on and `nodeIntegration` is off,
  so the renderer never touches Node APIs directly.

- **Renderer** (`src/renderer/`) — the UI. `index.html` is the shell and loads, **in numeric order**:
  - `css/` — styles split by area (`01-tokens.css` … `09-pulse.css`).
  - `locales/` — one file per language; `meta.js` loads **first** (it defines `window.LOCALES` and
    `LOCALES_META`).
  - `js/` — per-tab logic (`00-core.js` … `08-shell.js`), loaded as classic scripts. There is no
    module system and no bundler, so **load order matters** — a file that uses something defined in a
    later file will throw at load time.

## Guidelines

- **English only** in code comments, commit messages, and UI strings added to the `en` locale
  (`src/renderer/locales/en.js`).
- **One concern per pull request.** A bug fix and a refactor in the same PR is harder to review and
  harder to revert if something breaks.
- **Explain the "why", not just the "what"** in your PR description — especially for bug fixes. What
  was actually happening, and why did the old code produce that behavior?
- **Keep IPC channel names stable.** `preload.js` and the renderer depend on the exact channel
  strings used in `ipcMain.handle(...)`. Renaming one means updating the bridge and every caller.
- **Validate untrusted input.** Anything arriving from the renderer (or a remote API) is treated as
  untrusted. Use the shared validators in `src/main/validate.js` and `safeTarget` in
  `src/main/fs-utils.js`. The renderer mirrors some checks for instant feedback, but the backend must
  re-validate as defense in depth.
- **Run the tests** before opening a PR: `npm test`.
- **Test on Windows** if you can — Windows and Linux are the currently supported platforms, and
  several code paths (`powershell.exe`, `cmd.exe`, `run.bat`) are Windows-specific.

## Adding a language

1. Create a new file in `src/renderer/locales/` (e.g. `it.js` for Italian) by copying
   `src/renderer/locales/en.js`. Keep the keys identical — the app falls back to English for any key
   missing in the active locale, so a partial translation still works, it just won't be fully
   translated yet.
2. Add an entry to `window.LOCALES_META` in `src/renderer/locales/meta.js`:
   `{ code: 'it', name: 'Italiano' }`.
3. Add a matching `<option>` to the `#languageSelect` dropdown in `src/renderer/index.html`.
4. Make sure the new file is loaded: it must be required the same way the other languages are (see
   `tests/i18n.test.js` and how `index.html` includes the locale files).
5. Run `npm test` — the i18n test checks that every locale has every key the `en` block defines.

Not every string in the app goes through `data-i18n` yet. Extending coverage (adding
`data-i18n` / `data-i18n-placeholder` / `data-i18n-title` attributes to more elements, and the
matching keys) is a welcome contribution on its own.

## Reporting bugs

The most useful bug report includes:

- What you clicked / typed, and what you expected to happen.
- The actual Console output from the launcher at the time (not just "it crashed") — the launcher's
  **Console** tab, or the server's own `logs/latest.log` if the server process itself failed.
- Your Minecraft server software and version (Paper 1.21.4, Forge 1.20.1, etc.) if relevant.
- Your OS and, if a metric looks wrong, your Windows display language (some bugs are locale-specific).

## Code of conduct

Be respectful. Disagreements about code are fine; personal attacks are not.
