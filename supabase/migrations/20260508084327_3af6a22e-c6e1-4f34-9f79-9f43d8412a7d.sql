
-- Follows: users follow projects (trips)
CREATE TABLE public.follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  project_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, project_id)
);
ALTER TABLE public.follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Follows readable by owner of follow or project owner"
  ON public.follows FOR SELECT
  USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = project_id AND t.user_id = auth.uid()));
CREATE POLICY "Users can follow projects" ON public.follows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can unfollow" ON public.follows FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_follows_project ON public.follows(project_id);
CREATE INDEX idx_follows_user ON public.follows(user_id);

-- Notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  type text NOT NULL,
  project_id uuid,
  step_id uuid,
  actor_id uuid,
  message text,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own notifications" ON public.notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own notifications" ON public.notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own notifications" ON public.notifications FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read, created_at DESC);

-- Emoji reactions on steps
CREATE TABLE public.reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id uuid NOT NULL,
  user_id uuid NOT NULL,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (step_id, user_id, emoji)
);
ALTER TABLE public.reactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Reactions viewable if step viewable" ON public.reactions FOR SELECT USING (public.can_view_step(step_id));
CREATE POLICY "Auth users can react" ON public.reactions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can remove own reaction" ON public.reactions FOR DELETE USING (auth.uid() = user_id);

-- Threaded comments + mentions
ALTER TABLE public.comments ADD COLUMN parent_id uuid;
ALTER TABLE public.comments ADD COLUMN mentions uuid[] DEFAULT '{}';
CREATE INDEX idx_comments_parent ON public.comments(parent_id);

-- Enrich profiles
ALTER TABLE public.profiles ADD COLUMN location text;
ALTER TABLE public.profiles ADD COLUMN onboarded boolean NOT NULL DEFAULT false;

-- Floorplan support on trips
ALTER TABLE public.trips ADD COLUMN floorplan_url text;

-- Room tag on steps (links a step to a room name on the floorplan)
ALTER TABLE public.steps ADD COLUMN room text;
ALTER TABLE public.steps ADD COLUMN floorplan_x numeric;
ALTER TABLE public.steps ADD COLUMN floorplan_y numeric;

-- Notification trigger: when someone posts a step on a project, notify followers
CREATE OR REPLACE FUNCTION public.notify_followers_on_step()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  trip_title text;
BEGIN
  SELECT title INTO trip_title FROM public.trips WHERE id = NEW.trip_id;
  INSERT INTO public.notifications (user_id, type, project_id, step_id, actor_id, message)
  SELECT f.user_id, 'new_step', NEW.trip_id, NEW.id, NEW.user_id,
         'Nieuwe update in ' || COALESCE(trip_title, 'een project')
  FROM public.follows f
  WHERE f.project_id = NEW.trip_id AND f.user_id <> NEW.user_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_followers_on_step
  AFTER INSERT ON public.steps
  FOR EACH ROW EXECUTE FUNCTION public.notify_followers_on_step();

-- Notification trigger: comment on a step -> notify step owner + mentions
CREATE OR REPLACE FUNCTION public.notify_on_comment()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  step_owner uuid;
  step_trip uuid;
  m uuid;
BEGIN
  SELECT user_id, trip_id INTO step_owner, step_trip FROM public.steps WHERE id = NEW.step_id;
  IF step_owner IS NOT NULL AND step_owner <> NEW.user_id THEN
    INSERT INTO public.notifications (user_id, type, project_id, step_id, actor_id, message)
    VALUES (step_owner, 'comment', step_trip, NEW.step_id, NEW.user_id, 'Nieuwe reactie op je update');
  END IF;
  IF NEW.mentions IS NOT NULL THEN
    FOREACH m IN ARRAY NEW.mentions LOOP
      IF m <> NEW.user_id AND m <> step_owner THEN
        INSERT INTO public.notifications (user_id, type, project_id, step_id, actor_id, message)
        VALUES (m, 'mention', step_trip, NEW.step_id, NEW.user_id, 'Je bent genoemd in een reactie');
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_notify_on_comment
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();
