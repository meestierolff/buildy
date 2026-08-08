-- Durable account and social service e-mail. Recipient addresses are encrypted
-- before they enter PostgreSQL; the PII-free outbox only contains stable IDs.

CREATE TABLE public.email_recipient_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.app_users(id) ON DELETE CASCADE,
  recipient_ciphertext text NOT NULL,
  recipient_hash text NOT NULL,
  social_access_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_recipient_profiles_ciphertext_ck CHECK (
    recipient_ciphertext LIKE 'v1.%'
    AND char_length(recipient_ciphertext) <= 2048
  ),
  CONSTRAINT email_recipient_profiles_hash_ck CHECK (
    recipient_hash ~ '^[0-9a-f]{64}$'
  )
);
--> statement-breakpoint
ALTER TABLE public.email_recipient_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_register_auth_email_recipient(
  subject_auth_user_id text,
  requested_recipient_ciphertext text,
  requested_recipient_hash text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  resolved_user_id uuid;
BEGIN
  IF subject_auth_user_id IS NULL
    OR char_length(subject_auth_user_id) NOT BETWEEN 1 AND 512
    OR requested_recipient_ciphertext NOT LIKE 'v1.%'
    OR char_length(requested_recipient_ciphertext) > 2048
    OR requested_recipient_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid protected auth recipient';
  END IF;

  SELECT mapping.app_user_id
  INTO resolved_user_id
  FROM public.auth_identity_mappings mapping
  JOIN public.app_users account ON account.id = mapping.app_user_id
  WHERE mapping.auth_user_id = subject_auth_user_id
    AND mapping.migration_status = 'linked'
    AND account.status <> 'deleted'
    AND account.deleted_at IS NULL
  LIMIT 1;
  IF resolved_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'auth recipient identity is unavailable';
  END IF;

  INSERT INTO public.email_recipient_profiles (
    user_id, recipient_ciphertext, recipient_hash
  ) VALUES (
    resolved_user_id, requested_recipient_ciphertext, requested_recipient_hash
  )
  ON CONFLICT (user_id) DO UPDATE SET
    recipient_ciphertext = excluded.recipient_ciphertext,
    recipient_hash = excluded.recipient_hash,
    updated_at = statement_timestamp();

  RETURN resolved_user_id;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_set_social_access_email_preference(
  requested_enabled boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor uuid := public.app_actor_id();
BEGIN
  IF actor IS NULL OR requested_enabled IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid e-mail preference';
  END IF;

  UPDATE public.email_recipient_profiles recipient
  SET social_access_enabled = requested_enabled,
      updated_at = statement_timestamp()
  FROM public.app_users account
  WHERE recipient.user_id = actor
    AND account.id = recipient.user_id
    AND account.status = 'active'
    AND account.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'active e-mail recipient is unavailable';
  END IF;
  RETURN requested_enabled;
END
$function$;
--> statement-breakpoint
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
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'protected recipient required before first authentication';
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER app_users_require_email_recipient_before_first_auth
BEFORE UPDATE OF last_authenticated_at ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.app_require_email_recipient_before_first_auth();
--> statement-breakpoint
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
    ) VALUES (
      'account_lifecycle',
      NEW.id,
      'lifecycle.welcome.requested.v1',
      'account:' || NEW.id::text || ':email:welcome:v1',
      jsonb_build_object('schemaVersion', 1, 'userId', NEW.id)
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER app_users_enqueue_welcome_email
AFTER UPDATE OF last_authenticated_at ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.app_enqueue_welcome_email();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_enqueue_project_access_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  requested_event_type text;
  requested_idempotency_key text;
  requested_recipient_id uuid;
BEGIN
  IF pg_catalog.current_setting('app.migration_mode', true) = 'on'
    AND pg_catalog.pg_has_role(
      session_user,
      (
        SELECT relation.relowner
        FROM pg_catalog.pg_class relation
        WHERE relation.oid = 'public.project_access_requests'::pg_catalog.regclass
      ),
      'MEMBER'
    ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' AND NEW.status = 'pending' THEN
    requested_event_type := 'social.access_requested.requested.v1';
    requested_idempotency_key := 'access-request:' || NEW.id::text || ':email:requested:v1';
    requested_recipient_id := NEW.project_owner_id;
  ELSIF TG_OP = 'UPDATE'
    AND OLD.status IS DISTINCT FROM NEW.status
    AND OLD.status = 'pending'
    AND NEW.status = 'accepted' THEN
    requested_event_type := 'social.access_accepted.requested.v1';
    requested_idempotency_key := 'access-request:' || NEW.id::text || ':email:accepted:v1';
    requested_recipient_id := NEW.requester_id;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.outbox_events (
    aggregate_type, aggregate_id, event_type, idempotency_key, payload
  )
  SELECT
    'project_access',
    NEW.id,
    requested_event_type,
    requested_idempotency_key,
    jsonb_build_object(
      'schemaVersion', 1,
      'requestId', NEW.id,
      'projectId', NEW.project_id
    )
  FROM public.email_recipient_profiles recipient
  JOIN public.app_users account ON account.id = recipient.user_id
  WHERE recipient.user_id = requested_recipient_id
    AND recipient.social_access_enabled
    AND account.status = 'active'
    AND account.deleted_at IS NULL
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER project_access_requests_enqueue_email
AFTER INSERT OR UPDATE ON public.project_access_requests
FOR EACH ROW EXECUTE FUNCTION public.app_enqueue_project_access_email();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_enqueue_account_security_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.kind <> 'account'
    OR NEW.status NOT IN ('requested', 'blocked_active_order', 'deletion_pending') THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.outbox_events (
    aggregate_type, aggregate_id, event_type, idempotency_key, payload
  )
  SELECT
    'account_security',
    NEW.id,
    'security.account_alert.requested.v1',
    'deletion-job:' || NEW.id::text || ':email:security-requested:v1',
    jsonb_build_object(
      'schemaVersion', 1,
      'deletionJobId', NEW.id,
      'accountAction', 'deletion_requested'
    )
  FROM public.email_recipient_profiles recipient
  JOIN public.app_users account ON account.id = recipient.user_id
  WHERE recipient.user_id = NEW.requested_by_id
    AND account.status IN ('active', 'deletion_pending')
    AND account.deleted_at IS NULL
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER deletion_jobs_enqueue_security_email
AFTER INSERT OR UPDATE ON public.deletion_jobs
FOR EACH ROW EXECUTE FUNCTION public.app_enqueue_account_security_email();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_enqueue_migration_account_email(
  requested_user_id uuid,
  requested_recipient_ciphertext text,
  requested_recipient_hash text
)
RETURNS TABLE (queued boolean, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  event_already_exists boolean;
BEGIN
  IF requested_user_id IS NULL
    OR requested_recipient_ciphertext NOT LIKE 'v1.%'
    OR char_length(requested_recipient_ciphertext) > 2048
    OR requested_recipient_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid protected migration recipient';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('migration-account-email:' || requested_user_id::text, 0)
  );
  PERFORM 1
  FROM public.app_users account
  JOIN public.profiles profile ON profile.user_id = account.id
  JOIN public.auth_identity_mappings mapping ON mapping.app_user_id = account.id
  WHERE account.id = requested_user_id
    AND account.status = 'active'
    AND account.deleted_at IS NULL
    AND mapping.legacy_provider = 'legacy_auth'
    AND mapping.legacy_subject_id IS NOT NULL
    AND mapping.migration_status IN ('requires_reset', 'linked');
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'migration account is not eligible';
  END IF;

  INSERT INTO public.email_recipient_profiles (
    user_id, recipient_ciphertext, recipient_hash, social_access_enabled
  ) VALUES (
    requested_user_id, requested_recipient_ciphertext, requested_recipient_hash, false
  )
  ON CONFLICT (user_id) DO UPDATE SET
    recipient_ciphertext = excluded.recipient_ciphertext,
    recipient_hash = excluded.recipient_hash,
    updated_at = statement_timestamp();

  SELECT EXISTS (
    SELECT 1 FROM public.outbox_events event
    WHERE event.idempotency_key = 'account:' || requested_user_id::text || ':email:migration:v1'
  ) INTO event_already_exists;

  INSERT INTO public.outbox_events (
    aggregate_type, aggregate_id, event_type, idempotency_key, payload
  ) VALUES (
    'identity_migration',
    requested_user_id,
    'migration.account.requested.v1',
    'account:' || requested_user_id::text || ':email:migration:v1',
    jsonb_build_object('schemaVersion', 1, 'userId', requested_user_id)
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN QUERY SELECT true, event_already_exists;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_event_is_supported(
  requested_aggregate_type text,
  requested_event_type text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE requested_aggregate_type
    WHEN 'auth_email' THEN requested_event_type IN (
      'auth.email.verify_email',
      'auth.email.magic_link',
      'auth.email.reset_password'
    )
    WHEN 'photobook_order' THEN requested_event_type IN (
      'order.email.confirmation.requested.v1',
      'order.email.payment_failed.requested.v1',
      'order.email.in_production.requested.v1',
      'order.email.shipped.requested.v1',
      'order.email.refund_review.requested.v1'
    )
    WHEN 'moderation_report' THEN requested_event_type = 'moderation.report.received.requested.v1'
    WHEN 'feedback_submission' THEN requested_event_type = 'support.confirmation.requested.v1'
    WHEN 'account_lifecycle' THEN requested_event_type = 'lifecycle.welcome.requested.v1'
    WHEN 'project_access' THEN requested_event_type IN (
      'social.access_requested.requested.v1',
      'social.access_accepted.requested.v1'
    )
    WHEN 'account_security' THEN requested_event_type = 'security.account_alert.requested.v1'
    WHEN 'identity_migration' THEN requested_event_type = 'migration.account.requested.v1'
    ELSE false
  END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_worker_claim(
  requested_lease_owner text,
  requested_lease_seconds integer,
  requested_batch_size integer
)
RETURNS TABLE (
  id uuid,
  aggregate_id uuid,
  aggregate_type text,
  event_type text,
  idempotency_key text,
  payload jsonb,
  attempt_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR requested_lease_seconds NOT BETWEEN 30 AND 300
    OR requested_batch_size NOT BETWEEN 1 AND 25 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email worker claim';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT queued.id
    FROM public.outbox_events queued
    WHERE public.app_email_event_is_supported(queued.aggregate_type, queued.event_type)
      AND (
        (queued.status IN ('pending', 'retry') AND queued.available_at <= clock_timestamp())
        OR (queued.status = 'claimed' AND queued.lease_expires_at <= clock_timestamp())
      )
    ORDER BY queued.available_at, queued.created_at, queued.id
    FOR UPDATE SKIP LOCKED
    LIMIT requested_batch_size
  )
  UPDATE public.outbox_events claimed
  SET status = 'claimed',
      attempt_count = claimed.attempt_count + 1,
      lease_owner = requested_lease_owner,
      lease_expires_at = clock_timestamp() + make_interval(secs => requested_lease_seconds),
      updated_at = clock_timestamp()
  FROM candidates
  WHERE claimed.id = candidates.id
  RETURNING
    claimed.id,
    claimed.aggregate_id,
    claimed.aggregate_type,
    claimed.event_type,
    claimed.idempotency_key,
    claimed.payload,
    claimed.attempt_count;
END
$function$;
--> statement-breakpoint
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
    AND access_request.status = 'pending'
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
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_worker_prepare_account(
  requested_event_id uuid,
  requested_lease_owner text,
  requested_idempotency_key text,
  requested_recipient_hash text,
  requested_template_key text,
  requested_template_version text
)
RETURNS TABLE (status text, first_attempt_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_event public.outbox_events%ROWTYPE;
  selected_delivery public.email_deliveries%ROWTYPE;
  selected_recipient_user_id uuid;
  selected_recipient_hash text;
  expected_idempotency_key text;
  expected_template_key text;
  inserted_count integer;
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR char_length(requested_idempotency_key) NOT BETWEEN 16 AND 160
    OR requested_recipient_hash !~ '^[0-9a-f]{64}$'
    OR requested_template_version !~ '^[A-Za-z0-9._-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid account email preparation';
  END IF;

  SELECT queued.* INTO selected_event
  FROM public.outbox_events queued
  WHERE queued.id = requested_event_id
  FOR UPDATE;
  IF NOT FOUND
    OR selected_event.status <> 'claimed'
    OR selected_event.lease_owner IS DISTINCT FROM requested_lease_owner
    OR selected_event.lease_expires_at <= clock_timestamp()
    OR NOT public.app_email_event_is_supported(selected_event.aggregate_type, selected_event.event_type) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;

  IF selected_event.aggregate_type = 'account_lifecycle'
    AND selected_event.event_type = 'lifecycle.welcome.requested.v1' THEN
    SELECT account.id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.app_users account
    JOIN public.profiles profile ON profile.user_id = account.id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE account.id = selected_event.aggregate_id
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object('schemaVersion', 1, 'userId', account.id);
    expected_template_key := 'lifecycle.welcome';
    expected_idempotency_key := 'account:' || selected_event.aggregate_id::text || ':email:welcome:v1';
  ELSIF selected_event.aggregate_type = 'project_access'
    AND selected_event.event_type = 'social.access_requested.requested.v1' THEN
    SELECT access_request.project_owner_id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.project_access_requests access_request
    JOIN public.projects project ON project.id = access_request.project_id
    JOIN public.app_users account ON account.id = access_request.project_owner_id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE access_request.id = selected_event.aggregate_id
      AND access_request.status = 'pending'
      AND recipient.social_access_enabled
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object(
        'schemaVersion', 1, 'requestId', access_request.id, 'projectId', access_request.project_id
      );
    expected_template_key := 'social.access_requested';
    expected_idempotency_key := 'access-request:' || selected_event.aggregate_id::text || ':email:requested:v1';
  ELSIF selected_event.aggregate_type = 'project_access'
    AND selected_event.event_type = 'social.access_accepted.requested.v1' THEN
    SELECT access_request.requester_id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.project_access_requests access_request
    JOIN public.projects project ON project.id = access_request.project_id
    JOIN public.app_users account ON account.id = access_request.requester_id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE access_request.id = selected_event.aggregate_id
      AND access_request.status = 'accepted'
      AND recipient.social_access_enabled
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object(
        'schemaVersion', 1, 'requestId', access_request.id, 'projectId', access_request.project_id
      );
    expected_template_key := 'social.access_accepted';
    expected_idempotency_key := 'access-request:' || selected_event.aggregate_id::text || ':email:accepted:v1';
  ELSIF selected_event.aggregate_type = 'account_security'
    AND selected_event.event_type = 'security.account_alert.requested.v1' THEN
    SELECT job.requested_by_id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.deletion_jobs job
    JOIN public.app_users account ON account.id = job.requested_by_id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE job.id = selected_event.aggregate_id
      AND job.kind = 'account'
      AND account.status IN ('active', 'deletion_pending')
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object(
        'schemaVersion', 1, 'deletionJobId', job.id, 'accountAction', 'deletion_requested'
      );
    expected_template_key := 'security.account_alert';
    expected_idempotency_key := 'deletion-job:' || selected_event.aggregate_id::text || ':email:security-requested:v1';
  ELSIF selected_event.aggregate_type = 'identity_migration'
    AND selected_event.event_type = 'migration.account.requested.v1' THEN
    SELECT account.id, recipient.recipient_hash
    INTO selected_recipient_user_id, selected_recipient_hash
    FROM public.app_users account
    JOIN public.profiles profile ON profile.user_id = account.id
    JOIN public.email_recipient_profiles recipient ON recipient.user_id = account.id
    WHERE account.id = selected_event.aggregate_id
      AND account.status = 'active'
      AND account.deleted_at IS NULL
      AND selected_event.payload = jsonb_build_object('schemaVersion', 1, 'userId', account.id);
    expected_template_key := 'migration.account';
    expected_idempotency_key := 'account:' || selected_event.aggregate_id::text || ':email:migration:v1';
  END IF;

  IF selected_recipient_user_id IS NULL
    OR selected_recipient_hash IS NULL
    OR expected_template_key IS NULL
    OR expected_idempotency_key IS NULL
    OR selected_event.idempotency_key IS DISTINCT FROM expected_idempotency_key
    OR requested_idempotency_key IS DISTINCT FROM expected_idempotency_key
    OR requested_recipient_hash IS DISTINCT FROM selected_recipient_hash
    OR requested_template_key IS DISTINCT FROM expected_template_key THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'account email metadata does not match';
  END IF;

  INSERT INTO public.email_deliveries (
    outbox_event_id, recipient_user_id, recipient_hash, provider,
    template_key, template_version, idempotency_key, status, attempt_count
  ) VALUES (
    requested_event_id, selected_recipient_user_id, requested_recipient_hash,
    'brevo', requested_template_key, requested_template_version,
    requested_idempotency_key, 'queued', 1
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT delivery.* INTO selected_delivery
  FROM public.email_deliveries delivery
  WHERE delivery.idempotency_key = requested_idempotency_key
  FOR UPDATE;
  IF NOT FOUND
    OR selected_delivery.outbox_event_id <> requested_event_id
    OR selected_delivery.recipient_user_id IS DISTINCT FROM selected_recipient_user_id
    OR selected_delivery.recipient_hash <> requested_recipient_hash
    OR selected_delivery.template_key <> requested_template_key
    OR selected_delivery.template_version <> requested_template_version THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'email delivery idempotency collision';
  END IF;

  IF inserted_count = 0 AND selected_delivery.status IN ('queued', 'deferred') THEN
    UPDATE public.email_deliveries delivery
    SET status = 'queued',
        attempt_count = delivery.attempt_count + 1,
        failure_code = NULL,
        updated_at = clock_timestamp()
    WHERE delivery.id = selected_delivery.id
    RETURNING delivery.* INTO selected_delivery;
  END IF;
  IF selected_delivery.status NOT IN ('queued', 'deferred', 'submitted', 'delivered') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'email delivery is terminal';
  END IF;

  RETURN QUERY SELECT selected_delivery.status::text, selected_delivery.created_at;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_worker_acknowledge(
  requested_event_id uuid,
  requested_lease_owner text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR NOT EXISTS (
      SELECT 1 FROM public.email_deliveries delivery
      WHERE delivery.outbox_event_id = requested_event_id
        AND delivery.status IN ('submitted', 'delivered')
        AND delivery.provider_message_id IS NOT NULL
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email delivery cannot be acknowledged';
  END IF;

  UPDATE public.outbox_events queued
  SET status = 'delivered',
      delivered_at = COALESCE(queued.delivered_at, clock_timestamp()),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      updated_at = clock_timestamp()
  WHERE queued.id = requested_event_id
    AND public.app_email_event_is_supported(queued.aggregate_type, queued.event_type)
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_worker_complete(
  requested_event_id uuid,
  requested_lease_owner text,
  requested_provider text,
  requested_provider_message_id text,
  requested_submitted_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR requested_provider <> 'brevo'
    OR char_length(requested_provider_message_id) NOT BETWEEN 1 AND 500
    OR requested_submitted_at NOT BETWEEN clock_timestamp() - interval '1 hour' AND clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email provider receipt';
  END IF;

  PERFORM 1
  FROM public.outbox_events queued
  WHERE queued.id = requested_event_id
    AND public.app_email_event_is_supported(queued.aggregate_type, queued.event_type)
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;

  UPDATE public.email_deliveries delivery
  SET provider = requested_provider,
      provider_message_id = requested_provider_message_id,
      status = 'submitted',
      submitted_at = requested_submitted_at,
      failed_at = NULL,
      failure_code = NULL,
      updated_at = clock_timestamp()
  WHERE delivery.outbox_event_id = requested_event_id
    AND delivery.status IN ('queued', 'deferred');
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'email delivery is not sendable';
  END IF;

  UPDATE public.outbox_events queued
  SET status = 'delivered',
      delivered_at = clock_timestamp(),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = NULL,
      updated_at = clock_timestamp()
  WHERE queued.id = requested_event_id;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_email_worker_fail(
  requested_event_id uuid,
  requested_lease_owner text,
  requested_error_code text,
  requested_delay_seconds integer,
  requested_dead_letter boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF requested_lease_owner !~ '^[A-Za-z0-9:_-]{8,100}$'
    OR requested_error_code !~ '^[a-z0-9_]{1,80}$'
    OR requested_delay_seconds NOT BETWEEN 0 AND 900
    OR (requested_dead_letter AND requested_delay_seconds <> 0) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid email worker failure';
  END IF;

  PERFORM 1
  FROM public.outbox_events queued
  WHERE queued.id = requested_event_id
    AND public.app_email_event_is_supported(queued.aggregate_type, queued.event_type)
    AND queued.status = 'claimed'
    AND queued.lease_owner = requested_lease_owner
    AND queued.lease_expires_at > clock_timestamp()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'email worker lease is invalid';
  END IF;

  UPDATE public.email_deliveries delivery
  SET status = CASE
        WHEN requested_dead_letter THEN 'failed'::public.email_delivery_status
        ELSE 'deferred'::public.email_delivery_status
      END,
      failed_at = CASE WHEN requested_dead_letter THEN clock_timestamp() ELSE NULL END,
      failure_code = requested_error_code,
      updated_at = clock_timestamp()
  WHERE delivery.outbox_event_id = requested_event_id
    AND delivery.status IN ('queued', 'deferred');

  UPDATE public.outbox_events queued
  SET status = CASE
        WHEN requested_dead_letter THEN 'dead_letter'::public.outbox_status
        ELSE 'retry'::public.outbox_status
      END,
      available_at = clock_timestamp() + make_interval(secs => requested_delay_seconds),
      lease_owner = NULL,
      lease_expires_at = NULL,
      last_error_code = requested_error_code,
      updated_at = clock_timestamp()
  WHERE queued.id = requested_event_id;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_register_auth_email_recipient(text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_set_social_access_email_preference(boolean) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_require_email_recipient_before_first_auth() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enqueue_welcome_email() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enqueue_project_access_email() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enqueue_account_security_email() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_enqueue_migration_account_email(uuid, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_event_is_supported(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_claim(text, integer, integer) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_load_account_event(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_prepare_account(uuid, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_acknowledge(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_complete(uuid, text, text, text, timestamptz) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_email_worker_fail(uuid, text, text, integer, boolean) FROM PUBLIC;
