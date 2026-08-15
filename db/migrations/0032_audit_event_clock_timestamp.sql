-- Audit ordering should reflect actual statement order, not a transaction-wide
-- timestamp shared by multiple actions inside one admin workflow.

ALTER TABLE public.audit_events
  ALTER COLUMN created_at SET DEFAULT clock_timestamp();