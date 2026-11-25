# Configuration

Settings are merged in this order, later ones winning:

1. `config/default.json`
2. the preset in `config/presets/<name>.json`
3. `config/local.json` (your own, not committed)
4. environment variables

A file that cannot be read or is not valid JSON is reported in the server log and skipped. The server always starts.

## Options

| Key | Default | Meaning |
|---|---|---|
| `preset` | `"family"` | Which file in `config/presets/` to use. `PRESET=party` overrides it. |
| `brand.name` | `"OpenParlor"` | Shown on the home page, the TV, page titles and game headers. |
| `brand.tagline` | | Short line of text about your group or event. |
| `brand.accent` | `null` | A CSS colour, for example `"#2e7d32"`, used for the main accent. |
| `language` | `"en"` | Which file in `public/locales/` supplies the interface text. Missing keys fall back to English. |
| `limits.maxPlayers` | `12` | Players per room. `0` means no limit. |
| `limits.maxRooms` | `500` | Rooms at once (`MAX_ROOMS`). |
| `limits.maxConnections` | `2000` | Browser connections at once (`MAX_CONNECTIONS`). |
| `host.allowClaim` | `true` | Whether any player in the lobby can take over as host. Set `false` so only the host can pass host on. |
| `plugins.enabled` | `true` | Load games and mini-games from `plugins/` (or `PLUGINS_DIR`). `false` loads only the built-in ones. |
| `profiles.enabled` | `true` | Saved profiles, personal bests, streaks, scores and game history. `false` stores nothing about people (group records, which have no names, are still kept). |
| `bands` | from the preset | The groups players choose from. See below. |
| `gameDefaults` | `{}` | Default game settings, for example `{ "minigames": { "handicap": "off" } }`. Only values the game offers are accepted. |

Environment variables: `PORT` (3100), `PRESET`, `PLUGINS_DIR`, `MAX_ROOMS`, `MAX_CONNECTIONS`, `MAX_PLAYERS`, `CONFIG_DIR`, `CONTENT_DIR`, `DATA_DIR`.

## Bands

A band is a group of players who should get the same difficulty.

    "bands": [
      { "id": "novice", "label": "Novice", "hint": "just started", "tier": 1 },
      { "id": "regular", "label": "Regular", "tier": 2 },
      { "id": "expert", "label": "Expert", "tier": 3 }
    ]

- `id`: lowercase letters, numbers, `-` or `_` (up to 24). Saved profiles refer to it, so avoid changing it later.
- `label`: what players see (up to 30 characters).
- `hint`: optional extra text shown next to the label.
- `tier`: `1` easy, `2` medium or `3` hard. Games use the tier to choose question difficulty, board sizes, timing and so on. Several bands can share a tier.

With a single band nobody is asked to choose one. Invalid bands are reported and ignored. If none are valid, a single "Everyone" band is used.

Profiles saved by older versions (kid, teen, grownup) are mapped onto the bands with tiers 1, 2 and 3.

## Presets

A preset is a JSON file with a `name`, `description`, `bands` and optionally `gameDefaults`, `brand` or any other option. Add your own in `config/presets/` and select it with `"preset"` or `PRESET`.
