
DROP POLICY IF EXISTS "Profiles viewable by self, public or accepted follower" ON public.profiles;
CREATE POLICY "Profiles are publicly viewable"
ON public.profiles FOR SELECT
USING (true);
