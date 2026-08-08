-- Invite-only beta registration and privacy-minimal product instrumentation.
-- Invite codes and reservation tokens reach PostgreSQL only as one-way hashes.

ALTER TABLE public.beta_invite_redemptions
  ADD COLUMN provider text,
  ADD COLUMN email_hash text,
  ADD COLUMN idempotency_key text,
  ADD COLUMN request_hash text;
--> statement-breakpoint
CREATE UNIQUE INDEX beta_invite_redemptions_idempotency_uq
  ON public.beta_invite_redemptions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.beta_invite_redemptions
  ADD CONSTRAINT beta_invite_redemptions_provider_ck
    CHECK (provider IS NULL OR provider IN ('email', 'google')),
  ADD CONSTRAINT beta_invite_redemptions_email_hash_ck
    CHECK (email_hash IS NULL OR email_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT beta_invite_redemptions_idempotency_ck
    CHECK (idempotency_key IS NULL OR idempotency_key ~ '^beta-reservation:v1:[0-9a-f-]{36}$'),
  ADD CONSTRAINT beta_invite_redemptions_request_hash_ck
    CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT beta_invite_redemptions_runtime_shape_ck
    CHECK (
      idempotency_key IS NULL
      OR (
        provider IS NOT NULL
        AND request_hash IS NOT NULL
        AND (provider <> 'email' OR email_hash IS NOT NULL)
      )
    );
--> statement-breakpoint
CREATE TABLE public.product_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  event_name text NOT NULL,
  event_key text NOT NULL,
  subject_hash text,
  properties jsonb NOT NULL DEFAULT '{"schemaVersion":1}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT product_events_event_name_ck CHECK (event_name IN (
    'signup_started',
    'signup_completed',
    'onboarding_completed',
    'project_created',
    'first_update_created',
    'photo_upload_completed',
    'project_shared',
    'follow_requested',
    'follow_accepted',
    'comment_created',
    'photobook_opened',
    'photobook_draft_generated',
    'proof_generated',
    'proof_approved',
    'checkout_started',
    'checkout_completed',
    'feedback_submitted',
    'error_encountered'
  )),
  CONSTRAINT product_events_event_key_ck CHECK (
    char_length(event_key) BETWEEN 16 AND 180
    AND event_key ~ '^[A-Za-z0-9:_-]+$'
  ),
  CONSTRAINT product_events_subject_hash_ck CHECK (
    subject_hash IS NULL OR subject_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT product_events_properties_ck CHECK (
    jsonb_typeof(properties) = 'object'
    AND properties ? 'schemaVersion'
    AND properties->'schemaVersion' = '1'::jsonb
  ),
  CONSTRAINT product_events_time_ck CHECK (occurred_at <= created_at + interval '5 minutes')
);
--> statement-breakpoint
CREATE UNIQUE INDEX product_events_event_key_uq ON public.product_events (event_key);
--> statement-breakpoint
CREATE INDEX product_events_name_occurred_idx
  ON public.product_events (event_name, occurred_at, id);
--> statement-breakpoint
CREATE INDEX product_events_subject_occurred_idx
  ON public.product_events (subject_hash, occurred_at)
  WHERE subject_hash IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.product_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TRIGGER product_events_append_only
