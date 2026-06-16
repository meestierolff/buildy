
-- Revoke public EXECUTE on SECURITY DEFINER functions that are only used by triggers
-- (these don't need to be callable by users via the API)

REVOKE EXECUTE ON FUNCTION public.notify_followers_on_step() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_comment() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_project_follow() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_user_follow() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_follow_status() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_project_follow_status() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privileged_changes() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, PUBLIC;

-- RLS helper functions: only authenticated users should call them (they evaluate auth.uid())
REVOKE EXECUTE ON FUNCTION public.can_view_trip(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_step(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_view_budget(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_view_trip(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_step(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_budget(uuid) TO authenticated;

-- Profile RPCs called from the client by signed-in users only
REVOKE EXECUTE ON FUNCTION public.get_profiles_basic(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_profiles(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_basic(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_profiles(text, integer, integer) TO authenticated;
