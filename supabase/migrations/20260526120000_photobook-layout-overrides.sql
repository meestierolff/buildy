ALTER TABLE photobook_settings
  ADD COLUMN IF NOT EXISTS step_layout_overrides JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS step_photo_order JSONB NOT NULL DEFAULT '{}';
