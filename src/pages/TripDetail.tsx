import { useEffect, useState, useCallback, useRef } from "react";
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
import FloorplanView, { type FloorInfo } from "@/components/FloorplanView";
import FloorplanScrollView from "@/components/FloorplanScrollView";
import AllPhotosTab from "@/components/AllPhotosTab";
import CoverPickerDialog from "@/components/CoverPickerDialog";
import ProjectSettingsSheet from "@/components/ProjectSettingsSheet";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MapPin, Plus, BookOpen, Share2, Hammer, LayoutGrid, Map as MapIcon, Images, Wallet, Settings, Flag, Upload, Sparkles, Loader2, ChevronDown, MoreHorizontal } from "lucide-react";
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
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState("timeline");
  const [milestonesOnly, setMilestonesOnly] = useState(false);
  const [adjustCover, setAdjustCover] = useState(false);
  const [coverY, setCoverY] = useState<number>(50);
  const [uploadingFloorplan, setUploadingFloorplan] = useState(false);
  const [generatingBlueprint, setGeneratingBlueprint] = useState(false);
  const floorFileRef = useRef<HTMLInputElement>(null);
  const addFloorFileRef = useRef<HTMLInputElement>(null);

  // suppress unused warning — adjustCover kept for potential future use
  void adjustCover;

  const isOwner = user && trip?.user_id === user.id;

  useEffect(() => {
    if (trip?.title) {
      document.title = `${trip.title} — Buildy`;
    }
    return () => { document.title = "Buildy — Verbeter je huis, stap voor stap"; };
  }, [trip?.title]);

  const fetchTrip = useCallback(async () => {
    if (!id) return;

    const { data: tripData } = await supabase
      .from("trips")
      .select("*")
      .eq("id", id)
      .single();

    if (tripData) {
      const [{ data: profileData }, { data: privInfo }] = await Promise.all([
        supabase
          .from("profiles")
          .select("display_name, avatar_url")
          .eq("user_id", tripData.user_id)
          .single(),
        supabase.from("trip_private_info").select("address").eq("trip_id", id).maybeSingle(),
      ]);
      setTrip({ ...tripData, profile: profileData, address: privInfo?.address ?? null });
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

  const uploadFloorplan = async (file: File) => {
    setUploadingFloorplan(true);
    const path = `${trip.user_id}/floorplans/${trip.id}-${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("trip-media").upload(path, file, { upsert: true });
    if (upErr) { toast.error("Upload mislukt"); setUploadingFloorplan(false); return; }
    const { data } = supabase.storage.from("trip-media").getPublicUrl(path);
    // Keep legacy floorplan_url for backward compat; reset floorplans to single floor
    const newFloors: FloorInfo[] = [{ id: crypto.randomUUID(), label: "Begane grond", url: data.publicUrl }];
    await supabase.from("trips").update({ floorplan_url: data.publicUrl, floorplans: newFloors as any }).eq("id", trip.id);
    toast.success("Plattegrond geüpload");
    setUploadingFloorplan(false);
    fetchTrip();
  };

  const addFloor = async (file: File) => {
    setUploadingFloorplan(true);
    const path = `${trip.user_id}/floorplans/${trip.id}-${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("trip-media").upload(path, file, { upsert: true });
    if (upErr) { toast.error("Upload mislukt"); setUploadingFloorplan(false); return; }
    const { data } = supabase.storage.from("trip-media").getPublicUrl(path);
    const existing: FloorInfo[] = Array.isArray(trip.floorplans) && trip.floorplans.length > 0
      ? trip.floorplans
      : trip.floorplan_url
        ? [{ id: "__legacy__", label: "Begane grond", url: trip.floorplan_url }]
        : [];
    const floorLabels = ["Begane grond", "1e verdieping", "2e verdieping", "3e verdieping", "4e verdieping"];
    const newLabel = floorLabels[existing.length] ?? `Verdieping ${existing.length}`;
    const newFloors: FloorInfo[] = [...existing, { id: crypto.randomUUID(), label: newLabel, url: data.publicUrl }];
    await supabase.from("trips").update({ floorplans: newFloors as any }).eq("id", trip.id);
    toast.success(`${newLabel} toegevoegd`);
    setUploadingFloorplan(false);
    fetchTrip();
  };

  const makeBlueprint = async () => {
    if (!trip?.floorplan_url) return;
    if (!confirm("De huidige plattegrond wordt vervangen door een AI-blauwdruk. Doorgaan?")) return;
    setGeneratingBlueprint(true);
    try {
      const { data, error } = await supabase.functions.invoke("floorplan-blueprint", {
        body: { imageUrl: trip.floorplan_url },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const dataUrl: string = (data as any).image;
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const path = `${trip.user_id}/floorplans/${trip.id}-blueprint-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage.from("trip-media").upload(path, blob, { upsert: true, contentType: "image/png" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("trip-media").getPublicUrl(path);
      await supabase.from("trips").update({ floorplan_url: pub.publicUrl }).eq("id", trip.id);
      toast.success("Blauwdruk gegenereerd ✨");
      fetchTrip();
    } catch (e: any) {
      toast.error(e?.message || "Genereren mislukt");
    } finally {
      setGeneratingBlueprint(false);
    }
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

  const effectiveFloorplans: FloorInfo[] =
    Array.isArray(trip.floorplans) && trip.floorplans.length > 0
      ? trip.floorplans
      : trip.floorplan_url
        ? [{ id: "__legacy__", label: "Begane grond", url: trip.floorplan_url }]
        : [];

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
        <div className="container relative py-6 md:py-10">
          <div className="flex flex-col md:flex-row md:flex-wrap md:items-start md:justify-between gap-4">
            <div className="min-w-0 flex-1">
              {trip.project_type && (
                <span className="inline-block text-[10px] md:text-[11px] font-bold uppercase tracking-widest bg-accent text-accent-foreground px-2.5 py-1 rounded-full mb-3">
                  {trip.project_type}
                </span>
              )}
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-2 leading-tight break-words">{trip.title}</h1>
              {trip.profile && (
                <Link to={`/profile/${trip.user_id}`} className="text-sm text-primary-foreground/70 hover:text-accent">
                  door {trip.profile.display_name}
                </Link>
              )}
              <div className="flex flex-wrap items-center gap-3 mt-3 text-sm text-primary-foreground/80">
                {trip.address && (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="break-words">{trip.address}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex gap-2 w-full md:w-auto">
              {isOwner && (
                <Button size="sm" onClick={() => setShowAddStep(true)} className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90 flex-1 md:flex-none">
                  <Plus className="h-4 w-4" /> Update toevoegen
                </Button>
              )}
              {!isOwner && trip.is_public && (
                <FollowButton projectId={trip.id} className="bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground" />
              )}

              {/* Desktop: alle losse knoppen */}
              <div className="hidden md:flex flex-wrap gap-2">
                {isOwner && (
                  <Button size="sm" variant="outline" onClick={() => setShowSettings(true)} className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                    <Settings className="h-4 w-4" /> Instellingen
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={handleShare} className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                  <Share2 className="h-4 w-4" /> Delen
                </Button>
                {(isOwner || (trip.is_public && trip.budget_public)) && (
                  <Link to={`/trip/${id}/budget`}>
                    <Button size="sm" variant="outline" className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                      <Wallet className="h-4 w-4" /> Budget
                    </Button>
                  </Link>
                )}
                {isOwner && (
                  <Link to={`/trip/${id}/photobook`}>
                    <Button size="sm" variant="outline" className="gap-1.5 bg-transparent text-primary-foreground border-primary-foreground/30 hover:bg-primary-foreground/10 hover:text-primary-foreground">
                      <BookOpen className="h-4 w-4" /> Fotoboek
                    </Button>
                  </Link>
                )}
              </div>

            </div>

            {/* Mobile: zichtbare actie-rij ipv overflow-menu */}
            <div className="md:hidden grid grid-cols-4 gap-2 w-full mt-1">
              {isOwner && (
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 hover:bg-primary-foreground/10 px-2 py-2.5 text-primary-foreground"
                >
                  <Settings className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Instel</span>
                </button>
              )}
              <button
                onClick={handleShare}
                className="flex flex-col items-center gap-1.5 rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 hover:bg-primary-foreground/10 px-2 py-2.5 text-primary-foreground"
              >
                <Share2 className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Delen</span>
              </button>
              {(isOwner || (trip.is_public && trip.budget_public)) && (
                <Link
                  to={`/trip/${id}/budget`}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 hover:bg-primary-foreground/10 px-2 py-2.5 text-primary-foreground"
                >
                  <Wallet className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Budget</span>
                </Link>
              )}
              {isOwner && (
                <Link
                  to={`/trip/${id}/photobook`}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-accent bg-accent text-accent-foreground hover:bg-accent/90 px-2 py-2.5"
                >
                  <BookOpen className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Fotoboek</span>
                </Link>
              )}
            </div>
          </div>

          {/* Project description */}
          {trip.description && (
            <div className="mt-4 max-w-2xl">
              <p className="text-sm md:text-base text-primary-foreground/85 whitespace-pre-line leading-relaxed">
                {trip.description}
              </p>
            </div>
          )}

          <ProjectStats
            totalUpdates={steps.length}
            totalPhotos={totalPhotos}
            daysActive={days}
            milestones={milestones}
          />

          <div className="mt-4 max-w-md">
            <ProgressControl
              tripId={trip.id}
              isOwner={false}
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
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <TabsList>
                <TabsTrigger value="timeline" className="gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> Tijdlijn</TabsTrigger>
                <TabsTrigger value="floorplan" className="gap-1.5"><MapIcon className="h-3.5 w-3.5" /> Plattegrond</TabsTrigger>
                <TabsTrigger value="photos" className="gap-1.5"><Images className="h-3.5 w-3.5" /> Alle foto's</TabsTrigger>
              </TabsList>
              {milestones > 0 && activeTab === "timeline" && (
                <Button
                  size="sm"
                  variant={milestonesOnly ? "default" : "outline"}
                  onClick={() => setMilestonesOnly((v) => !v)}
                  className={`gap-1.5 ${milestonesOnly ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`}
                >
                  <Flag className="h-3.5 w-3.5" /> Mijlpalen
                </Button>
              )}
              {(isOwner || (trip.is_public && trip.budget_public)) && (
                <Link to={`/trip/${id}/budget`}>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Wallet className="h-3.5 w-3.5" /> Budget
                  </Button>
                </Link>
              )}
              {isOwner && (
                <Link to={`/trip/${id}/photobook`}>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" /> Fotoboek
                  </Button>
                </Link>
              )}
            </div>
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
              {effectiveFloorplans.length === 0 && !isOwner && (
                <div className="py-16 text-center text-muted-foreground">
                  <MapIcon className="h-10 w-10 mx-auto mb-2 opacity-40" />
                  <p>Nog geen plattegrond beschikbaar.</p>
                </div>
              )}
              {effectiveFloorplans.length === 0 && isOwner && (
                <div className="py-16 text-center">
                  <MapIcon className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
                  <p className="text-muted-foreground mb-4">Nog geen plattegrond geüpload.</p>
                  <Button onClick={() => floorFileRef.current?.click()} disabled={uploadingFloorplan} className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90">
                    <Upload className="h-4 w-4" /> {uploadingFloorplan ? "Uploaden..." : "Plattegrond uploaden"}
                  </Button>
                </div>
              )}
              {effectiveFloorplans.length > 0 && (
                <>
                  {isOwner && (
                    <div className="flex justify-end gap-1 pt-3">
                      <Button size="sm" variant={floorMode === "view" ? "default" : "outline"} onClick={() => setFloorMode("view")}>Bekijken</Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="sm" variant={floorMode === "manage" ? "default" : "outline"} className="gap-1.5">
                            Beheren <ChevronDown className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setFloorMode("manage")}>
                            <MapPin className="h-4 w-4 mr-2" /> Pinnen beheren
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={makeBlueprint} disabled={generatingBlueprint || uploadingFloorplan}>
                            {generatingBlueprint ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                            AI blauwdruk maken
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => addFloorFileRef.current?.click()} disabled={uploadingFloorplan || generatingBlueprint}>
                            <Upload className="h-4 w-4 mr-2" /> Verdieping toevoegen
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => floorFileRef.current?.click()} disabled={uploadingFloorplan || generatingBlueprint}>
                            <Upload className="h-4 w-4 mr-2" /> Plattegrond vervangen
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                  {(!isOwner || floorMode === "view") ? (
                    <FloorplanScrollView floorplans={effectiveFloorplans} steps={steps} />
                  ) : (
                    <FloorplanView
                      tripId={trip.id}
                      userId={trip.user_id}
                      isOwner={!!isOwner}
                      floorplans={effectiveFloorplans}
                      steps={steps}
                      onChanged={fetchTrip}
                    />
                  )}
                </>
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

      {isOwner && (
        <ProjectSettingsSheet
          open={showSettings}
          onOpenChange={setShowSettings}
          trip={trip}
          coverY={coverY}
          onCoverYChange={setCoverY}
          onOpenCoverPicker={() => setShowCoverPicker(true)}
          onChanged={fetchTrip}
        />
      )}

      <input
        ref={floorFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && uploadFloorplan(e.target.files[0])}
      />
      <input
        ref={addFloorFileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => e.target.files?.[0] && addFloor(e.target.files[0])}
      />
    </div>
  );
};

export default TripDetail;
