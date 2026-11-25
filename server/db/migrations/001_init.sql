-- Profiles: who people are. Games and scores hang off these.
CREATE TABLE profiles (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  avatar       INTEGER NOT NULL DEFAULT 0,
  band         TEXT NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX profiles_name_nocase ON profiles (name COLLATE NOCASE);

-- Personal bests and daily streaks, one row per profile and mini-game.
CREATE TABLE profile_game_stats (
  profile_id       TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  game_id          TEXT NOT NULL,
  best             INTEGER NOT NULL DEFAULT 0,
  plays            INTEGER NOT NULL DEFAULT 0,
  streak_current   INTEGER NOT NULL DEFAULT 0,
  streak_best      INTEGER NOT NULL DEFAULT 0,
  streak_last_date TEXT,
  best_run         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (profile_id, game_id)
);

-- Every individual mini-game score (solo practice and rounds played in a room).
CREATE TABLE scores (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  profile_id TEXT NOT NULL REFERENCES profiles (id) ON DELETE CASCADE,
  game_id    TEXT NOT NULL,
  score      INTEGER NOT NULL,
  mode       TEXT NOT NULL CHECK (mode IN ('solo', 'room')),
  played_at  TEXT NOT NULL
);
CREATE INDEX scores_profile ON scores (profile_id, played_at);
CREATE INDEX scores_game ON scores (game_id, score DESC);

-- Group records for "play together" mini-games.
CREATE TABLE records (
  key      TEXT PRIMARY KEY,
  game_id  TEXT NOT NULL,
  players  INTEGER NOT NULL,
  handicap TEXT NOT NULL,
  total    INTEGER NOT NULL,
  date     TEXT NOT NULL
);

-- Finished room games and each player's result. Results keep the name as played, even if the profile is deleted.
CREATE TABLE games (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id      TEXT NOT NULL,
  room_code    TEXT,
  started_at   TEXT NOT NULL,
  ended_at     TEXT NOT NULL,
  player_count INTEGER NOT NULL,
  settings     TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX games_ended ON games (ended_at DESC);

CREATE TABLE game_results (
  game_ref   INTEGER NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  profile_id TEXT REFERENCES profiles (id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  band       TEXT,
  score      INTEGER NOT NULL,
  rank       INTEGER NOT NULL
);
CREATE INDEX game_results_game ON game_results (game_ref);
CREATE INDEX game_results_profile ON game_results (profile_id);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
