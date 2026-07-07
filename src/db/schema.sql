CREATE TABLE IF NOT EXISTS attention_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  type TEXT NOT NULL,
  project TEXT,
  summary TEXT,
  content TEXT,
  metadata_json TEXT NOT NULL,
  redacted_summary TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(source, source_event_id)
);

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT,
  reason TEXT,
  candidates_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(event_id) REFERENCES attention_events(id)
);

CREATE TABLE IF NOT EXISTS focuses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project TEXT,
  keywords_json TEXT NOT NULL DEFAULT '[]',
  last_activity_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS focus_checkins (
  id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  notes TEXT NOT NULL,
  blocker TEXT,
  next_action TEXT,
  source TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(focus_id) REFERENCES focuses(id),
  FOREIGN KEY(run_id) REFERENCES ingestion_runs(id)
);
