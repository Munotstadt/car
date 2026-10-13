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

-- Notiz-Spalte für Trips (Trips-Seite, editierbar). Der Worker ergänzt sie bei Bedarf selbst.
-- ALTER TABLE skoda_trips_tbl ADD COLUMN note TEXT;

-- Ladevorgänge (Seite /charging). Der Worker legt die Tabelle bei Bedarf selbst an.
CREATE TABLE IF NOT EXISTS car_charging_tbl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charging_date_utc TEXT NOT NULL,      -- 'YYYY-MM-DD HH:MM:SS' UTC
  activity TEXT NOT NULL,               -- 'External' (Default) | 'Home'
  odometer_km REAL, soc_start REAL, soc_end REAL, range_start REAL, range_end REAL,
  kwh_charged REAL, costs_chf REAL,
  "duration_hh:mm" TEXT,                -- 'hh:mm'
  temperature REAL, notes TEXT, location TEXT, station_name TEXT, charging_card TEXT,
  charging_type TEXT,                   -- 'AC' | 'DC'
  placeholder2 TEXT, placeholder3 TEXT,
  created_at_utc TEXT NOT NULL DEFAULT (datetime('now')),
  modified_at_utc TEXT                  -- bei Anlage = created_at_utc, bei jeder Änderung neu gesetzt
);
CREATE INDEX IF NOT EXISTS idx_charging_date ON car_charging_tbl(charging_date_utc);
