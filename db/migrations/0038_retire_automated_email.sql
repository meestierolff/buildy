-- Buildy has no e-mail provider in the MVP. Keep the historical tables and
-- functions for audit/rollback evidence, but remove every automatic producer.

DROP TRIGGER IF EXISTS app_users_require_email_recipient_before_first_auth
ON public.app_users;
--> statement-breakpoint
DROP TRIGGER IF EXISTS app_users_enqueue_welcome_email
ON public.app_users;
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_access_requests_enqueue_email
ON public.project_access_requests;
--> statement-breakpoint
DROP TRIGGER IF EXISTS deletion_jobs_enqueue_security_email
ON public.deletion_jobs;
--> statement-breakpoint
DROP TRIGGER IF EXISTS photobook_order_events_enqueue_transactional_email
ON public.photobook_order_events;
--> statement-breakpoint

-- Some historical SECURITY DEFINER commands insert provider work directly
-- instead of going through one of the retired producer triggers. Preserve the
-- commands and existing outbox history, but reject new e-mail and automated
-- print events at the canonical outbox boundary.
CREATE OR REPLACE FUNCTION public.app_suppress_retired_provider_outbox_event()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.event_type LIKE '%.email.%'
    OR NEW.event_type IN (
      'lifecycle.welcome.requested.v1',
      'social.access_requested.requested.v1',
      'social.access_accepted.requested.v1',
      'security.account_alert.requested.v1',
      'migration.account.requested.v1',
      'moderation.report.received.requested.v1',
      'support.confirmation.requested.v1',
      'photobook_order.paid.v1'
    ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END
$function$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.app_suppress_retired_provider_outbox_event()
FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER outbox_events_suppress_retired_provider_automation
BEFORE INSERT ON public.outbox_events
FOR EACH ROW
EXECUTE FUNCTION public.app_suppress_retired_provider_outbox_event();
--> statement-breakpoint
