-- Add separate cost/hours columns for "mixed" (combinatie) work type
-- These allow users to specify DIY vs outsourced breakdown within a combined budget entry
ALTER TABLE step_budget
  ADD COLUMN IF NOT EXISTS diy_cost      NUMERIC,
  ADD COLUMN IF NOT EXISTS diy_hours     NUMERIC,
  ADD COLUMN IF NOT EXISTS outsourced_cost  NUMERIC,
  ADD COLUMN IF NOT EXISTS outsourced_hours NUMERIC;
