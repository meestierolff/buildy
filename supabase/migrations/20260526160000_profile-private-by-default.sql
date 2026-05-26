-- Profiles are private by default (opt-in to public)
ALTER TABLE public.profiles ALTER COLUMN is_private SET DEFAULT true;

-- Flip all existing profiles to private — users must explicitly choose to be discoverable
UPDATE public.profiles SET is_private = true;
