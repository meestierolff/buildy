import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ChevronLeft, ChevronRight, Hammer } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

const Photobook = () => {
  const { id } = useParams<{ id: string }>();
  const [trip, setTrip] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
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
    fetchData();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  const pages: React.ReactNode[] = [];

  // Cover page
  pages.push(
    <div key="cover" className="flex flex-col items-center justify-center h-full bg-primary text-primary-foreground p-12 text-center relative overflow-hidden">
      <div className="absolute inset-0 blueprint-grid opacity-15" />
      <div className="relative">
        <div className="bg-accent rounded-2xl p-3 inline-block mb-6 shadow-lg">
          <Hammer className="h-8 w-8 text-accent-foreground" />
        </div>
        {trip?.project_type && (
          <p className="text-xs uppercase tracking-[0.3em] text-accent mb-3 font-bold">{trip.project_type}</p>
        )}
        <h1 className="text-4xl md:text-5xl font-bold mb-4 font-serif">{trip?.title}</h1>
        {trip?.address && <p className="text-base text-primary-foreground/70 mb-3">📍 {trip.address}</p>}
        {trip?.start_date && trip?.end_date && (
          <p className="text-lg text-primary-foreground/80">
            {format(new Date(trip.start_date), "d MMMM yyyy", { locale: nl })} — {format(new Date(trip.end_date), "d MMMM yyyy", { locale: nl })}
          </p>
        )}
        {trip?.start_date && !trip?.end_date && (
          <p className="text-lg text-primary-foreground/80">{format(new Date(trip.start_date), "MMMM yyyy", { locale: nl })}</p>
        )}
        {trip?.description && (
          <p className="text-sm text-primary-foreground/70 mt-6 max-w-md italic">{trip.description}</p>
        )}
        <p className="mt-10 text-xs uppercase tracking-widest text-accent/80">Een Buildy verbouwingslogboek</p>
      </div>
    </div>
  );

  // Group steps by phase
  const phaseOrder = ["Voorbereiding", "Sloop", "Ruwbouw", "Installatie", "Afwerking", "Inrichting", "Oplevering"];
  const grouped = new Map<string, any[]>();
  for (const step of steps) {
    const key = step.phase || "Overige updates";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(step);
  }
  const sortedPhases = Array.from(grouped.keys()).sort((a, b) => {
    const ai = phaseOrder.indexOf(a);
    const bi = phaseOrder.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  for (const phase of sortedPhases) {
    // Chapter divider
    pages.push(
      <div key={`ch-${phase}`} className="h-full flex flex-col items-center justify-center p-12 bg-secondary/40 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-accent font-bold mb-4">Hoofdstuk</p>
        <h2 className="text-5xl font-bold font-serif">{phase}</h2>
        <div className="w-16 h-1 bg-accent mt-6" />
      </div>
    );

    for (const step of grouped.get(phase)!) {
      const photos = step.step_media?.filter((m: any) => m.media_type !== "video") || [];
      const hasDescription = !!step.description;

      if (photos.length === 0 && hasDescription) {
        pages.push(
          <div key={step.id} className="h-full flex flex-col justify-center p-10 md:p-16 bg-card">
            <div className="mb-4">
              <p className="text-xs uppercase tracking-widest text-accent mb-1 font-bold">{phase}</p>
              <p className="text-xs text-muted-foreground mb-2">{format(new Date(step.step_date), "d MMMM yyyy", { locale: nl })}</p>
              <h2 className="text-3xl font-bold font-serif">{step.location_name}</h2>
            </div>
            <p className="text-base leading-relaxed text-foreground/80 italic whitespace-pre-line">"{step.description}"</p>
          </div>
        );
      } else if (photos.length === 1) {
        pages.push(
          <div key={step.id} className="h-full relative">
            <img src={photos[0].media_url} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-8 text-white">
              <p className="text-xs uppercase tracking-widest text-accent mb-1 font-bold">{phase}</p>
              <p className="text-xs opacity-70 mb-2">{format(new Date(step.step_date), "d MMMM yyyy", { locale: nl })}</p>
              <h2 className="text-3xl font-bold font-serif mb-2">{step.location_name}</h2>
              {hasDescription && (
                <p className="text-sm leading-relaxed opacity-90 max-w-lg italic">"{step.description}"</p>
              )}
            </div>
          </div>
        );
      } else if (photos.length === 2) {
        pages.push(
          <div key={step.id} className="h-full flex flex-col bg-card">
            <div className="flex-1 grid grid-cols-2 gap-1 min-h-0">
              {photos.map((m: any) => (
                <img key={m.id} src={m.media_url} alt="" className="w-full h-full object-cover" />
              ))}
            </div>
            <div className="p-6">
              <p className="text-xs uppercase tracking-widest text-accent mb-1 font-bold">{phase}</p>
              <p className="text-xs text-muted-foreground mb-1">{format(new Date(step.step_date), "d MMMM yyyy", { locale: nl })}</p>
              <h2 className="text-2xl font-bold font-serif">{step.location_name}</h2>
              {hasDescription && (
                <p className="text-sm leading-relaxed text-foreground/80 mt-2 italic">"{step.description}"</p>
              )}
            </div>
          </div>
        );
      } else if (photos.length >= 3) {
        pages.push(
          <div key={step.id} className="h-full flex flex-col bg-card">
            <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-1 min-h-0">
              <img src={photos[0].media_url} alt="" className="w-full h-full object-cover row-span-2" />
              <img src={photos[1].media_url} alt="" className="w-full h-full object-cover" />
              {photos[2] ? (
                <div className="relative">
                  <img src={photos[2].media_url} alt="" className="w-full h-full object-cover" />
                  {photos.length > 3 && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <span className="text-white text-lg font-bold">+{photos.length - 3}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div />
              )}
            </div>
            <div className="p-6">
              <p className="text-xs uppercase tracking-widest text-accent mb-1 font-bold">{phase}</p>
              <p className="text-xs text-muted-foreground mb-1">{format(new Date(step.step_date), "d MMMM yyyy", { locale: nl })}</p>
              <h2 className="text-2xl font-bold font-serif">{step.location_name}</h2>
              {hasDescription && (
                <p className="text-sm leading-relaxed text-foreground/80 mt-2 italic">"{step.description}"</p>
              )}
            </div>
          </div>
        );

        if (photos.length > 4) {
          for (let i = 3; i < photos.length; i += 4) {
            const batch = photos.slice(i, i + 4);
            pages.push(
              <div key={`${step.id}-extra-${i}`} className="h-full grid grid-cols-2 gap-1 bg-card">
                {batch.map((m: any) => (
                  <img key={m.id} src={m.media_url} alt="" className="w-full h-full object-cover" />
                ))}
              </div>
            );
          }
        }
      }
    }
  }

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <div className="container py-4 flex items-center gap-4">
        <Link to={`/trip/${id}`}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Terug naar project
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
