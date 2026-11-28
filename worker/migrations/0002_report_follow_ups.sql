-- Follow-ups on an existing report (one open report per station per
-- device). A follow-up is its own row, so triage keeps aggregating by
-- (station_id, category); `parent_id` points at the report it adds to.
-- NULL for a report's first row. The reporter only ever holds the
-- parent's id: status polling answers for the whole family.
ALTER TABLE broken_reports ADD COLUMN parent_id TEXT;

CREATE INDEX idx_broken_reports_parent ON broken_reports (parent_id);
