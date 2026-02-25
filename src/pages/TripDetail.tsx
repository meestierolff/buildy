import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import TripMap from "@/components/TripMap";
import StepTimeline from "@/components/StepTimeline";
import AddStepDialog from "@/components/AddStepDialog";
import EditStepDialog from "@/components/EditStepDialog";
import { Button } from "@/components/ui/button";
import { Calendar, MapPin, Navigation, Plus, BookOpen, Share2 } from "lucide-react";
import { format, differenceInDays } from "date-fns";
import { nl } from "date-fns/locale";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const TripDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAddStep, setShowAddStep] = useState(false);
  const [editingStep, setEditingStep] = useState<any>(null);
  const [deletingStepId, setDeletingStepId] = useState<string | null>(null);

  const isOwner = user && trip?.user_id === user.id;

  const fetchTrip = useCallback(async () => {
    if (!id) return;

    const { data: tripData } = await supabase
      .from("trips")
      .select("*")
      .eq("id", id)
      .single();

    if (tripData) {
      const { data: profileData } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("user_id", tripData.user_id)
        .single();
      setTrip({ ...tripData, profile: profileData });
    }

    const { data: stepsData } = await supabase
      .from("steps")
      .select("*, step_media(*)")
      .eq("trip_id", id)
      .order("step_date", { ascending: true })
      .order("step_order", { ascending: true });

    if (stepsData) {
      const enriched = await Promise.all(
        stepsData.map(async (step) => {
          const [{ count: likeCount }, { count: commentCount }] = await Promise.all([
            supabase.from("likes").select("*", { count: "exact", head: true }).eq("step_id", step.id),
            supabase.from("comments").select("*", { count: "exact", head: true }).eq("step_id", step.id),
          ]);

          let userLiked = false;
          if (user) {
            const { data: likeData } = await supabase
              .from("likes")
              .select("id")
              .eq("step_id", step.id)
              .eq("user_id", user.id)
              .maybeSingle();
            userLiked = !!likeData;
          }

          return {
            ...step,
            like_count: likeCount || 0,
            comment_count: commentCount || 0,
            user_liked: userLiked,
          };
        })
      );
      setSteps(enriched);
    }

    setLoading(false);
  }, [id, user]);

  useEffect(() => {
    fetchTrip();
  }, [fetchTrip]);

  const handleLike = async (stepId: string) => {
    if (!user) {
      toast.error("Log in om te liken");
      return;
    }

    const step = steps.find((s) => s.id === stepId);
    if (!step) return;

    if (step.user_liked) {
      await supabase.from("likes").delete().eq("step_id", stepId).eq("user_id", user.id);
    } else {
      await supabase.from("likes").insert({ step_id: stepId, user_id: user.id });
    }

    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, user_liked: !s.user_liked, like_count: s.like_count + (s.user_liked ? -1 : 1) }
          : s
      )
    );
  };

  const handleDelete = async () => {
    if (!deletingStepId) return;
    const { error } = await supabase.from("steps").delete().eq("id", deletingStepId);
    if (error) {
      toast.error("Kon stap niet verwijderen: " + error.message);
    } else {
      toast.success("Stap verwijderd");
      fetchTrip();
    }
    setDeletingStepId(null);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link gekopieerd!");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="container py-20 text-center">
        <p className="text-muted-foreground">Trip niet gevonden.</p>
      </div>
    );
  }

  const days = trip.start_date && trip.end_date
    ? differenceInDays(new Date(trip.end_date), new Date(trip.start_date)) + 1
    : null;

  return (
    <div className="flex flex-col lg:flex-row h-[calc(100vh-4rem)]">
      {/* Left: Timeline */}
      <div className="lg:w-[480px] w-full overflow-y-auto border-r bg-background">
        {/* Trip header */}
        <div className="p-6 border-b bg-gradient-to-br from-primary/5 to-accent/5">
          <div className="flex items-center gap-2 mb-1">
            {trip.countries?.map((c: string) => (
              <span key={c} className="text-xs bg-accent/15 text-accent-foreground px-2.5 py-0.5 rounded-full font-medium">{c}</span>
            ))}
          </div>
          <h1 className="text-2xl font-bold mb-1">{trip.title}</h1>
          {trip.profile && (
            <Link to={`/profile/${trip.user_id}`} className="text-sm text-muted-foreground hover:text-accent transition-colors">
              door {trip.profile.display_name}
            </Link>
          )}

          <div className="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
            {days && (
              <span className="flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" /> {days} dagen
              </span>
            )}
            <span className="flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {steps.length} stappen
            </span>
          </div>

          <div className="flex gap-2 mt-4">
            {isOwner && (
              <Button size="sm" onClick={() => setShowAddStep(true)} className="gap-1.5">
                <Plus className="h-4 w-4" /> Stap toevoegen
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={handleShare} className="gap-1.5">
              <Share2 className="h-4 w-4" /> Delen
            </Button>
            <Link to={`/trip/${id}/photobook`}>
              <Button size="sm" variant="outline" className="gap-1.5">
                <BookOpen className="h-4 w-4" /> Fotoboek
              </Button>
            </Link>
          </div>
        </div>

        {/* Steps */}
        {steps.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            <Navigation className="h-10 w-10 mx-auto mb-3 opacity-40" />
            <p>Nog geen stappen. {isOwner && "Voeg je eerste stap toe!"}</p>
          </div>
        ) : (
          <StepTimeline
            steps={steps}
            activeStepId={activeStepId}
            onStepClick={setActiveStepId}
            onLike={handleLike}
            onEdit={setEditingStep}
            onDelete={setDeletingStepId}
            isOwner={!!isOwner}
          />
        )}
      </div>

      {/* Right: Map */}
      <div className="flex-1 relative">
        <TripMap
          steps={steps}
          activeStepId={activeStepId}
          onMarkerClick={setActiveStepId}
        />
      </div>

      {/* Add Step Dialog */}
      {showAddStep && id && (
        <AddStepDialog
          tripId={id}
          onClose={() => setShowAddStep(false)}
          onAdded={fetchTrip}
        />
      )}

      {/* Edit Step Dialog */}
      {editingStep && (
        <EditStepDialog
          step={editingStep}
          onClose={() => setEditingStep(null)}
          onUpdated={fetchTrip}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingStepId} onOpenChange={() => setDeletingStepId(null)}>
        <AlertDialogContent className="z-[1000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Stap verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dit kan niet ongedaan worden gemaakt. Alle foto's en reacties bij deze stap worden ook verwijderd.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuleren</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Verwijderen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default TripDetail;
