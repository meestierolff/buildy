ALTER TABLE public.photobook_settings
  ADD COLUMN IF NOT EXISTS step_layout_overrides JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS step_photo_order JSONB NOT NULL DEFAULT '{}';

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS floorplans JSONB NOT NULL DEFAULT '[]';

ALTER TABLE public.steps
  ADD COLUMN IF NOT EXISTS floorplan_id TEXT;