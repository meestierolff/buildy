-- Canonical, actor-scoped connection lists. The function deliberately returns
-- only the identity fields needed to manage a relationship. Private profile
-- details remain behind the ordinary profile visibility boundary.

CREATE OR REPLACE FUNCTION public.app_list_profile_connections(
  requested_view text,
  cursor_at timestamptz,
  cursor_user_id uuid,
  page_size integer
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  slug text,
  is_private boolean,
  avatar_id uuid,
  avatar_content_type text,
  avatar_width integer,
  avatar_height integer,
  viewer_follow_status text,
  follows_viewer boolean,
  relationship_at timestamptz,
  total_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor_user uuid := public.app_actor_id();
BEGIN
  IF actor_user IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.app_users app_user
    WHERE app_user.id = actor_user
      AND app_user.status = 'active'
      AND app_user.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'an active actor is required';
  END IF;

  IF requested_view NOT IN ('following', 'followers', 'incoming', 'outgoing', 'blocked') THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid connection view';
  END IF;

  IF page_size NOT BETWEEN 1 AND 51 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid connection page size';
  END IF;

  IF (cursor_at IS NULL) IS DISTINCT FROM (cursor_user_id IS NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'incomplete connection cursor';
  END IF;

  RETURN QUERY
  WITH candidate_relationships AS MATERIALIZED (
    SELECT
      CASE
        WHEN requested_view IN ('following', 'outgoing', 'blocked')
          THEN relationship.target_user_id
        ELSE relationship.source_user_id
      END AS related_user_id,
      relationship.updated_at AS related_at
    FROM public.user_relationships relationship
    WHERE
      (requested_view = 'following'
        AND relationship.source_user_id = actor_user
        AND relationship.kind = 'follow'
        AND relationship.status = 'active')
      OR (requested_view = 'followers'
        AND relationship.target_user_id = actor_user
        AND relationship.kind = 'follow'
        AND relationship.status = 'active')
      OR (requested_view = 'incoming'
        AND relationship.target_user_id = actor_user
        AND relationship.kind = 'follow'
        AND relationship.status = 'pending')
      OR (requested_view = 'outgoing'
        AND relationship.source_user_id = actor_user
        AND relationship.kind = 'follow'
        AND relationship.status = 'pending')
      OR (requested_view = 'blocked'
        AND relationship.source_user_id = actor_user
        AND relationship.kind = 'block'
        AND relationship.status = 'active')
  ),
  visible_candidates AS MATERIALIZED (
    SELECT candidate.related_user_id, candidate.related_at
    FROM candidate_relationships candidate
    JOIN public.app_users related_user
      ON related_user.id = candidate.related_user_id
     AND related_user.status = 'active'
     AND related_user.deleted_at IS NULL
    WHERE requested_view = 'blocked'
      OR NOT EXISTS (
        SELECT 1
        FROM public.user_relationships active_block
        WHERE active_block.kind = 'block'
          AND active_block.status = 'active'
          AND (
            (active_block.source_user_id = actor_user
              AND active_block.target_user_id = candidate.related_user_id)
            OR (active_block.source_user_id = candidate.related_user_id
              AND active_block.target_user_id = actor_user)
          )
      )
  ),
  enriched AS MATERIALIZED (
    SELECT
      profile.user_id,
      profile.display_name,
      profile.slug,
      profile.is_private,
      CASE
        WHEN profile.is_private = false OR viewer_follow.status = 'active'
          THEN avatar.id
        ELSE NULL
      END AS avatar_id,
      CASE
        WHEN profile.is_private = false OR viewer_follow.status = 'active'
          THEN avatar.detected_content_type
        ELSE NULL
      END AS avatar_content_type,
      CASE
        WHEN profile.is_private = false OR viewer_follow.status = 'active'
          THEN avatar.width_pixels
        ELSE NULL
      END AS avatar_width,
      CASE
        WHEN profile.is_private = false OR viewer_follow.status = 'active'
          THEN avatar.height_pixels
        ELSE NULL
      END AS avatar_height,
      CASE
        WHEN viewer_follow.status = 'active' THEN 'following'
        WHEN viewer_follow.status = 'pending' THEN 'pending'
        ELSE 'none'
      END AS viewer_follow_status,
      coalesce(target_follow.status = 'active', false) AS follows_viewer,
      candidate.related_at AS relationship_at,
      count(*) OVER () AS total_count
    FROM visible_candidates candidate
    JOIN public.profiles profile ON profile.user_id = candidate.related_user_id
    LEFT JOIN public.user_relationships viewer_follow
      ON viewer_follow.source_user_id = actor_user
     AND viewer_follow.target_user_id = profile.user_id
     AND viewer_follow.kind = 'follow'
    LEFT JOIN public.user_relationships target_follow
      ON target_follow.source_user_id = profile.user_id
     AND target_follow.target_user_id = actor_user
     AND target_follow.kind = 'follow'
    LEFT JOIN public.media_assets avatar
      ON avatar.id = profile.avatar_asset_id
     AND avatar.owner_id = profile.user_id
     AND avatar.project_id IS NULL
     AND avatar.original_asset_id IS NULL
     AND avatar.purpose = 'avatar'
     AND avatar.status = 'ready'
     AND avatar.is_current
     AND avatar.exif_stripped
     AND avatar.deleted_at IS NULL
     AND avatar.ready_at IS NOT NULL
     AND avatar.detected_content_type LIKE 'image/%'
     AND avatar.width_pixels > 0
     AND avatar.height_pixels > 0
  )
  SELECT
    enriched.user_id,
    enriched.display_name,
    enriched.slug,
    enriched.is_private,
    enriched.avatar_id,
    enriched.avatar_content_type,
    enriched.avatar_width,
    enriched.avatar_height,
    enriched.viewer_follow_status,
    enriched.follows_viewer,
    enriched.relationship_at,
    enriched.total_count
  FROM enriched
  WHERE cursor_at IS NULL
    OR (enriched.relationship_at, enriched.user_id) < (cursor_at, cursor_user_id)
  ORDER BY enriched.relationship_at DESC, enriched.user_id DESC
  LIMIT page_size;
END
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_list_profile_connections(
  text, timestamptz, uuid, integer
) FROM PUBLIC;
--> statement-breakpoint

-- Explicit searches may reveal only enough identity to send a private-profile
-- follow request. Anonymous discovery still contains public profiles only.
CREATE OR REPLACE FUNCTION public.app_search_profile_identities(
  requested_query text,
  cursor_at timestamptz,
  cursor_user_id uuid,
  page_size integer
)
RETURNS TABLE (
  user_id uuid,
  display_name text,
  slug text,
  bio text,
  location text,
  is_private boolean,
  is_pro boolean,
  created_at timestamptz,
  avatar_id uuid,
  avatar_content_type text,
  avatar_width integer,
  avatar_height integer,
  follower_count integer,
  following_count integer,
  viewer_access text,
  viewer_follow_status text,
  follows_viewer boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  viewer_id uuid := public.app_actor_id();
BEGIN
  IF viewer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.app_users viewer
    WHERE viewer.id = viewer_id
      AND viewer.status = 'active'
      AND viewer.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'an active actor is required';
  END IF;

  IF page_size NOT BETWEEN 1 AND 51
     OR (requested_query IS NOT NULL AND char_length(requested_query) NOT BETWEEN 2 AND 80)
     OR (cursor_at IS NULL) IS DISTINCT FROM (cursor_user_id IS NULL) THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = 'invalid profile search boundary';
  END IF;

  RETURN QUERY
  SELECT
    profile.user_id,
    profile.display_name,
    profile.slug,
    CASE WHEN access.can_view_profile THEN profile.bio ELSE NULL END,
    CASE WHEN access.can_view_profile THEN profile.location ELSE NULL END,
    profile.is_private,
    CASE WHEN access.can_view_profile THEN profile.is_pro ELSE false END,
    profile.created_at,
    CASE WHEN access.can_view_profile THEN avatar.id ELSE NULL END,
    CASE WHEN access.can_view_profile THEN avatar.detected_content_type ELSE NULL END,
    CASE WHEN access.can_view_profile THEN avatar.width_pixels ELSE NULL END,
    CASE WHEN access.can_view_profile THEN avatar.height_pixels ELSE NULL END,
    CASE WHEN access.can_view_profile THEN coalesce(follower_stats.count, 0) ELSE 0 END,
    CASE WHEN access.can_view_profile THEN coalesce(following_stats.count, 0) ELSE 0 END,
    CASE
      WHEN profile.user_id = viewer_id THEN 'owner'
      WHEN profile.is_private AND viewer_follow.status = 'active' THEN 'follower'
      WHEN profile.is_private THEN 'requestable'
      ELSE 'public'
    END,
    CASE
      WHEN profile.user_id = viewer_id THEN 'self'
      WHEN viewer_follow.status = 'active' THEN 'following'
      WHEN viewer_follow.status = 'pending' THEN 'pending'
      ELSE 'none'
    END,
    coalesce(target_follow.status = 'active', false)
  FROM public.profiles profile
  JOIN public.app_users profile_user
    ON profile_user.id = profile.user_id
   AND profile_user.status = 'active'
   AND profile_user.deleted_at IS NULL
  LEFT JOIN public.user_relationships viewer_follow
    ON viewer_follow.source_user_id = viewer_id
   AND viewer_follow.target_user_id = profile.user_id
   AND viewer_follow.kind = 'follow'
  LEFT JOIN public.user_relationships target_follow
    ON target_follow.source_user_id = profile.user_id
   AND target_follow.target_user_id = viewer_id
   AND target_follow.kind = 'follow'
  CROSS JOIN LATERAL (
    SELECT (
      profile.is_private = false
      OR profile.user_id = viewer_id
      OR viewer_follow.status = 'active'
    ) AS can_view_profile
  ) access
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS count
    FROM public.user_relationships relationship
    WHERE relationship.target_user_id = profile.user_id
      AND relationship.kind = 'follow'
      AND relationship.status = 'active'
  ) follower_stats ON true
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS count
    FROM public.user_relationships relationship
    WHERE relationship.source_user_id = profile.user_id
      AND relationship.kind = 'follow'
      AND relationship.status = 'active'
  ) following_stats ON true
  LEFT JOIN public.media_assets avatar
    ON avatar.id = profile.avatar_asset_id
   AND avatar.owner_id = profile.user_id
   AND avatar.project_id IS NULL
   AND avatar.original_asset_id IS NULL
   AND avatar.purpose = 'avatar'
   AND avatar.status = 'ready'
   AND avatar.is_current
   AND avatar.exif_stripped
   AND avatar.deleted_at IS NULL
   AND avatar.ready_at IS NOT NULL
   AND avatar.detected_content_type LIKE 'image/%'
   AND avatar.width_pixels > 0
   AND avatar.height_pixels > 0
  WHERE NOT EXISTS (
      SELECT 1
      FROM public.user_relationships active_block
      WHERE active_block.kind = 'block'
        AND active_block.status = 'active'
        AND (
          (active_block.source_user_id = viewer_id
            AND active_block.target_user_id = profile.user_id)
          OR (active_block.source_user_id = profile.user_id
            AND active_block.target_user_id = viewer_id)
        )
    )
    AND (
      access.can_view_profile
      OR (viewer_id IS NOT NULL AND requested_query IS NOT NULL)
    )
    AND (
      requested_query IS NULL
      OR position(requested_query IN lower(profile.display_name)) > 0
      OR position(requested_query IN lower(profile.slug)) > 0
    )
    AND (
      cursor_at IS NULL
      OR (profile.created_at, profile.user_id) < (cursor_at, cursor_user_id)
    )
  ORDER BY profile.created_at DESC, profile.user_id DESC
  LIMIT page_size;
END
$function$;
--> statement-breakpoint

REVOKE ALL ON FUNCTION public.app_search_profile_identities(
  text, timestamptz, uuid, integer
) FROM PUBLIC;
