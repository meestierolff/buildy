CREATE OR REPLACE FUNCTION app_resolve_active_user(subject_auth_user_id text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT mapping.app_user_id
  FROM public.auth_identity_mappings mapping
  JOIN public.app_users app_user ON app_user.id = mapping.app_user_id
  WHERE mapping.auth_user_id = subject_auth_user_id
    AND mapping.migration_status = 'linked'
    AND app_user.status = 'active'
    AND app_user.deleted_at IS NULL
  LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION app_provision_auth_identity(
  subject_auth_user_id text,
  candidate_app_user_id uuid,
  mark_authenticated boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  resolved_app_user_id uuid;
  resolved_status public.app_user_status;
  profile_name text;
BEGIN
  IF subject_auth_user_id IS NULL
    OR char_length(subject_auth_user_id) NOT BETWEEN 1 AND 512
    OR candidate_app_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid auth identity input';
  END IF;

  SELECT left(
    coalesce(nullif(btrim(regexp_replace(auth_user.name, '[[:space:]]+', ' ', 'g')), ''), 'Nieuwe verbouwer'),
    80
  )
  INTO profile_name
  FROM public.auth_users auth_user
  WHERE auth_user.id = subject_auth_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'auth user missing';
  END IF;

  SELECT mapping.app_user_id
  INTO resolved_app_user_id
  FROM public.auth_identity_mappings mapping
  WHERE mapping.auth_user_id = subject_auth_user_id;

  IF resolved_app_user_id IS NULL THEN
    INSERT INTO public.app_users (id) VALUES (candidate_app_user_id);

    INSERT INTO public.auth_identity_mappings (
      app_user_id,
      auth_user_id,
      migration_status,
      linked_at
    ) VALUES (
      candidate_app_user_id,
      subject_auth_user_id,
      'linked',
      statement_timestamp()
    )
    ON CONFLICT (auth_user_id) DO NOTHING;

    SELECT mapping.app_user_id
    INTO resolved_app_user_id
    FROM public.auth_identity_mappings mapping
    WHERE mapping.auth_user_id = subject_auth_user_id;

    IF resolved_app_user_id IS DISTINCT FROM candidate_app_user_id THEN
      DELETE FROM public.app_users candidate
      WHERE candidate.id = candidate_app_user_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.auth_identity_mappings mapping
          WHERE mapping.app_user_id = candidate.id
        );
    END IF;
  END IF;

  IF resolved_app_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'identity mapping missing';
  END IF;

  SELECT app_user.status
  INTO resolved_status
  FROM public.app_users app_user
  WHERE app_user.id = resolved_app_user_id
    AND app_user.deleted_at IS NULL;

  IF resolved_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'app user missing';
  END IF;
  IF mark_authenticated AND resolved_status <> 'active' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'app user inactive';
  END IF;

  INSERT INTO public.profiles (user_id, display_name, slug)
  VALUES (
    resolved_app_user_id,
    profile_name,
    'verbouwer-' || replace(lower(resolved_app_user_id::text), '-', '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  IF mark_authenticated THEN
    UPDATE public.app_users
    SET last_authenticated_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE id = resolved_app_user_id;
  END IF;

  RETURN resolved_app_user_id;
END
$function$;

CREATE OR REPLACE FUNCTION app_enqueue_auth_email(
  email_aggregate_id uuid,
  email_event_type text,
  email_idempotency_key text,
  protected_payload jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  email_kind text;
BEGIN
  email_kind := protected_payload ->> 'kind';
  IF email_event_type NOT IN (
      'auth.email.verify_email',
      'auth.email.magic_link',
      'auth.email.reset_password'
    )
    OR email_event_type <> 'auth.email.' || coalesce(email_kind, '')
    OR protected_payload ->> 'schemaVersion' <> '1'
    OR protected_payload ->> 'recipientCiphertext' !~ '^v1\.'
    OR protected_payload ->> 'actionUrlCiphertext' !~ '^v1\.'
    OR (
      protected_payload ? 'authUserIdHash'
      AND protected_payload ->> 'authUserIdHash' !~ '^[0-9a-f]{64}$'
    )
    OR protected_payload - ARRAY[
      'schemaVersion',
      'kind',
      'authUserIdHash',
      'recipientCiphertext',
      'actionUrlCiphertext'
    ] <> '{}'::jsonb
    OR email_idempotency_key !~ '^auth-email:v1:(verify_email|magic_link|reset_password):[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid protected auth email';
  END IF;

  INSERT INTO public.outbox_events (
    aggregate_type,
    aggregate_id,
    event_type,
    idempotency_key,
    payload
  ) VALUES (
    'auth_email',
    email_aggregate_id,
    email_event_type,
    email_idempotency_key,
    protected_payload
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
END
$function$;

CREATE POLICY outbox_events_select_actor_mutation
ON outbox_events
FOR SELECT
USING (
  (
    aggregate_type = 'project'
    AND EXISTS (
      SELECT 1 FROM projects project
      WHERE project.id = aggregate_id AND project.owner_id = app_actor_id()
    )
  )
  OR (
    aggregate_type = 'update'
    AND EXISTS (
      SELECT 1 FROM updates project_update
      WHERE project_update.id = aggregate_id
        AND project_update.project_owner_id = app_actor_id()
    )
  )
);

CREATE POLICY outbox_events_insert_actor_mutation
ON outbox_events
FOR INSERT
WITH CHECK (
  (
    aggregate_type = 'project'
    AND EXISTS (
      SELECT 1 FROM projects project
      WHERE project.id = aggregate_id AND project.owner_id = app_actor_id()
    )
  )
  OR (
    aggregate_type = 'update'
    AND EXISTS (
      SELECT 1 FROM updates project_update
      WHERE project_update.id = aggregate_id
        AND project_update.project_owner_id = app_actor_id()
    )
  )
);

REVOKE ALL ON FUNCTION app_resolve_active_user(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_provision_auth_identity(text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_enqueue_auth_email(uuid, text, text, jsonb) FROM PUBLIC;
