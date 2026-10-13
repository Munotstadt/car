-- Ergaenzung zur bestehenden D1-DB "car" (skoda_collector_tbl / skoda_trips_tbl existieren bereits).
-- Der Worker legt fehlende Tabellen beim ersten Request automatisch an (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS skoda_activites_tbl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  activity_time_utc TEXT NOT NULL,      -- 'YYYY-MM-DD HH:MM:SS' UTC
  activity TEXT NOT NULL,
  activity_comment TEXT,
  odometer_km REAL,
  soc_percentage REAL,
  range_km REAL,
  placeholder1 TEXT,
  placeholder2 TEXT,
  placeholder3 TEXT,
  placeholder4 TEXT,
  placeholder5 TEXT,
  at_date_utc TEXT NOT NULL             -- 'YYYY-MM-DD' UTC (aus activity_time_utc)
);
CREATE INDEX IF NOT EXISTS idx_activities_time ON skoda_activites_tbl(activity_time_utc);

-- Login-Schutz (Google Authenticator / TOTP)
CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_state (
  key TEXT PRIMARY KEY,
  value TEXT
);
