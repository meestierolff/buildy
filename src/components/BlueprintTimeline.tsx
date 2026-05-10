import { useState } from "react";
import { Heart, MessageCircle, Pencil, Trash2, Hammer, Home, PaintRoller, Wrench, CheckCircle2, Sparkles, Sofa, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import ReactionBar from "@/components/ReactionBar";
import CommentsSheet from "@/components/CommentsSheet";
import MediaLightbox, { LightboxItem } from "@/components/MediaLightbox";
import { phaseColor } from "@/components/PhaseSelect";

interface StepMedia {
  id: string;
  media_url: string;
  media_type: string;
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
}

interface Props {
  steps: Step[];
  onLike?: (stepId: string) => void;
  onEdit?: (step: Step) => void;
  onDelete?: (stepId: string) => void;
  isOwner?: boolean;
}

const phaseIcon = (phase: string | null) => {
  switch (phase) {
    case "Voorbereiding": return Ruler;
    case "Sloop": return Hammer;
    case "Ruwbouw": return Home;
    case "Installatie": return Wrench;
    case "Afwerking": return PaintRoller;
    case "Inrichting": return Sofa;
    case "Oplevering": return CheckCircle2;
    default: return Sparkles;
  }
};

const BlueprintTimeline = ({ steps, onLike, onEdit, onDelete, isOwner }: Props) => {
  const [openComments, setOpenComments] = useState<string | null>(null);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [lightbox, setLightbox] = useState<{ items: LightboxItem[]; idx: number; tripId?: string } | null>(null);
  const cc = (id: string, base: number) => commentCounts[id] ?? base;

  const openLightboxForStep = (step: Step, mediaIdx: number) => {
    const items: LightboxItem[] = step.step_media.map((m) => ({
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
    <div className="relative">
      {/* connector line */}
      <div className="absolute left-1/2 top-0 bottom-0 -translate-x-1/2 w-0.5 bg-gradient-to-b from-accent via-accent/60 to-accent/20" />

      <div className="space-y-10 py-8">
        {steps.map((step, i) => {
          const Icon = phaseIcon(step.phase);
          const isLeft = i % 2 === 0;
          return (
            <div key={step.id} className="relative">
              {/* node / milestone marker */}
              <div className="absolute left-1/2 top-6 -translate-x-1/2 z-10">
                {step.is_milestone ? (
                  <div className="w-12 h-12 rounded-full bg-accent text-accent-foreground flex items-center justify-center shadow-lg shadow-accent/40 ring-4 ring-background">
                    <Icon className="h-5 w-5" />
                  </div>
                ) : (
                  <div className="w-4 h-4 rounded-full bg-accent ring-4 ring-background mt-4" />
                )}
              </div>

              {/* card */}
              <div className={`flex ${isLeft ? "justify-start pr-[calc(50%+2rem)]" : "justify-end pl-[calc(50%+2rem)]"}`}>
                <div className="w-full max-w-md bg-card rounded-xl border-2 border-border shadow-md hover:shadow-xl hover:border-accent/40 transition-all overflow-hidden">
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {step.phase && (
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-accent/15 text-accent px-2 py-0.5 rounded-full">
                              {step.phase}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(step.step_date), "d MMM yyyy", { locale: nl })}
                          </span>
                        </div>
                        <h3 className="font-bold text-base text-foreground font-sans leading-tight">
                          {step.location_name}
                        </h3>
                      </div>
                      {isOwner && (
                        <div className="flex items-center gap-1 shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit?.(step)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => onDelete?.(step.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </div>

                    {step.step_media.length > 0 && (
                      <div className="grid grid-cols-2 gap-1 rounded-lg overflow-hidden mb-3">
                        {step.step_media.slice(0, 4).map((m, mi) => (
                          <div key={m.id} className={`relative ${step.step_media.length === 1 ? "col-span-2" : ""} ${mi === 0 && step.step_media.length === 3 ? "row-span-2" : ""}`}>
                            {m.media_type === "video" ? (
                              <video src={m.media_url} className="w-full h-28 object-cover" />
                            ) : (
                              <img src={m.media_url} alt="" className="w-full h-28 object-cover" loading="lazy" />
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {step.description && (
                      <p className="text-sm text-foreground/80 leading-relaxed line-clamp-4">
                        {step.description}
                      </p>
                    )}

                    <div className="mt-3 pt-2 border-t space-y-2">
                      <ReactionBar stepId={step.id} />
                      <div className="flex items-center gap-4">
                        <button
                          onClick={() => onLike?.(step.id)}
                          className={`flex items-center gap-1 text-xs transition-colors ${
                            step.user_liked ? "text-accent" : "text-muted-foreground hover:text-accent"
                          }`}
                        >
                          <Heart className={`h-3.5 w-3.5 ${step.user_liked ? "fill-current" : ""}`} />
                          {step.like_count}
                        </button>
                        <button
                          onClick={() => setOpenComments(step.id)}
                          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-accent transition-colors"
                        >
                          <MessageCircle className="h-3.5 w-3.5" />
                          {cc(step.id, step.comment_count)}
                        </button>
                      </div>
                    </div>
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
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default BlueprintTimeline;
