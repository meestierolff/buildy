-- PostgreSQL applies SELECT policies to rows produced by UPDATE. A soft-delete
-- therefore needs a narrowly scoped read path for its resulting tombstone;
-- otherwise an otherwise-authorized author/owner UPDATE fails its RLS check.
-- Only the comment author or active project owner can observe that tombstone.

DROP POLICY IF EXISTS comments_select_tombstone_manager ON public.comments;
CREATE POLICY comments_select_tombstone_manager ON public.comments FOR SELECT
USING (
  status = 'deleted'
  AND public.app_can_manage_comment(id)
);
