import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

const Photobook = () => {
  const { id } = useParams<{ id: string }>();
  const [trip, setTrip] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetch = async () => {
      if (!id) return;

      const { data: tripData } = await supabase.from("trips").select("*").eq("id", id).single();
      setTrip(tripData);

      const { data: stepsData } = await supabase
        .from("steps")
        .select("*, step_media(*)")
        .eq("trip_id", id)
        .order("step_date", { ascending: true });

      setSteps(stepsData || []);
      setLoading(false);
    };
    fetch();
  }, [id]);

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" /></div>;
  }

  // Build pages: cover + step pages
  const pages: React.ReactNode[] = [];

  // Cover page
  pages.push(
    <div key="cover" className="flex flex-col items-center justify-center h-full bg-gradient-to-br from-primary/10 to-accent/10 p-12 text-center">
      <h1 className="text-4xl md:text-5xl font-bold mb-4">{trip?.title}</h1>
      {trip?.start_date && (
        <p className="text-lg text-muted-foreground">
          {format(new Date(trip.start_date), "MMMM yyyy", { locale: nl })}
        </p>
      )}
      {trip?.countries?.length > 0 && (
        <p className="text-muted-foreground mt-2">{trip.countries.join(" · ")}</p>
      )}
    </div>
  );

  // Step pages
  steps.forEach((step) => {
    pages.push(
      <div key={step.id} className="h-full p-8 md:p-12 flex flex-col">
        <h2 className="text-2xl font-bold mb-1">{step.location_name}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          {format(new Date(step.step_date), "d MMMM yyyy", { locale: nl })}
        </p>
        {step.step_media?.length > 0 && (
          <div className="grid grid-cols-2 gap-2 mb-4 flex-1 min-h-0">
            {step.step_media.slice(0, 4).map((m: any) => (
              <img key={m.id} src={m.media_url} alt="" className="rounded-lg object-cover w-full h-full" />
            ))}
          </div>
        )}
        {step.description && (
          <p className="text-sm leading-relaxed text-foreground/80 italic">{step.description}</p>
        )}
      </div>
    );
  });

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <div className="container py-4 flex items-center gap-4">
        <Link to={`/trip/${id}`}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Terug naar trip
          </Button>
        </Link>
        <span className="text-sm text-muted-foreground">
          Pagina {currentPage + 1} / {pages.length}
        </span>
      </div>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative w-full max-w-3xl aspect-[3/4] bg-card rounded-xl shadow-2xl overflow-hidden">
          {pages[currentPage]}
        </div>
      </div>

      <div className="container py-4 flex justify-center gap-4">
        <Button
          variant="outline"
          size="icon"
          disabled={currentPage === 0}
          onClick={() => setCurrentPage((p) => p - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button
          variant="outline"
          size="icon"
          disabled={currentPage === pages.length - 1}
          onClick={() => setCurrentPage((p) => p + 1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

export default Photobook;
