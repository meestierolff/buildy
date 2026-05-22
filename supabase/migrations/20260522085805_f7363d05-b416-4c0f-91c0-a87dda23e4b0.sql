ALTER TABLE public.trips
ADD COLUMN IF NOT EXISTS cover_title_position TEXT NOT NULL DEFAULT 'center';