BEFORE UPDATE OR DELETE ON public.product_events
FOR EACH ROW EXECUTE FUNCTION public.prevent_append_only_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_product_event_properties_valid(
  requested_event_name text,
  requested_properties jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT CASE
    WHEN requested_event_name = 'signup_started' THEN
      requested_properties = jsonb_build_object(
        'schemaVersion', 1,
        'method', requested_properties->>'method'
      )
      AND requested_properties->>'method' IN ('email', 'google')
    WHEN requested_event_name = 'project_shared' THEN
      requested_properties = jsonb_build_object(
        'schemaVersion', 1,
        'visibility', requested_properties->>'visibility'
      )
      AND requested_properties->>'visibility' IN ('public', 'private')
    WHEN requested_event_name = 'error_encountered' THEN
      requested_properties = jsonb_build_object(
        'schemaVersion', 1,
        'category', requested_properties->>'category'
      )
      AND requested_properties->>'category' IN (
        'network', 'offline', 'timeout', 'authentication', 'validation',
        'upload', 'render', 'checkout', 'unknown'
      )
    ELSE requested_properties = '{"schemaVersion":1}'::jsonb
  END
$function$;
--> statement-breakpoint
ALTER TABLE public.product_events
  ADD CONSTRAINT product_events_exact_properties_ck CHECK (
    public.app_product_event_properties_valid(event_name, properties)
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_product_event_subject_hash(requested_subject_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT encode(digest('buildy-product-event-subject-v1:' || requested_subject_id::text, 'sha256'), 'hex')
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_insert_product_event(
  requested_event_name text,
  requested_event_key text,
  requested_subject_id uuid
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  INSERT INTO public.product_events (
    event_name, event_key, subject_hash, properties, occurred_at
  ) VALUES (
    requested_event_name,
    requested_event_key,
    CASE WHEN requested_subject_id IS NULL THEN NULL
      ELSE public.app_product_event_subject_hash(requested_subject_id) END,
    '{"schemaVersion":1}'::jsonb,
    clock_timestamp()
  )
  ON CONFLICT (event_key) DO NOTHING
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_create_beta_invite(
  requested_id uuid,
  requested_code_hash text,
  requested_email_hash text,
  requested_max_uses integer,
  requested_expires_at timestamptz,
  requested_cohort text,
  requested_request_id text
)
RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  created_invite public.beta_invites%ROWTYPE;
BEGIN
  IF requested_id IS NULL
    OR requested_code_hash !~ '^[0-9a-f]{64}$'
    OR (requested_email_hash IS NOT NULL AND requested_email_hash !~ '^[0-9a-f]{64}$')
    OR requested_max_uses NOT BETWEEN 1 AND 100
    OR requested_expires_at NOT BETWEEN clock_timestamp() + interval '15 minutes' AND clock_timestamp() + interval '180 days'
    OR requested_cohort !~ '^[a-z0-9][a-z0-9_-]{0,39}$'
    OR requested_request_id !~ '^[A-Za-z0-9:_-]{8,100}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid beta invite creation';
  END IF;

  INSERT INTO public.beta_invites (
    id, code_hash, email_hash, status, max_uses, use_count, expires_at, metadata
  ) VALUES (
    requested_id,
    requested_code_hash,
    requested_email_hash,
    'active',
    requested_max_uses,
    0,
    requested_expires_at,
    jsonb_build_object('schemaVersion', 1, 'cohort', requested_cohort)
  )
  RETURNING * INTO created_invite;

  INSERT INTO public.audit_events (
    actor_kind, action, resource_type, resource_id, request_id, metadata
  ) VALUES (
    'admin',
    'beta.invite_created',
    'beta_invite',
    created_invite.id,
    requested_request_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'maxUses', created_invite.max_uses,
      'emailRestricted', created_invite.email_hash IS NOT NULL,
      'cohort', requested_cohort
    )
  );

  RETURN QUERY SELECT created_invite.id, created_invite.expires_at;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_revoke_beta_invite(
  requested_code_hash text,
  requested_request_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  revoked_invite_id uuid;
BEGIN
  IF requested_code_hash !~ '^[0-9a-f]{64}$'
    OR requested_request_id !~ '^[A-Za-z0-9:_-]{8,100}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid beta invite revocation';
  END IF;

  UPDATE public.beta_invites invite
  SET status = 'revoked', updated_at = clock_timestamp()
  WHERE invite.code_hash = requested_code_hash
    AND invite.status = 'active'
  RETURNING invite.id INTO revoked_invite_id;

  IF revoked_invite_id IS NULL THEN RETURN false; END IF;

  UPDATE public.beta_invite_redemptions redemption
  SET status = 'revoked', updated_at = clock_timestamp()
  WHERE redemption.invite_id = revoked_invite_id
    AND redemption.status = 'reserved';

  INSERT INTO public.audit_events (
    actor_kind, action, resource_type, resource_id, request_id, metadata
  ) VALUES (
    'admin', 'beta.invite_revoked', 'beta_invite', revoked_invite_id,
    requested_request_id, '{"schemaVersion":1}'::jsonb
  );
  RETURN true;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_reserve_beta_invite(
  requested_code_hash text,
  requested_email_hash text,
  requested_reservation_token_hash text,
  requested_provider text,
  requested_idempotency_key text,
  requested_request_hash text
)
RETURNS TABLE (
  redemption_id uuid,
  reservation_expires_at timestamptz,
  replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_invite public.beta_invites%ROWTYPE;
  selected_redemption public.beta_invite_redemptions%ROWTYPE;
  resolved_expiry timestamptz;
BEGIN
  IF requested_code_hash !~ '^[0-9a-f]{64}$'
    OR (requested_email_hash IS NOT NULL AND requested_email_hash !~ '^[0-9a-f]{64}$')
    OR requested_reservation_token_hash !~ '^[0-9a-f]{64}$'
    OR requested_provider NOT IN ('email', 'google')
    OR (requested_provider = 'email' AND requested_email_hash IS NULL)
    OR requested_idempotency_key !~ '^beta-reservation:v1:[0-9a-f-]{36}$'
    OR requested_request_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid beta reservation';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(requested_idempotency_key, 0));
  SELECT redemption.* INTO selected_redemption
  FROM public.beta_invite_redemptions redemption
  WHERE redemption.idempotency_key = requested_idempotency_key;
  IF FOUND THEN
    IF selected_redemption.request_hash IS DISTINCT FROM requested_request_hash
      OR selected_redemption.provider IS DISTINCT FROM requested_provider
      OR selected_redemption.email_hash IS DISTINCT FROM requested_email_hash
      OR selected_redemption.reservation_token_hash IS DISTINCT FROM requested_reservation_token_hash THEN
      RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'beta reservation idempotency collision';
    END IF;
    IF selected_redemption.status <> 'reserved'
      OR selected_redemption.reservation_expires_at <= clock_timestamp() THEN
      RETURN;
    END IF;
    RETURN QUERY SELECT
      selected_redemption.id,
      selected_redemption.reservation_expires_at,
      true;
    RETURN;
  END IF;

  SELECT invite.* INTO selected_invite
  FROM public.beta_invites invite
  WHERE invite.code_hash = requested_code_hash
  FOR UPDATE;
  IF NOT FOUND
    OR selected_invite.status <> 'active'
    OR selected_invite.expires_at <= clock_timestamp()
    OR selected_invite.use_count >= selected_invite.max_uses
    OR (
      selected_invite.email_hash IS NOT NULL
      AND requested_email_hash IS NOT NULL
      AND selected_invite.email_hash <> requested_email_hash
    ) THEN
    RETURN;
  END IF;

  resolved_expiry := least(selected_invite.expires_at, clock_timestamp() + interval '10 minutes');
  INSERT INTO public.beta_invite_redemptions (
    invite_id, reservation_token_hash, status, reservation_expires_at,
    provider, email_hash, idempotency_key, request_hash
  ) VALUES (
    selected_invite.id, requested_reservation_token_hash, 'reserved',
    resolved_expiry, requested_provider, requested_email_hash,
    requested_idempotency_key, requested_request_hash
  )
  RETURNING * INTO selected_redemption;

  INSERT INTO public.audit_events (
    actor_kind, action, resource_type, resource_id, metadata
  ) VALUES (
    'system', 'beta.invite_reserved', 'beta_invite_redemption',
    selected_redemption.id,
    jsonb_build_object('schemaVersion', 1, 'provider', requested_provider)
  );

  RETURN QUERY SELECT selected_redemption.id, resolved_expiry, false;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_complete_beta_signup(
  requested_reservation_token_hash text,
  requested_email_hash text,
  requested_auth_user_id text,
  requested_provider text
)
RETURNS TABLE (app_user_id uuid, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  selected_redemption public.beta_invite_redemptions%ROWTYPE;
  selected_invite public.beta_invites%ROWTYPE;
  selected_invite_found boolean;
  resolved_app_user_id uuid;
BEGIN
  IF requested_reservation_token_hash !~ '^[0-9a-f]{64}$'
    OR requested_email_hash !~ '^[0-9a-f]{64}$'
    OR char_length(requested_auth_user_id) NOT BETWEEN 1 AND 512
    OR requested_provider NOT IN ('email', 'google') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid beta signup completion';
  END IF;

  SELECT redemption.* INTO selected_redemption
  FROM public.beta_invite_redemptions redemption
  WHERE redemption.reservation_token_hash = requested_reservation_token_hash
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  IF selected_redemption.status = 'completed' THEN
    IF selected_redemption.auth_user_id = requested_auth_user_id
      AND selected_redemption.email_hash = requested_email_hash
      AND selected_redemption.provider = requested_provider THEN
      RETURN QUERY SELECT selected_redemption.app_user_id, true;
    END IF;
    RETURN;
  END IF;

  SELECT invite.* INTO selected_invite
  FROM public.beta_invites invite
  WHERE invite.id = selected_redemption.invite_id
  FOR UPDATE;
  selected_invite_found := FOUND;

  IF selected_redemption.status <> 'reserved'
    OR selected_redemption.reservation_expires_at <= clock_timestamp()
    OR selected_redemption.provider <> requested_provider
    OR (
      selected_redemption.email_hash IS NOT NULL
      AND selected_redemption.email_hash <> requested_email_hash
    )
    OR NOT selected_invite_found
    OR selected_invite.status <> 'active'
    OR selected_invite.expires_at <= clock_timestamp()
    OR selected_invite.use_count >= selected_invite.max_uses
    OR (
      selected_invite.email_hash IS NOT NULL
      AND selected_invite.email_hash <> requested_email_hash
    ) THEN
    RETURN;
  END IF;

  SELECT mapping.app_user_id INTO resolved_app_user_id
  FROM public.auth_identity_mappings mapping
  JOIN public.app_users app_user ON app_user.id = mapping.app_user_id
  WHERE mapping.auth_user_id = requested_auth_user_id
    AND mapping.migration_status = 'linked'
    AND app_user.status = 'active'
    AND app_user.deleted_at IS NULL;
  IF resolved_app_user_id IS NULL THEN RETURN; END IF;

  UPDATE public.beta_invite_redemptions redemption
  SET app_user_id = resolved_app_user_id,
      auth_user_id = requested_auth_user_id,
      email_hash = requested_email_hash,
      status = 'completed',
      completed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE redemption.id = selected_redemption.id;

  UPDATE public.beta_invites invite
  SET use_count = invite.use_count + 1,
      status = CASE
        WHEN invite.use_count + 1 >= invite.max_uses THEN 'exhausted'::public.beta_invite_status
        ELSE invite.status
      END,
      updated_at = clock_timestamp()
  WHERE invite.id = selected_invite.id;

  INSERT INTO public.audit_events (
    actor_kind, actor_user_id, action, resource_type, resource_id, metadata
  ) VALUES (
    'user', resolved_app_user_id, 'beta.invite_redeemed',
    'beta_invite_redemption', selected_redemption.id,
    jsonb_build_object('schemaVersion', 1, 'provider', requested_provider)
  );

  RETURN QUERY SELECT resolved_app_user_id, false;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_record_client_product_event(
  requested_event_id uuid,
  requested_event_name text,
  requested_anonymous_subject_hash text,
  requested_properties jsonb
)
RETURNS TABLE (accepted boolean, replayed boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  actor uuid := public.app_actor_id();
  resolved_subject_hash text;
  resolved_event_key text := 'product-event:client:' || requested_event_id::text;
  inserted_count integer;
  selected_event public.product_events%ROWTYPE;
BEGIN
  IF requested_event_id IS NULL
    OR requested_event_name NOT IN (
      'signup_started', 'project_shared', 'photobook_opened', 'error_encountered'
    )
    OR public.app_product_event_properties_valid(requested_event_name, requested_properties) IS DISTINCT FROM true
    OR (
      actor IS NULL
      AND requested_event_name NOT IN ('signup_started', 'error_encountered')
    )
    OR (
      actor IS NULL
      AND requested_anonymous_subject_hash !~ '^[0-9a-f]{64}$'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid client product event';
  END IF;

  resolved_subject_hash := CASE
    WHEN actor IS NULL THEN requested_anonymous_subject_hash
    ELSE public.app_product_event_subject_hash(actor)
  END;

  INSERT INTO public.product_events (
    event_name, event_key, subject_hash, properties
  ) VALUES (
    requested_event_name, resolved_event_key, resolved_subject_hash, requested_properties
  )
  ON CONFLICT (event_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT event.* INTO selected_event
  FROM public.product_events event
  WHERE event.event_key = resolved_event_key;
  IF selected_event.event_name <> requested_event_name
    OR selected_event.subject_hash IS DISTINCT FROM resolved_subject_hash
    OR selected_event.properties <> requested_properties THEN
    RAISE EXCEPTION USING ERRCODE = '23505', MESSAGE = 'product event idempotency collision';
  END IF;

  RETURN QUERY SELECT true, inserted_count = 0;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.app_capture_product_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_TABLE_NAME = 'auth_identity_mappings' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'signup_completed',
      'product-event:signup-completed:' || NEW.app_user_id::text,
      NEW.app_user_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'profiles' AND TG_OP = 'UPDATE' THEN
    IF OLD.onboarded_at IS NULL AND NEW.onboarded_at IS NOT NULL THEN
      PERFORM public.app_insert_product_event(
        'onboarding_completed',
        'product-event:onboarding-completed:' || NEW.user_id::text,
        NEW.user_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'projects' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'project_created',
      'product-event:project-created:' || NEW.id::text,
      NEW.owner_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'updates' AND TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.updates sibling
      WHERE sibling.project_id = NEW.project_id AND sibling.id <> NEW.id
    ) THEN
      PERFORM public.app_insert_product_event(
        'first_update_created',
        'product-event:first-update-created:' || NEW.project_id::text,
        NEW.author_id
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'media_assets' THEN
    IF NEW.purpose = 'project_media' AND NEW.status = 'ready' THEN
      IF TG_OP = 'INSERT' THEN
        PERFORM public.app_insert_product_event(
          'photo_upload_completed',
          'product-event:photo-upload-completed:' || NEW.id::text,
          NEW.owner_id
        );
      ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.app_insert_product_event(
          'photo_upload_completed',
          'product-event:photo-upload-completed:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'user_relationships' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.kind = 'follow' AND NEW.status = 'pending' THEN
        PERFORM public.app_insert_product_event(
          'follow_requested',
          'product-event:follow-requested:' || NEW.id::text,
          NEW.source_user_id
        );
      END IF;
    ELSE
      IF NEW.kind = 'follow' AND NEW.status = 'pending'
        AND OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.app_insert_product_event(
          'follow_requested',
          'product-event:follow-requested:' || NEW.id::text,
          NEW.source_user_id
        );
      END IF;
      IF NEW.kind = 'follow' AND OLD.status = 'pending' AND NEW.status = 'accepted' THEN
        PERFORM public.app_insert_product_event(
          'follow_accepted',
          'product-event:follow-accepted:' || NEW.id::text,
          NEW.source_user_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'comments' AND TG_OP = 'INSERT' THEN
    PERFORM public.app_insert_product_event(
      'comment_created',
      'product-event:comment-created:' || NEW.id::text,
      NEW.author_id
    );
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_drafts' THEN
    IF NEW.status = 'ready' THEN
      IF TG_OP = 'INSERT' THEN
        PERFORM public.app_insert_product_event(
          'photobook_draft_generated',
          'product-event:photobook-draft-generated:' || NEW.id::text,
          NEW.owner_id
        );
      ELSIF OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.app_insert_product_event(
          'photobook_draft_generated',
          'product-event:photobook-draft-generated:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_revisions' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.status IN ('ready', 'approved', 'locked') THEN
        PERFORM public.app_insert_product_event(
          'proof_generated',
          'product-event:proof-generated:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF NEW.approved_at IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'proof_approved',
          'product-event:proof-approved:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    ELSE
      IF NEW.status IN ('ready', 'approved', 'locked')
        AND OLD.status NOT IN ('ready', 'approved', 'locked') THEN
        PERFORM public.app_insert_product_event(
          'proof_generated',
          'product-event:proof-generated:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF NEW.approved_at IS NOT NULL AND OLD.approved_at IS NULL THEN
        PERFORM public.app_insert_product_event(
          'proof_approved',
          'product-event:proof-approved:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'photobook_orders' THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.stripe_checkout_session_id IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_started',
          'product-event:checkout-started:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF NEW.paid_at IS NOT NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_completed',
          'product-event:checkout-completed:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    ELSE
      IF NEW.stripe_checkout_session_id IS NOT NULL
        AND OLD.stripe_checkout_session_id IS NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_started',
          'product-event:checkout-started:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
      IF NEW.paid_at IS NOT NULL AND OLD.paid_at IS NULL THEN
        PERFORM public.app_insert_product_event(
          'checkout_completed',
          'product-event:checkout-completed:' || NEW.id::text,
          NEW.owner_id
        );
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_TABLE_NAME = 'feedback_submissions' AND TG_OP = 'INSERT' THEN
    IF NEW.kind = 'feedback' THEN
      PERFORM public.app_insert_product_event(
        'feedback_submitted',
        'product-event:feedback-submitted:' || NEW.id::text,
        NEW.submitted_by_id
      );
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE TRIGGER beta_signup_product_event
AFTER INSERT ON public.auth_identity_mappings
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER onboarding_product_event
AFTER UPDATE OF onboarded_at ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER project_created_product_event
AFTER INSERT ON public.projects
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER first_update_product_event
AFTER INSERT ON public.updates
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER photo_upload_product_event
AFTER INSERT OR UPDATE OF status ON public.media_assets
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER follow_product_event
AFTER INSERT OR UPDATE OF status ON public.user_relationships
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER comment_created_product_event
AFTER INSERT ON public.comments
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER photobook_draft_product_event
AFTER INSERT OR UPDATE OF status ON public.photobook_drafts
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER photobook_proof_product_event
AFTER INSERT OR UPDATE OF status, approved_at ON public.photobook_revisions
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER checkout_product_event
AFTER INSERT OR UPDATE OF stripe_checkout_session_id, paid_at ON public.photobook_orders
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
CREATE TRIGGER feedback_product_event
AFTER INSERT ON public.feedback_submissions
FOR EACH ROW EXECUTE FUNCTION public.app_capture_product_event();
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_product_event_properties_valid(text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_product_event_subject_hash(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_insert_product_event(text, text, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_create_beta_invite(uuid, text, text, integer, timestamptz, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_revoke_beta_invite(text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_reserve_beta_invite(text, text, text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_complete_beta_signup(text, text, text, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_record_client_product_event(uuid, text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_capture_product_event() FROM PUBLIC;
