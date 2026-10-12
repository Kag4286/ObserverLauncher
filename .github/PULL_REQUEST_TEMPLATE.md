## What this changes

A short summary of the change.

## Why

Explain the reason, not just the diff. For a bug fix: what was actually happening, and why did the
old code produce that behaviour? For a feature: what problem does it solve?

## Scope

One concern per pull request. If this touches two unrelated things, split it.

## Checklist

- [ ] `npm test` passes
- [ ] Comments and strings are in English
- [ ] No duplicated code (checked for an existing helper before adding one)
- [ ] IPC channel names were not renamed (if this touches `preload.js`)
- [ ] A new per-instance field was added in all three places (if applicable)
- [ ] New animation uses the motion tokens (if this touches CSS)
- [ ] Tested on Windows if the change is platform-specific

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full guidelines.
