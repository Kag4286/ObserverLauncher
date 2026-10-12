# Security policy

## Reporting a vulnerability

Please report security issues privately, not in a public issue.

Use GitHub's [private vulnerability reporting](https://github.com/Kag4286/ObserverLauncher/security/advisories/new)
for this repository. If you cannot use that, open a minimal public issue that only asks for a private
channel, with no details of the problem.

Please include:

- What the issue is and where it lives (file, feature, or endpoint).
- How to reproduce it.
- What an attacker could do with it.
- The version you tested (see `package.json` or the app's About).

## Scope

The parts of this project that handle untrusted input or hold secrets are the most useful to look at:

- The MCP server and its stdio bridge (token handling, the `/rpc` and `/resource` endpoints).
- Remote access (the loopback HTTP server, its token, and its IP allowlist).
- Anything that writes to disk or resolves a path (the `safeTarget` guard, downloads, archive extraction).
- Secrets at rest (the launcher's encrypted store).

The app runs locally and has no server-side component and no user accounts, so issues that require an
attacker to already have full control of the machine are out of scope.

## What to expect

This is a small project maintained by one person, so there is no guaranteed response time. Reports
are read and answered as soon as possible. If a fix is needed, it will ship in a normal release and
be credited in the changelog unless you ask to stay anonymous.

## Supported versions

Only the latest release is supported. Older versions do not receive security fixes.
