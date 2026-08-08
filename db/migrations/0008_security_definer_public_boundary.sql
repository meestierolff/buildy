-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. RLS helper
-- functions and worker boundaries must instead be granted explicitly to the
-- environment-specific runtime roles after migrations have completed.
DO $hardening$
DECLARE
  routine record;
BEGIN
  FOR routine IN
    SELECT
      namespace.nspname AS schema_name,
      procedure.proname AS function_name,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid) AS identity_arguments
    FROM pg_catalog.pg_proc procedure
    JOIN pg_catalog.pg_namespace namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.prosecdef
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION %I.%I(%s) FROM PUBLIC',
      routine.schema_name,
      routine.function_name,
      routine.identity_arguments
    );
  END LOOP;
END
$hardening$;
