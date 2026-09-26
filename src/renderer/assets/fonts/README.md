# Space Grotesk — self-hosted font

`style.css` declares an `@font-face` pointing to:

```
./assets/fonts/SpaceGrotesk-Variable.woff2
```

That file is **not bundled** in this patch (this sandbox has no network to download the binary).
If the file is missing, the browser/Electron falls back to
`-apple-system, "Segoe UI", Inter, Roboto, Arial, sans-serif` — the app still works and the style
is still correct, only the font differs slightly.

## How to add the real font (one time, on a machine with network access)

1. Download the Space Grotesk variable font (OFL license, free) from one of these sources:
   - Fontsource: https://fontsource.org/fonts/space-grotesk → download the "variable" `.woff2`
   - Google Fonts (upstream GitHub repo): https://github.com/googlefonts/space-grotesk → build it or
     grab `SpaceGrotesk[wght].ttf` and convert it to `.woff2` (e.g. with `fonttools varLib.instancer`
     or https://transfonter.org, choosing "TTF/OTF → WOFF2").
2. Rename the file to `SpaceGrotesk-Variable.woff2` and place it in this folder
   (`src/renderer/assets/fonts/`).
3. Reload the app (`npm start`) — no CSS/CSP change needed, because the file lives inside the app
   (`'self'`) so it does not violate `default-src 'self'` and needs no Google Fonts domain.

Optional — it only affects the typography, not any functionality.
