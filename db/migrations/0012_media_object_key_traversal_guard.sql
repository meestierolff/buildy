-- The original generated SQL lost the backslashes from `\.\.` and therefore
-- treated any two-character path segment as traversal. Character classes keep
-- the intent stable across generators and PostgreSQL string settings.

ALTER TABLE public.media_assets
  DROP CONSTRAINT media_assets_object_key_ck;

ALTER TABLE public.media_assets
  ADD CONSTRAINT media_assets_object_key_ck
  CHECK (
    length(object_key) BETWEEN 1 AND 1024
    AND object_key !~ '(^|/)[.][.](/|$)'
  );
