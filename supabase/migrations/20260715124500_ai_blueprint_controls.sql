-- AI blueprint usage is disabled by configuration by default. When it is
-- explicitly enabled, this service-role-only counter provides an atomic daily
-- quota so parallel requests cannot bypass the spend limit.
CREATE TABLE IF NOT EXISTS public.ai_blueprint_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  usage_date date NOT NULL DEFAULT (timezone('utc', now()))::date,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, usage_date)
);

ALTER TABLE public.ai_blueprint_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_blueprint_usage FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.ai_blueprint_usage TO service_role;

CREATE OR REPLACE FUNCTION public.claim_ai_blueprint_quota(
  _user_id uuid,
  _daily_limit integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  claimed_user_id uuid;
BEGIN
  IF _user_id IS NULL OR _daily_limit IS NULL OR _daily_limit < 1 OR _daily_limit > 100 THEN
    RETURN false;
  END IF;

  INSERT INTO public.ai_blueprint_usage (user_id, usage_date, request_count, updated_at)
  VALUES (_user_id, (timezone('utc', now()))::date, 1, now())
  ON CONFLICT (user_id, usage_date) DO UPDATE
    SET request_count = public.ai_blueprint_usage.request_count + 1,
        updated_at = now()
    WHERE public.ai_blueprint_usage.request_count < _daily_limit
  RETURNING user_id INTO claimed_user_id;

  RETURN claimed_user_id IS NOT NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_ai_blueprint_quota(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_blueprint_quota(uuid, integer) TO service_role;
