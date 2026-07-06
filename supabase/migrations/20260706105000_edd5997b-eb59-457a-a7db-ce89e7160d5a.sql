-- 1. New table
CREATE TABLE public.trip_budgets (
  trip_id uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  budget_total numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.trip_budgets TO authenticated;
GRANT SELECT ON public.trip_budgets TO anon;
GRANT ALL ON public.trip_budgets TO service_role;

-- 3. Backfill from existing trips
INSERT INTO public.trip_budgets (trip_id, budget_total)
SELECT id, budget_total FROM public.trips WHERE budget_total IS NOT NULL;

-- 4. RLS
ALTER TABLE public.trip_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View budget total when allowed"
  ON public.trip_budgets FOR SELECT
  USING (public.can_view_budget(trip_id));

CREATE POLICY "Owner can insert budget total"
  ON public.trip_budgets FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can update budget total"
  ON public.trip_budgets FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can delete budget total"
  ON public.trip_budgets FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

-- 5. updated_at trigger
CREATE TRIGGER update_trip_budgets_updated_at
  BEFORE UPDATE ON public.trip_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 6. Drop the leaky column from trips
ALTER TABLE public.trips DROP COLUMN budget_total;