-- New projects are private by default
ALTER TABLE public.trips ALTER COLUMN is_public SET DEFAULT false;

-- Optional contractor info per step
ALTER TABLE public.steps ADD COLUMN IF NOT EXISTS contractor_name TEXT;
ALTER TABLE public.steps ADD COLUMN IF NOT EXISTS contractor_notes TEXT;

-- Ensure profiles stay publicly findable (so users can discover and follow other builders)
ALTER TABLE public.profiles ALTER COLUMN is_private SET DEFAULT false;