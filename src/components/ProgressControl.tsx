import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import ProgressBar from "./ProgressBar";
import { toast } from "sonner";

interface Props {
  tripId: string;
  isOwner: boolean;
  startDate: string | null;
  endDate: string | null;
  progressMode: string | null;
  progressPercentage: number | null;
  onChanged: () => void;
}

export const computeAutoProgress = (start: string | null, end: string | null) => {
  if (!start || !end) return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (e <= s) return 0;
  const now = Date.now();
  const pct = ((now - s) / (e - s)) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
};

const ProgressControl = ({ tripId, isOwner, startDate, endDate, progressMode, progressPercentage, onChanged }: Props) => {
  const hasEnd = !!endDate && !!startDate;
  const initialMode = (progressMode === "auto" && hasEnd) ? "auto" : "manual";
  const [mode, setMode] = useState<"auto" | "manual">(initialMode);
  const [manualVal, setManualVal] = useState<number>(progressPercentage ?? 0);

  useEffect(() => {
    setMode(progressMode === "auto" && hasEnd ? "auto" : "manual");
    setManualVal(progressPercentage ?? 0);
  }, [progressMode, progressPercentage, hasEnd]);

  const displayed = mode === "auto" ? computeAutoProgress(startDate, endDate) : manualVal;

  const persistMode = async (next: "auto" | "manual") => {
    setMode(next);
    const { error } = await supabase.from("trips").update({ progress_mode: next }).eq("id", tripId);
    if (error) toast.error("Kon modus niet opslaan");
    else onChanged();
  };

  const persistManual = async (v: number) => {
    setManualVal(v);
    const { error } = await supabase
      .from("trips")
      .update({ progress_percentage: v, progress_mode: "manual" })
      .eq("id", tripId);
    if (error) toast.error("Kon voortgang niet opslaan");
  };

  return (
    <div className="space-y-2">
      <ProgressBar value={displayed} />
      {isOwner && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-primary-foreground/80">
          {hasEnd && (
            <div className="flex items-center gap-2">
              <Switch
                id={`auto-${tripId}`}
                checked={mode === "auto"}
                onCheckedChange={(c) => persistMode(c ? "auto" : "manual")}
              />
              <Label htmlFor={`auto-${tripId}`} className="cursor-pointer text-primary-foreground/80">
                Automatisch op tijdlijn
              </Label>
            </div>
          )}
          {mode === "manual" && (
            <div className="flex-1 min-w-[140px] max-w-xs">
              <Slider
                value={[manualVal]}
                min={0}
                max={100}
                step={1}
                onValueChange={(v) => setManualVal(v[0])}
                onValueCommit={(v) => persistManual(v[0])}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ProgressControl;
