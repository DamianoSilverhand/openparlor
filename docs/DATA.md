# Data and backups

OpenParlor keeps its data in one SQLite file, `data/openparlor.db`, created on first start. It uses Node's built-in `node:sqlite`, so there is nothing extra to install. This needs **Node 22.13 or newer**; older versions print a clear message and stop.

Set `DATA_DIR` to keep the data somewhere else. The `data/` folder is not committed.

## What is stored

| Table | Contents |
|---|---|
| `profiles` | Name, animal, band and play count for each saved profile. |
| `profile_game_stats` | Personal best, plays and daily streak for each profile and mini-game. |
| `scores` | Every mini-game score, from solo practice and from rooms. |
| `records` | Group records for "play together" mini-games. |
| `games`, `game_results` | Every finished room game and each player's score and rank. Names are kept as played, including guests who had no profile. |
| `meta`, `schema_migrations` | Bookkeeping. |

If `profiles.enabled` is `false` in the config, nothing about people is saved: no profiles, scores or game history. Group records (a total per game and group size, with no names) are still kept.

Quiz questions, prompts and words are not in the database. They stay in JSON files so they are easy to share and review (see [CONTENT-PACKS.md](CONTENT-PACKS.md)).

## Scores page

`/stats` shows the best scores for each mini-game, the most recent games and the group records.

## Your own data

- **Download:** in Solo Practice, choose **Download my data** to get one profile as a JSON file.
- **Import:** on the Solo Practice profile screen, choose **Import a profile**. If the profile still exists its scores are merged (the best of each is kept); otherwise it is added again, with a number after the name if the name is taken.
- **Delete:** **Delete my profile** removes the profile and its personal stats. Results of past room games stay, with the name but no link to the profile.

The same things are available over HTTP: `GET /api/profiles/<id>/export`, `POST /api/profiles/import`, `DELETE /api/profiles/<id>`, `GET /api/profiles/<id>/history`, `GET /api/leaderboard?game=math`, `GET /api/history`, `GET /api/records`. They have no login, like the rest of the profile features, so anyone on the network can use them. Turn profiles off if that is a problem.

## Backups

A backup is written to `data/backups/` when the server starts and then once a day, and the newest 7 are kept. To make one right now:

    npm run backup

To restore, stop the server and copy a backup over `data/openparlor.db` (delete `openparlor.db-wal` and `openparlor.db-shm` next to it first).

## Upgrading from the JSON files

Older versions saved `data/profiles.json` and `data/records.json`. On first start these are imported into the database and renamed to `profiles.json.imported` and `records.json.imported`; they are never deleted. Levels such as `kid` and `grownup` are mapped onto your configured bands. A file that cannot be read is left alone and reported in the log. Running the import twice does not create duplicates.

## Schema changes

The schema is versioned with numbered files in `server/db/migrations/`. New versions apply their migrations automatically at start-up, each in a transaction. A database made by a newer version is refused with an explanation instead of being changed.
