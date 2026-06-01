CREATE TABLE IF NOT EXISTS public.photobook_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  merchant_reference text NOT NULL UNIQUE,
  peecho_id text UNIQUE,
  pdf_url text NOT NULL,
  format text NOT NULL,
  page_count integer NOT NULL CHECK (page_count > 0),
  status text NOT NULL DEFAULT 'ready_for_checkout',
  peecho_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  tracking_code text,
  tracking_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status_updated_at timestamptz,
  ordered_at timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.photobook_orders TO authenticated;
GRANT ALL ON public.photobook_orders TO service_role;

ALTER TABLE public.photobook_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can view photobook orders"
ON public.photobook_orders FOR SELECT
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid())
);

CREATE POLICY "Owner can create photobook orders"
ON public.photobook_orders FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid())
);

CREATE POLICY "Owner can update photobook orders"
ON public.photobook_orders FOR UPDATE
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid())
);

CREATE POLICY "Owner can delete photobook orders"
ON public.photobook_orders FOR DELETE
USING (
  auth.uid() = user_id
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid())
);

CREATE INDEX IF NOT EXISTS idx_photobook_orders_trip_id ON public.photobook_orders(trip_id);
CREATE INDEX IF NOT EXISTS idx_photobook_orders_user_id ON public.photobook_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_photobook_orders_reference ON public.photobook_orders(merchant_reference);

DROP TRIGGER IF EXISTS update_photobook_orders_updated_at ON public.photobook_orders;
CREATE TRIGGER update_photobook_orders_updated_at
BEFORE UPDATE ON public.photobook_orders
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();