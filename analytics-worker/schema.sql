CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS visit_cells (
  cell_key TEXT PRIMARY KEY,
  latitude REAL NOT NULL CHECK (latitude >= -90 AND latitude <= 90),
  longitude REAL NOT NULL CHECK (longitude >= -180 AND longitude <= 180),
  country_code TEXT NOT NULL DEFAULT 'XX' CHECK (length(country_code) = 2),
  visit_count INTEGER NOT NULL DEFAULT 0 CHECK (visit_count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_visit_cells_count
  ON visit_cells (visit_count DESC);

INSERT INTO counters (key, value)
VALUES ('total_visits', 0)
ON CONFLICT(key) DO NOTHING;
