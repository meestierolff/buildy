import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import PhaseSelect, { DEFAULT_PHASES } from "./PhaseSelect";
import { toast } from "sonner";
import { Upload, X } from "lucide-react";

interface AddStepDialogProps {
  tripId: string;
  onClose: () => void;
  onAdded: () => void;
}

// Re-export so existing imports keep working
export const PHASES = DEFAULT_PHASES;

const AddStepDialog = ({ tripId, onClose, onAdded }: AddStepDialogProps) => {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [locationName, setLocationName] = useState("");
  const [phase, setPhase] = useState<string>("");
  const [isMilestone, setIsMilestone] = useState(false);
  const [description, setDescription] = useState("");
  const [stepDate, setStepDate] = useState(new Date().toISOString().split("T")[0]);
  const [cost, setCost] = useState<string>("");
  const [hoursSpent, setHoursSpent] = useState<string>("");
  const [workType, setWorkType] = useState<string>("");
  const [files, setFiles] = useState<File[]>([]);
  const [customPhases, setCustomPhases] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("trips").select("custom_phases").eq("id", tripId).single().then(({ data }) => {
      setCustomPhases((data?.custom_phases as string[]) || []);
    });
  }, [tripId]);

  const addCustomPhase = async (name: string) => {
    const next = Array.from(new Set([...customPhases, name]));
    setCustomPhases(next);
    await supabase.from("trips").update({ custom_phases: next }).eq("id", tripId);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles((prev) => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);

    const { data: step, error } = await supabase
      .from("steps")
      .insert({
        trip_id: tripId,
        user_id: user.id,
        location_name: locationName,
        phase: phase || null,
        is_milestone: isMilestone,
        description: description || null,
        step_date: stepDate,
        cost: cost === "" ? null : Number(cost),
        hours_spent: hoursSpent === "" ? null : Number(hoursSpent),
        work_type: workType || null,
      })
      .select()
      .single();

    if (error) {
      console.error("Add step failed:", error);
      toast.error("Kon update niet toevoegen. Probeer het opnieuw.");
      setLoading(false);
      return;
    }

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${step.id}/${i}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("trip-media")
        .upload(path, file);

      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("trip-media").getPublicUrl(path);
        await supabase.from("step_media").insert({
          step_id: step.id,
          user_id: user.id,
          media_url: urlData.publicUrl,
          media_type: file.type.startsWith("video") ? "video" : "image",
          sort_order: i,
        });
      }
    }

    toast.success("Update toegevoegd!");
    onAdded();
    onClose();
    setLoading(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto z-[1000]">
        <DialogHeader>
          <DialogTitle>Nieuwe update toevoegen</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Titel *</Label>
            <Input value={locationName} onChange={(e) => setLocationName(e.target.value)} required placeholder="Bijv. Sloop begane grond" />
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
            <Switch id="milestone" checked={isMilestone} onCheckedChange={setIsMilestone} />
            <Label htmlFor="milestone" className="cursor-pointer">Markeren als mijlpaal 🏗️</Label>
          </div>
          <div>
            <Label>Verhaal</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Vertel wat er deze dag is gebeurd..." rows={4} />
          </div>

          <div className="rounded-lg border p-3 space-y-3 bg-secondary/30">
            <Label className="text-sm font-semibold">💰 Budget & tijd (optioneel)</Label>
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
            <Label>Foto's & Video's</Label>
            <label className="mt-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-4 cursor-pointer hover:border-accent transition-colors">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Klik om bestanden te selecteren</span>
              <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
            </label>
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {files.map((f, i) => (
                  <div key={i} className="relative group">
                    <div className="w-16 h-16 rounded-md bg-muted flex items-center justify-center overflow-hidden">
                      {f.type.startsWith("image") ? (
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs">🎥</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeFile(i)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={loading}>
            {loading ? "Toevoegen..." : "Update toevoegen"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default AddStepDialog;
