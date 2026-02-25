import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MapPin, Calendar, Navigation, Plus, Compass, Globe } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

interface TripWithSteps {
  id: string;
  title: string;
  countries: string[] | null;
  start_date: string | null;
  end_date: string | null;
  cover_image_url: string | null;
  user_id: string;
  profile?: { display_name: string; avatar_url: string | null };
  step_count: number;
}

const Index = () => {
  const { user } = useAuth();
  const [trips, setTrips] = useState<TripWithSteps[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchTrips = async () => {
      const { data } = await supabase
        .from("trips")
        .select("*")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(20);

      if (data) {
        const tripsWithCounts = await Promise.all(
          data.map(async (trip: any) => {
            const [{ count }, { data: profileData }] = await Promise.all([
              supabase.from("steps").select("*", { count: "exact", head: true }).eq("trip_id", trip.id),
              supabase.from("profiles").select("display_name, avatar_url").eq("user_id", trip.user_id).single(),
            ]);
            return {
              ...trip,
              profile: profileData,
              step_count: count || 0,
            };
          })
        );
        setTrips(tripsWithCounts);
      }
      setLoading(false);
    };
    fetchTrips();
  }, []);

  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="relative overflow-hidden py-24 md:py-36">
        <div className="absolute inset-0 bg-gradient-to-br from-primary via-primary/90 to-primary/70" />
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.4'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"
        }} />
        <div className="container relative text-center">
          <div className="flex justify-center mb-6">
            <div className="bg-accent/20 backdrop-blur-sm rounded-full p-3">
              <Globe className="h-8 w-8 text-accent" />
            </div>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-4 tracking-tight text-primary-foreground">
            <span className="italic text-gradient-gold">Ontdek</span> de wereld,{" "}
            <br className="hidden md:block" />
            deel je avontuur.
          </h1>
          <p className="text-lg md:text-xl text-primary-foreground/80 max-w-2xl mx-auto mb-8">
            Leg elke stap van je reis vast met foto's, verhalen en een interactieve routekaart.
          </p>
          {user ? (
            <Link to="/trips/new">
              <Button size="lg" className="gap-2 text-base bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg shadow-accent/25">
                <Plus className="h-5 w-5" /> Start een nieuwe trip
              </Button>
            </Link>
          ) : (
            <Link to="/auth">
              <Button size="lg" className="gap-2 text-base bg-accent text-accent-foreground hover:bg-accent/90 shadow-lg shadow-accent/25">
                <Compass className="h-5 w-5" /> Aan de slag
              </Button>
            </Link>
          )}
        </div>
      </section>

      {/* Trip grid */}
      <section className="container py-12">
        <h2 className="text-2xl font-bold mb-8">Recente trips</h2>
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[1, 2, 3].map((i) => (
              <Card key={i} className="animate-pulse">
                <div className="h-48 bg-muted rounded-t-lg" />
                <CardContent className="p-4 space-y-2">
                  <div className="h-5 bg-muted rounded w-3/4" />
                  <div className="h-4 bg-muted rounded w-1/2" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : trips.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Navigation className="h-12 w-12 mx-auto mb-4 opacity-40" />
            <p className="text-lg">Nog geen trips om te tonen.</p>
            {user && (
              <Link to="/trips/new">
                <Button variant="outline" className="mt-4">
                  Maak je eerste trip
                </Button>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {trips.map((trip) => (
              <Link key={trip.id} to={`/trip/${trip.id}`}>
                <Card className="overflow-hidden hover:shadow-lg transition-all group cursor-pointer border-border/50 hover:border-accent/30">
                  <div className="h-48 bg-gradient-to-br from-primary/20 to-accent/20 relative overflow-hidden">
                    {trip.cover_image_url && (
                      <img
                        src={trip.cover_image_url}
                        alt={trip.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      />
                    )}
                    {!trip.cover_image_url && (
                      <div className="w-full h-full flex items-center justify-center">
                        <Compass className="h-12 w-12 text-primary/30" />
                      </div>
                    )}
                    {trip.countries && trip.countries.length > 0 && (
                      <div className="absolute bottom-2 left-2 flex gap-1">
                        {trip.countries.map((c) => (
                          <span key={c} className="bg-card/80 backdrop-blur-sm text-xs px-2 py-0.5 rounded-full font-medium">
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-lg mb-1 font-sans">{trip.title}</h3>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      {trip.start_date && (
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(trip.start_date), "d MMM yyyy", { locale: nl })}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" />
                        {trip.step_count} stappen
                      </span>
                    </div>
                    {trip.profile && (
                      <p className="text-xs text-muted-foreground mt-2">
                        door {trip.profile.display_name}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Index;
