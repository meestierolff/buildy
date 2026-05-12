DROP POLICY IF EXISTS "Anyone can view trip media" ON storage.objects;

CREATE POLICY "Users can view own folder in trip-media"
ON storage.objects
FOR SELECT
USING (
  bucket_id = 'trip-media'
  AND auth.uid()::text = (storage.foldername(name))[1]
);