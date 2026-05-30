import { useState } from "react";
import { Heart, MessageCircle, Pencil, Trash2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import ReactionBar from "@/components/ReactionBar";
import CommentsSheet from "@/components/CommentsSheet";
import MediaLightbox, { LightboxItem } from "@/components/MediaLightbox";
import BeforeAfterSlider from "@/components/BeforeAfterSlider";
import { phaseColor } from "@/components/PhaseSelect";

interface StepMedia {
  id: string;
  media_url: string;
  media_type: string;
  compare_role?: "before" | "after" | null;
  sort_order?: number | null;
}

interface Step {
  id: string;
  location_name: string;
  description: string | null;
  step_date: string;
  phase: string | null;
  is_milestone: boolean | null;
  step_media: StepMedia[];
  like_count: number;
  comment_count: number;
  user_liked: boolean;
  contractor_name?: string | null;
}

interface Props {
  steps: Step[];
  onLike?: (stepId: string) => void;
  onEdit?: (step: Step) => void;
  onDelete?: (stepId: string) => void;
  isOwner?: boolean;
}

const BlueprintTimeline = ({ steps, onLike, onEdit, onDelete, isOwner }: Props) => {
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; idx: number } | null>(null);
  const cc = (id: string, base: number) => commentCounts[id] ?? base;

  const openLightboxForStep = (step: Step, mediaIdx: number) => {
    const items: LightboxItem[] = [...step.step_media].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)).map((m) => ({
      id: m.id,
      url: m.media_url,
      type: m.media_type,
      stepId: step.id,
      stepTitle: step.location_name,
      stepDate: step.step_date,
      phase: step.phase,
    }));
    setLightbox({ items, idx: mediaIdx });
  };
  return (
    <div className="divide-y divide-border/50 pb-16">
      {steps.map((step) => {
        // Sort media by sort_order to match edit dialog order
        const sortedMedia = [...step.step_media].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
        const before = sortedMedia.find((m) => m.compare_role === "before");
        const after = sortedMedia.find((m) => m.compare_role === "after");
        const hasCompare = !!before && !!after;
        const visuals = sortedMedia.filter(
          (m) => m.media_type !== "pdf" && !(hasCompare && (m.id === before!.id || m.id === after!.id))
        );
        const pdfs = sortedMedia.filter((m) => m.media_type === "pdf");

        return (
          <article key={step.id} className="bg-card">
            {/* Step meta row: date + phase + owner actions */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2 gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                <time className="text-xs font-medium text-muted-foreground">
                  {format(new Date(step.step_date), "d MMMM yyyy", { locale: nl })}
                </time>
                {step.phase && (
                  <span className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${phaseColor(step.phase)}`}>
                    {step.phase}
                  </span>
                )}
                {step.is_milestone && (
                  <span className="flex items-center gap-0.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                    <Star className="h-2.5 w-2.5" /> Mijlpaal
                  </span>
                )}
              </div>
              {isOwner && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit?.(step)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => onDelete?.(step.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </div>

            {/* Title */}
            <div className="px-4 pb-3">
              <h3 className="font-bold text-lg leading-tight">{step.location_name}</h3>
            </div>

            {/* Before/After slider */}
            {hasCompare && (
              <div className="px-4 pb-3">
                <BeforeAfterSlider beforeUrl={before!.media_url} afterUrl={after!.media_url} />
              </div>
            )}

            {/* Photos: hero + thumbnail strip */}
            {visuals.length > 0 && (
              <div className="mb-0">
                {/* Hero photo — full card width, no padding */}
                <button
                  type="button"
                  className="w-full block relative overflow-hidden bg-muted"
                  style={{ aspectRatio: "4/3" }}
                  onClick={() => openLightboxForStep(step, sortedMedia.findIndex((x) => x.id === visuals[0].id))}
                >
                  {visuals[0].media_type === "video" ? (
                    <video src={visuals[0].media_url} className="w-full h-full object-cover" />
                  ) : (
                    <img
                      src={visuals[0].media_url}
                      alt=""
                      className="w-full h-full object-cover hover:scale-[1.02] transition-transform duration-700"
                      loading="lazy"
                    />
                  )}
                </button>
                {/* Thumbnail strip for extra photos */}
                {visuals.length > 1 && (
                  <div className={`grid gap-0.5 mt-0.5 ${visuals.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                    {visuals.slice(1, 4).map((m, mi) => {
                      const origIdx = sortedMedia.findIndex((x) => x.id === m.id);
                      const isOverflow = mi === 2 && visuals.length > 4;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => openLightboxForStep(step, origIdx)}
                          className="relative bg-muted overflow-hidden"
                          style={{ aspectRatio: "1" }}
                        >
                          {m.media_type === "video" ? (
                            <video src={m.media_url} className="absolute inset-0 w-full h-full object-cover" />
                          ) : (
                            <img src={m.media_url} alt="" className="absolute inset-0 w-full h-full object-cover hover:opacity-90 transition-opacity" loading="lazy" />
                          )}
                          {isOverflow && (
                            <div className="absolute inset-0 bg-black/60 text-white text-sm font-semibold flex items-center justify-center">
                              +{visuals.length - 3}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Description + PDFs */}
            <div className="px-4 py-3 space-y-2">
              {step.description && (
                <p className="text-sm text-foreground/80 leading-relaxed">{step.description}</p>
              )}
              {step.contractor_name && (
                <p className="text-[11px] text-muted-foreground font-medium">🔧 {step.contractor_name}</p>
              )}
              {pdfs.length > 0 && (
                <div className="space-y-1.5">
                  {pdfs.map((m) => {
                    const name = decodeURIComponent(m.media_url.split("/").pop() || "document.pdf");
                    return (
                      <a
                        key={m.id}
                        href={m.media_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-md border bg-secondary/40 hover:bg-secondary px-3 py-2 text-sm transition-colors"
                      >
                        <span className="text-lg">📄</span>
                        <span className="truncate flex-1">{name}</span>
                        <span className="text-xs text-muted-foreground">PDF</span>
                      </a>
                    );
                  })}
                </div>
              )}

              {/* Reactions + likes + comments */}
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <ReactionBar stepId={step.id} />
                <div className="flex items-center gap-4">
                  <button
                    onClick={() => onLike?.(step.id)}
                    className={`flex items-center gap-1.5 text-sm transition-colors ${step.user_liked ? "text-accent" : "text-muted-foreground hover:text-accent"}`}
                  >
                    <Heart className={`h-4 w-4 ${step.user_liked ? "fill-current" : ""}`} />
                    <span className="text-xs">{step.like_count}</span>
                  </button>
                  <button
                    onClick={() => setOpenComments(step.id)}
                    className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-accent transition-colors"
                  >
                    <MessageCircle className="h-4 w-4" />
                    <span className="text-xs">{cc(step.id, step.comment_count)}</span>
                  </button>
                </div>
              </div>
            </div>

            <CommentsSheet
              stepId={step.id}
              open={openComments === step.id}
              onOpenChange={(o) => setOpenComments(o ? step.id : null)}
              onCountChange={(d) =>
                setCommentCounts((p) => ({ ...p, [step.id]: cc(step.id, step.comment_count) + d }))
              }
            />
          </article>
        );
      })}
      {lightbox && (
        <MediaLightbox
          items={lightbox.items}
          index={lightbox.idx}
          onIndex={(i) => setLightbox({ ...lightbox, idx: i })}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
};

export default BlueprintTimeline;
