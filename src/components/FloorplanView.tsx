import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Upload, MapPin, Hammer, Move } from "lucide-react";
import { toast } from "sonner";

interface Step {
  id: string;
  location_name: string;
  room: string | null;
  floorplan_x: number | null;
  floorplan_y: number | null;
  step_media: { media_url: string; media_type: string }[];
}

interface Props {
  tripId: string;
  userId: string;
  isOwner: boolean;
  floorplanUrl: string | null;
  steps: Step[];
  onChanged: () => void;
}

const FloorplanView = ({ tripId, userId, isOwner, floorplanUrl, steps, onChanged }: Props) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [uploading, setUploading] = useState(false);
  const [pinningStepId, setPinningStepId] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);

  const upload = async (file: File) => {
    setUploading(true);
    const path = `${userId}/floorplans/${tripId}-${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("trip-media").upload(path, file, { upsert: true });
    if (upErr) {
      toast.error("Upload mislukt");
      setUploading(false);
      return;
    }
    const { data } = supabase.storage.from("trip-media").getPublicUrl(path);
    await supabase.from("trips").update({ floorplan_url: data.publicUrl }).eq("id", tripId);
    toast.success("Plattegrond geüpload");
    setUploading(false);
    onChanged();
  };

  const handleContainerClick = async (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinningStepId || draggingId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    await supabase.from("steps").update({ floorplan_x: x, floorplan_y: y }).eq("id", pinningStepId);
    toast.success("Pin geplaatst");
    setPinningStepId(null);
    onChanged();
  };

  const startDrag = (e: React.PointerEvent, stepId: string) => {
    if (!isOwner) return;
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDraggingId(stepId);
    setActiveStep(null);
  };

  const onDragMove = (e: React.PointerEvent) => {
    if (!draggingId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height) * 100));
    setDragPos({ x, y });
  };

  const endDrag = async (e: React.PointerEvent) => {
    if (!draggingId) return;
    const id = draggingId;
    const pos = dragPos;
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setDraggingId(null);
    setDragPos(null);
    if (pos) {
      await supabase.from("steps").update({ floorplan_x: pos.x, floorplan_y: pos.y }).eq("id", id);
      toast.success("Pin verplaatst");
      onChanged();
    }
  };

  if (!floorplanUrl) {
    return (
      <div className="py-16 text-center">
        <MapPin className="h-12 w-12 mx-auto mb-3 text-muted-foreground/40" />
        <p className="text-muted-foreground mb-4">Nog geen plattegrond geüpload.</p>
        {isOwner && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5 bg-accent text-accent-foreground hover:bg-accent/90">
              <Upload className="h-4 w-4" /> {uploading ? "Uploaden..." : "Plattegrond uploaden"}
            </Button>
          </>
        )}
      </div>
    );
  }

  const pinned = steps.filter((s) => s.floorplan_x != null && s.floorplan_y != null);
  const unpinned = steps.filter((s) => s.floorplan_x == null);

  return (
    <div className="py-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <p className="text-sm text-muted-foreground">
            {pinned.length} van {steps.length} updates op de plattegrond
          </p>
          {isOwner && pinned.length > 0 && (
            <p className="text-xs text-muted-foreground/80 flex items-center gap-1 mt-0.5">
              <Move className="h-3 w-3" /> Sleep een pin om hem te verplaatsen
            </p>
          )}
        </div>
        {isOwner && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" /> Vervang
            </Button>
          </>
        )}
      </div>

      <div
        ref={containerRef}
        className={`relative w-full bg-muted rounded-xl overflow-hidden border-2 select-none ${pinningStepId ? "border-accent cursor-crosshair" : "border-border"}`}
        onClick={handleContainerClick}
      >
        <img src={floorplanUrl} alt="Plattegrond" className="w-full h-auto block pointer-events-none" draggable={false} />
        {pinned.map((s) => {
          const isDrag = draggingId === s.id;
          const x = isDrag && dragPos ? dragPos.x : (s.floorplan_x ?? 0);
          const y = isDrag && dragPos ? dragPos.y : (s.floorplan_y ?? 0);
          return (
            <button
              key={s.id}
              type="button"
              onPointerDown={(e) => startDrag(e, s.id)}
              onPointerMove={onDragMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={(e) => {
                e.stopPropagation();
                if (dragPos) return; // was dragging
                setActiveStep(s.id === activeStep ? null : s.id);
              }}
              className={`absolute -translate-x-1/2 -translate-y-full touch-none ${isOwner ? "cursor-grab active:cursor-grabbing" : ""} ${isDrag ? "z-20" : ""}`}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              <div className={`bg-accent text-accent-foreground rounded-full p-1.5 shadow-lg transition-transform ${isDrag ? "scale-125 ring-2 ring-accent/40" : "hover:scale-110"}`}>
                <Hammer className="h-3.5 w-3.5" />
              </div>
              {activeStep === s.id && !isDrag && (
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-background border-2 border-accent/30 rounded-lg p-2 w-44 shadow-xl z-10 text-left">
                  {s.step_media[0] && (
                    <img src={s.step_media[0].media_url} alt="" className="w-full h-20 object-cover rounded mb-1" />
                  )}
                  <p className="text-xs font-semibold line-clamp-2">{s.location_name}</p>
                  {s.room && <p className="text-[10px] text-muted-foreground">{s.room}</p>}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {isOwner && unpinned.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
            Nog te plaatsen — klik update, dan klik op de plattegrond:
          </p>
          <div className="flex flex-wrap gap-2">
            {unpinned.map((s) => (
              <button
                key={s.id}
                onClick={() => setPinningStepId(s.id === pinningStepId ? null : s.id)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                  pinningStepId === s.id
                    ? "bg-accent text-accent-foreground border-accent"
                    : "bg-muted border-border hover:border-accent"
                }`}
              >
                {s.location_name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default FloorplanView;
