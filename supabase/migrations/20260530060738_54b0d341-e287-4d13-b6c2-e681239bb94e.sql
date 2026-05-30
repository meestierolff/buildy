ALTER TABLE public.step_budget
  ADD COLUMN IF NOT EXISTS diy_cost numeric,
  ADD COLUMN IF NOT EXISTS diy_hours numeric,
  ADD COLUMN IF NOT EXISTS outsourced_cost numeric,
  ADD COLUMN IF NOT EXISTS outsourced_hours numeric;