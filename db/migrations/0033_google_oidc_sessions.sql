-- Google OpenID Connect is the only active authentication method. The legacy
-- Better Auth tables stay intact so existing Google identities can be adopted
-- without changing provider subjects or historical account data.
CREATE TABLE public.google_oidc_identities (
  subject text PRIMARY KEY,
  auth_user_id text NOT NULL UNIQUE
    REFERENCES public.auth_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  last_authenticated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT google_oidc_identities_subject_ck CHECK (
    char_length(subject) BETWEEN 1 AND 255
    AND subject !~ '[[:cntrl:]]'
  ),
  CONSTRAINT google_oidc_identities_authenticated_clock_ck CHECK (
    last_authenticated_at >= created_at
  )
);

CREATE TABLE public.google_oidc_login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  source_hash text NOT NULL,
  browser_binding_hash text NOT NULL,
  code_verifier_ciphertext text NOT NULL,
  nonce_ciphertext text NOT NULL,
  next_path text NOT NULL DEFAULT '/',
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT google_oidc_login_attempts_state_hash_ck CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT google_oidc_login_attempts_source_hash_ck CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT google_oidc_login_attempts_browser_binding_hash_ck CHECK (
    browser_binding_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT google_oidc_login_attempts_verifier_ciphertext_ck CHECK (
    code_verifier_ciphertext LIKE 'v1.%'
    AND char_length(code_verifier_ciphertext) <= 1024
  ),
  CONSTRAINT google_oidc_login_attempts_nonce_ciphertext_ck CHECK (
    nonce_ciphertext LIKE 'v1.%'
    AND char_length(nonce_ciphertext) <= 1024
  ),
  CONSTRAINT google_oidc_login_attempts_next_path_ck CHECK (
    char_length(next_path) BETWEEN 1 AND 2048
    AND left(next_path, 1) = '/'
    AND left(next_path, 2) <> '//'
    AND next_path !~ '[[:cntrl:]]'
    AND position(chr(92) in next_path) = 0
  ),
  CONSTRAINT google_oidc_login_attempts_expiry_ck CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '15 minutes'
  ),
  CONSTRAINT google_oidc_login_attempts_consumed_ck CHECK (
    consumed_at IS NULL OR consumed_at >= created_at
  )
);

CREATE INDEX google_oidc_login_attempts_source_expiry_idx
  ON public.google_oidc_login_attempts (source_hash, expires_at)
  WHERE consumed_at IS NULL;
CREATE INDEX google_oidc_login_attempts_expiry_idx
  ON public.google_oidc_login_attempts (expires_at);

CREATE TABLE public.google_oidc_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_subject text NOT NULL
    REFERENCES public.google_oidc_identities(subject) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  user_agent text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  CONSTRAINT google_oidc_sessions_token_hash_ck CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT google_oidc_sessions_user_agent_ck CHECK (
    user_agent IS NULL OR char_length(user_agent) BETWEEN 1 AND 1000
  ),
  CONSTRAINT google_oidc_sessions_expiry_ck CHECK (
    expires_at > created_at
    AND expires_at <= created_at + interval '8 days'
  ),
  CONSTRAINT google_oidc_sessions_revoked_ck CHECK (
    revoked_at IS NULL OR revoked_at >= created_at
  )
);

CREATE INDEX google_oidc_sessions_identity_expiry_idx
  ON public.google_oidc_sessions (identity_subject, expires_at DESC)
  WHERE revoked_at IS NULL;
CREATE INDEX google_oidc_sessions_expiry_idx
  ON public.google_oidc_sessions (expires_at);

-- Adopt only unambiguous, already-linked Google accounts. OAuth access,
-- refresh, and ID tokens deliberately never cross into the new tables.
INSERT INTO public.google_oidc_identities (
  subject,
  auth_user_id,
  created_at,
  updated_at,
  last_authenticated_at
)
SELECT
  account.account_id,
  account.user_id,
  least(account.created_at, auth_user.created_at),
  greatest(account.updated_at, auth_user.updated_at),
  greatest(account.updated_at, auth_user.updated_at)
FROM public.auth_accounts account
JOIN public.auth_users auth_user ON auth_user.id = account.user_id
JOIN public.auth_identity_mappings mapping
  ON mapping.auth_user_id = account.user_id
 AND mapping.migration_status = 'linked'
JOIN public.app_users app_user
  ON app_user.id = mapping.app_user_id
 AND app_user.status = 'active'
 AND app_user.deleted_at IS NULL
WHERE lower(account.provider_id) = 'google'
  AND char_length(account.account_id) BETWEEN 1 AND 255
  AND account.account_id !~ '[[:cntrl:]]'
ON CONFLICT DO NOTHING;

REVOKE ALL ON TABLE public.google_oidc_identities FROM PUBLIC;
REVOKE ALL ON TABLE public.google_oidc_login_attempts FROM PUBLIC;
REVOKE ALL ON TABLE public.google_oidc_sessions FROM PUBLIC;
