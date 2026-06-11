ALTER TABLE public.photobook_orders
  ADD COLUMN IF NOT EXISTS payment_provider text NOT NULL DEFAULT 'stripe',
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_amount_cents integer,
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'eur',
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS fulfillment_error text,
  ADD COLUMN IF NOT EXISTS peecho_order_request jsonb NOT NULL DEFAULT '{}'::jsonb;

DROP POLICY IF EXISTS "Owner can update photobook orders" ON public.photobook_orders;
DROP POLICY IF EXISTS "Owner can delete photobook orders" ON public.photobook_orders;

CREATE INDEX IF NOT EXISTS idx_photobook_orders_stripe_session
ON public.photobook_orders(stripe_checkout_session_id);

CREATE INDEX IF NOT EXISTS idx_photobook_orders_payment_status
ON public.photobook_orders(payment_status, fulfillment_status);

CREATE TABLE IF NOT EXISTS public.photobook_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.photobook_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.photobook_order_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owner can view photobook order events"
ON public.photobook_order_events FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.photobook_orders o
    WHERE o.id = order_id
      AND o.user_id = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.trips t
        WHERE t.id = o.trip_id
          AND t.user_id = auth.uid()
      )
  )
);

GRANT SELECT ON public.photobook_order_events TO authenticated;
GRANT ALL ON public.photobook_order_events TO service_role;
