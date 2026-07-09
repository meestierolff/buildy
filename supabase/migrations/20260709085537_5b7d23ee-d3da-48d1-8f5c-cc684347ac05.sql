
DROP TRIGGER IF EXISTS trg_follows_notify ON public.follows;
DROP TRIGGER IF EXISTS trg_follows_set_status ON public.follows;
DROP TRIGGER IF EXISTS trg_user_follows_notify ON public.user_follows;
DROP TRIGGER IF EXISTS trg_user_follows_set_status ON public.user_follows;
DROP TRIGGER IF EXISTS trg_steps_notify_followers ON public.steps;
DROP TRIGGER IF EXISTS trg_steps_updated_at ON public.steps;
DROP TRIGGER IF EXISTS trg_comments_notify ON public.comments;
DROP TRIGGER IF EXISTS trg_profiles_prevent_privileged ON public.profiles;
DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
DROP TRIGGER IF EXISTS trg_trips_updated_at ON public.trips;
