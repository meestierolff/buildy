-- Extend the existing owner-only, forced-RLS budget records. Existing account
-- export (to_jsonb) and bounded deletion already include these rows/columns.
ALTER TABLE public.budget_items
  ADD COLUMN is_update_summary boolean NOT NULL DEFAULT false,
  ADD COLUMN private_notes text,
  ADD COLUMN own_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN contractor_minutes integer NOT NULL DEFAULT 0,
  ADD CONSTRAINT budget_items_private_notes_ck CHECK (private_notes IS NULL OR char_length(private_notes) <= 10000),
  ADD CONSTRAINT budget_items_minutes_ck CHECK (own_minutes BETWEEN 0 AND 6000000 AND contractor_minutes BETWEEN 0 AND 6000000),
  ADD CONSTRAINT budget_items_update_summary_ck CHECK (NOT is_update_summary OR (update_id IS NOT NULL AND kind = 'actual'));
CREATE UNIQUE INDEX budget_items_update_summary_uq ON public.budget_items(update_id) WHERE is_update_summary;

-- Phase deletion uses the existing project outbox idempotency mechanism. Add
-- its keyed request hash to both existing lifecycle erasure triggers while
-- preserving their current bodies, owners, fixed search paths and ACLs.
DO $migration$
DECLARE
  function_name text;
  definition text;
BEGIN
  FOREACH function_name IN ARRAY ARRAY[
    'public.app_redact_request_hashes_on_account_erasure()',
    'public.app_redact_request_hashes_on_project_erasure()'
  ] LOOP
    definition := pg_get_functiondef(function_name::regprocedure);
    IF position('''project.phase.created.v1''' in definition) = 0 THEN
      RAISE EXCEPTION 'Expected phase request redaction marker is missing';
    END IF;
    definition := replace(definition, '''project.phase.created.v1''',
      '''project.phase.created.v1'', ''project.phase.deleted.v1''');
    EXECUTE definition;
  END LOOP;
END
$migration$;
