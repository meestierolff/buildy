GRANT EXECUTE ON FUNCTION public.can_view_trip(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_view_step(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.can_view_budget(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.get_profiles_basic(uuid[]) TO anon;
GRANT EXECUTE ON FUNCTION public.search_profiles(text, integer, integer) TO anon;