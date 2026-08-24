-- Preserve historical provider values while making every implicit new media
-- record use the active private Vercel Blob namespace.
ALTER TABLE public.media_assets
  ALTER COLUMN storage_provider SET DEFAULT 'vercel_blob';
--> statement-breakpoint
