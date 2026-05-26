-- Aannemer-info per stap (optioneel)
ALTER TABLE public.steps ADD COLUMN IF NOT EXISTS contractor_name TEXT;
ALTER TABLE public.steps ADD COLUMN IF NOT EXISTS contractor_notes TEXT;
