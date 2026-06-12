
-- 1) Profiles: private by default
ALTER TABLE public.profiles ALTER COLUMN is_private SET DEFAULT true;

-- 2) Add status to follows + user_follows ('pending' | 'accepted')
ALTER TABLE public.follows ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.follows DROP CONSTRAINT IF EXISTS follows_status_check;
ALTER TABLE public.follows ADD CONSTRAINT follows_status_check CHECK (status IN ('pending','accepted'));
UPDATE public.follows SET status = 'accepted' WHERE status <> 'accepted';

ALTER TABLE public.user_follows ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending';
ALTER TABLE public.user_follows DROP CONSTRAINT IF EXISTS user_follows_status_check;
ALTER TABLE public.user_follows ADD CONSTRAINT user_follows_status_check CHECK (status IN ('pending','accepted'));
UPDATE public.user_follows SET status = 'accepted' WHERE status <> 'accepted';

-- 3) Triggers to auto-decide status on insert based on target privacy
CREATE OR REPLACE FUNCTION public.set_project_follow_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pub boolean;
  owner uuid;
BEGIN
  SELECT is_public, user_id INTO pub, owner FROM public.trips WHERE id = NEW.project_id;
  IF owner IS NULL THEN
    RAISE EXCEPTION 'Project bestaat niet';
  END IF;
  IF owner = NEW.user_id THEN
    RAISE EXCEPTION 'Eigenaar kan eigen project niet volgen';
  END IF;
  IF pub THEN
    NEW.status := 'accepted';
  ELSE
    NEW.status := 'pending';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_project_follow_status ON public.follows;
CREATE TRIGGER trg_set_project_follow_status
BEFORE INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.set_project_follow_status();

CREATE OR REPLACE FUNCTION public.set_user_follow_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  priv boolean;
BEGIN
  IF NEW.follower_id = NEW.following_id THEN
    RAISE EXCEPTION 'Je kunt jezelf niet volgen';
  END IF;
  SELECT is_private INTO priv FROM public.profiles WHERE user_id = NEW.following_id;
  IF priv IS NULL OR priv = true THEN
    NEW.status := 'pending';
  ELSE
    NEW.status := 'accepted';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_user_follow_status ON public.user_follows;
CREATE TRIGGER trg_set_user_follow_status
BEFORE INSERT ON public.user_follows
FOR EACH ROW EXECUTE FUNCTION public.set_user_follow_status();

-- 4) Notification triggers for follow requests + acceptance
CREATE OR REPLACE FUNCTION public.notify_on_project_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner uuid;
  trip_title text;
BEGIN
  SELECT user_id, title INTO owner, trip_title FROM public.trips WHERE id = NEW.project_id;
  IF owner IS NULL OR owner = NEW.user_id THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      INSERT INTO public.notifications (user_id, type, project_id, actor_id, message)
      VALUES (owner, 'follow_request', NEW.project_id, NEW.user_id,
              'Nieuw volgverzoek voor ' || COALESCE(trip_title,'je project'));
    ELSE
      INSERT INTO public.notifications (user_id, type, project_id, actor_id, message)
      VALUES (owner, 'new_follower', NEW.project_id, NEW.user_id,
              'Je hebt een nieuwe volger op ' || COALESCE(trip_title,'je project'));
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO public.notifications (user_id, type, project_id, actor_id, message)
    VALUES (NEW.user_id, 'follow_accepted', NEW.project_id, owner,
            'Je volgverzoek voor ' || COALESCE(trip_title,'een project') || ' is goedgekeurd');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_project_follow_ins ON public.follows;
CREATE TRIGGER trg_notify_project_follow_ins
AFTER INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.notify_on_project_follow();

DROP TRIGGER IF EXISTS trg_notify_project_follow_upd ON public.follows;
CREATE TRIGGER trg_notify_project_follow_upd
AFTER UPDATE ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.notify_on_project_follow();

