-- Restore anon EXECUTE grants that 20260616080704 revoked too aggressively.
--
-- RLS policies on steps / step_media / step_budget call these helper functions
-- as the querying role. Revoking EXECUTE from anon made every anonymous SELECT
-- fail with "permission denied for function can_view_trip" — including rows of
-- public projects, which broke the logged-out discover feed and public project
-- pages. auth.uid() is NULL for anon, so the functions correctly fall back to
-- is_public = true; granting anon does not expose private data.
GRANT EXECUTE ON FUNCTION public.can_view_trip(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_view_step(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_view_budget(uuid) TO anon;

-- Discovery RPCs: SECURITY DEFINER by design, returning only minimal public
-- fields (user_id, display_name, avatar_url). Needed by the public homepage
-- feed and project pages to show project owners to logged-out visitors.
GRANT EXECUTE ON FUNCTION public.get_profiles_basic(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.search_profiles(text, integer, integer) TO anon;
