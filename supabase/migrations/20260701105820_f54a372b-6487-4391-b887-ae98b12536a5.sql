
CREATE OR REPLACE FUNCTION public.get_trip_access_info(_trip_id uuid)
RETURNS TABLE(trip_exists boolean, is_public boolean, owner_id uuid, title text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT true, t.is_public, t.user_id, t.title
  FROM public.trips t
  WHERE t.id = _trip_id
  UNION ALL
  SELECT false, NULL::boolean, NULL::uuid, NULL::text
  WHERE NOT EXISTS (SELECT 1 FROM public.trips t WHERE t.id = _trip_id)
  LIMIT 1;
$$;

REVOKE EXECUTE ON FUNCTION public.get_trip_access_info(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_trip_access_info(uuid) TO authenticated;
