DROP POLICY IF EXISTS "Users manage own photobook pdfs" ON storage.objects;
CREATE POLICY "Users manage own photobook pdfs"
ON storage.objects FOR ALL TO authenticated
USING (
  bucket_id = 'photobook-pdfs'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'photobook-pdfs'
  AND (storage.foldername(name))[1] = auth.uid()::text
);