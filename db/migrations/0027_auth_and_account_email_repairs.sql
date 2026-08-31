-- Keep linked sign-ins usable without legacy recipient envelopes while account
-- e-mail loaders continue to work for already-queued project-access events.

CREATE OR REPLACE FUNCTION public.app_require_email_recipient_before_first_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.last_authenticated_at IS NULL
    AND NEW.last_authenticated_at IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.email_recipient_profiles recipient
      WHERE recipient.user_id = NEW.id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.auth_identity_mappings mapping
      WHERE mapping.app_user_id = NEW.id
        AND mapping.migration_status = 'linked'
        AND mapping.auth_user_id IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'protected recipient required before first authentication';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_enqueue_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF OLD.last_authenticated_at IS NULL
    AND NEW.last_authenticated_at IS NOT NULL
    AND NEW.status = 'active'
    AND NEW.deleted_at IS NULL THEN
    INSERT INTO public.outbox_events (
      aggregate_type, aggregate_id, event_type, idempotency_key, payload
    )
    SELECT
      'account_lifecycle',
      NEW.id,
      'lifecycle.welcome.requested.v1',
      'account:' || NEW.id::text || ':email:welcome:v1',
      jsonb_build_object('schemaVersion', 1, 'userId', NEW.id)
    FROM public.email_recipient_profiles recipient
    WHERE recipient.user_id = NEW.id
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_email_worker_load_account_event(
  requested_event_id uuid,
  requested_lease_owner text
)
RETURNS TABLE (
  aggregate_type text,
  aggregate_id uuid,
  recipient_user_id uuid,
  recipient_ciphertext text,
  recipient_hash text,
  display_name text,
  actor_display_name text,
  project_title text,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid account email load';
  END IF;

  RETURN QUERY
  SELECT
    queued.aggregate_type,
    queued.aggregate_id,
    account.id,
    recipient.recipient_ciphertext,
    recipient.recipient_hash,
    profile.display_name,
    NULL::text,
    NULL::text,
    queued.created_at
  FROM public.outbox_events queued
  JOIN public.app_users account ON account.id = queued.aggregate_id
  JOIN public.profiles profile ON profile.user_id = account.id
  JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'account_lifecycle'
    AND queued.event_type = 'lifecycle.welcome.requested.v1'
    AND queued.idempotency_key = 'account:' || account.id::text || ':email:welcome:v1'
    AND queued.payload = jsonb_build_object('schemaVersion', 1, 'userId', account.id)
    AND account.status = 'active'
    AND account.deleted_at IS NULL
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
  UNION ALL
  SELECT
    queued.aggregate_type,
    queued.aggregate_id,
    owner_account.id,
    recipient.recipient_ciphertext,
    recipient.recipient_hash,
    owner_profile.display_name,
    requester_profile.display_name,
    project.title,
    queued.created_at
  FROM public.outbox_events queued
  JOIN public.project_access_requests access_request ON access_request.id = queued.aggregate_id
  JOIN public.projects project ON project.id = access_request.project_id
  JOIN public.app_users owner_account ON owner_account.id = access_request.project_owner_id
  JOIN public.profiles owner_profile ON owner_profile.user_id = owner_account.id
  JOIN public.profiles requester_profile ON requester_profile.user_id = access_request.requester_id
  JOIN public.email_recipient_profiles recipient ON recipient.user_id = owner_account.id
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'project_access'
    AND queued.event_type = 'social.access_requested.requested.v1'
    AND queued.idempotency_key = 'access-request:' || access_request.id::text || ':email:requested:v1'
    AND queued.payload = jsonb_build_object(
      'schemaVersion', 1, 'requestId', access_request.id, 'projectId', access_request.project_id
    )
    AND recipient.social_access_enabled
    AND owner_account.status = 'active'
    AND owner_account.deleted_at IS NULL
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
  UNION ALL
  SELECT
    queued.aggregate_type,
    queued.aggregate_id,
    requester_account.id,
    recipient.recipient_ciphertext,
    recipient.recipient_hash,
    requester_profile.display_name,
    owner_profile.display_name,
    project.title,
    queued.created_at
  FROM public.outbox_events queued
  JOIN public.project_access_requests access_request ON access_request.id = queued.aggregate_id
  JOIN public.projects project ON project.id = access_request.project_id
  JOIN public.app_users requester_account ON requester_account.id = access_request.requester_id
  JOIN public.profiles requester_profile ON requester_profile.user_id = requester_account.id
  JOIN public.profiles owner_profile ON owner_profile.user_id = access_request.project_owner_id
  JOIN public.email_recipient_profiles recipient ON recipient.user_id = requester_account.id
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'project_access'
    AND queued.event_type = 'social.access_accepted.requested.v1'
    AND queued.idempotency_key = 'access-request:' || access_request.id::text || ':email:accepted:v1'
    AND queued.payload = jsonb_build_object(
      'schemaVersion', 1, 'requestId', access_request.id, 'projectId', access_request.project_id
    )
    AND access_request.status = 'accepted'
    AND recipient.social_access_enabled
    AND requester_account.status = 'active'
    AND requester_account.deleted_at IS NULL
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
  UNION ALL
  SELECT
    queued.aggregate_type,
    queued.aggregate_id,
    account.id,
    recipient.recipient_ciphertext,
    recipient.recipient_hash,
    profile.display_name,
    NULL::text,
    NULL::text,
    queued.created_at
  FROM public.outbox_events queued
  JOIN public.deletion_jobs job ON job.id = queued.aggregate_id AND job.kind = 'account'
  JOIN public.app_users account ON account.id = job.requested_by_id
  JOIN public.profiles profile ON profile.user_id = account.id
  JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'account_security'
    AND queued.event_type = 'security.account_alert.requested.v1'
    AND queued.idempotency_key = 'deletion-job:' || job.id::text || ':email:security-requested:v1'
    AND queued.payload = jsonb_build_object(
      'schemaVersion', 1, 'deletionJobId', job.id, 'accountAction', 'deletion_requested'
    )
    AND account.status IN ('active', 'deletion_pending')
    AND account.deleted_at IS NULL
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
  UNION ALL
  SELECT
    queued.aggregate_type,
    queued.aggregate_id,
    account.id,
    recipient.recipient_ciphertext,
    recipient.recipient_hash,
    profile.display_name,
    NULL::text,
    NULL::text,
    queued.created_at
  FROM public.outbox_events queued
  JOIN public.app_users account ON account.id = queued.aggregate_id
  JOIN public.profiles profile ON profile.user_id = account.id
  JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
  WHERE queued.id = requested_event_id
    AND queued.aggregate_type = 'identity_migration'
    AND queued.event_type = 'migration.account.requested.v1'
    AND queued.idempotency_key = 'account:' || account.id::text || ':email:migration:v1'
    AND queued.payload = jsonb_build_object('schemaVersion', 1, 'userId', account.id)
    AND account.status = 'active'
    AND account.deleted_at IS NULL
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp();
END
$function$;