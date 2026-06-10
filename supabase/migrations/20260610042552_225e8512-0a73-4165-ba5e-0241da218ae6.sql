
-- Profiles: respect is_private
DROP POLICY IF EXISTS "Profiles are viewable by everyone" ON public.profiles;
DROP POLICY IF EXISTS "Public profiles are viewable" ON public.profiles;
CREATE POLICY "Public or owner profiles are viewable"
  ON public.profiles FOR SELECT
  USING (is_private = false OR auth.uid() = user_id);

-- user_follows: restrict to authenticated; participants always allowed
DROP POLICY IF EXISTS "User follows are viewable by everyone" ON public.user_follows;
DROP POLICY IF EXISTS "Anyone can view user follows" ON public.user_follows;
CREATE POLICY "Authenticated users can view user follows"
  ON public.user_follows FOR SELECT
  TO authenticated
  USING (true);

-- Comments: allow owners to update their own
CREATE POLICY "Users can update their own comments"
  ON public.comments FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND public.can_view_step(step_id));

-- Reactions: allow owners to update their own
CREATE POLICY "Users can update their own reactions"
  ON public.reactions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
