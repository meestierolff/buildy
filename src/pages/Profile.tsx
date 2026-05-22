import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MapPin, Hammer, Camera, Pencil } from "lucide-react";
import { toast } from "sonner";

const Profile = () => {
  const { userId } = useParams<{ userId: string }>();
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [stats, setStats] = useState({ updates: 0, photos: 0 });
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ display_name: "", bio: "", location: "" });

  const isMe = user?.id === userId;

  const load = async () => {
    if (!userId) return;
    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .eq("user_id", userId)
      .single();
    setProfile(profileData);
    if (profileData) setDraft({
      display_name: profileData.display_name || "",
      bio: profileData.bio || "",
      location: profileData.location || "",
    });

    let tripsQuery = supabase
      .from("trips")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (!isMe) tripsQuery = tripsQuery.eq("is_public", true);
    const { data: tripsData } = await tripsQuery;
    setTrips(tripsData || []);

    const tripIds = (tripsData || []).map((t: any) => t.id);
    if (tripIds.length) {
      const [{ count: updates }, { count: photos }] = await Promise.all([
        supabase.from("steps").select("*", { count: "exact", head: true }).in("trip_id", tripIds),
        supabase.from("step_media").select("*", { count: "exact", head: true }).eq("user_id", userId),
      ]);
      setStats({ updates: updates || 0, photos: photos || 0 });
    }
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [userId, user?.id]);

  const save = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: draft.display_name.trim(),
        bio: draft.bio.trim() || null,
        location: draft.location.trim() || null,
      })
      .eq("user_id", user.id);
    if (error) {
      toast.error("Opslaan mislukt");
    } else {
      toast.success("Profiel bijgewerkt");
      setEditing(false);
      load();
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!profile) {
    return <div className="container py-20 text-center text-muted-foreground">Profiel niet gevonden.</div>;
  }

  return (
    <div className="container max-w-4xl py-12">
      <div className="flex items-start gap-4 mb-8">
        <Avatar className="h-20 w-20">
          <AvatarImage src={profile.avatar_url || ""} />
          <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
            {profile.display_name?.[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-2xl font-bold">{profile.display_name}</h1>
            {isMe && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" /> Bewerk
              </Button>
            )}
          </div>
          {profile.location && (
            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin className="h-3.5 w-3.5" /> {profile.location}
            </p>
          )}
          {profile.bio && <p className="text-sm mt-2 leading-relaxed">{profile.bio}</p>}

          <div className="flex gap-5 mt-3 text-sm">
            <span><strong>{trips.length}</strong> <span className="text-muted-foreground">projecten</span></span>
            <span className="flex items-center gap-1"><Hammer className="h-3.5 w-3.5 text-accent" /><strong>{stats.updates}</strong> <span className="text-muted-foreground">updates</span></span>
            <span className="flex items-center gap-1"><Camera className="h-3.5 w-3.5 text-accent" /><strong>{stats.photos}</strong> <span className="text-muted-foreground">foto's</span></span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {trips.map((trip) => (
          <Link key={trip.id} to={`/trip/${trip.id}`}>
            <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer border-2 hover:border-accent/40">
              <div className="h-40 bg-gradient-to-br from-primary/20 to-accent/20">
                {trip.cover_image_url && (
                  <img src={trip.cover_image_url} alt={trip.title} className="w-full h-full object-cover" />
                )}
              </div>
              <CardContent className="p-4">
                <h3 className="font-semibold text-lg font-sans">{trip.title}</h3>
                {trip.address && <p className="text-xs text-muted-foreground mt-1">📍 {trip.address}</p>}
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent>
          <DialogHeader><DialogTitle>Profiel bewerken</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Naam</Label>
              <Input value={draft.display_name} onChange={(e) => setDraft({ ...draft, display_name: e.target.value })} />
            </div>
            <div>
              <Label>Locatie</Label>
              <Input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} />
            </div>
            <div>
              <Label>Bio</Label>
              <Textarea value={draft.bio} onChange={(e) => setDraft({ ...draft, bio: e.target.value })} rows={3} />
            </div>
            <Button onClick={save} className="w-full bg-accent text-accent-foreground hover:bg-accent/90">Opslaan</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Profile;
