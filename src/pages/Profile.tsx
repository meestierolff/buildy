import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Calendar, MapPin } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

const Profile = () => {
  const { userId } = useParams<{ userId: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      if (!userId) return;

      const { data: profileData } = await supabase
        .from("profiles")
        .select("*")
        .eq("user_id", userId)
        .single();

      setProfile(profileData);

      const { data: tripsData } = await supabase
        .from("trips")
        .select("*")
        .eq("user_id", userId)
        .eq("is_public", true)
        .order("created_at", { ascending: false });

      setTrips(tripsData || []);
      setLoading(false);
    };
    fetch();
  }, [userId]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!profile) {
    return <div className="container py-20 text-center text-muted-foreground">Profiel niet gevonden.</div>;
  }

  return (
    <div className="container max-w-4xl py-12">
      <div className="flex items-center gap-4 mb-8">
        <Avatar className="h-16 w-16">
          <AvatarImage src={profile.avatar_url || ""} />
          <AvatarFallback className="bg-primary text-primary-foreground text-xl">
            {profile.display_name?.[0]?.toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-2xl font-bold">{profile.display_name}</h1>
          {profile.bio && <p className="text-muted-foreground">{profile.bio}</p>}
          <p className="text-sm text-muted-foreground">{trips.length} trips</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {trips.map((trip) => (
          <Link key={trip.id} to={`/trip/${trip.id}`}>
            <Card className="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer">
              <div className="h-40 bg-gradient-to-br from-primary/20 to-accent/20">
                {trip.cover_image_url && (
                  <img src={trip.cover_image_url} alt={trip.title} className="w-full h-full object-cover" />
                )}
              </div>
              <CardContent className="p-4">
                <h3 className="font-semibold text-lg font-sans">{trip.title}</h3>
                <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
                  {trip.start_date && (
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" />
                      {format(new Date(trip.start_date), "d MMM yyyy", { locale: nl })}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default Profile;
