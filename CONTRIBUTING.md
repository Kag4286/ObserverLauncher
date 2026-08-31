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
npm start
```

The app is plain Electron — no bundler, no build step for development. `src/main.js` is the Electron
main process entry point (window creation, IPC wiring, stateful server/timer orchestration); the
mostly-stateless logic it depends on lives in `src/main/` (`settings.js`, `fs-utils.js`, `http.js`,
`java.js`, `server-files.js`, `network.js`, `paper-api.js`) — each of those is a plain module you can
`require()` and test in isolation, with no dependency on a running Electron window. `src/renderer/` is
the UI (`index.html` + `app.js` + `style.css` + `locales.js`), and `src/preload.js`
is the only bridge between them (`contextIsolation` is on, so the renderer never touches Node APIs
directly).

## Guidelines

- **English only** in code comments, commit messages, and UI strings added to
  `src/renderer/locales.js`'s `en` block.
- **One concern per pull request.** A bug fix and a refactor in the same PR is harder to review and
  harder to revert if something breaks.
- **Explain the "why", not just the "what"** in your PR description — especially for bug fixes. What
  was actually happening, and why did the old code produce that behavior?
- **Test on Windows** if you can — Windows and Linux are the currently supported platforms, and several code
  paths (`powershell.exe`, `cmd.exe`, `run.bat`) are Windows-specific.

## Adding a language

1. Open `src/renderer/locales.js` and copy the `en` block into a new key (e.g. `es` for Spanish).
2. Translate every value. Keep the keys identical — the app falls back to English for any key missing
   in the active locale, so a partial translation still works, it just won't be fully translated yet.
3. Add an `<option>` to the `#languageSelect` dropdown in `src/renderer/index.html`.
4. Not every string in the app goes through `data-i18n` yet — see the README's Roadmap. Extending
   coverage (adding `data-i18n`/`data-i18n-placeholder` attributes to more elements, and the matching
   keys) is a welcome contribution on its own.

## Reporting bugs

The most useful bug report includes:

- What you clicked / typed, and what you expected to happen.
- The actual Console output from the launcher at the time (not just "it crashed") — Console tab, or
  the server's own `logs/latest.log` if the server process itself failed.
- Your Minecraft server software and version (Paper 1.21.4, Forge 1.20.1, etc.) if relevant.

## Code of conduct

Be respectful. Disagreements about code are fine; personal attacks are not.
