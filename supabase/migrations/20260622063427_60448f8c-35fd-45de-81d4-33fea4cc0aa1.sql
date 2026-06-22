ALTER TABLE public.photobook_orders
  ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS payment_amount_cents integer,
  ADD COLUMN IF NOT EXISTS payment_currency text NOT NULL DEFAULT 'eur',
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS fulfillment_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS fulfillment_error text,
  ADD COLUMN IF NOT EXISTS peecho_order_request jsonb,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_email text;

CREATE INDEX IF NOT EXISTS photobook_orders_stripe_session_idx
  ON public.photobook_orders (stripe_checkout_session_id);

CREATE TABLE IF NOT EXISTS public.photobook_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.photobook_orders(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS photobook_order_events_order_idx
  ON public.photobook_order_events (order_id, created_at DESC);

GRANT SELECT ON public.photobook_order_events TO authenticated;
GRANT ALL ON public.photobook_order_events TO service_role;

ALTER TABLE public.photobook_order_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner can view order events" ON public.photobook_order_events;
CREATE POLICY "Owner can view order events"
ON public.photobook_order_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.photobook_orders o
    WHERE o.id = photobook_order_events.order_id
      AND o.user_id = auth.uid()
  )
);