-- Username/password is the active login method. Existing Google identities and
-- their history remain intact; no account is assigned a fabricated email.
ALTER TABLE public.auth_users ALTER COLUMN email DROP NOT NULL;

CREATE TABLE public.password_credentials (
  auth_user_id text PRIMARY KEY REFERENCES public.auth_users(id) ON DELETE CASCADE,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT password_credentials_username_ck CHECK (username ~ '^[a-z0-9][a-z0-9_.-]{2,31}$'),
  CONSTRAINT password_credentials_hash_ck CHECK (
    password_hash ~ '^scrypt\$v1\$131072\$8\$1\$[0-9a-f]{32}\$[0-9a-f]{128}$'
  )
);

CREATE TABLE public.password_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text NOT NULL REFERENCES public.auth_users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT password_sessions_token_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT password_sessions_user_agent_ck CHECK (user_agent IS NULL OR char_length(user_agent) BETWEEN 1 AND 1000),
  CONSTRAINT password_sessions_expiry_ck CHECK (
    expires_at > created_at AND expires_at <= created_at + interval '8 days'
  ),
  CONSTRAINT password_sessions_revoked_ck CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX password_sessions_user_expiry_idx
  ON public.password_sessions (auth_user_id, expires_at DESC) WHERE revoked_at IS NULL;
CREATE INDEX password_sessions_expiry_idx ON public.password_sessions (expires_at);

-- Anonymous authentication cannot directly bypass the domain's self-only RLS.
-- This narrow web-only function serializes session creation with account
-- suspension/deletion, without granting writes to app_users or mappings.
CREATE FUNCTION public.app_lock_password_auth_identity(subject_auth_user_id text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT app_user.id
  FROM public.password_credentials credential
  JOIN public.auth_identity_mappings mapping ON mapping.auth_user_id = credential.auth_user_id
  JOIN public.app_users app_user ON app_user.id = mapping.app_user_id
  WHERE credential.auth_user_id = subject_auth_user_id
    AND mapping.migration_status = 'linked'
    AND app_user.status = 'active'
    AND app_user.deleted_at IS NULL
  FOR UPDATE OF app_user
$function$;

-- Restoring account status never resurrects sessions revoked by moderation or
-- a deletion request. Final identity erasure cascades credentials and sessions.
CREATE FUNCTION public.app_revoke_password_sessions_on_account_restriction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.status <> 'active' OR NEW.deleted_at IS NOT NULL THEN
    UPDATE public.password_sessions session
    SET revoked_at = greatest(statement_timestamp(), session.created_at),
        updated_at = greatest(statement_timestamp(), session.created_at)
    FROM public.auth_identity_mappings mapping
    WHERE mapping.app_user_id = NEW.id
      AND mapping.auth_user_id = session.auth_user_id
      AND session.revoked_at IS NULL;
  END IF;
  RETURN NEW;
END
$function$;
CREATE TRIGGER app_users_revoke_password_sessions
AFTER UPDATE OF status, deleted_at ON public.app_users
FOR EACH ROW EXECUTE FUNCTION public.app_revoke_password_sessions_on_account_restriction();

REVOKE ALL ON TABLE public.password_credentials, public.password_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_lock_password_auth_identity(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_revoke_password_sessions_on_account_restriction() FROM PUBLIC;
