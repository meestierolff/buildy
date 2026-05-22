import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import PhaseSelect from "./PhaseSelect";
import { toast } from "sonner";
import { Upload, X, Trash2, ArrowLeft, ArrowRight, MapPin, Hammer } from "lucide-react";

interface EditStepDialogProps {
  step: any;
  onClose: () => void;
  onUpdated: () => void;
}

const EditStepDialog = ({ step, onClose, onUpdated }: EditStepDialogProps) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [locationName, setLocationName] = useState(step.location_name);
  const [phase, setPhase] = useState<string>(step.phase || "");
  const [isMilestone, setIsMilestone] = useState<boolean>(!!step.is_milestone);
  const [description, setDescription] = useState(step.description || "");
  const [stepDate, setStepDate] = useState(step.step_date);
  const [cost, setCost] = useState<string>(step.cost != null ? String(step.cost) : "");
  const [hoursSpent, setHoursSpent] = useState<string>(step.hours_spent != null ? String(step.hours_spent) : "");
  const [workType, setWorkType] = useState<string>(step.work_type || "");
  const [existingMedia, setExistingMedia] = useState<any[]>(
    [...(step.step_media || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  );
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [customPhases, setCustomPhases] = useState<string[]>([]);
  const [floorplanUrl, setFloorplanUrl] = useState<string | null>(null);
  const [pinX, setPinX] = useState<number | null>(step.floorplan_x);
  const [pinY, setPinY] = useState<number | null>(step.floorplan_y);

  useEffect(() => {
    supabase
      .from("trips")
      .select("custom_phases, floorplan_url")
      .eq("id", step.trip_id)
      .single()
      .then(({ data }) => {
        setCustomPhases((data?.custom_phases as string[]) || []);
        setFloorplanUrl((data?.floorplan_url as string) || null);
      });
  }, [step.trip_id]);

  const addCustomPhase = async (name: string) => {
    const next = Array.from(new Set([...customPhases, name]));
    setCustomPhases(next);
    await supabase.from("trips").update({ custom_phases: next }).eq("id", step.trip_id);
  };

  const moveMedia = (index: number, dir: -1 | 1) => {
    setExistingMedia((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeExisting = async (m: any) => {
    if (!confirm("Foto verwijderen?")) return;
    const { error } = await supabase.from("step_media").delete().eq("id", m.id);
    if (error) {
      toast.error("Kon niet verwijderen");
      return;
    }
    try {
      const url = new URL(m.media_url);
      const idx = url.pathname.indexOf("/trip-media/");
      if (idx >= 0) {
        const path = url.pathname.slice(idx + "/trip-media/".length);
        await supabase.storage.from("trip-media").remove([decodeURIComponent(path)]);
      }
    } catch { /* ignore */ }
    setExistingMedia((prev) => prev.filter((x) => x.id !== m.id));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setNewFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
  };

  const handlePinClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setPinX(((e.clientX - rect.left) / rect.width) * 100);
    setPinY(((e.clientY - rect.top) / rect.height) * 100);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    const { error } = await supabase
      .from("steps")
      .update({
        location_name: locationName,
        phase: phase || null,
        is_milestone: isMilestone,
        description: description || null,
        step_date: stepDate,
        floorplan_x: pinX,
        floorplan_y: pinY,
        cost: cost === "" ? null : Number(cost),
        hours_spent: hoursSpent === "" ? null : Number(hoursSpent),
        work_type: workType || null,
      })
      .eq("id", step.id);

    if (error) {
      console.error("Update step failed:", error);
      toast.error("Kon update niet opslaan. Probeer het opnieuw.");
      setLoading(false);
      return;
    }

    // Persist reorder of existing media
    await Promise.all(
      existingMedia.map((m, i) =>
        (m.sort_order ?? 0) !== i
          ? supabase.from("step_media").update({ sort_order: i }).eq("id", m.id)
          : Promise.resolve()
      )
    );

    const baseOrder = existingMedia.length;
    for (let i = 0; i < newFiles.length; i++) {
      const file = newFiles[i];
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${step.id}/${Date.now()}-${i}.${ext}`;
      const { error: upErr } = await supabase.storage.from("trip-media").upload(path, file);
      if (!upErr) {
        const { data: urlData } = supabase.storage.from("trip-media").getPublicUrl(path);
        await supabase.from("step_media").insert({
          step_id: step.id,
          user_id: user.id,
          media_url: urlData.publicUrl,
          media_type: file.type === "application/pdf" ? "pdf" : file.type.startsWith("video") ? "video" : "image",
          sort_order: baseOrder + i,
        });
      }
    }

    toast.success("Update opgeslagen!");
    onUpdated();
    onClose();
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto z-[1000]">
        <DialogHeader>
          <DialogTitle>Update bewerken</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Titel *</Label>
            <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fase</Label>
              <PhaseSelect value={phase} onChange={setPhase} customPhases={customPhases} onAddCustom={addCustomPhase} />
            </div>
            <div>
              <Label>Datum *</Label>
              <Input type="date" value={stepDate} onChange={(e) => setStepDate(e.target.value)} required />
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border p-3 bg-secondary/40">
            <Switch id="milestone-edit" checked={isMilestone} onCheckedChange={setIsMilestone} />
            <Label htmlFor="milestone-edit" className="cursor-pointer">Markeren als mijlpaal 🏗️</Label>
          </div>
          <div>
            <Label>Verhaal</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>

          <div className="rounded-lg border p-3 space-y-3 bg-secondary/30">
            <Label className="text-sm font-semibold">💰 Budget & tijd</Label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Kosten (€)</Label>
                <Input type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0,00" />
              </div>
              <div>
                <Label className="text-xs">Uren besteed</Label>
                <Input type="number" min="0" step="0.5" value={hoursSpent} onChange={(e) => setHoursSpent(e.target.value)} placeholder="0" />
              </div>
            </div>
            <div>
              <Label className="text-xs">Type werk</Label>
              <select
                value={workType}
                onChange={(e) => setWorkType(e.target.value)}
                className="mt-1 w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— Kies —</option>
                <option value="diy">Zelf gedaan</option>
                <option value="outsourced">Uitbesteed</option>
                <option value="mixed">Combinatie</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <Label>Bestaande foto's</Label>
              <p className="text-[10px] text-muted-foreground">Markeer 1 als <strong>Voor</strong> en 1 als <strong>Na</strong> voor de vergelijking-slider.</p>
            </div>
            {existingMedia.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">Geen foto's</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-1">
                {existingMedia.map((m, i) => {
                  const role = m.compare_role as "before" | "after" | null;
                  const setRole = async (next: "before" | "after" | null) => {
                    // Ensure uniqueness across the step
                    setExistingMedia((prev) =>
                      prev.map((x) => {
                        if (x.id === m.id) return { ...x, compare_role: next };
                        if (next && x.compare_role === next) return { ...x, compare_role: null };
                        return x;
                      })
                    );
                    if (next) {
                      await supabase.from("step_media").update({ compare_role: null }).eq("step_id", step.id).eq("compare_role", next);
                    }
                    await supabase.from("step_media").update({ compare_role: next }).eq("id", m.id);
                  };
                  return (
                  <div key={m.id} className="relative group">
                    <div className={`w-20 h-20 rounded-md bg-muted overflow-hidden flex items-center justify-center text-center px-1 ${role ? "ring-2 ring-accent" : ""}`}>
                      {m.media_type === "video" ? (
                        <video src={m.media_url} className="w-full h-full object-cover" />
                      ) : m.media_type === "pdf" ? (
                        <span className="text-[10px] leading-tight">📄 PDF</span>
                      ) : (
                        <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    {role && (
                      <span className="absolute top-0.5 left-0.5 text-[9px] font-bold uppercase tracking-wider bg-accent text-accent-foreground px-1 rounded">
                        {role === "before" ? "Voor" : "Na"}
                      </span>
                    )}
                    {m.media_type !== "pdf" && m.media_type !== "video" && (
                      <div className="absolute top-full mt-1 left-0 right-0 flex gap-0.5 z-10">
                        <button type="button" onClick={() => setRole(role === "before" ? null : "before")} className={`flex-1 text-[9px] py-0.5 rounded ${role === "before" ? "bg-accent text-accent-foreground" : "bg-muted hover:bg-muted-foreground/20"}`}>Voor</button>
                        <button type="button" onClick={() => setRole(role === "after" ? null : "after")} className={`flex-1 text-[9px] py-0.5 rounded ${role === "after" ? "bg-accent text-accent-foreground" : "bg-muted hover:bg-muted-foreground/20"}`}>Na</button>
                      </div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 flex justify-between bg-black/50 px-1">
                      <button
                        type="button"
                        onClick={() => moveMedia(i, -1)}
                        disabled={i === 0}
                        className="text-white disabled:opacity-30 p-0.5"
                        aria-label="Eerder"
                      >
                        <ArrowLeft className="h-3 w-3" />
                      </button>
                      <span className="text-[10px] text-white">{i + 1}</span>
                      <button
                        type="button"
                        onClick={() => moveMedia(i, 1)}
                        disabled={i === existingMedia.length - 1}
                        className="text-white disabled:opacity-30 p-0.5"
                        aria-label="Later"
                      >
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExisting(m)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-1"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
            {existingMedia.some((m) => m.compare_role) && (
              <p className="text-[10px] text-muted-foreground mt-8">Vergelijking-slider wordt automatisch getoond in de tijdlijn.</p>
            )}
          </div>

          <div>
            <Label>Nieuwe foto's & video's toevoegen</Label>
            <label className="mt-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-3 cursor-pointer hover:border-accent transition-colors">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Klik om bestanden te selecteren</span>
              <input type="file" multiple accept="image/*,video/*,application/pdf" className="hidden" onChange={handleFileChange} />
            </label>
            {newFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {newFiles.map((f, i) => (
                  <div key={i} className="relative group">
                    <div className="w-16 h-16 rounded-md bg-muted overflow-hidden flex items-center justify-center text-center px-1">
                      {f.type.startsWith("image") ? (
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                      ) : f.type === "application/pdf" ? (
                        <span className="text-[10px] leading-tight">📄 PDF</span>
                      ) : (
                        <span className="text-xs">🎥</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setNewFiles((prev) => prev.filter((_, j) => j !== i))}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {floorplanUrl && (
            <div>
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> Plek op plattegrond</Label>
                {pinX != null && (
                  <button
                    type="button"
                    onClick={() => { setPinX(null); setPinY(null); }}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Pin verwijderen
                  </button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1 mb-2">Klik op de plattegrond om de pin te plaatsen of te verplaatsen.</p>
              <div className="relative w-full bg-muted rounded-lg overflow-hidden border-2 border-border cursor-crosshair" onClick={handlePinClick}>
                <img src={floorplanUrl} alt="Plattegrond" className="w-full h-auto block select-none" />
                {pinX != null && pinY != null && (
                  <div
                    className="absolute -translate-x-1/2 -translate-y-full pointer-events-none"
                    style={{ left: `${pinX}%`, top: `${pinY}%` }}
                  >
                    <div className="bg-accent text-accent-foreground rounded-full p-1.5 shadow-lg">
                      <Hammer className="h-3.5 w-3.5" />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={loading}>
            {loading ? "Opslaan..." : "Opslaan"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditStepDialog;
