import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, ChevronLeft, ChevronRight, Hammer, Pencil, Eye, EyeOff, Check } from "lucide-react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { toast } from "sonner";

interface PhotobookSettings {
  cover_title: string | null;
  cover_subtitle: string | null;
  cover_media_id: string | null;
  chapter_overrides: Record<string, string>;
}

const Photobook = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [trip, setTrip] = useState<any>(null);
  const [steps, setSteps] = useState<any[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState(false);
  const [settings, setSettings] = useState<PhotobookSettings>({
    cover_title: null,
    cover_subtitle: null,
    cover_media_id: null,
    chapter_overrides: {},
  });
  const [excludedMedia, setExcludedMedia] = useState<Set<string>>(new Set());
  const [excludedSteps, setExcludedSteps] = useState<Set<string>>(new Set());

  const isOwner = user && trip?.user_id === user.id;

  useEffect(() => {
    const fetchData = async () => {
      if (!id) return;
      const [{ data: tripData }, { data: stepsData }, { data: settingsData }, { data: exMedia }, { data: exSteps }] = await Promise.all([
        supabase.from("trips").select("*").eq("id", id).single(),
        supabase.from("steps").select("*, step_media(*)").eq("trip_id", id).order("step_date", { ascending: true }),
        supabase.from("photobook_settings").select("*").eq("trip_id", id).maybeSingle(),
        supabase.from("photobook_excluded_media").select("media_id").eq("trip_id", id),
        supabase.from("photobook_excluded_steps").select("step_id").eq("trip_id", id),
      ]);
      setTrip(tripData);
      setSteps(stepsData || []);
      if (settingsData) {
        setSettings({
          cover_title: settingsData.cover_title,
          cover_subtitle: settingsData.cover_subtitle,
          cover_media_id: settingsData.cover_media_id,
          chapter_overrides: (settingsData.chapter_overrides as any) || {},
        });
      }
      setExcludedMedia(new Set((exMedia || []).map((r: any) => r.media_id)));
      setExcludedSteps(new Set((exSteps || []).map((r: any) => r.step_id)));
      setLoading(false);
    };
    fetchData();
  }, [id]);

  const upsertSettings = async (patch: Partial<PhotobookSettings>) => {
    if (!id) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    const { error } = await supabase.from("photobook_settings").upsert({
      trip_id: id,
      cover_title: next.cover_title,
      cover_subtitle: next.cover_subtitle,
      cover_media_id: next.cover_media_id,
      chapter_overrides: next.chapter_overrides as any,
    });
    if (error) toast.error("Kon niet opslaan");
  };

  const updateTripField = async (patch: Record<string, any>) => {
    if (!id) return;
    setTrip((t: any) => ({ ...t, ...patch }));
    const { error } = await supabase.from("trips").update(patch).eq("id", id);
    if (error) toast.error("Kon niet opslaan");
  };


  const toggleMedia = async (mediaId: string) => {
    if (!id) return;
    const isOut = excludedMedia.has(mediaId);
    const next = new Set(excludedMedia);
    if (isOut) {
      next.delete(mediaId);
      await supabase.from("photobook_excluded_media").delete().eq("trip_id", id).eq("media_id", mediaId);
    } else {
      next.add(mediaId);
      await supabase.from("photobook_excluded_media").insert({ trip_id: id, media_id: mediaId });
    }
    setExcludedMedia(next);
  };

  const toggleStep = async (stepId: string) => {
    if (!id) return;
    const isOut = excludedSteps.has(stepId);
    const next = new Set(excludedSteps);
    if (isOut) {
      next.delete(stepId);
      await supabase.from("photobook_excluded_steps").delete().eq("trip_id", id).eq("step_id", stepId);
    } else {
      next.add(stepId);
      await supabase.from("photobook_excluded_steps").insert({ trip_id: id, step_id: stepId });
    }
    setExcludedSteps(next);
  };

  // Build pages (memoized)
  const pages = useMemo(() => {
    if (!trip) return [];

    const list: { key: string; node: React.ReactNode; meta?: { stepId?: string; chapter?: string } }[] = [];

    const allMedia = steps.flatMap((s) => (s.step_media || []).map((m: any) => ({ ...m, step: s })));
    const coverImage = settings.cover_media_id
      ? allMedia.find((m) => m.id === settings.cover_media_id)
      : null;
    const coverTitle = settings.cover_title || trip.title;
    const coverSubtitle = settings.cover_subtitle ?? trip.address ?? "";

    const titlePos = (trip.cover_title_position as string) || "center";
    const posClass =
      titlePos === "top" ? "justify-start pt-16"
      : titlePos === "bottom" ? "justify-end pb-16"
      : titlePos === "banner" ? "justify-end pb-0"
      : "justify-center";

    list.push({
      key: "cover",
      node: (
        <div className={`flex flex-col items-center h-full bg-primary text-primary-foreground text-center relative overflow-hidden ${posClass}`}>
          {coverImage && (
            <>
              <img src={coverImage.media_url} alt="" className={`absolute inset-0 w-full h-full object-cover ${titlePos === "banner" ? "opacity-100" : "opacity-40"}`} />
              {titlePos !== "banner" && <div className="absolute inset-0 bg-primary/60" />}
            </>
          )}
          {titlePos !== "banner" && <div className="absolute inset-0 blueprint-grid opacity-15" />}
          <div className={`relative px-12 ${titlePos === "banner" ? "w-full bg-primary/85 py-8" : ""}`}>
            {titlePos !== "banner" && (
              <div className="bg-accent rounded-2xl p-3 inline-block mb-6 shadow-lg">
                <Hammer className="h-8 w-8 text-accent-foreground" />
              </div>
            )}
            {trip.project_type && (
              <p className="text-xs uppercase tracking-[0.3em] text-accent mb-3 font-bold">{trip.project_type}</p>
            )}
            <h1 className="text-4xl md:text-5xl font-bold mb-4 font-serif">{coverTitle}</h1>
            {coverSubtitle && <p className="text-base text-primary-foreground/70 mb-3">{coverSubtitle}</p>}
            {trip.start_date && trip.end_date && (
              <p className="text-lg text-primary-foreground/80">
                {format(new Date(trip.start_date), "d MMM yyyy", { locale: nl })} — {format(new Date(trip.end_date), "d MMM yyyy", { locale: nl })}
              </p>
            )}
            {titlePos !== "banner" && (
              <p className="mt-10 text-xs uppercase tracking-widest text-accent/80">Een Buildy verbouwingslogboek</p>
            )}
          </div>
        </div>
      ),
    });


    if (trip.floorplan_url) {
      list.push({
        key: "floorplan",
        node: (
          <div className="h-full flex flex-col bg-card p-12">
            <div className="text-center mb-6">
              <p className="text-xs uppercase tracking-[0.3em] text-accent font-bold mb-2">Plattegrond</p>
              <h2 className="text-3xl font-serif font-bold">{trip.title}</h2>
              {trip.address && <p className="text-sm text-muted-foreground mt-1">{trip.address}</p>}
            </div>
            <div className="flex-1 min-h-0 flex items-center justify-center">
              <img
                src={trip.floorplan_url}
                alt="Plattegrond"
                className="max-w-full max-h-full object-contain rounded-md shadow-sm"
              />
            </div>
          </div>
        ),
      });
    }


    const visibleSteps = steps.filter((s) => !excludedSteps.has(s.id));
    const phaseOrder = ["Aankoop", "Voorbereiding/Design", "Voorbereiding", "Sloop", "Ruwbouw", "Installatie", "Afbouw", "Afwerking", "Inrichting", "Oplevering"];
    const grouped = new Map<string, any[]>();
    for (const step of visibleSteps) {
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
      const chapterTitle = settings.chapter_overrides[phase] || phase;
      list.push({
        key: `ch-${phase}`,
        meta: { chapter: phase },
        node: (
          <div className="h-full flex flex-col items-center justify-center p-12 bg-secondary/40 text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-accent font-bold mb-4">Hoofdstuk</p>
            <h2 className="text-5xl font-bold font-serif">{chapterTitle}</h2>
            <div className="w-16 h-1 bg-accent mt-6" />
          </div>
        ),
      });

      for (const step of grouped.get(phase)!) {
        const photos = (step.step_media || []).filter((m: any) => m.media_type !== "video" && !excludedMedia.has(m.id));
        const hasDescription = !!step.description;

        if (photos.length === 0 && !hasDescription) continue;

        if (photos.length === 0) {
          list.push({
            key: step.id,
            meta: { stepId: step.id },
            node: (
              <div className="h-full flex flex-col justify-center p-10 md:p-16 bg-card">
                <p className="text-xs uppercase tracking-widest text-accent mb-1 font-bold">{chapterTitle}</p>
                <p className="text-xs text-muted-foreground mb-2">{format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}</p>
                <h2 className="text-3xl font-bold font-serif mb-3">{step.location_name}</h2>
                <p className="text-base leading-relaxed text-foreground/80 italic whitespace-pre-line">"{step.description}"</p>
              </div>
            ),
          });
        } else if (photos.length === 1) {
          list.push({
            key: step.id,
            meta: { stepId: step.id },
            node: (
              <div className="h-full relative">
                <img src={photos[0].media_url} alt="" loading="lazy" className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                <div className="absolute bottom-0 left-0 right-0 p-8 text-white">
                  <p className="text-xs uppercase tracking-widest text-accent mb-1 font-bold">{chapterTitle}</p>
                  <p className="text-xs opacity-70 mb-2">{format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}</p>
                  <h2 className="text-3xl font-bold font-serif mb-2">{step.location_name}</h2>
                  {hasDescription && <p className="text-sm opacity-90 max-w-lg italic">"{step.description}"</p>}
                </div>
              </div>
            ),
          });
        } else {
          // chunk in 4
          for (let i = 0; i < photos.length; i += 4) {
            const batch = photos.slice(i, i + 4);
            const isFirst = i === 0;
            list.push({
              key: `${step.id}-${i}`,
              meta: { stepId: step.id },
              node: (
                <div
                  className="h-full bg-card overflow-hidden grid"
                  style={{ gridTemplateRows: isFirst ? "1fr auto" : "1fr" }}
                >
                  <div
                    className={`grid gap-1 overflow-hidden ${batch.length === 2 ? "grid-cols-2" : "grid-cols-2 grid-rows-2"}`}
                  >
                    {batch.map((m: any) => (
                      <img
                        key={m.id}
                        src={m.media_url}
                        loading="lazy"
                        alt=""
                        className="w-full h-full object-cover min-h-0 min-w-0 block"
                      />
                    ))}
                  </div>
                  {isFirst && (
                    <div className="px-5 py-4 sm:px-6 sm:py-5 border-t bg-card">
                      <p className="text-[10px] sm:text-xs uppercase tracking-widest text-accent mb-0.5 font-bold">
                        {chapterTitle}
                      </p>
                      <p className="text-[10px] sm:text-xs text-muted-foreground mb-1">
                        {format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}
                      </p>
                      <h2 className="text-lg sm:text-2xl font-bold font-serif leading-tight">
                        {step.location_name}
                      </h2>
                      {hasDescription && (
                        <p className="text-xs sm:text-sm text-foreground/80 mt-1.5 italic line-clamp-2 sm:line-clamp-3">
                          "{step.description}"
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ),
            });
          }
        }
      }
    }

    return list;
  }, [trip, steps, settings, excludedMedia, excludedSteps]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin h-8 w-8 border-2 border-accent border-t-transparent rounded-full" />
      </div>
    );
  }

  // Clamp current page
  const safePage = Math.min(currentPage, Math.max(0, pages.length - 1));

  return (
    <div className="min-h-screen bg-muted flex flex-col">
      <div className="container py-4 flex flex-wrap items-center gap-3">
        <Link to={`/trip/${id}`}>
          <Button variant="ghost" size="sm" className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Terug
          </Button>
        </Link>
        <span className="text-sm text-muted-foreground">
          Pagina {safePage + 1} / {pages.length}
        </span>
        {isOwner && (
          <Button
            variant={editing ? "default" : "outline"}
            size="sm"
            onClick={() => setEditing(!editing)}
            className="ml-auto gap-1.5"
          >
            {editing ? <Check className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {editing ? "Klaar met bewerken" : "Bewerk fotoboek"}
          </Button>
        )}
      </div>

      {editing && pages[safePage]?.key === "cover" && (
        <div className="container pb-3 space-y-2">
          <div className="rounded-lg border bg-card p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cover</p>

            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Omslagfoto</p>
              <div className="flex gap-1.5 overflow-x-auto pb-1">
                <button
                  onClick={() => upsertSettings({ cover_media_id: null })}
                  className={`flex-shrink-0 w-14 h-14 rounded border-2 bg-muted flex items-center justify-center text-[10px] ${!settings.cover_media_id ? "border-primary" : "border-transparent"}`}
                  title="Geen foto"
                >
                  Geen
                </button>
                {steps.flatMap((s: any) => (s.step_media || []).filter((m: any) => m.media_type !== "video")).map((m: any) => (
                  <button
                    key={m.id}
                    onClick={() => upsertSettings({ cover_media_id: m.id })}
                    className={`flex-shrink-0 w-14 h-14 rounded border-2 overflow-hidden ${settings.cover_media_id === m.id ? "border-primary" : "border-transparent"}`}
                  >
                    <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            </div>

            <Input
              placeholder={trip.title}
              value={settings.cover_title ?? ""}
              onChange={(e) => upsertSettings({ cover_title: e.target.value || null })}
            />
            <Input
              placeholder={trip.address ?? "Ondertitel"}
              value={settings.cover_subtitle ?? ""}
              onChange={(e) => upsertSettings({ cover_subtitle: e.target.value || null })}
            />

            <div>
              <p className="text-[11px] font-medium text-muted-foreground mb-1.5">Titelpositie</p>
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { v: "top", label: "Boven", bar: "top-2" },
                  { v: "center", label: "Midden", bar: "top-1/2 -translate-y-1/2" },
                  { v: "bottom", label: "Onder", bar: "bottom-2" },
                  { v: "banner", label: "Banner", bar: "bottom-0", full: true },
                ].map((o) => {
                  const active = ((trip.cover_title_position as string) || "center") === o.v;
                  return (
                    <button
                      key={o.v}
                      onClick={() => updateTripField({ cover_title_position: o.v })}
                      className={`relative h-12 rounded border-2 bg-muted ${active ? "border-primary" : "border-transparent"}`}
                      title={o.label}
                    >
                      <span className={`absolute left-2 right-2 h-1.5 rounded ${o.full ? "left-0 right-0 h-3 bg-muted-foreground/60" : "bg-muted-foreground/60"} ${o.bar}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              💡 Klik op een foto in het boek om die uit het fotoboek te halen (blijft in je tijdlijn).
              Klik op een hoofdstukpagina om de titel aan te passen.
            </p>
          </div>
        </div>
      )}


      <div className="flex-1 flex items-center justify-center p-4">
        <div className="relative w-full max-w-5xl aspect-[4/3] bg-card rounded-xl shadow-2xl overflow-hidden">
          {/* Render only nearby pages for perf */}
          {pages.map((p, i) => {
            if (Math.abs(i - safePage) > 1) return null;
            return (
              <div
                key={p.key}
                className="absolute inset-0"
                style={{ display: i === safePage ? "block" : "none" }}
              >
                {p.node}
                {editing && p.meta?.stepId && (
                  <div className="absolute top-2 right-2 z-10 flex gap-1.5">
                    <button
                      onClick={() => toggleStep(p.meta!.stepId!)}
                      className="bg-black/60 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1 hover:bg-black/80"
                    >
                      <EyeOff className="h-3 w-3" /> Verberg update
                    </button>
                  </div>
                )}
                {editing && p.meta?.stepId && (
                  <PhotoEditOverlay
                    step={steps.find((s) => s.id === p.meta!.stepId)}
                    excludedMedia={excludedMedia}
                    onToggleMedia={toggleMedia}
                    onSetCover={(mid) => upsertSettings({ cover_media_id: mid })}
                  />
                )}
                {editing && p.meta?.chapter && (
                  <ChapterEditOverlay
                    phase={p.meta.chapter}
                    value={settings.chapter_overrides[p.meta.chapter] || ""}
                    onChange={(v) =>
                      upsertSettings({
                        chapter_overrides: {
                          ...settings.chapter_overrides,
                          ...(v ? { [p.meta!.chapter!]: v } : {}),
                        },
                      })
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="container py-4 flex justify-center gap-4">
        <Button variant="outline" size="icon" disabled={safePage === 0} onClick={() => setCurrentPage(safePage - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" disabled={safePage >= pages.length - 1} onClick={() => setCurrentPage(safePage + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
};

const PhotoEditOverlay = ({
  step,
  excludedMedia,
  onToggleMedia,
  onSetCover,
}: {
  step: any;
  excludedMedia: Set<string>;
  onToggleMedia: (id: string) => void;
  onSetCover: (id: string) => void;
}) => {
  if (!step) return null;
  const photos = (step.step_media || []).filter((m: any) => m.media_type !== "video");
  return (
    <div className="absolute bottom-2 left-2 right-2 z-10 bg-black/70 backdrop-blur rounded-lg p-2 flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
      {photos.map((m: any) => {
        const out = excludedMedia.has(m.id);
        return (
          <div key={m.id} className="relative group">
            <img src={m.media_url} alt="" className={`w-12 h-12 object-cover rounded transition ${out ? "opacity-40 grayscale" : ""}`} />
            {out && (
              <>
                <div className="absolute inset-0 rounded ring-2 ring-destructive" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <EyeOff className="h-4 w-4 text-destructive drop-shadow" />
                </div>
                <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-[8px] font-bold uppercase tracking-wide px-1 py-0.5 rounded">
                  Uit
                </span>
              </>
            )}
            <div className="absolute inset-0 flex items-center justify-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 rounded">
              <button
                onClick={() => onToggleMedia(m.id)}
                className="text-white p-1 hover:bg-white/20 rounded"
                title={out ? "Terugzetten in fotoboek" : "Verberg uit fotoboek"}
              >
                {out ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              </button>
              <button
                onClick={() => onSetCover(m.id)}
                className="text-white text-[10px] px-1.5 hover:bg-white/20 rounded"
              >
                Cover
              </button>
            </div>
          </div>

        );
      })}
    </div>
  );
};

const ChapterEditOverlay = ({ phase, value, onChange }: { phase: string; value: string; onChange: (v: string) => void }) => {
  return (
    <div className="absolute bottom-4 left-4 right-4 z-10">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Standaard: ${phase}`}
        className="bg-background/95 backdrop-blur"
      />
    </div>
  );
};

export default Photobook;
