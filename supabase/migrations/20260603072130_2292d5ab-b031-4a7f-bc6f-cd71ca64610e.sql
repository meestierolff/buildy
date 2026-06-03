
-- Move contractor PII off the publicly readable steps table into an owner-only side table
CREATE TABLE public.step_contractor_info (
  step_id uuid PRIMARY KEY,
  trip_id uuid NOT NULL,
  contractor_name text,
  contractor_notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.step_contractor_info TO authenticated;
GRANT ALL ON public.step_contractor_info TO service_role;

ALTER TABLE public.step_contractor_info ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can view contractor info"
ON public.step_contractor_info FOR SELECT
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = step_contractor_info.trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can insert contractor info"
ON public.step_contractor_info FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = step_contractor_info.trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can update contractor info"
ON public.step_contractor_info FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = step_contractor_info.trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can delete contractor info"
ON public.step_contractor_info FOR DELETE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = step_contractor_info.trip_id AND t.user_id = auth.uid()));

-- Migrate existing data
INSERT INTO public.step_contractor_info (step_id, trip_id, contractor_name, contractor_notes)
SELECT id, trip_id, contractor_name, contractor_notes
FROM public.steps
WHERE contractor_name IS NOT NULL OR contractor_notes IS NOT NULL;

-- Drop the publicly exposed columns
ALTER TABLE public.steps DROP COLUMN contractor_name;
ALTER TABLE public.steps DROP COLUMN contractor_notes;
