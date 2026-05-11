
-- Tighten trip-media INSERT policy: enforce path ownership
DROP POLICY IF EXISTS "Authenticated users can upload trip media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload to trip-media" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload trip-media" ON storage.objects;

CREATE POLICY "Users upload to own folder in trip-media"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'trip-media'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- Also ensure UPDATE/DELETE are scoped to own folder (idempotent re-create)
DROP POLICY IF EXISTS "Users can update own trip media" ON storage.objects;
CREATE POLICY "Users update own folder in trip-media"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'trip-media'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

DROP POLICY IF EXISTS "Users can delete own trip media" ON storage.objects;
CREATE POLICY "Users delete own folder in trip-media"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'trip-media'
  AND (auth.uid())::text = (storage.foldername(name))[1]
);

-- Restrict EXECUTE on SECURITY DEFINER helper functions.
-- They are still callable from RLS policies (which evaluate as table owner).
REVOKE EXECUTE ON FUNCTION public.can_view_trip(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.can_view_step(uuid) FROM anon, authenticated, public;
