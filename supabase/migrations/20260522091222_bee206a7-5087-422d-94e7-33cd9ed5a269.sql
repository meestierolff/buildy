
-- Privacy toggle on profiles
ALTER TABLE public.profiles ADD COLUMN is_private boolean NOT NULL DEFAULT false;

-- User-to-user follows (social)
CREATE TABLE public.user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL,
  following_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User follows are viewable by everyone"
  ON public.user_follows FOR SELECT USING (true);

CREATE POLICY "Users can follow others"
  ON public.user_follows FOR INSERT WITH CHECK (auth.uid() = follower_id);

CREATE POLICY "Users can unfollow"
  ON public.user_follows FOR DELETE USING (auth.uid() = follower_id);

CREATE INDEX idx_user_follows_follower ON public.user_follows(follower_id);
CREATE INDEX idx_user_follows_following ON public.user_follows(following_id);
