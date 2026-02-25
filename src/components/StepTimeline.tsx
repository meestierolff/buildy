import { useRef, useEffect } from "react";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { MapPin, Clock, Heart, MessageCircle, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface StepMedia {
  id: string;
  media_url: string;
  media_type: string;
}

interface Step {
  id: string;
  location_name: string;
  country: string | null;
  description: string | null;
  step_date: string;
  travel_hours: number | null;
  latitude: number | null;
  longitude: number | null;
  step_media: StepMedia[];
  like_count: number;
  comment_count: number;
  user_liked: boolean;
}

interface StepTimelineProps {
  steps: Step[];
  activeStepId: string | null;
  onStepClick: (stepId: string) => void;
  onLike?: (stepId: string) => void;
  onEdit?: (step: Step) => void;
  onDelete?: (stepId: string) => void;
  isOwner?: boolean;
}

const StepTimeline = ({ steps, activeStepId, onStepClick, onLike, onEdit, onDelete, isOwner }: StepTimelineProps) => {
  const refs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (activeStepId && refs.current[activeStepId]) {
      refs.current[activeStepId]?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeStepId]);

  return (
    <div className="relative py-6 px-4">
      {/* Vertical line */}
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/40 via-accent/30 to-primary/10" />

      {steps.map((step, i) => (
        <div key={step.id}>
          {/* Travel indicator */}
          {step.travel_hours && i > 0 && (
            <div className="flex items-center gap-2 ml-5 my-3 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              <span>Gereisd voor {step.travel_hours} uur</span>
            </div>
          )}

          <div
            ref={(el) => { refs.current[step.id] = el; }}
            className={`relative ml-4 pl-8 pb-8 cursor-pointer transition-all ${
              activeStepId === step.id ? "scale-[1.01]" : ""
            }`}
            onClick={() => onStepClick(step.id)}
          >
            {/* Dot */}
            <div
              className={`absolute left-[-1px] top-2 w-3.5 h-3.5 rounded-full border-2 transition-all ${
                activeStepId === step.id
                  ? "bg-accent border-accent shadow-md shadow-accent/30"
                  : "bg-card border-primary/50"
              }`}
            />

            {/* Content card */}
            <div
              className={`bg-card rounded-xl p-4 shadow-sm border transition-all ${
                activeStepId === step.id ? "ring-2 ring-accent/40 shadow-lg" : "hover:shadow-md"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">
                  {format(new Date(step.step_date), "d MMMM yyyy", { locale: nl })}
                </span>
                {isOwner && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-primary"
                      onClick={(e) => { e.stopPropagation(); onEdit?.(step); }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={(e) => { e.stopPropagation(); onDelete?.(step.id); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <h3 className="font-semibold text-lg flex items-center gap-1.5 font-sans">
                <MapPin className="h-4 w-4 text-accent flex-shrink-0" />
                {step.location_name}
                {step.country && <span className="text-muted-foreground text-sm font-normal">, {step.country}</span>}
              </h3>

              {/* Photos */}
              {step.step_media.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg overflow-hidden">
                  {step.step_media.slice(0, 4).map((media, mi) => (
                    <div key={media.id} className={`relative ${step.step_media.length === 1 ? "col-span-2" : ""} ${mi === 0 && step.step_media.length === 3 ? "row-span-2" : ""}`}>
                      {media.media_type === "video" ? (
                        <video src={media.media_url} className="w-full h-32 object-cover" />
                      ) : (
                        <img src={media.media_url} alt="" className="w-full h-32 object-cover" loading="lazy" />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Description */}
              {step.description && (
                <p className="mt-3 text-sm text-foreground/80 leading-relaxed line-clamp-4">
                  {step.description}
                </p>
              )}

              {/* Social */}
              <div className="flex items-center gap-4 mt-3 pt-2 border-t">
                <button
                  onClick={(e) => { e.stopPropagation(); onLike?.(step.id); }}
                  className={`flex items-center gap-1 text-xs transition-colors ${
                    step.user_liked ? "text-red-500" : "text-muted-foreground hover:text-red-500"
                  }`}
                >
                  <Heart className={`h-3.5 w-3.5 ${step.user_liked ? "fill-current" : ""}`} />
                  {step.like_count}
                </button>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <MessageCircle className="h-3.5 w-3.5" />
                  {step.comment_count}
                </span>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};

export default StepTimeline;
