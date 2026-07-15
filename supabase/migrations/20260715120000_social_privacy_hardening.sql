-- Social access is deliberately split in two:
--   * user_follows controls profile/social-feed relationships;
--   * follows controls access to one specific project.
-- A user follow must never grant access to private projects.

-- ---------------------------------------------------------------------------
-- Referential integrity for the social tables (NOT VALID preserves legacy
-- rows while still enforcing every new write).
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_project_id_fkey') THEN
    ALTER TABLE public.follows
      ADD CONSTRAINT follows_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.trips(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'follows_user_id_fkey') THEN
    ALTER TABLE public.follows
      ADD CONSTRAINT follows_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_follows_follower_id_fkey') THEN
    ALTER TABLE public.user_follows
      ADD CONSTRAINT user_follows_follower_id_fkey
      FOREIGN KEY (follower_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_follows_following_id_fkey') THEN
    ALTER TABLE public.user_follows
      ADD CONSTRAINT user_follows_following_id_fkey
      FOREIGN KEY (following_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reactions_step_id_fkey') THEN
    ALTER TABLE public.reactions
      ADD CONSTRAINT reactions_step_id_fkey
      FOREIGN KEY (step_id) REFERENCES public.steps(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reactions_user_id_fkey') THEN
    ALTER TABLE public.reactions
      ADD CONSTRAINT reactions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_parent_id_fkey') THEN
    ALTER TABLE public.comments
      ADD CONSTRAINT comments_parent_id_fkey
      FOREIGN KEY (parent_id) REFERENCES public.comments(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_user_id_fkey') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_actor_id_fkey') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_actor_id_fkey
      FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_project_id_fkey') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_project_id_fkey
      FOREIGN KEY (project_id) REFERENCES public.trips(id) ON DELETE CASCADE NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_step_id_fkey') THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_step_id_fkey
      FOREIGN KEY (step_id) REFERENCES public.steps(id) ON DELETE CASCADE NOT VALID;
  END IF;
END
$$;

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_content_length_check;
ALTER TABLE public.comments
  ADD CONSTRAINT comments_content_length_check
  CHECK (char_length(btrim(content)) BETWEEN 1 AND 2000) NOT VALID;

ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_mentions_limit_check;
ALTER TABLE public.comments
  ADD CONSTRAINT comments_mentions_limit_check
  CHECK (COALESCE(cardinality(mentions), 0) <= 10) NOT VALID;

ALTER TABLE public.reactions DROP CONSTRAINT IF EXISTS reactions_supported_emoji_check;
ALTER TABLE public.reactions
  ADD CONSTRAINT reactions_supported_emoji_check
  CHECK (emoji = ANY (ARRAY['👍','❤️','🔥','🎉','👏','😍'])) NOT VALID;

-- Private trip-level visual assets keep a stable storage path in the row; the
-- client resolves that path to a short-lived signed URL at render/export time.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS cover_storage_path text,
  ADD COLUMN IF NOT EXISTS floorplan_storage_path text;

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_cover_storage_path_check;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_cover_storage_path_check CHECK (
    cover_storage_path IS NULL
    OR cover_storage_path LIKE user_id::text || '/trip-assets/' || id::text || '/covers/%'
  ) NOT VALID;

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_floorplan_storage_path_check;
ALTER TABLE public.trips
  ADD CONSTRAINT trips_floorplan_storage_path_check CHECK (
    floorplan_storage_path IS NULL
    OR floorplan_storage_path LIKE user_id::text || '/trip-assets/' || id::text || '/floorplans/%'
  ) NOT VALID;

-- ---------------------------------------------------------------------------
-- Non-recursive, SECURITY DEFINER access helpers. These return booleans only
-- and are safe for anon RLS evaluation on public projects.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_view_trip(_viewer_id uuid, _trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trips t
    WHERE t.id = _trip_id
      AND (
        t.is_public = true
        OR t.user_id = _viewer_id
        OR EXISTS (
          SELECT 1
          FROM public.follows f
          WHERE f.project_id = t.id
            AND f.user_id = _viewer_id
            AND f.status = 'accepted'
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.user_can_view_trip(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.can_view_trip(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.user_can_view_trip(auth.uid(), _trip_id)
$$;

CREATE OR REPLACE FUNCTION public.can_view_step(_step_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.steps s
    WHERE s.id = _step_id
      AND public.user_can_view_trip(auth.uid(), s.trip_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.can_view_budget(_trip_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.trips t
    WHERE t.id = _trip_id
      AND (
        t.user_id = auth.uid()
        OR (t.budget_public = true AND public.user_can_view_trip(auth.uid(), t.id))
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_trip(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_step(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_budget(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_trip(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_step(uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_budget(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "Public trips are viewable by everyone" ON public.trips;
DROP POLICY IF EXISTS "Trips viewable with project access" ON public.trips;
CREATE POLICY "Trips viewable with project access"
ON public.trips FOR SELECT
USING (public.can_view_trip(id));

-- Full private profiles are visible only to their owner and accepted profile
-- followers. This relationship does not confer project access.
CREATE OR REPLACE FUNCTION public.can_view_profile(_profile_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.user_id = _profile_user_id
      AND (
        p.is_private = false
        OR p.user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.user_follows uf
          WHERE uf.following_id = p.user_id
            AND uf.follower_id = auth.uid()
            AND uf.status = 'accepted'
        )
      )
  )
$$;

REVOKE ALL ON FUNCTION public.can_view_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid) TO anon, authenticated;

DROP POLICY IF EXISTS "Profiles are publicly viewable" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by owner or when public" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by self, public or accepted follower" ON public.profiles;
DROP POLICY IF EXISTS "Public or owner profiles are viewable" ON public.profiles;
DROP POLICY IF EXISTS "Profiles visible with social access" ON public.profiles;
CREATE POLICY "Profiles visible with social access"
ON public.profiles FOR SELECT
USING (public.can_view_profile(user_id));

-- Public discovery never enumerates private profiles. Known profile IDs may
-- still be resolved to minimal name/avatar data for comments and follow lists.
CREATE OR REPLACE FUNCTION public.search_profiles(
  _q text,
  _limit integer DEFAULT 30,
  _offset integer DEFAULT 0
)
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, is_private boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.user_id, p.display_name, p.avatar_url, p.is_private
  FROM public.profiles p
  WHERE public.can_view_profile(p.user_id)
    AND (_q IS NULL OR btrim(_q) = '' OR p.display_name ILIKE '%' || btrim(_q) || '%')
  ORDER BY p.display_name ASC NULLS LAST, p.user_id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 30), 1), 50)
  OFFSET LEAST(GREATEST(COALESCE(_offset, 0), 0), 1000)
$$;

CREATE OR REPLACE FUNCTION public.get_profiles_basic(_ids uuid[])
RETURNS TABLE(user_id uuid, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.user_id, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id = ANY(COALESCE(_ids[1:100], ARRAY[]::uuid[]))
$$;

REVOKE ALL ON FUNCTION public.search_profiles(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_profiles_basic(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_profiles(text, integer, integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_profiles_basic(uuid[]) TO anon, authenticated;

-- Accepted social relationships are visible only when both endpoint profiles
-- are visible. Pending requests remain participant-only.
DROP POLICY IF EXISTS "Users can view their own follow relationships" ON public.user_follows;
DROP POLICY IF EXISTS "Authenticated users can view user follows" ON public.user_follows;
DROP POLICY IF EXISTS "User follows are viewable by everyone" ON public.user_follows;
DROP POLICY IF EXISTS "Visible accepted user follows" ON public.user_follows;
CREATE POLICY "Visible accepted user follows"
ON public.user_follows FOR SELECT
USING (
  auth.uid() = follower_id
  OR auth.uid() = following_id
  OR (
    status = 'accepted'
    AND (
      public.can_view_profile(follower_id)
      AND public.can_view_profile(following_id)
    )
  )
);

DROP POLICY IF EXISTS "Follows readable by owner, project owner or public trip" ON public.follows;
DROP POLICY IF EXISTS "Follows readable by owner of follow or project owner" ON public.follows;
DROP POLICY IF EXISTS "Project follows visible to participants and viewers" ON public.follows;
CREATE POLICY "Project follows visible to participants and viewers"
ON public.follows FOR SELECT
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = follows.project_id AND t.user_id = auth.uid()
  )
  OR (status = 'accepted' AND public.can_view_trip(project_id))
);

-- ---------------------------------------------------------------------------
-- Every follow request goes through narrowly-scoped RPCs. Trigger functions
-- recompute status and immutable-identity triggers prevent row reassignment.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_project_follow_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  project_public boolean;
  project_owner uuid;
BEGIN
  SELECT t.is_public, t.user_id
    INTO project_public, project_owner
  FROM public.trips t
  WHERE t.id = NEW.project_id;

  IF project_owner IS NULL THEN
    RAISE EXCEPTION 'Project bestaat niet';
  END IF;
  IF project_owner = NEW.user_id THEN
    RAISE EXCEPTION 'Eigenaar kan eigen project niet volgen';
  END IF;

  NEW.status := CASE WHEN project_public THEN 'accepted' ELSE 'pending' END;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.set_user_follow_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  profile_private boolean;
BEGIN
  IF NEW.follower_id = NEW.following_id THEN
    RAISE EXCEPTION 'Je kunt jezelf niet volgen';
  END IF;

  SELECT p.is_private
    INTO profile_private
  FROM public.profiles p
  WHERE p.user_id = NEW.following_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profiel bestaat niet';
  END IF;

  NEW.status := CASE WHEN profile_private THEN 'pending' ELSE 'accepted' END;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.prevent_follow_identity_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_TABLE_NAME = 'follows' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.project_id IS DISTINCT FROM OLD.project_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Volgrelatie kan niet worden verplaatst';
    END IF;
  ELSE
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.follower_id IS DISTINCT FROM OLD.follower_id
      OR NEW.following_id IS DISTINCT FROM OLD.following_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Volgrelatie kan niet worden verplaatst';
    END IF;
  END IF;

  IF OLD.status = 'accepted' AND NEW.status <> 'accepted' THEN
    RAISE EXCEPTION 'Een geaccepteerde relatie kan alleen worden verwijderd';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_set_project_follow_status ON public.follows;
CREATE TRIGGER trg_set_project_follow_status
BEFORE INSERT ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.set_project_follow_status();

DROP TRIGGER IF EXISTS trg_prevent_project_follow_identity_changes ON public.follows;
CREATE TRIGGER trg_prevent_project_follow_identity_changes
BEFORE UPDATE ON public.follows
FOR EACH ROW EXECUTE FUNCTION public.prevent_follow_identity_changes();

DROP TRIGGER IF EXISTS trg_set_user_follow_status ON public.user_follows;
CREATE TRIGGER trg_set_user_follow_status
BEFORE INSERT ON public.user_follows
FOR EACH ROW EXECUTE FUNCTION public.set_user_follow_status();

DROP TRIGGER IF EXISTS trg_prevent_user_follow_identity_changes ON public.user_follows;
CREATE TRIGGER trg_prevent_user_follow_identity_changes
BEFORE UPDATE ON public.user_follows
FOR EACH ROW EXECUTE FUNCTION public.prevent_follow_identity_changes();

-- A request cannot remain "pending" once its project is public. Existing
-- accepted followers deliberately retain access when a project becomes
-- private again; the owner can remove them in the access manager.
CREATE OR REPLACE FUNCTION public.accept_project_follows_when_public()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_public = true AND OLD.is_public = false THEN
    UPDATE public.follows
    SET status = 'accepted'
    WHERE project_id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_accept_project_follows_when_public ON public.trips;
CREATE TRIGGER trg_accept_project_follows_when_public
AFTER UPDATE OF is_public ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.accept_project_follows_when_public();

REVOKE ALL ON FUNCTION public.accept_project_follows_when_public() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.request_project_follow(_project_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requester uuid := auth.uid();
  result_status text;
BEGIN
  IF requester IS NULL THEN
    RAISE EXCEPTION 'Log in om een project te volgen';
  END IF;

  INSERT INTO public.follows (user_id, project_id, status)
  VALUES (requester, _project_id, 'pending')
  ON CONFLICT (user_id, project_id) DO NOTHING;

  SELECT f.status INTO result_status
  FROM public.follows f
  WHERE f.user_id = requester AND f.project_id = _project_id;

  IF result_status IS NULL THEN
    RAISE EXCEPTION 'Volgverzoek kon niet worden opgeslagen';
  END IF;
  RETURN result_status;
END
$$;

CREATE OR REPLACE FUNCTION public.request_user_follow(_following_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  requester uuid := auth.uid();
  result_status text;
BEGIN
  IF requester IS NULL THEN
    RAISE EXCEPTION 'Log in om iemand te volgen';
  END IF;

  INSERT INTO public.user_follows (follower_id, following_id, status)
  VALUES (requester, _following_id, 'pending')
  ON CONFLICT (follower_id, following_id) DO NOTHING;

  SELECT uf.status INTO result_status
  FROM public.user_follows uf
  WHERE uf.follower_id = requester AND uf.following_id = _following_id;

  IF result_status IS NULL THEN
    RAISE EXCEPTION 'Volgverzoek kon niet worden opgeslagen';
  END IF;
  RETURN result_status;
END
$$;

CREATE OR REPLACE FUNCTION public.respond_to_project_follow(
  _project_id uuid,
  _follower_id uuid,
  _accept boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  responder uuid := auth.uid();
BEGIN
  IF responder IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = _project_id AND t.user_id = responder
  ) THEN
    RAISE EXCEPTION 'Alleen de projecteigenaar kan dit verzoek behandelen';
  END IF;

  IF _accept THEN
    UPDATE public.follows f
    SET status = 'accepted'
    WHERE f.project_id = _project_id
      AND f.user_id = _follower_id
      AND f.status = 'pending';
  ELSE
    DELETE FROM public.follows f
    WHERE f.project_id = _project_id
      AND f.user_id = _follower_id
      AND f.status = 'pending';
  END IF;
  RETURN FOUND;
END
$$;

CREATE OR REPLACE FUNCTION public.respond_to_user_follow(
  _follower_id uuid,
  _accept boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  responder uuid := auth.uid();
BEGIN
  IF responder IS NULL THEN
    RAISE EXCEPTION 'Log in om dit verzoek te behandelen';
  END IF;

  IF _accept THEN
    UPDATE public.user_follows uf
    SET status = 'accepted'
    WHERE uf.follower_id = _follower_id
      AND uf.following_id = responder
      AND uf.status = 'pending';
  ELSE
    DELETE FROM public.user_follows uf
    WHERE uf.follower_id = _follower_id
      AND uf.following_id = responder
      AND uf.status = 'pending';
  END IF;
  RETURN FOUND;
END
$$;

REVOKE INSERT, UPDATE ON public.follows FROM authenticated;
REVOKE INSERT, UPDATE ON public.user_follows FROM authenticated;
REVOKE ALL ON FUNCTION public.request_project_follow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_user_follow(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_to_project_follow(uuid, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.respond_to_user_follow(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_project_follow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_user_follow(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_project_follow(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_user_follow(uuid, boolean) TO authenticated;

DROP POLICY IF EXISTS "Users can follow or request to follow any project" ON public.follows;
DROP POLICY IF EXISTS "RPC creates own project follows" ON public.follows;
CREATE POLICY "RPC creates own project follows"
ON public.follows FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can follow others" ON public.user_follows;
DROP POLICY IF EXISTS "RPC creates own user follows" ON public.user_follows;
CREATE POLICY "RPC creates own user follows"
ON public.user_follows FOR INSERT TO authenticated
WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Project owners can approve follow requests" ON public.follows;
DROP POLICY IF EXISTS "Project owners can approve pending follows" ON public.follows;
CREATE POLICY "Project owners can approve pending follows"
ON public.follows FOR UPDATE TO authenticated
USING (
  status = 'pending'
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = follows.project_id AND t.user_id = auth.uid()
  )
)
WITH CHECK (
  status = 'accepted'
  AND EXISTS (
    SELECT 1 FROM public.trips t
    WHERE t.id = follows.project_id AND t.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Followee can approve user follow requests" ON public.user_follows;
DROP POLICY IF EXISTS "Followee can approve pending user follows" ON public.user_follows;
CREATE POLICY "Followee can approve pending user follows"
ON public.user_follows FOR UPDATE TO authenticated
USING (auth.uid() = following_id AND status = 'pending')
WITH CHECK (auth.uid() = following_id AND status = 'accepted');

-- Trigger functions are internal; PostgreSQL triggers do not require callers
-- to have EXECUTE on their functions.
REVOKE ALL ON FUNCTION public.set_project_follow_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_user_follow_status() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_follow_identity_changes() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Comments/reactions: immutable ownership, bounded input and owner moderation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_comment_thread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  parent_step uuid;
  parent_parent uuid;
BEGIN
  NEW.content := btrim(NEW.content);
  NEW.mentions := ARRAY(
    SELECT DISTINCT candidate.mention_id
    FROM unnest(COALESCE(NEW.mentions, ARRAY[]::uuid[])) AS candidate(mention_id)
    JOIN public.profiles p ON p.user_id = candidate.mention_id
    WHERE candidate.mention_id IS NOT NULL
    LIMIT 10
  );

  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.step_id, c.parent_id
      INTO parent_step, parent_parent
    FROM public.comments c
    WHERE c.id = NEW.parent_id;

    IF parent_step IS NULL OR parent_step <> NEW.step_id THEN
      RAISE EXCEPTION 'Antwoord hoort niet bij deze update';
    END IF;
    IF parent_parent IS NOT NULL THEN
      RAISE EXCEPTION 'Meer dan één antwoordniveau is niet toegestaan';
    END IF;
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_validate_comment_thread ON public.comments;
CREATE TRIGGER trg_validate_comment_thread
BEFORE INSERT OR UPDATE OF content, mentions, parent_id, step_id ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.validate_comment_thread();

DROP POLICY IF EXISTS "Users can update their own comments" ON public.comments;
DROP POLICY IF EXISTS "Users can update own comments" ON public.comments;
REVOKE UPDATE ON public.comments FROM authenticated;
REVOKE UPDATE ON public.reactions FROM authenticated;

DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;
DROP POLICY IF EXISTS "Comment author or project owner can delete" ON public.comments;
CREATE POLICY "Comment author or project owner can delete"
ON public.comments FOR DELETE TO authenticated
USING (
  auth.uid() = user_id
  OR EXISTS (
    SELECT 1
    FROM public.steps s
    JOIN public.trips t ON t.id = s.trip_id
    WHERE s.id = comments.step_id AND t.user_id = auth.uid()
  )
);

REVOKE ALL ON FUNCTION public.validate_comment_thread() FROM PUBLIC, anon, authenticated;

-- Notify project followers and followers of the builder, but only the latter
-- for public projects. UNION prevents duplicate notifications.
CREATE OR REPLACE FUNCTION public.notify_followers_on_step()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  trip_title text;
  trip_owner uuid;
  trip_public boolean;
BEGIN
  SELECT t.title, t.user_id, t.is_public
    INTO trip_title, trip_owner, trip_public
  FROM public.trips t
  WHERE t.id = NEW.trip_id;

  INSERT INTO public.notifications (user_id, type, project_id, step_id, actor_id, message)
  SELECT audience.user_id, 'new_step', NEW.trip_id, NEW.id, NEW.user_id,
         'Nieuwe update in ' || COALESCE(trip_title, 'een project')
  FROM (
    SELECT f.user_id
    FROM public.follows f
    WHERE f.project_id = NEW.trip_id AND f.status = 'accepted'
    UNION
    SELECT uf.follower_id
    FROM public.user_follows uf
    WHERE trip_public = true
      AND uf.following_id = trip_owner
      AND uf.status = 'accepted'
  ) AS audience
  WHERE audience.user_id <> NEW.user_id;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  step_owner uuid;
  step_trip uuid;
  parent_author uuid;
BEGIN
  SELECT s.user_id, s.trip_id
    INTO step_owner, step_trip
  FROM public.steps s
  WHERE s.id = NEW.step_id;

  IF NEW.parent_id IS NOT NULL THEN
    SELECT c.user_id INTO parent_author
    FROM public.comments c
    WHERE c.id = NEW.parent_id;
  END IF;

  INSERT INTO public.notifications (user_id, type, project_id, step_id, actor_id, message)
  SELECT DISTINCT ON (candidate.user_id)
         candidate.user_id,
         candidate.type,
         step_trip,
         NEW.step_id,
         NEW.user_id,
         candidate.message
  FROM (
    SELECT parent_author AS user_id, 'reply'::text AS type,
           'Nieuw antwoord op je reactie'::text AS message, 1 AS priority
    WHERE parent_author IS NOT NULL
    UNION ALL
    SELECT mention.mention_id, 'mention', 'Je bent genoemd in een reactie', 2
    FROM unnest(COALESCE(NEW.mentions, ARRAY[]::uuid[])) AS mention(mention_id)
    UNION ALL
    SELECT step_owner, 'comment', 'Nieuwe reactie op je update', 3
    WHERE step_owner IS NOT NULL
  ) AS candidate
  WHERE candidate.user_id <> NEW.user_id
    AND public.user_can_view_trip(candidate.user_id, step_trip)
  ORDER BY candidate.user_id, candidate.priority;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_notify_followers_on_step ON public.steps;
CREATE TRIGGER trg_notify_followers_on_step
AFTER INSERT ON public.steps
FOR EACH ROW EXECUTE FUNCTION public.notify_followers_on_step();

DROP TRIGGER IF EXISTS trg_notify_on_comment ON public.comments;
CREATE TRIGGER trg_notify_on_comment
AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();

REVOKE ALL ON FUNCTION public.notify_followers_on_step() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_comment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_project_follow() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_on_user_follow() FROM PUBLIC, anon, authenticated;

-- Private project metadata is not disclosed before a request exists.
CREATE OR REPLACE FUNCTION public.get_trip_access_info(_trip_id uuid)
RETURNS TABLE(trip_exists boolean, is_public boolean, owner_id uuid, title text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT true,
         t.is_public,
         CASE
           WHEN t.is_public
             OR t.user_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.follows f
               WHERE f.project_id = t.id AND f.user_id = auth.uid()
             )
           THEN t.user_id
           ELSE NULL
         END,
         CASE
           WHEN t.is_public
             OR t.user_id = auth.uid()
             OR EXISTS (
               SELECT 1 FROM public.follows f
               WHERE f.project_id = t.id AND f.user_id = auth.uid()
             )
           THEN t.title
           ELSE NULL
         END
  FROM public.trips t
  WHERE t.id = _trip_id
  UNION ALL
  SELECT false, NULL::boolean, NULL::uuid, NULL::text
  WHERE NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = _trip_id)
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.get_trip_access_info(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_trip_access_info(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- Storage: make the missing private bucket reproducible and bind every new
-- private upload to a step owned by the uploader. Legacy public assets remain
-- in trip-media for backward compatibility and print delivery.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'trip-private',
  'trip-private',
  false,
  104857600,
  ARRAY[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
    'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "trip-private: owner can read" ON storage.objects;
CREATE POLICY "trip-private: owner can read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "trip-private: viewers of step can read" ON storage.objects;
CREATE POLICY "trip-private: viewers of step can read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'trip-private'
  AND CASE
    WHEN array_length(storage.foldername(name), 1) = 2
      AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN public.can_view_step(((storage.foldername(name))[2])::uuid)
    WHEN array_length(storage.foldername(name), 1) = 4
      AND (storage.foldername(name))[2] = 'trip-assets'
      AND (storage.foldername(name))[3] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND (storage.foldername(name))[4] IN ('covers', 'floorplans')
    THEN public.can_view_trip(((storage.foldername(name))[3])::uuid)
    ELSE false
  END
);

DROP POLICY IF EXISTS "trip-private: public can read for public steps" ON storage.objects;
CREATE POLICY "trip-private: public can read for public steps"
ON storage.objects FOR SELECT TO anon
USING (
  bucket_id = 'trip-private'
  AND CASE
    WHEN array_length(storage.foldername(name), 1) = 2
      AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN public.can_view_step(((storage.foldername(name))[2])::uuid)
    WHEN array_length(storage.foldername(name), 1) = 4
      AND (storage.foldername(name))[2] = 'trip-assets'
      AND (storage.foldername(name))[3] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND (storage.foldername(name))[4] IN ('covers', 'floorplans')
    THEN public.can_view_trip(((storage.foldername(name))[3])::uuid)
    ELSE false
  END
);

DROP POLICY IF EXISTS "trip-private: owner can insert" ON storage.objects;
CREATE POLICY "trip-private: owner can insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND CASE
    WHEN array_length(storage.foldername(name), 1) = 2
      AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','gif','avif','mp4','mov','webm','pdf')
      AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN EXISTS (
      SELECT 1
      FROM public.steps s
      JOIN public.trips t ON t.id = s.trip_id
      WHERE s.id = ((storage.foldername(name))[2])::uuid
        AND t.user_id = auth.uid()
    )
    WHEN array_length(storage.foldername(name), 1) = 4
      AND (storage.foldername(name))[2] = 'trip-assets'
      AND (storage.foldername(name))[3] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND (storage.foldername(name))[4] IN ('covers', 'floorplans')
      AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','gif','avif')
    THEN EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = ((storage.foldername(name))[3])::uuid
        AND t.user_id = auth.uid()
    )
    ELSE false
  END
);

DROP POLICY IF EXISTS "trip-private: owner can update" ON storage.objects;
CREATE POLICY "trip-private: owner can update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND CASE
    WHEN array_length(storage.foldername(name), 1) = 2
      AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','gif','avif','mp4','mov','webm','pdf')
      AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    THEN EXISTS (
      SELECT 1
      FROM public.steps s
      JOIN public.trips t ON t.id = s.trip_id
      WHERE s.id = ((storage.foldername(name))[2])::uuid
        AND t.user_id = auth.uid()
    )
    WHEN array_length(storage.foldername(name), 1) = 4
      AND (storage.foldername(name))[2] = 'trip-assets'
      AND (storage.foldername(name))[3] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      AND (storage.foldername(name))[4] IN ('covers', 'floorplans')
      AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','gif','avif')
    THEN EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = ((storage.foldername(name))[3])::uuid
        AND t.user_id = auth.uid()
    )
    ELSE false
  END
);

DROP POLICY IF EXISTS "trip-private: owner can delete" ON storage.objects;
CREATE POLICY "trip-private: owner can delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Project media is private; trip-media becomes legacy read-only. Avatars use
-- their own constrained public bucket and two alternating deterministic slots,
-- which permits rollback if the profile update fails without becoming a
-- general-purpose public file host.
DROP POLICY IF EXISTS "Users upload to own folder in trip-media" ON storage.objects;
DROP POLICY IF EXISTS "Users upload avatars in trip-media" ON storage.objects;
DROP POLICY IF EXISTS "Users update own folder in trip-media" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own trip media" ON storage.objects;
DROP POLICY IF EXISTS "Users update avatars in trip-media" ON storage.objects;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Public avatar reads" ON storage.objects;
CREATE POLICY "Public avatar reads"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "Users upload own avatar slots" ON storage.objects;
CREATE POLICY "Users upload own avatar slots"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND array_length(storage.foldername(name), 1) = 1
  AND storage.filename(name) ~* '^avatar-[ab]\.(jpg|jpeg|png|webp|gif)$'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid())
  AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','gif')
);

DROP POLICY IF EXISTS "Users update own avatar slots" ON storage.objects;
CREATE POLICY "Users update own avatar slots"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND array_length(storage.foldername(name), 1) = 1
  AND storage.filename(name) ~* '^avatar-[ab]\.(jpg|jpeg|png|webp|gif)$'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid())
)
WITH CHECK (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND array_length(storage.foldername(name), 1) = 1
  AND storage.filename(name) ~* '^avatar-[ab]\.(jpg|jpeg|png|webp|gif)$'
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = auth.uid())
  AND lower(storage.extension(name)) IN ('jpg','jpeg','png','webp','gif')
);

DROP POLICY IF EXISTS "Users delete own avatar slots" ON storage.objects;
CREATE POLICY "Users delete own avatar slots"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'avatars'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND array_length(storage.foldername(name), 1) = 1
  AND storage.filename(name) ~* '^avatar-[ab]\.(jpg|jpeg|png|webp|gif)$'
);
