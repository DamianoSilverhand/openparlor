# Security policy

## Reporting a vulnerability

Please **do not** open a public issue for a security problem. Use GitHub's private vulnerability reporting: open the
repository's **Security** tab and choose **Report a vulnerability**. Include what you found, how to reproduce it, and which
version or commit you tested. We will acknowledge your report, tell you what we plan to do, and credit you when the fix is
released if you wish.

## Supported versions

The latest release (and the `main` branch) receives fixes.

## What OpenParlor is designed for

OpenParlor is built to run **on a home, classroom or party network** that you control, with guests who join by scanning a
code. It is not yet designed to be exposed to the internet. In particular:

- There is **no login**. Anyone who can reach the server can create a room, join one with its four-letter code, and use the
  profile, score and history endpoints. Turn profiles off in the config (`"profiles": { "enabled": false }`) if you do not
  want anything about people saved.
- **Plugins are trusted code** that runs inside the server with full access. Only install plugins you trust. There is no
  sandbox.
- The server limits message sizes, message rates and the number of rooms, and refuses malformed requests, but it has not
  been hardened against a determined attacker on the internet. Do not expose it without a reverse proxy that adds the
  protection you need.
- Scores sent from a phone are trusted up to the game's maximum, so a modified phone can post a perfect score.

An internet mode with the extra protections it needs is planned (see ROADMAP.md).

## Good practice when running it

- Keep Node up to date (22.13 or newer).
- Use `npm run cert` and https if you want installable-app features, and keep `data/` (it holds profiles and scores) out of
  version control and backed up (`npm run backup`).
