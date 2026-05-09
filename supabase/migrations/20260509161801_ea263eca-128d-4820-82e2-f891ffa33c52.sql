
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS progress_mode text NOT NULL DEFAULT 'manual';
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS custom_phases text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.photobook_settings (
  trip_id uuid PRIMARY KEY,
  cover_title text,
  cover_subtitle text,
  cover_media_id uuid,
  chapter_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.photobook_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Photobook settings readable if trip viewable"
ON public.photobook_settings FOR SELECT
USING (public.can_view_trip(trip_id));

CREATE POLICY "Owner can insert photobook settings"
ON public.photobook_settings FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can update photobook settings"
ON public.photobook_settings FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner can delete photobook settings"
ON public.photobook_settings FOR DELETE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.photobook_excluded_media (
  trip_id uuid NOT NULL,
  media_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, media_id)
);
ALTER TABLE public.photobook_excluded_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Excluded media readable if trip viewable"
ON public.photobook_excluded_media FOR SELECT
USING (public.can_view_trip(trip_id));

CREATE POLICY "Owner manages excluded media insert"
ON public.photobook_excluded_media FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner manages excluded media delete"
ON public.photobook_excluded_media FOR DELETE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.photobook_excluded_steps (
  trip_id uuid NOT NULL,
  step_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, step_id)
);
ALTER TABLE public.photobook_excluded_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Excluded steps readable if trip viewable"
ON public.photobook_excluded_steps FOR SELECT
USING (public.can_view_trip(trip_id));

CREATE POLICY "Owner manages excluded steps insert"
ON public.photobook_excluded_steps FOR INSERT
WITH CHECK (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));

CREATE POLICY "Owner manages excluded steps delete"
ON public.photobook_excluded_steps FOR DELETE
USING (EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.user_id = auth.uid()));
