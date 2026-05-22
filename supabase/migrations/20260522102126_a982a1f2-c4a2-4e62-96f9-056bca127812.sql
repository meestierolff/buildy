
-- 1. Move trips.address into owner-only private table
CREATE TABLE public.trip_private_info (
  trip_id uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  address text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.trip_private_info (trip_id, address)
SELECT id, address FROM public.trips WHERE address IS NOT NULL;

ALTER TABLE public.trips DROP COLUMN address;

ALTER TABLE public.trip_private_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can view own trip private info"
ON public.trip_private_info FOR SELECT
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can insert own trip private info"
ON public.trip_private_info FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can update own trip private info"
ON public.trip_private_info FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can delete own trip private info"
ON public.trip_private_info FOR DELETE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

-- 2. Move sensitive budget fields out of steps into a budget-gated table
CREATE TABLE public.step_budget (
  step_id uuid PRIMARY KEY REFERENCES public.steps(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  cost numeric,
  hours_spent numeric,
  work_type text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.step_budget (step_id, trip_id, cost, hours_spent, work_type)
SELECT id, trip_id, cost, hours_spent, work_type FROM public.steps
WHERE cost IS NOT NULL OR hours_spent IS NOT NULL OR work_type IS NOT NULL;

ALTER TABLE public.steps DROP COLUMN cost;
ALTER TABLE public.steps DROP COLUMN hours_spent;
ALTER TABLE public.steps DROP COLUMN work_type;

ALTER TABLE public.step_budget ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Budget readable if allowed"
ON public.step_budget FOR SELECT
USING (public.can_view_budget(trip_id));

CREATE POLICY "Owner can insert budget"
ON public.step_budget FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can update budget"
ON public.step_budget FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can delete budget"
ON public.step_budget FOR DELETE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE INDEX idx_step_budget_trip_id ON public.step_budget(trip_id);

-- 3. Restrict photobook editorial tables to trip owners only
DROP POLICY "Photobook settings readable if trip viewable" ON public.photobook_settings;
CREATE POLICY "Owner can view photobook settings"
ON public.photobook_settings FOR SELECT
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

DROP POLICY "Excluded media readable if trip viewable" ON public.photobook_excluded_media;
CREATE POLICY "Owner can view excluded media"
ON public.photobook_excluded_media FOR SELECT
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

DROP POLICY "Excluded steps readable if trip viewable" ON public.photobook_excluded_steps;
CREATE POLICY "Owner can view excluded steps"
ON public.photobook_excluded_steps FOR SELECT
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));