CREATE OR REPLACE FUNCTION public.notify_on_user_follow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'pending' THEN
      INSERT INTO public.notifications (user_id, type, actor_id, message)
      VALUES (NEW.following_id, 'user_follow_request', NEW.follower_id, 'Nieuw volgverzoek');
    ELSE
      INSERT INTO public.notifications (user_id, type, actor_id, message)
      VALUES (NEW.following_id, 'new_user_follower', NEW.follower_id, 'Je hebt een nieuwe volger');
    END IF;
  ELSIF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
    INSERT INTO public.notifications (user_id, type, actor_id, message)
    VALUES (NEW.follower_id, 'user_follow_accepted', NEW.following_id, 'Je volgverzoek is goedgekeurd');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_user_follow_ins ON public.user_follows;
CREATE TRIGGER trg_notify_user_follow_ins
AFTER INSERT ON public.user_follows
FOR EACH ROW EXECUTE FUNCTION public.notify_on_user_follow();

DROP TRIGGER IF EXISTS trg_notify_user_follow_upd ON public.user_follows;
CREATE TRIGGER trg_notify_user_follow_upd
AFTER UPDATE ON public.user_follows
FOR EACH ROW EXECUTE FUNCTION public.notify_on_user_follow();

-- 5) Update can_view_trip: accepted follower can view private projects
CREATE OR REPLACE FUNCTION public.can_view_trip(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = _trip_id
      AND (
        t.is_public = true
        OR t.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.project_id = t.id
            AND f.user_id = auth.uid()
            AND f.status = 'accepted'
        )
      )
  )
$$;

-- 6) Update notify_followers_on_step to only notify accepted followers
CREATE OR REPLACE FUNCTION public.notify_followers_on_step()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  trip_title text;
BEGIN
  SELECT title INTO trip_title FROM public.trips WHERE id = NEW.trip_id;
  INSERT INTO public.notifications (user_id, type, project_id, step_id, actor_id, message)
  SELECT f.user_id, 'new_step', NEW.trip_id, NEW.id, NEW.user_id,
         'Nieuwe update in ' || COALESCE(trip_title, 'een project')
  FROM public.follows f
  WHERE f.project_id = NEW.trip_id
    AND f.user_id <> NEW.user_id
    AND f.status = 'accepted';
  RETURN NEW;
END;
$$;

-- 7) Profiles SELECT policy: allow if not private, self, or accepted user-follower
DROP POLICY IF EXISTS "Public or owner profiles are viewable" ON public.profiles;
CREATE POLICY "Profiles viewable by self, public or accepted follower"
ON public.profiles FOR SELECT
USING (
  is_private = false
  OR auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.user_follows uf
    WHERE uf.following_id = profiles.user_id
      AND uf.follower_id = auth.uid()
      AND uf.status = 'accepted'
  )
);

-- 8) Follows INSERT policy: allow request for any existing project (trigger sets status)
DROP POLICY IF EXISTS "Users can follow visible projects" ON public.follows;
CREATE POLICY "Users can follow or request to follow any project"
ON public.follows FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = project_id)
);

-- 9) Follows UPDATE policy: project owner can approve (set status='accepted')
DROP POLICY IF EXISTS "Project owners can approve follow requests" ON public.follows;
CREATE POLICY "Project owners can approve follow requests"
ON public.follows FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = project_id AND t.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = project_id AND t.user_id = auth.uid()));

-- 10) Follows DELETE policy: follower OR project owner can delete (reject = delete)
DROP POLICY IF EXISTS "Users can unfollow" ON public.follows;
CREATE POLICY "Follower or project owner can remove follow"
ON public.follows FOR DELETE
USING (
  auth.uid() = user_id
  OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = project_id AND t.user_id = auth.uid())
);

-- 11) user_follows UPDATE policy: followee can approve
DROP POLICY IF EXISTS "Followee can approve user follow requests" ON public.user_follows;
CREATE POLICY "Followee can approve user follow requests"
ON public.user_follows FOR UPDATE
USING (auth.uid() = following_id)
WITH CHECK (auth.uid() = following_id);

-- 12) user_follows DELETE policy: follower OR followee can remove
DROP POLICY IF EXISTS "Users can unfollow" ON public.user_follows;
CREATE POLICY "Follower or followee can remove user follow"
ON public.user_follows FOR DELETE
USING (auth.uid() = follower_id OR auth.uid() = following_id);
