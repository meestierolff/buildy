-- ---------------------------------------------------------------------------
-- 1. Restrict INSERT policies on follows and user_follows to status = 'pending'
--    This prevents users from inserting status = 'accepted' directly.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "RPC creates own project follows" ON public.follows;
DROP POLICY IF EXISTS "Users can follow or request to follow any project" ON public.follows;
CREATE POLICY "RPC creates own project follows"
ON public.follows FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id AND status = 'pending');

DROP POLICY IF EXISTS "RPC creates own user follows" ON public.user_follows;
DROP POLICY IF EXISTS "Users can follow others" ON public.user_follows;
CREATE POLICY "RPC creates own user follows"
ON public.user_follows FOR INSERT TO authenticated
WITH CHECK (auth.uid() = follower_id AND status = 'pending');

-- ---------------------------------------------------------------------------
-- 2. Update notification trigger functions to include actor display_name in
--    notification messages for user and project follow requests/approvals.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_user_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_name text;
  target_name text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT p.display_name INTO actor_name FROM public.profiles p WHERE p.user_id = NEW.follower_id;
    IF NEW.status = 'pending' THEN
      INSERT INTO public.notifications (user_id, type, actor_id, message)
      VALUES (NEW.following_id, 'user_follow_request', NEW.follower_id,
              COALESCE(actor_name, 'Iemand') || ' wil je volgen');
    ELSE
      INSERT INTO public.notifications (user_id, type, actor_id, message)
      VALUES (NEW.following_id, 'new_user_follower', NEW.follower_id,
              COALESCE(actor_name, 'Iemand') || ' volgt je nu');
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT p.display_name INTO target_name FROM public.profiles p WHERE p.user_id = NEW.following_id;
    INSERT INTO public.notifications (user_id, type, actor_id, message)
    VALUES (NEW.follower_id, 'user_follow_accepted', NEW.following_id,
            COALESCE(target_name, 'Iemand') || ' heeft je volgverzoek goedgekeurd');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_on_project_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  owner uuid;
  trip_title text;
  actor_name text;
  owner_name text;
BEGIN
  SELECT user_id, title INTO owner, trip_title FROM public.trips WHERE id = NEW.project_id;
  IF owner IS NULL OR owner = NEW.user_id THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT p.display_name INTO actor_name FROM public.profiles p WHERE p.user_id = NEW.user_id;
    IF NEW.status = 'pending' THEN
      INSERT INTO public.notifications (user_id, type, project_id, actor_id, message)
      VALUES (owner, 'follow_request', NEW.project_id, NEW.user_id,
              COALESCE(actor_name, 'Iemand') || ' vraagt toegang tot ' || COALESCE(trip_title, 'je project'));
    ELSE
      INSERT INTO public.notifications (user_id, type, project_id, actor_id, message)
      VALUES (owner, 'new_follower', NEW.project_id, NEW.user_id,
              COALESCE(actor_name, 'Iemand') || ' volgt nu ' || COALESCE(trip_title, 'je project'));
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    SELECT p.display_name INTO owner_name FROM public.profiles p WHERE p.user_id = owner;
    INSERT INTO public.notifications (user_id, type, project_id, actor_id, message)
    VALUES (NEW.user_id, 'follow_accepted', NEW.project_id, owner,
            COALESCE(owner_name, 'De eigenaar') || ' heeft je verzoek voor ' || COALESCE(trip_title, 'het project') || ' goedgekeurd');
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_on_user_follow() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_project_follow() FROM PUBLIC, anon, authenticated;
