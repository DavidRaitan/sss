-- The record of every sitting, and the learner's notes: one row per thing that happened.
CREATE TABLE IF NOT EXISTS events (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  at   TEXT NOT NULL,          -- "YYYY-MM-DD HH:MM:SS", the learner's local time
  kind TEXT NOT NULL,          -- heard, answer, navigate, note, discarded, error, ...
  ref  TEXT,                   -- the amud, when there is one
  body TEXT NOT NULL           -- the whole row, as JSON
);
CREATE INDEX IF NOT EXISTS events_kind_at ON events (kind, at);
