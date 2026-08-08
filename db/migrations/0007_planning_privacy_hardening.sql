-- Budgets remain private until a dedicated, auditable sharing capability exists.
-- This is a privacy-reducing flag, so fail closed for both existing and future rows.
UPDATE public.project_budgets
SET is_shared = false,
    updated_at = statement_timestamp()
WHERE is_shared = true;

ALTER TABLE public.project_budgets
  ADD CONSTRAINT project_budgets_private_ck CHECK (is_shared = false);

ALTER TABLE public.floorplan_pins
  ADD COLUMN version integer DEFAULT 1 NOT NULL;

ALTER TABLE public.floorplan_pins
  ADD CONSTRAINT floorplan_pins_version_ck CHECK (version > 0);

CREATE FUNCTION public.validate_floorplan_asset_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.media_assets asset
    WHERE asset.id = NEW.media_asset_id
      AND asset.project_id = NEW.project_id
      AND asset.owner_id = NEW.owner_id
      AND asset.original_asset_id IS NULL
      AND asset.purpose = 'floorplan'
      AND asset.status = 'ready'
      AND asset.is_current
      AND asset.deleted_at IS NULL
      AND asset.ready_at IS NOT NULL
      AND asset.detected_content_type LIKE 'image/%'
      AND asset.size_bytes IS NOT NULL
      AND asset.sha256 IS NOT NULL
      AND asset.width_pixels > 0
      AND asset.height_pixels > 0
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid floorplan media asset';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER floorplans_validate_asset_scope
BEFORE INSERT OR UPDATE OF project_id, owner_id, media_asset_id
ON public.floorplans
FOR EACH ROW EXECUTE FUNCTION public.validate_floorplan_asset_scope();

CREATE FUNCTION public.validate_floorplan_pin_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.floorplan_id IS DISTINCT FROM OLD.floorplan_id
    OR NEW.update_id IS DISTINCT FROM OLD.update_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'floorplan pin linkage is immutable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.floorplans floorplan
    JOIN public.media_assets asset
      ON asset.id = floorplan.media_asset_id
     AND asset.project_id = floorplan.project_id
     AND asset.owner_id = floorplan.owner_id
    WHERE floorplan.id = NEW.floorplan_id
      AND floorplan.project_id = NEW.project_id
      AND asset.original_asset_id IS NULL
      AND asset.purpose = 'floorplan'
      AND asset.status = 'ready'
      AND asset.is_current
      AND asset.deleted_at IS NULL
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.updates project_update
    WHERE project_update.id = NEW.update_id
      AND project_update.project_id = NEW.project_id
      AND project_update.status IN ('draft', 'published')
      AND project_update.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid floorplan pin scope';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER floorplan_pins_validate_scope
BEFORE INSERT OR UPDATE OF project_id, floorplan_id, update_id
ON public.floorplan_pins
FOR EACH ROW EXECUTE FUNCTION public.validate_floorplan_pin_scope();

CREATE FUNCTION public.guard_project_budget_server_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF NEW.is_shared THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'project budget must remain private';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.currency <> 'EUR' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'unsupported project budget currency';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.id IS DISTINCT FROM OLD.id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
    OR NEW.currency IS DISTINCT FROM OLD.currency
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'project budget server fields are immutable';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER project_budgets_guard_server_fields
BEFORE INSERT OR UPDATE OF id, project_id, owner_id, currency, is_shared
ON public.project_budgets
FOR EACH ROW EXECUTE FUNCTION public.guard_project_budget_server_fields();

