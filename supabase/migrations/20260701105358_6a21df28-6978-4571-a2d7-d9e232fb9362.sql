
-- 1) follows: force INSERTs to status='pending'; triggers set 'accepted' for public projects
DROP POLICY IF EXISTS "Users can follow or request to follow any project" ON public.follows;
CREATE POLICY "Users can follow or request to follow any project"
ON public.follows
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND status = 'pending'
  AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = follows.project_id)
);

-- 2) photobook_orders: remove client UPDATE/DELETE; only service_role (Edge Functions) may mutate
DROP POLICY IF EXISTS "Owner can update photobook orders" ON public.photobook_orders;
DROP POLICY IF EXISTS "Owner can delete photobook orders" ON public.photobook_orders;

-- 3) trip-private storage: enforce path structure user_id/step_id/filename on INSERT and UPDATE
DROP POLICY IF EXISTS "trip-private: owner can insert" ON storage.objects;
CREATE POLICY "trip-private: owner can insert"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'trip-private'
  AND (auth.uid())::text = (storage.foldername(name))[1]
  AND array_length(storage.foldername(name), 1) >= 2
  AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
);

DROP POLICY IF EXISTS "trip-private: owner can update" ON storage.objects;
CREATE POLICY "trip-private: owner can update"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'trip-private'
  AND (auth.uid())::text = (storage.foldername(name))[1]
)
WITH CHECK (
  bucket_id = 'trip-private'
  AND (auth.uid())::text = (storage.foldername(name))[1]
  AND array_length(storage.foldername(name), 1) >= 2
  AND (storage.foldername(name))[2] ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
);
