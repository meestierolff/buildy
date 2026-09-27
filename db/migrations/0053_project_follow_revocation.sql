-- Blocking/removal must also revoke the existing legacy access requests for
-- this exact participant pair. Their ordinary RLS depends on a retired helper;
-- keep it ungranted and perform only the already-authorized revocation here.
CREATE OR REPLACE FUNCTION public.app_revoke_project_follows(target_follower uuid, target_owner uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
  changed_rows integer;
BEGIN
  IF actor_user IS NULL OR target_follower IS NULL OR target_owner IS NULL
     OR actor_user NOT IN (target_follower, target_owner)
     OR NOT EXISTS (
       SELECT 1 FROM public.app_users account
       WHERE account.id = actor_user AND account.status = 'active'
         AND account.deleted_at IS NULL
     ) THEN
    RAISE EXCEPTION 'project follower unavailable' USING ERRCODE = '42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'social:' || least(target_follower, target_owner)::text || ':' || greatest(target_follower, target_owner)::text,
    0
  ));
  UPDATE public.project_access_requests access
  SET status = 'revoked', decided_by_id = actor_user,
      decided_at = statement_timestamp(), revoked_at = statement_timestamp(),
      version = access.version + 1, updated_at = statement_timestamp()
  WHERE access.requester_id = target_follower
    AND access.project_owner_id = target_owner
    AND access.status IN ('pending', 'accepted');

  UPDATE public.project_followers follower
  SET status = 'revoked', updated_at = statement_timestamp()
  WHERE follower.follower_id = target_follower
    AND follower.project_owner_id = target_owner
    AND follower.status IN ('active', 'muted');
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  RETURN changed_rows;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_revoke_project_follows(uuid, uuid) FROM PUBLIC;