CREATE FUNCTION public.validate_budget_item_scope()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND (
    NEW.budget_id IS DISTINCT FROM OLD.budget_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.created_by_id IS DISTINCT FROM OLD.created_by_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'budget item ownership is immutable';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.project_budgets budget
    WHERE budget.id = NEW.budget_id
      AND budget.project_id = NEW.project_id
      AND budget.owner_id = NEW.created_by_id
      AND budget.is_shared = false
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid budget item ownership';
  END IF;

  IF NEW.update_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.updates project_update
    WHERE project_update.id = NEW.update_id
      AND project_update.project_id = NEW.project_id
      AND project_update.project_owner_id = NEW.created_by_id
      AND project_update.author_id = NEW.created_by_id
      AND project_update.status IN ('draft', 'published')
      AND project_update.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'invalid budget item update';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER budget_items_validate_scope
BEFORE INSERT OR UPDATE OF budget_id, project_id, update_id, created_by_id
ON public.budget_items
FOR EACH ROW EXECUTE FUNCTION public.validate_budget_item_scope();

DROP POLICY floorplans_select_visible ON public.floorplans;
DROP POLICY floorplans_owner_all ON public.floorplans;
CREATE POLICY floorplans_select_visible
ON public.floorplans
FOR SELECT
USING (
  app_can_view_project(project_id)
  AND EXISTS (
    SELECT 1
    FROM public.media_assets asset
    WHERE asset.id = media_asset_id
      AND asset.project_id = floorplans.project_id
      AND asset.owner_id = floorplans.owner_id
      AND asset.original_asset_id IS NULL
      AND asset.purpose = 'floorplan'
      AND asset.status = 'ready'
      AND asset.is_current
      AND asset.deleted_at IS NULL
      AND asset.ready_at IS NOT NULL
      AND asset.detected_content_type LIKE 'image/%'
      AND asset.size_bytes IS NOT NULL
      AND asset.sha256 IS NOT NULL
      AND asset.width_pixels > 0
      AND asset.height_pixels > 0
  )
);

CREATE POLICY floorplans_owner_insert
ON public.floorplans
FOR INSERT
WITH CHECK (owner_id = app_actor_id() AND app_owns_project(project_id));

CREATE POLICY floorplans_owner_update
ON public.floorplans
FOR UPDATE
USING (owner_id = app_actor_id() AND app_owns_project(project_id))
WITH CHECK (owner_id = app_actor_id() AND app_owns_project(project_id));

CREATE POLICY floorplans_owner_delete
ON public.floorplans
FOR DELETE
USING (owner_id = app_actor_id() AND app_owns_project(project_id));

DROP POLICY floorplan_pins_select_visible ON public.floorplan_pins;
DROP POLICY floorplan_pins_owner_all ON public.floorplan_pins;
CREATE POLICY floorplan_pins_select_visible
ON public.floorplan_pins
FOR SELECT
USING (
  app_can_view_project(project_id)
  AND EXISTS (
    SELECT 1
    FROM public.floorplans floorplan
    WHERE floorplan.id = floorplan_id
      AND floorplan.project_id = floorplan_pins.project_id
  )
  AND EXISTS (
    SELECT 1
    FROM public.updates project_update
    WHERE project_update.id = update_id
      AND project_update.project_id = floorplan_pins.project_id
      AND project_update.deleted_at IS NULL
      AND (
        app_owns_project(floorplan_pins.project_id)
        OR project_update.status = 'published'
      )
  )
);

CREATE POLICY floorplan_pins_owner_insert
ON public.floorplan_pins
FOR INSERT
WITH CHECK (app_owns_project(project_id));

CREATE POLICY floorplan_pins_owner_update
ON public.floorplan_pins
FOR UPDATE
USING (app_owns_project(project_id))
WITH CHECK (app_owns_project(project_id));

CREATE POLICY floorplan_pins_owner_delete
ON public.floorplan_pins
FOR DELETE
USING (app_owns_project(project_id));

DROP POLICY budgets_select_visible ON public.project_budgets;
CREATE POLICY budgets_select_owner
ON public.project_budgets
FOR SELECT
USING (owner_id = app_actor_id() AND is_shared = false);

DROP POLICY budget_items_select_visible ON public.budget_items;
CREATE POLICY budget_items_select_owner
ON public.budget_items
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.project_budgets budget
    WHERE budget.id = budget_id
      AND budget.project_id = budget_items.project_id
      AND budget.owner_id = app_actor_id()
      AND budget.is_shared = false
  )
);

ALTER TABLE public.floorplans FORCE ROW LEVEL SECURITY;
ALTER TABLE public.floorplan_pins FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_budgets FORCE ROW LEVEL SECURITY;
ALTER TABLE public.budget_items FORCE ROW LEVEL SECURITY;

REVOKE ALL ON FUNCTION public.validate_floorplan_asset_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_floorplan_pin_scope() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_project_budget_server_fields() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_budget_item_scope() FROM PUBLIC;
