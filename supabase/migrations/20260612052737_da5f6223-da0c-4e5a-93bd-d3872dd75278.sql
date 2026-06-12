
-- Add storage_path column to step_media for new private bucket uploads
ALTER TABLE public.step_media ADD COLUMN IF NOT EXISTS storage_path text;

-- RLS policies on storage.objects for the private 'trip-private' bucket
-- Path scheme: {userId}/{stepId}/{i}.{ext}

CREATE POLICY "trip-private: owner can read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "trip-private: viewers of step can read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'trip-private'
  AND public.can_view_step(((storage.foldername(name))[2])::uuid)
);

CREATE POLICY "trip-private: public can read for public steps"
ON storage.objects FOR SELECT TO anon
USING (
  bucket_id = 'trip-private'
  AND public.can_view_step(((storage.foldername(name))[2])::uuid)
);

CREATE POLICY "trip-private: owner can insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "trip-private: owner can update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "trip-private: owner can delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'trip-private'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
