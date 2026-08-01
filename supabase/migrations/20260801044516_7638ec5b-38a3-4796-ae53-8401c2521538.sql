ALTER TABLE public.photobook_orders
  ADD COLUMN IF NOT EXISTS pdf_storage_path text,
  ADD COLUMN IF NOT EXISTS pdf_delete_after timestamptz;

ALTER TABLE public.photobook_orders ALTER COLUMN pdf_url DROP NOT NULL;