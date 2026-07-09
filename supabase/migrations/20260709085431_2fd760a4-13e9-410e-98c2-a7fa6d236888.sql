
-- Attach missing triggers (functions already exist)

-- 1) Auto-create profile on new user
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Project follow: set status + notifications
DROP TRIGGER IF EXISTS trg_follows_set_status ON public.follows;
CREATE TRIGGER trg_follows_set_status
  BEFORE INSERT ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.set_project_follow_status();

DROP TRIGGER IF EXISTS trg_follows_notify ON public.follows;
CREATE TRIGGER trg_follows_notify
  AFTER INSERT OR UPDATE ON public.follows
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_project_follow();

-- 3) User follow: set status + notifications
DROP TRIGGER IF EXISTS trg_user_follows_set_status ON public.user_follows;
CREATE TRIGGER trg_user_follows_set_status
  BEFORE INSERT ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION public.set_user_follow_status();

DROP TRIGGER IF EXISTS trg_user_follows_notify ON public.user_follows;
CREATE TRIGGER trg_user_follows_notify
  AFTER INSERT OR UPDATE ON public.user_follows
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_user_follow();

-- 4) Steps → notify followers of new update
DROP TRIGGER IF EXISTS trg_steps_notify_followers ON public.steps;
CREATE TRIGGER trg_steps_notify_followers
  AFTER INSERT ON public.steps
  FOR EACH ROW EXECUTE FUNCTION public.notify_followers_on_step();

-- 5) Comments → notify step owner + mentions
DROP TRIGGER IF EXISTS trg_comments_notify ON public.comments;
CREATE TRIGGER trg_comments_notify
  AFTER INSERT ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_comment();

-- 6) Profiles: prevent privileged-field tampering + updated_at
DROP TRIGGER IF EXISTS trg_profiles_prevent_privileged ON public.profiles;
CREATE TRIGGER trg_profiles_prevent_privileged
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_profile_privileged_changes();

DROP TRIGGER IF EXISTS trg_profiles_updated_at ON public.profiles;
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 7) Trips updated_at
DROP TRIGGER IF EXISTS trg_trips_updated_at ON public.trips;
CREATE TRIGGER trg_trips_updated_at
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 8) Steps updated_at
DROP TRIGGER IF EXISTS trg_steps_updated_at ON public.steps;
CREATE TRIGGER trg_steps_updated_at
  BEFORE UPDATE ON public.steps
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
