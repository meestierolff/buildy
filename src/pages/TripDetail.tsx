import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import BlueprintTimeline from "@/components/BlueprintTimeline";
import BlueprintBackground from "@/components/BlueprintBackground";
import ProgressControl from "@/components/ProgressControl";
import FollowButton from "@/components/FollowButton";
import AddStepDialog from "@/components/AddStepDialog";
import EditStepDialog from "@/components/EditStepDialog";
import ProjectStats from "@/components/ProjectStats";
import FloorplanView from "@/components/FloorplanView";
import FloorplanScrollView from "@/components/FloorplanScrollView";
import AllPhotosTab from "@/components/AllPhotosTab";
import CoverPickerDialog from "@/components/CoverPickerDialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MapPin, Plus, BookOpen, Share2, Hammer, LayoutGrid, Map as MapIcon, Images, ImagePlus, Pencil, Check, X, MoveVertical } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { differenceInDays } from "date-fns";
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
  const [loading, setLoading] = useState(true);
  const [showAddStep, setShowAddStep] = useState(false);
  const [editingStep, setEditingStep] = useState<any>(null);
  const [deletingStepId, setDeletingStepId] = useState<string | null>(null);
  const [floorMode, setFloorMode] = useState<"view" | "manage">("view");
  const [showCoverPicker, setShowCoverPicker] = useState(false);
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState("");
  const [savingDesc, setSavingDesc] = useState(false);
  const [activeTab, setActiveTab] = useState("timeline");
  const [milestonesOnly, setMilestonesOnly] = useState(false);
  const [adjustCover, setAdjustCover] = useState(false);
  const [coverY, setCoverY] = useState<number>(50);

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
      setCoverY(typeof (tripData as any).cover_position_y === "number" ? (tripData as any).cover_position_y : 50);
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
      console.error("Delete step failed:", error);
      toast.error("Kon update niet verwijderen. Probeer het opnieuw.");
    } else {
      toast.success("Update verwijderd");
      fetchTrip();
    }
    setDeletingStepId(null);
  };

  const handleShare = () => {
    navigator.clipboard.writeText(window.location.href);
    toast.success("Link gekopieerd!");
  };

  const saveDescription = async () => {
    setSavingDesc(true);
    const { error } = await supabase
      .from("trips")
      .update({ description: descDraft.trim() || null })
      .eq("id", trip.id);
    setSavingDesc(false);
    if (error) {
      console.error(error);
      toast.error("Opslaan mislukt.");
      return;
    }
    setEditingDesc(false);
    fetchTrip();
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
        <p className="text-muted-foreground">Project niet gevonden.</p>
      </div>
    );
  }

  const days = trip.start_date
    ? differenceInDays(new Date(trip.end_date ?? new Date()), new Date(trip.start_date)) + 1
    : null;
  const totalPhotos = steps.reduce((sum, s) => sum + (s.step_media?.length ?? 0), 0);
  const milestones = steps.filter((s) => s.is_milestone).length;

  return (
    <div className="min-h-screen">
      {/* Project header */}
      <section className="relative bg-primary text-primary-foreground overflow-hidden">
        {trip.cover_image_url ? (
          <>
            <img
              src={trip.cover_image_url}
              alt=""
              style={{ objectPosition: `center ${coverY}%` }}
              className="absolute inset-0 w-full h-full object-cover opacity-40"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-primary/70 via-primary/80 to-primary" />
          </>
        ) : (
          <div className="absolute inset-0 blueprint-grid opacity-15" />
        )}
        <div className="container relative py-10">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              {trip.project_type && (
                <span className="inline-block text-[11px] font-bold uppercase tracking-widest bg-accent text-accent-foreground px-2.5 py-1 rounded-full mb-3">
                  {trip.project_type}
                </span>
              )}
              <h1 className="text-3xl md:text-4xl font-bold mb-2 leading-tight">{trip.title}</h1>
              {trip.profile && (
                <Link to={`/profile/${trip.user_id}`} className="text-sm text-primary-foreground/70 hover:text-accent">
                  door {trip.profile.display_name}
                </Link>
              )}
              <div className="flex flex-wrap items-center gap-4 mt-3 text-sm text-primary-foreground/80">
                {trip.address && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> {trip.address}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {isOwner && (
                <>
                  <Button size="sm" onClick={() => setShowAddStep(true)} className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90">
                    <Plus className="h-4 w-4" /> Update toevoegen
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowCoverPicker(true)} className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                    <ImagePlus className="h-4 w-4" /> Cover
                  </Button>
                  {trip.cover_image_url && (
                    <Button size="sm" variant="outline" onClick={() => setAdjustCover((v) => !v)} className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground hidden md:inline-flex">
                      <MoveVertical className="h-4 w-4" /> {adjustCover ? "Klaar" : "Positie"}
                    </Button>
                  )}
                </>
              )}
              {!isOwner && trip.is_public && (
                <FollowButton projectId={trip.id} />
              )}
              <Button size="sm" variant="outline" onClick={handleShare} className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                <Share2 className="h-4 w-4" /> Delen
              </Button>
              <Link to={`/trip/${id}/photobook`}>
                <Button size="sm" variant="outline" className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                  <BookOpen className="h-4 w-4" /> Fotoboek
                </Button>
              </Link>
            </div>
          </div>

          {/* Project description */}
          <div className="mt-4 max-w-2xl">
            {editingDesc ? (
              <div className="space-y-2">
                <Textarea
                  value={descDraft}
                  onChange={(e) => setDescDraft(e.target.value)}
                  rows={3}
                  placeholder="Korte beschrijving van je project..."
                  className="bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/50 border-primary-foreground/20"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={saveDescription} disabled={savingDesc} className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90">
                    <Check className="h-3.5 w-3.5" /> Opslaan
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingDesc(false)} className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                    <X className="h-3.5 w-3.5" /> Annuleren
                  </Button>
                </div>
              </div>
            ) : trip.description ? (
              <div className="group relative">
                <p className="text-sm md:text-base text-primary-foreground/85 whitespace-pre-line leading-relaxed">
                  {trip.description}
                </p>
                {isOwner && (
                  <button
                    onClick={() => { setDescDraft(trip.description ?? ""); setEditingDesc(true); }}
                    className="mt-1 text-xs text-accent hover:underline inline-flex items-center gap-1"
                  >
                    <Pencil className="h-3 w-3" /> Bewerken
                  </button>
                )}
              </div>
            ) : isOwner ? (
              <button
                onClick={() => { setDescDraft(""); setEditingDesc(true); }}
                className="text-xs text-primary-foreground/60 hover:text-accent inline-flex items-center gap-1"
              >
                <Pencil className="h-3 w-3" /> Beschrijving toevoegen
              </button>
            ) : null}
          </div>

          <ProjectStats
            totalUpdates={steps.length}
            totalPhotos={totalPhotos}
            daysActive={days}
            milestones={milestones}
            milestonesActive={milestonesOnly}
            onMilestonesClick={milestones > 0 ? () => {
              setMilestonesOnly((v) => !v);
              setActiveTab("timeline");
            } : undefined}
          />

          <div className="mt-4 max-w-md">
            <ProgressControl
              tripId={trip.id}
              isOwner={!!isOwner}
              startDate={trip.start_date}
              endDate={trip.end_date}
              progressMode={trip.progress_mode}
              progressPercentage={trip.progress_percentage}
              onChanged={fetchTrip}
            />
          </div>
        </div>
      </section>

      {/* Tabs: timeline / floorplan */}
      <section className="relative">
        <BlueprintBackground />
        <div className="container relative max-w-5xl">
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v !== "timeline") setMilestonesOnly(false); }} className="pt-6">
            <TabsList className="mb-2">
              <TabsTrigger value="timeline" className="gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> Tijdlijn</TabsTrigger>
              <TabsTrigger value="floorplan" className="gap-1.5"><MapIcon className="h-3.5 w-3.5" /> Plattegrond</TabsTrigger>
              <TabsTrigger value="photos" className="gap-1.5"><Images className="h-3.5 w-3.5" /> Alle foto's</TabsTrigger>
            </TabsList>
            <TabsContent value="timeline">
              {milestonesOnly && (
                <div className="flex items-center justify-between mb-3 px-3 py-2 rounded-md bg-accent/10 border border-accent/30 text-sm">
                  <span>Alleen mijlpalen worden getoond</span>
                  <Button size="sm" variant="ghost" onClick={() => setMilestonesOnly(false)} className="h-7">
                    Filter wissen
                  </Button>
                </div>
              )}
              {(() => {
                const visible = milestonesOnly ? steps.filter((s) => s.is_milestone) : steps;
                return visible.length === 0 ? (
                  <div className="py-20 text-center text-muted-foreground">
                    <Hammer className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p className="text-lg">{milestonesOnly ? "Geen mijlpalen gevonden." : "Nog geen updates."}</p>
                    {isOwner && !milestonesOnly && <p className="text-sm mt-1">Voeg je eerste 'voor'-foto toe om te starten!</p>}
                  </div>
                ) : (
                  <BlueprintTimeline
                    steps={visible}
                    onLike={handleLike}
                    onEdit={setEditingStep}
                    onDelete={setDeletingStepId}
                    isOwner={!!isOwner}
                  />
                );
              })()}
            </TabsContent>
            <TabsContent value="floorplan">
              {!trip.floorplan_url && !isOwner && (
                <div className="py-16 text-center text-muted-foreground">
                  <MapIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p>Nog geen plattegrond beschikbaar.</p>
                </div>
              )}
              {trip.floorplan_url && (
                <>
                  {isOwner && (
                    <div className="flex justify-end gap-1 pt-3">
                      <Button size="sm" variant={floorMode === "view" ? "default" : "outline"} onClick={() => setFloorMode("view")}>Bekijken</Button>
                      <Button size="sm" variant={floorMode === "manage" ? "default" : "outline"} onClick={() => setFloorMode("manage")}>Pinnen beheren</Button>
                    </div>
                  )}
                  {(!isOwner || floorMode === "view") ? (
                    <FloorplanScrollView floorplanUrl={trip.floorplan_url} steps={steps} />
                  ) : (
                    <FloorplanView
                      tripId={trip.id}
                      userId={trip.user_id}
                      isOwner={!!isOwner}
                      floorplanUrl={trip.floorplan_url}
                      steps={steps}
                      onChanged={fetchTrip}
                    />
                  )}
                </>
              )}
              {!trip.floorplan_url && isOwner && (
                <FloorplanView
                  tripId={trip.id}
                  userId={trip.user_id}
                  isOwner={!!isOwner}
                  floorplanUrl={trip.floorplan_url}
                  steps={steps}
                  onChanged={fetchTrip}
                />
              )}
            </TabsContent>
            <TabsContent value="photos">
              <AllPhotosTab tripId={trip.id} steps={steps} />
            </TabsContent>
          </Tabs>
        </div>
      </section>

      {showAddStep && id && (
        <AddStepDialog
          tripId={id}
          onClose={() => setShowAddStep(false)}
          onAdded={fetchTrip}
        />
      )}

      {editingStep && (
        <EditStepDialog
          step={editingStep}
          onClose={() => setEditingStep(null)}
          onUpdated={fetchTrip}
        />
      )}

      <AlertDialog open={!!deletingStepId} onOpenChange={() => setDeletingStepId(null)}>
        <AlertDialogContent className="z-[1000]">
          <AlertDialogHeader>
            <AlertDialogTitle>Update verwijderen?</AlertDialogTitle>
            <AlertDialogDescription>
              Dit kan niet ongedaan worden gemaakt. Alle foto's en reacties bij deze update worden ook verwijderd.
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

      {showCoverPicker && (
        <CoverPickerDialog
          tripId={trip.id}
          userId={trip.user_id}
          currentUrl={trip.cover_image_url}
          onClose={() => setShowCoverPicker(false)}
          onSaved={fetchTrip}
        />
      )}
    </div>
  );
};

export default TripDetail;
