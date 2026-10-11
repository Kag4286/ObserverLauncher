# Code signing policy

ObserverLauncher distributes Windows installers from its public GitHub repository. This page
states what we sign, how it is built, and who is responsible - the policy that our free code
signing provider (SignPath Foundation) requires us to publish.

## What gets signed

- The Windows installer `ObserverLauncher-<version>-setup.exe` produced by
  [electron-builder](https://www.electron.build/) (NSIS target).
- Linux builds (AppImage) are currently **not** signed. This is deliberate and may change later.

## How it is built

The signed Windows installer is built **only** by GitHub Actions from the public repository
[Kag4286/ObserverLauncher](https://github.com/Kag4286/ObserverLauncher):

1. `npx electron-builder --win nsis --publish never` produces an **unsigned** installer on a
   `windows-latest` runner (see `.github/workflows/release-signed.yml`).
2. The installer is submitted to SignPath for Authenticode signing.
3. `scripts/regenerate-update-yml.js` recomputes the SHA-512 of the signed file and patches
   `latest.yml` so the auto-updater accepts it.
4. The signed installer is attached to a GitHub Release (kept as a draft until a maintainer
   reviews and publishes it).

No binary is signed that was not built by this pipeline from this repository. We never sign
third-party or upstream artifacts.

## Who signs

Signing is performed by [SignPath.io](https://signpath.io/) using a certificate issued by the
[SignPath Foundation](https://signpath.org/). The signing key never leaves SignPath's hardware
security module (HSM).

- **Author / maintainer:** Kag4286 (<https://github.com/Kag4286>)
- **Signing service:** SignPath.io (SignPath Foundation certificate)

## Verifying a download

On Windows, right-click the installer -> **Properties** -> **Digital Signatures**. A genuine build
shows a signature by **SignPath Foundation**. You can also verify from PowerShell:

```powershell
Get-AuthenticodeSignature .\ObserverLauncher-<version>-setup.exe | Format-List Status, SignerCertificate
```

`Status` should be `Valid`.

## Reporting a problem

If a download is unsigned, has an unexpected signature, or you suspect a tampered release, please
open an issue at <https://github.com/Kag4286/ObserverLauncher/issues>.
