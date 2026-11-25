-- A run id lets a phone send the same finished game twice (for example after an offline replay) without it counting twice.
ALTER TABLE scores ADD COLUMN run_id TEXT;
CREATE UNIQUE INDEX scores_run_id ON scores (profile_id, run_id) WHERE run_id IS NOT NULL;
