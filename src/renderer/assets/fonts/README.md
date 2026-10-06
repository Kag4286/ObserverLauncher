# Bundled fonts (offline-safe)

v4.0.0 loads its UI + mono fonts from `fonts.css` in this folder (linked before `css/01-tokens.css`).
That file is **generated** - do not edit it by hand. There is NO Google Fonts `@import`, and the
CSP is `font-src 'self'`, so the app renders fully offline either way.

Right now `fonts.css` is a placeholder and the app uses the fallback stack
(`Inter, system-ui, …`), which looks correct - just not the exact typeface.

## One-time: fetch + bundle the real fonts

On a machine with network access, from the project root:

```
npm i --no-save @fontsource-variable/manrope @fontsource/ibm-plex-mono
node scripts/fetch-fonts.js
```

The script copies the woff2 subsets (Latin, Vietnamese, Cyrillic - so all 7 locales render in the
real font) into this folder and rewrites `fonts.css` with the correct `@font-face` + `unicode-range`.
It is **not** an npm dependency of the app - `--no-save` keeps it out of package.json (the woff2
files are committed here instead).

Then reload the app (`npm start`). No CSS/CSP change needed - the files live inside the app (`'self'`).

## Fonts + licenses (both OFL)

- **Manrope** (UI) - https://github.com/sharanda/manrope
- **IBM Plex Mono** (technical) - https://github.com/IBM/plex
