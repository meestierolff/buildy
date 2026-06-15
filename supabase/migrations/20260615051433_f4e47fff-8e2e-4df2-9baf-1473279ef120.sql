
-- 1) Fix can_view_step to include accepted followers
CREATE OR REPLACE FUNCTION public.can_view_step(_step_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.steps s
    JOIN public.trips t ON t.id = s.trip_id
    WHERE s.id = _step_id
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

-- 2) Tighten profiles SELECT policy
DROP POLICY IF EXISTS "Profiles are publicly viewable" ON public.profiles;
DROP POLICY IF EXISTS "Profiles publicly viewable" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable by everyone" ON public.profiles;

CREATE POLICY "Profiles viewable by owner or when public"
ON public.profiles
FOR SELECT
USING (
  is_private = false
  OR auth.uid() = user_id
);

-- 3) Safe RPCs for discovery (return only minimal fields, ignore privacy for name/avatar lookup)
CREATE OR REPLACE FUNCTION public.search_profiles(_q text, _limit int DEFAULT 30, _offset int DEFAULT 0)
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, is_private boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.display_name, p.avatar_url, p.is_private
  FROM public.profiles p
  WHERE (_q IS NULL OR _q = '' OR p.display_name ILIKE '%' || _q || '%')
  ORDER BY p.display_name ASC NULLS LAST
  LIMIT GREATEST(_limit, 1)
  OFFSET GREATEST(_offset, 0)
$$;

GRANT EXECUTE ON FUNCTION public.search_profiles(text, int, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.get_profiles_basic(_ids uuid[])
RETURNS TABLE(user_id uuid, display_name text, avatar_url text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.user_id, p.display_name, p.avatar_url
  FROM public.profiles p
  WHERE p.user_id = ANY(_ids)
$$;

GRANT EXECUTE ON FUNCTION public.get_profiles_basic(uuid[]) TO anon, authenticated;
