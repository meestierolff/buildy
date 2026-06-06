
-- 1. Prevent privilege escalation on profiles.is_pro via trigger
CREATE OR REPLACE FUNCTION public.prevent_profile_privileged_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only allow is_pro changes from service_role (server-side)
  IF NEW.is_pro IS DISTINCT FROM OLD.is_pro
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Not allowed to modify is_pro';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_privileged_changes ON public.profiles;
CREATE TRIGGER profiles_prevent_privileged_changes
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privileged_changes();

-- 2. Explicit deny INSERT policy on notifications for clients
DROP POLICY IF EXISTS "No client inserts on notifications" ON public.notifications;
CREATE POLICY "No client inserts on notifications"
ON public.notifications
FOR INSERT
TO authenticated, anon
WITH CHECK (false);
