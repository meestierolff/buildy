-- Support multiple floorplan images per trip (one per floor/verdieping)
-- Each floor is stored as {id, label, url} in a JSONB array
-- Steps reference their floor via floorplan_id (null = first/legacy floor)

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS floorplans JSONB NOT NULL DEFAULT '[]';

ALTER TABLE steps
  ADD COLUMN IF NOT EXISTS floorplan_id TEXT;
