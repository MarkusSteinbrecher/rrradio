-- Broken-station report pipeline (issue #507, P1).
--
-- One row per report. The `id` is the anonymous receipt token returned
-- to the reporting client; it is random and unguessable, and it is the
-- only handle the reporter ever holds — no reporter identity is stored.
-- Aggregation ("N people reported no-audio for station X") is a
-- GROUP BY (station_id, category) over these rows.
CREATE TABLE broken_reports (
  id           TEXT PRIMARY KEY,            -- receipt token (crypto-random)
  station_id   TEXT NOT NULL,
  station_name TEXT NOT NULL,
  stream_host  TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT 'unspecified',
  comment      TEXT NOT NULL DEFAULT '',
  platform     TEXT NOT NULL DEFAULT 'unknown',
  app_version  TEXT NOT NULL DEFAULT '',
  reason       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'received',  -- received | confirmed | resolved
  resolution   TEXT,                              -- fixed | removed | not-reproducible
  created_at   TEXT NOT NULL,                     -- ISO 8601 UTC
  resolved_at  TEXT,
  github_issue INTEGER                            -- linked issue in MarkusSteinbrecher/rrradio
);

CREATE INDEX idx_broken_reports_station_category ON broken_reports (station_id, category);
CREATE INDEX idx_broken_reports_status ON broken_reports (status);
CREATE INDEX idx_broken_reports_github_issue ON broken_reports (github_issue);

-- Ingest rate limiting. Keyed by a daily-salted SHA-256 of the client
-- IP — not reversible without the salt, not linkable across days, and
-- rows for previous days are purged on the next ingest. This table is
-- rate-limit state only; it is never joined against broken_reports.
CREATE TABLE report_rate (
  ip_hash TEXT NOT NULL,
  day     TEXT NOT NULL,                          -- YYYY-MM-DD UTC
  count   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_hash, day)
);
