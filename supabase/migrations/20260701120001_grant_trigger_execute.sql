-- Grant EXECUTE on trigger functions to authenticated users so triggers can fire
GRANT EXECUTE ON FUNCTION public.notify_on_comment() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_project_follow() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_on_user_follow() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_follow_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_project_follow_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.notify_followers_on_step() TO authenticated;
