-- Revoke EXECUTE from anon/authenticated on internal trigger / helper functions
-- that should never be callable through the Data API.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_followers_on_step() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_comment() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_project_follow() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_on_user_follow() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_project_follow_status() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_user_follow_status() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.prevent_profile_privileged_changes() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, PUBLIC;
