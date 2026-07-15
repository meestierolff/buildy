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
import TripRouteMap from "@/components/TripRouteMap";
import CoverPickerDialog from "@/components/CoverPickerDialog";
import ProjectSettingsSheet from "@/components/ProjectSettingsSheet";
import RequestAccessCard from "@/components/RequestAccessCard";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MapPin, Plus, BookOpen, Share2, Hammer, LayoutGrid, Map as MapIcon, Images, Wallet, Settings, Flag, Upload, Sparkles, Loader2, ChevronDown } from "lucide-react";
import { differenceInDays } from "date-fns";
import { toast } from "sonner";
import {
  hydrateStepsMedia,
  hydrateTripAssets,
  resolvePrivateStoragePath,
  serializeFloorAssets,
} from "@/lib/mediaUrl";
import { prepareUpload } from "@/lib/compressImage";
import { getOwnedPrivatePath, getOwnedPublicTripMediaPath } from "@/lib/storagePaths";
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
import { usePageMeta } from "@/hooks/usePageMeta";

const AI_BLUEPRINT_ENABLED = import.meta.env.VITE_AI_BLUEPRINT_ENABLED === "true";

const toSortableTime = (value?: string | null) => {
  const time = value ? new Date(value).getTime() : 0;
  return Number.isFinite(time) ? time : 0;
};

