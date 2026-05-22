ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_pro boolean NOT NULL DEFAULT false;
ALTER TABLE public.step_media ADD COLUMN IF NOT EXISTS compare_role text;
ALTER TABLE public.step_media DROP CONSTRAINT IF EXISTS step_media_compare_role_check;
ALTER TABLE public.step_media ADD CONSTRAINT step_media_compare_role_check CHECK (compare_role IS NULL OR compare_role IN ('before','after'));