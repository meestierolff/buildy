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
import { Upload, X, Trash2 } from "lucide-react";

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
  const [existingMedia, setExistingMedia] = useState<any[]>(step.step_media || []);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [customPhases, setCustomPhases] = useState<string[]>([]);

  useEffect(() => {
    supabase.from("trips").select("custom_phases").eq("id", step.trip_id).single().then(({ data }) => {
      setCustomPhases((data?.custom_phases as string[]) || []);
    });
  }, [step.trip_id]);

  const addCustomPhase = async (name: string) => {
    const next = Array.from(new Set([...customPhases, name]));
    setCustomPhases(next);
    await supabase.from("trips").update({ custom_phases: next }).eq("id", step.trip_id);
  };

  const removeExisting = async (m: any) => {
    if (!confirm("Foto verwijderen?")) return;
    const { error } = await supabase.from("step_media").delete().eq("id", m.id);
    if (error) {
      toast.error("Kon niet verwijderen");
      return;
    }
    // best-effort storage cleanup
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
      })
      .eq("id", step.id);

    if (error) {
      toast.error("Kon update niet opslaan: " + error.message);
      setLoading(false);
      return;
    }

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
          media_type: file.type.startsWith("video") ? "video" : "image",
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

          <div>
            <Label>Bestaande foto's</Label>
            {existingMedia.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">Geen foto's</p>
            ) : (
              <div className="flex flex-wrap gap-2 mt-1">
                {existingMedia.map((m) => (
                  <div key={m.id} className="relative group">
                    <div className="w-20 h-20 rounded-md bg-muted overflow-hidden">
                      {m.media_type === "video" ? (
                        <video src={m.media_url} className="w-full h-full object-cover" />
                      ) : (
                        <img src={m.media_url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeExisting(m)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-1"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>Nieuwe foto's & video's toevoegen</Label>
            <label className="mt-1 flex items-center justify-center gap-2 border-2 border-dashed rounded-lg p-3 cursor-pointer hover:border-accent transition-colors">
              <Upload className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Klik om bestanden te selecteren</span>
              <input type="file" multiple accept="image/*,video/*" className="hidden" onChange={handleFileChange} />
            </label>
            {newFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {newFiles.map((f, i) => (
                  <div key={i} className="relative group">
                    <div className="w-16 h-16 rounded-md bg-muted overflow-hidden">
                      {f.type.startsWith("image") ? (
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
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

          <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={loading}>
            {loading ? "Opslaan..." : "Opslaan"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditStepDialog;