const sortStepsOldestFirst = <T extends { step_date: string; step_order?: number | null; created_at?: string | null }>(items: T[]) =>
  [...items].sort((a, b) => {
    const dateDiff = toSortableTime(a.step_date) - toSortableTime(b.step_date);
    if (dateDiff !== 0) return dateDiff;

    const orderDiff = (a.step_order ?? 0) - (b.step_order ?? 0);
    if (orderDiff !== 0) return orderDiff;

    return toSortableTime(a.created_at) - toSortableTime(b.created_at);
  });

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
  const [showRouteMap, setShowRouteMap] = useState(false);
  const [coverY, setCoverY] = useState<number>(50);
  const [uploadingFloorplan, setUploadingFloorplan] = useState(false);
  const [generatingBlueprint, setGeneratingBlueprint] = useState(false);
  const floorFileRef = useRef<HTMLInputElement>(null);
  const addFloorFileRef = useRef<HTMLInputElement>(null);

  const isOwner = user && trip?.user_id === user.id;
  const fallbackCoverUrl = steps
    .flatMap((s) => s.step_media || [])
    .find((m: any) => m.media_type !== "video" && m.media_type !== "pdf")?.media_url;
  const pageCoverUrl = trip?.cover_image_url || fallbackCoverUrl;
  usePageMeta({
    title: trip?.title ? `${trip.title} — Buildy` : "Project — Buildy",
    description: trip?.description
      ? `${trip.description.slice(0, 145)}${trip.description.length > 145 ? "..." : ""}`
      : "Bekijk de updates, foto's, fases en mijlpalen van dit renovatieproject op Buildy.",
    image: pageCoverUrl || undefined,
    imageAlt: trip?.title ? `Renovatieproject ${trip.title} op Buildy` : "Renovatieproject op Buildy",
    path: id ? `/trip/${id}` : undefined,
    noIndex: !!trip && !trip.is_public,
    type: "article",
  });

  const fetchTrip = useCallback(async () => {
    if (!id) return;

    const { data: tripData } = await supabase
      .from("trips")
      .select("*")
      .eq("id", id)
      .single();

    if (tripData) {
      await hydrateTripAssets([tripData]);
      const [{ data: profileRows }, { data: privInfo }] = await Promise.all([
        supabase.rpc("get_profiles_basic", { _ids: [tripData.user_id] }),
        supabase.from("trip_private_info").select("address").eq("trip_id", id).maybeSingle(),
      ]);
      const profileData = (profileRows && profileRows[0]) || null;
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
      await hydrateStepsMedia(stepsData as any);
      const stepIds = stepsData.map((step) => step.id);
      if (stepIds.length === 0) {
        setSteps([]);
      } else {
        const isOwner = !!user && user.id === (tripData as any)?.user_id;
        const [likesRes, commentsRes, userLikesRes, contractorRes] = await Promise.all([
          supabase.from("likes").select("step_id").in("step_id", stepIds),
          supabase.from("comments").select("step_id").in("step_id", stepIds),
          user
            ? supabase.from("likes").select("step_id").eq("user_id", user.id).in("step_id", stepIds)
            : Promise.resolve({ data: [] }),
          isOwner
            ? supabase.from("step_contractor_info").select("step_id, contractor_name, contractor_notes").in("step_id", stepIds)
            : Promise.resolve({ data: [] }),
        ]);

        const likeCounts = new Map<string, number>();
        (likesRes.data || []).forEach((like: any) => {
          likeCounts.set(like.step_id, (likeCounts.get(like.step_id) || 0) + 1);
        });

        const commentCounts = new Map<string, number>();
        (commentsRes.data || []).forEach((comment: any) => {
          commentCounts.set(comment.step_id, (commentCounts.get(comment.step_id) || 0) + 1);
        });

        const likedByUser = new Set((userLikesRes.data || []).map((like: any) => like.step_id));
        const contractorMap = new Map<string, { contractor_name: string | null; contractor_notes: string | null }>();
        ((contractorRes as any).data || []).forEach((c: any) => {
          contractorMap.set(c.step_id, { contractor_name: c.contractor_name, contractor_notes: c.contractor_notes });
        });

        setSteps(stepsData.map((step) => ({
          ...step,
          like_count: likeCounts.get(step.id) || 0,
          comment_count: commentCounts.get(step.id) || 0,
          user_liked: likedByUser.has(step.id),
          contractor_name: contractorMap.get(step.id)?.contractor_name ?? null,
          contractor_notes: contractorMap.get(step.id)?.contractor_notes ?? null,
        })));

      }
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

    const { error } = step.user_liked
      ? await supabase.from("likes").delete().eq("step_id", stepId).eq("user_id", user.id)
      : await supabase.from("likes").insert({ step_id: stepId, user_id: user.id });
    if (error) {
      console.error("Like toggle failed:", error);
      toast.error("Like bijwerken mislukt");
      return;
    }

    setSteps((prev) =>
      prev.map((s) =>
        s.id === stepId
          ? { ...s, user_liked: !s.user_liked, like_count: s.like_count + (s.user_liked ? -1 : 1) }
          : s
      )
    );
  };

  const handleReorderMedia = async (stepId: string, orderedMediaIds: string[]) => {
    if (!isOwner) return;
    const step = steps.find((s) => s.id === stepId);
    if (!step) return;

    const sortedMedia = [...(step.step_media || [])].sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const mediaById = new Map(sortedMedia.map((media: any) => [media.id, media]));
    const orderedVisuals = orderedMediaIds
      .map((mediaId) => mediaById.get(mediaId))
      .filter(Boolean);
    const remainingVisuals = sortedMedia.filter((media: any) => media.media_type !== "pdf" && !orderedMediaIds.includes(media.id));
    const pdfs = sortedMedia.filter((media: any) => media.media_type === "pdf");
    const nextMedia = [...orderedVisuals, ...remainingVisuals, ...pdfs].map((media: any, index) => ({
      ...media,
      sort_order: index,
    }));

    setSteps((current) =>
      current.map((item) => item.id === stepId ? { ...item, step_media: nextMedia } : item),
    );

    const results = await Promise.all(
      nextMedia.map((media: any) =>
        supabase.from("step_media").update({ sort_order: media.sort_order }).eq("id", media.id),
      ),
    );
    const error = results.find((result) => result.error)?.error;
    if (error) {
      console.error("Reorder media failed:", error);
      toast.error("Kon fotovolgorde niet opslaan");
      fetchTrip();
    }
  };

  const handleDelete = async () => {
    if (!deletingStepId) return;
    const step = steps.find((item) => item.id === deletingStepId);
    if (!step || !trip?.user_id) {
      toast.error("Update kon niet worden gevonden");
      setDeletingStepId(null);
      return;
    }

    const mediaRows = (step.step_media || []) as Array<{
      storage_path?: string | null;
      media_url?: string | null;
    }>;
    const privatePaths = Array.from(new Set(mediaRows
      .map((media) => getOwnedPrivatePath(media.storage_path, trip.user_id))
      .filter((path: string | null): path is string => !!path)));
    const publicPaths = Array.from(new Set(mediaRows
      .map((media) => getOwnedPublicTripMediaPath(media.media_url, trip.user_id))
      .filter((path: string | null): path is string => !!path)));

    if (privatePaths.length > 0) {
      const { error } = await supabase.storage.from("trip-private").remove(privatePaths);
      if (error) {
        console.error("Delete private step media failed:", error);
        toast.error("Foto's konden niet veilig worden verwijderd. De update is behouden.");
        return;
      }
    }
    if (publicPaths.length > 0) {
      const { error } = await supabase.storage.from("trip-media").remove(publicPaths);
      if (error) {
        console.error("Delete legacy step media failed:", error);
        toast.error("Oude foto's konden niet worden verwijderd. De update is behouden.");
        return;
      }
    }

    if (trip.cover_image_url && (step.step_media || []).some(
      (media: { media_url?: string | null }) => media.media_url === trip.cover_image_url,
    )) {
      const { error } = await supabase
        .from("trips")
        .update({ cover_image_url: null, cover_storage_path: null })
        .eq("id", trip.id);
      if (error) console.error("Clear deleted step cover failed:", error);
    }

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

  const handleShare = async () => {
    const url = window.location.href;
    const shareData = {
      title: trip?.title ? `${trip.title} op Buildy` : "Renovatieproject op Buildy",
      text: trip?.is_public
        ? "Bekijk dit renovatieproject op Buildy."
        : "Bekijk dit privéproject op Buildy. Toegang van de eigenaar is vereist.",
      url,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        toast.success("Project gedeeld");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("Native share failed, using clipboard:", error);
      }
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const input = document.createElement("textarea");
        input.value = url;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (!copied) throw new Error("Clipboard fallback failed");
      }
      toast.success(trip?.is_public
        ? "Projectlink gekopieerd"
        : "Privélink gekopieerd — de ontvanger moet eerst toegang krijgen");
    } catch (error) {
      console.error("Share failed:", error);
      toast.error("Delen mislukt. Kopieer de link uit je adresbalk.");
    }
  };

  const uploadFloorplanAsset = async (blob: Blob, extension: string) => {
    const path = `${trip.user_id}/trip-assets/${trip.id}/floorplans/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage
      .from("trip-private")
      .upload(path, blob, { contentType: blob.type || undefined });
    if (error) throw error;
    const url = await resolvePrivateStoragePath(path);
    if (!url) {
      await supabase.storage.from("trip-private").remove([path]);
      throw new Error("De beveiligde plattegrond kon niet worden geladen");
    }
    return { path, url };
  };

  const prepareFloorplanAsset = async (file: File) => {
    const prepared = await prepareUpload(file);
    if (!prepared.type.startsWith("image/")) throw new Error("Kies een JPG-, PNG-, WebP-, GIF- of AVIF-afbeelding");
    const extension = prepared.name.split(".").pop()?.toLowerCase() || "jpg";
    return uploadFloorplanAsset(prepared, extension);
  };

  const removeReplacedFloorplans = async (
    paths: Array<string | null | undefined>,
    legacyUrls: Array<string | null | undefined> = [],
  ) => {
    const prefix = `${trip.user_id}/trip-assets/${trip.id}/floorplans/`;
    const ownedPaths = Array.from(new Set(paths.filter((path): path is string => !!path && path.startsWith(prefix))));
    if (ownedPaths.length > 0) {
      const { error } = await supabase.storage.from("trip-private").remove(ownedPaths);
      if (error) console.error("Remove replaced floorplan failed:", error);
    }

    const uniqueLegacyUrls = Array.from(new Set(legacyUrls.filter((url): url is string => !!url)));
    if (uniqueLegacyUrls.length === 0) return;
    const { data: mediaReferences, error: referenceError } = await supabase
      .from("step_media")
      .select("media_url")
      .in("media_url", uniqueLegacyUrls);
    if (referenceError) {
      console.error("Check legacy floorplan references failed:", referenceError);
      return;
    }
    const referencedUrls = new Set((mediaReferences || []).map((row) => row.media_url));
    if (trip.cover_image_url) referencedUrls.add(trip.cover_image_url);
    const publicPaths = uniqueLegacyUrls
      .filter((url) => !referencedUrls.has(url))
      .map((url) => getOwnedPublicTripMediaPath(url, trip.user_id))
      .filter((path): path is string => !!path);
    if (publicPaths.length > 0) {
      const { error } = await supabase.storage.from("trip-media").remove(Array.from(new Set(publicPaths)));
      if (error) console.error("Remove legacy floorplan failed:", error);
    }
  };

  const uploadFloorplan = async (file: File) => {
    setUploadingFloorplan(true);
    try {
      const asset = await prepareFloorplanAsset(file);
      const newFloors: FloorInfo[] = [{
        id: crypto.randomUUID(),
        label: "Begane grond",
        url: asset.url,
        storage_path: asset.path,
      }];
      const previousPaths = [
        trip.floorplan_storage_path,
        ...(Array.isArray(trip.floorplans) ? trip.floorplans.map((floor: FloorInfo) => floor.storage_path) : []),
      ];
      const previousUrls = [
        trip.floorplan_url,
        ...(Array.isArray(trip.floorplans) ? trip.floorplans.map((floor: FloorInfo) => floor.url) : []),
      ];
      const { error } = await supabase.from("trips").update({
        floorplan_url: null,
        floorplan_storage_path: asset.path,
        floorplans: serializeFloorAssets(newFloors) as any,
      }).eq("id", trip.id);
      if (error) {
        await supabase.storage.from("trip-private").remove([asset.path]);
        throw error;
      }
      await removeReplacedFloorplans(previousPaths, previousUrls);
      toast.success("Plattegrond veilig geüpload");
      await fetchTrip();
    } catch (error) {
      console.error("Upload floorplan failed:", error);
      toast.error(error instanceof Error ? error.message : "Upload mislukt");
    } finally {
      setUploadingFloorplan(false);
    }
  };

  const addFloor = async (file: File) => {
    setUploadingFloorplan(true);
    try {
      const asset = await prepareFloorplanAsset(file);
      const existing: FloorInfo[] = Array.isArray(trip.floorplans) && trip.floorplans.length > 0
        ? trip.floorplans
        : trip.floorplan_url
          ? [{
              id: "__legacy__",
              label: "Begane grond",
              url: trip.floorplan_url,
              storage_path: trip.floorplan_storage_path,
            }]
          : [];
      const floorLabels = ["Begane grond", "1e verdieping", "2e verdieping", "3e verdieping", "4e verdieping"];
      const newLabel = floorLabels[existing.length] ?? `Verdieping ${existing.length}`;
      const newFloors: FloorInfo[] = [...existing, {
        id: crypto.randomUUID(),
        label: newLabel,
        url: asset.url,
        storage_path: asset.path,
      }];
      const { error } = await supabase.from("trips").update({
        floorplans: serializeFloorAssets(newFloors) as any,
      }).eq("id", trip.id);
      if (error) {
        await supabase.storage.from("trip-private").remove([asset.path]);
        throw error;
      }
      toast.success(`${newLabel} toegevoegd`);
      await fetchTrip();
    } catch (error) {
      console.error("Add floorplan failed:", error);
      toast.error(error instanceof Error ? error.message : "Upload mislukt");
    } finally {
      setUploadingFloorplan(false);
    }
  };

  const makeBlueprint = async () => {
    const currentFloors: FloorInfo[] = Array.isArray(trip?.floorplans) && trip.floorplans.length > 0
      ? trip.floorplans
      : trip?.floorplan_url
        ? [{
            id: "__legacy__",
            label: "Begane grond",
            url: trip.floorplan_url,
            storage_path: trip.floorplan_storage_path,
          }]
        : [];
    const primary = currentFloors[0];
    if (!primary) return;
    if (!confirm("De huidige plattegrond wordt vervangen door een AI-blauwdruk. Doorgaan?")) return;
    setGeneratingBlueprint(true);
    try {
      const body = primary.storage_path
        ? { storagePath: primary.storage_path }
        : { imageUrl: primary.url };
      const { data, error } = await supabase.functions.invoke("floorplan-blueprint", { body });
      if (error) throw error;
      const payload = data as { error?: string; image?: string } | null;
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.image) throw new Error("De blauwdrukservice gaf geen afbeelding terug");
      const response = await fetch(payload.image);
      if (!response.ok) throw new Error("De gegenereerde afbeelding kon niet worden gelezen");
      const blob = await response.blob();
      const asset = await uploadFloorplanAsset(blob, "png");
      const newFloors: FloorInfo[] = currentFloors.map((floor, index) => index === 0
        ? { ...floor, url: asset.url, storage_path: asset.path }
        : floor);
      const { error: saveError } = await supabase.from("trips").update({
        floorplan_url: null,
        floorplan_storage_path: asset.path,
        floorplans: serializeFloorAssets(newFloors) as any,
      }).eq("id", trip.id);
      if (saveError) {
        await supabase.storage.from("trip-private").remove([asset.path]);
        throw saveError;
      }
      await removeReplacedFloorplans([primary.storage_path], [primary.url]);
      toast.success("Blauwdruk gegenereerd ✨");
      await fetchTrip();
    } catch (error) {
      console.error("Generate blueprint failed:", error);
      toast.error(error instanceof Error ? error.message : "Genereren mislukt");
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
    return id ? <RequestAccessCard tripId={id} /> : (
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
  const headerCoverUrl = pageCoverUrl;
  const timelineSteps = sortStepsOldestFirst(steps);

  const resolvedFloorplans: FloorInfo[] = Array.isArray(trip.floorplans)
    ? trip.floorplans.filter((floor: FloorInfo) => typeof floor?.url === "string" && floor.url.length > 0)
    : [];
  const effectiveFloorplans: FloorInfo[] =
    resolvedFloorplans.length > 0
      ? resolvedFloorplans
      : trip.floorplan_url
        ? [{
            id: "__legacy__",
            label: "Begane grond",
            url: trip.floorplan_url,
            storage_path: trip.floorplan_storage_path,
          }]
        : [];

  return (
    <div className="min-h-screen">
      {/* Project header */}
      <section className="relative bg-primary text-primary-foreground overflow-hidden">
        {headerCoverUrl ? (
          <>
            <img
              src={headerCoverUrl}
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
              {!isOwner && (
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
                    <Button size="sm" className="gap-1.5 bg-accent text-accent-foreground shadow-lg shadow-accent/20 hover:bg-accent/90">
                      <BookOpen className="h-4 w-4" /> Fotoboek
                    </Button>
                  </Link>
                )}
              </div>

            </div>

            {/* Mobile: zichtbare actie-rij ipv overflow-menu */}
            <div className="md:hidden flex flex-wrap gap-2 w-full mt-1">
              {isOwner && (
                <button
                  onClick={() => setShowSettings(true)}
                  className="flex min-w-[88px] flex-1 flex-col items-center gap-1.5 rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 hover:bg-primary-foreground/10 px-2 py-2.5 text-primary-foreground"
                >
                  <Settings className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Instel</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleShare}
                className="flex min-w-[88px] flex-1 flex-col items-center gap-1.5 rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 hover:bg-primary-foreground/10 px-2 py-2.5 text-primary-foreground"
                aria-label="Project delen"
              >
                <Share2 className="h-4 w-4" />
                <span className="text-[10px] font-bold uppercase tracking-wider">Delen</span>
              </button>
              {(isOwner || (trip.is_public && trip.budget_public)) && (
                <Link
                  to={`/trip/${id}/budget`}
                  className="flex min-w-[88px] flex-1 flex-col items-center gap-1.5 rounded-xl border border-primary-foreground/20 bg-primary-foreground/5 hover:bg-primary-foreground/10 px-2 py-2.5 text-primary-foreground"
                >
                  <Wallet className="h-4 w-4" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Budget</span>
                </Link>
              )}
              {isOwner && (
                <Link
                  to={`/trip/${id}/photobook`}
                  className="flex min-w-[88px] flex-1 flex-col items-center gap-1.5 rounded-xl border border-accent bg-accent text-accent-foreground shadow-lg shadow-accent/20 hover:bg-accent/90 px-2 py-2.5"
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
        <div className="container relative max-w-7xl">
          <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v); if (v !== "timeline") setMilestonesOnly(false); }} className="pt-6">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <TabsList>
                <TabsTrigger value="timeline" className="gap-1.5"><LayoutGrid className="h-3.5 w-3.5" /> Tijdlijn</TabsTrigger>
                <TabsTrigger value="floorplan" className="gap-1.5"><MapIcon className="h-3.5 w-3.5" /> Plattegrond</TabsTrigger>
                <TabsTrigger value="photos" className="gap-1.5"><Images className="h-3.5 w-3.5" /> Alle foto's</TabsTrigger>
              </TabsList>
              {milestones > 0 && (
                <Button
                  size="sm"
                  variant={milestonesOnly ? "default" : "outline"}
                  onClick={() => {
                    if (activeTab !== "timeline") {
                      setActiveTab("timeline");
                      setMilestonesOnly(true);
                      return;
                    }
                    setMilestonesOnly((v) => !v);
                  }}
                  className={`gap-1.5 ${milestonesOnly ? "bg-accent text-accent-foreground hover:bg-accent/90" : ""}`}
                >
                  <Flag className="h-3.5 w-3.5" /> Mijlpalen
                </Button>
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
                const visible = milestonesOnly ? timelineSteps.filter((s) => s.is_milestone) : timelineSteps;
                const routeSteps = (milestonesOnly ? steps.filter((s) => s.is_milestone) : steps).map((s) => ({
                  id: s.id,
                  latitude: s.latitude ?? null,
                  longitude: s.longitude ?? null,
                  location_name: s.location_name,
                  step_date: s.step_date,
                }));
                return visible.length === 0 ? (
                  <div className="py-20 text-center text-muted-foreground">
                    <Hammer className="h-12 w-12 mx-auto mb-3 opacity-40" />
                    <p className="text-lg">{milestonesOnly ? "Geen mijlpalen gevonden." : "Nog geen updates."}</p>
                    {isOwner && !milestonesOnly && <p className="text-sm mt-1">Voeg je eerste 'voor'-foto toe om te starten!</p>}
                  </div>
                ) : (
                  <div className={`grid gap-4 ${showRouteMap ? "lg:grid-cols-[minmax(0,1fr)_320px]" : ""}`}>
                    <div className="min-w-0">
                      <BlueprintTimeline
                        steps={visible}
                        onLike={handleLike}
                        onEdit={setEditingStep}
                        onDelete={setDeletingStepId}
                        onReorderMedia={handleReorderMedia}
                        isOwner={!!isOwner}
                        tripId={trip.id}
                      />
                      {routeSteps.some((s) => s.latitude && s.longitude) && (
                        <div className="mt-3">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setShowRouteMap((v) => !v)}
                            className="gap-1.5 text-xs"
                          >
                            <MapIcon className="h-3.5 w-3.5" />
                            {showRouteMap ? "Locatiekaart verbergen" : "Locatiekaart tonen"}
                          </Button>
                        </div>
                      )}
                    </div>
                    {showRouteMap && (
                      <aside className="hidden lg:block">
                        <div className="sticky top-4 h-[calc(100vh-6rem)]">
                          <TripRouteMap steps={routeSteps} />
                        </div>
                      </aside>
                    )}
                  </div>
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
                          {AI_BLUEPRINT_ENABLED && (
                            <DropdownMenuItem onClick={makeBlueprint} disabled={generatingBlueprint || uploadingFloorplan}>
                              {generatingBlueprint ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
                              AI blauwdruk maken
                            </DropdownMenuItem>
                          )}
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
          currentStoragePath={trip.cover_storage_path}
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
