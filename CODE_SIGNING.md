# Code signing policy

This page states the project's code-signing intentions: what would be signed, how it would be
built, and how to verify a download once signing is in place.

## Current status: not signed

As of 5.3.0, the Windows installer is **not code-signed**. Windows SmartScreen therefore shows a
"Windows protected your PC" or "Unknown publisher" warning on first run. Click **More info**, then
**Run anyway** to continue. The Linux AppImage is unaffected.

The project applied to the [SignPath Foundation](https://signpath.org/) free OSS signing program.
That application was not approved, because the project does not yet have enough public references
(articles, community discussions) for the program's reputation requirement. The project may
re-apply once it has a wider public footprint. Nothing is signed today.

## What would be signed

Once signing is in place:

- The Windows installer `ObserverLauncher-<version>-setup.exe` produced by
  [electron-builder](https://www.electron.build/) (NSIS target).
- Linux builds (AppImage) would stay unsigned. This is deliberate and may change later.

## How it would be built

The signed Windows installer would be built only by GitHub Actions from the public repository
[Kag4286/ObserverLauncher](https://github.com/Kag4286/ObserverLauncher):

1. `npx electron-builder --win nsis --publish never` produces an **unsigned** installer on a
   `windows-latest` runner (see `.github/workflows/release-signed.yml`).
2. The installer is submitted to SignPath for Authenticode signing.
3. `scripts/regenerate-update-yml.js` recomputes the SHA-512 of the signed file and patches
   `latest.yml` so the auto-updater accepts it.
4. The signed installer is attached to a GitHub Release (kept as a draft until a maintainer
   reviews and publishes it).

No binary would be signed that was not built by this pipeline from this repository. Third-party or
upstream artifacts are never signed.

## Who would sign

Signing would be performed by [SignPath.io](https://signpath.io/) using a certificate issued by the
[SignPath Foundation](https://signpath.org/). The signing key would never leave SignPath's hardware
security module (HSM).

- **Author / maintainer:** Kag4286 (<https://github.com/Kag4286>)

## Verifying a download today

Since releases are currently unsigned, there is no signature to check. To confirm a download is
intact, compare its SHA-256 against the value printed in the GitHub release notes for that version.

```powershell
Get-FileHash .\ObserverLauncher-<version>-setup.exe -Algorithm SHA256
```

Once signing is added, this section will instead describe checking the Digital Signatures tab in
the file's Properties.

## Reporting a problem

If a download has an unexpected signature, or you suspect a tampered release, please open an issue
at <https://github.com/Kag4286/ObserverLauncher/issues>.
