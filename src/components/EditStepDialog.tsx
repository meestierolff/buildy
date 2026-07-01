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
import { BriefcaseBusiness, FileText, Hammer, MapPin, Star, Trash2, Upload, Video, Wallet, X } from "lucide-react";
import type { FloorInfo } from "./FloorplanView";
import { prepareUpload } from "@/lib/compressImage";

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
  const [cost, setCost] = useState<string>("");
  const [hoursSpent, setHoursSpent] = useState<string>("");
  const [workType, setWorkType] = useState<string>("");
  const [diyCost, setDiyCost] = useState<string>("");
  const [diyHours, setDiyHours] = useState<string>("");
  const [outsourcedCost, setOutsourcedCost] = useState<string>("");
  const [outsourcedHours, setOutsourcedHours] = useState<string>("");
  const [contractorName, setContractorName] = useState<string>("");
  const [contractorNotes, setContractorNotes] = useState<string>("");

  const [existingMedia, setExistingMedia] = useState<any[]>(
    [...(step.step_media || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  );
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const [customPhases, setCustomPhases] = useState<string[]>([]);
  const [floorplans, setFloorplans] = useState<FloorInfo[]>([]);
  const [selectedFloorId, setSelectedFloorId] = useState<string>(step.floorplan_id ?? "__legacy__");
  const [pinX, setPinX] = useState<number | null>(step.floorplan_x);
  const [pinY, setPinY] = useState<number | null>(step.floorplan_y);

  useEffect(() => {
    supabase
      .from("trips")
      .select("custom_phases, floorplan_url, floorplans")
      .eq("id", step.trip_id)
      .single()
      .then(({ data }) => {
        setCustomPhases((data?.custom_phases as string[]) || []);
        const fpRaw = (data?.floorplans as unknown) as FloorInfo[] | null;
        const floors = Array.isArray(fpRaw) && fpRaw.length > 0
          ? fpRaw
          : data?.floorplan_url
            ? [{ id: "__legacy__", label: "Begane grond", url: data.floorplan_url as string }]
            : [];
        setFloorplans(floors);
        if (!step.floorplan_id) setSelectedFloorId(floors[0]?.id ?? "__legacy__");
      });
    supabase
      .from("step_budget")
      .select("cost, hours_spent, work_type, diy_cost, diy_hours, outsourced_cost, outsourced_hours")
      .eq("step_id", step.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setCost(data.cost != null ? String(data.cost) : "");
          setHoursSpent(data.hours_spent != null ? String(data.hours_spent) : "");
          setWorkType(data.work_type || "");
          setDiyCost(data.diy_cost != null ? String(data.diy_cost) : "");
          setDiyHours(data.diy_hours != null ? String(data.diy_hours) : "");
          setOutsourcedCost(data.outsourced_cost != null ? String(data.outsourced_cost) : "");
          setOutsourcedHours(data.outsourced_hours != null ? String(data.outsourced_hours) : "");
        }
      });
    supabase
      .from("step_contractor_info")
      .select("contractor_name, contractor_notes")
      .eq("step_id", step.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setContractorName(data.contractor_name || "");
          setContractorNotes(data.contractor_notes || "");
        }
      });
  }, [step.trip_id, step.id, step.floorplan_id]);


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
    try {
      // Prefer the canonical storage_path; fall back to parsing legacy public URLs.
      if (m.storage_path) {
        await supabase.storage.from("trip-private").remove([m.storage_path]);
      } else if (m.media_url) {
        const url = new URL(m.media_url);
        const idx = url.pathname.indexOf("/trip-media/");
        if (idx >= 0) {
          const path = url.pathname.slice(idx + "/trip-media/".length);
          await supabase.storage.from("trip-media").remove([decodeURIComponent(path)]);
        }
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
        floorplan_id: pinX != null ? (selectedFloorId === "__legacy__" ? null : selectedFloorId) : null,
      })
      .eq("id", step.id);

    if (error) {
      console.error("Update step failed:", error);
      toast.error("Kon update niet opslaan. Probeer het opnieuw.");
      setLoading(false);
      return;
    }

    if (contractorName.trim() || contractorNotes.trim()) {
      await supabase.from("step_contractor_info").upsert({
        step_id: step.id,
        trip_id: step.trip_id,
        contractor_name: contractorName.trim() || null,
        contractor_notes: contractorNotes.trim() || null,
        updated_at: new Date().toISOString(),
      });
    } else {
      await supabase.from("step_contractor_info").delete().eq("step_id", step.id);
    }

    const hasBudget = cost !== "" || hoursSpent !== "" || workType !== "" ||
      diyCost !== "" || diyHours !== "" || outsourcedCost !== "" || outsourcedHours !== "";
    if (hasBudget) {
      const isMixed = workType === "mixed";
      const totalCost = isMixed
        ? (diyCost !== "" || outsourcedCost !== "" ? Number(diyCost || 0) + Number(outsourcedCost || 0) : null)
        : (cost === "" ? null : Number(cost));
      const totalHours = isMixed
        ? (diyHours !== "" || outsourcedHours !== "" ? Number(diyHours || 0) + Number(outsourcedHours || 0) : null)
        : (hoursSpent === "" ? null : Number(hoursSpent));
      await supabase.from("step_budget").upsert({
        step_id: step.id,
        trip_id: step.trip_id,
        cost: totalCost,
        hours_spent: totalHours,
        work_type: workType || null,
        diy_cost: isMixed && diyCost !== "" ? Number(diyCost) : null,
        diy_hours: isMixed && diyHours !== "" ? Number(diyHours) : null,
        outsourced_cost: isMixed && outsourcedCost !== "" ? Number(outsourcedCost) : null,
        outsourced_hours: isMixed && outsourcedHours !== "" ? Number(outsourcedHours) : null,
      });
    } else {
      await supabase.from("step_budget").delete().eq("step_id", step.id);
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
      let file: File;
      try {
        file = await prepareUpload(newFiles[i]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Bestand overgeslagen");
        continue;
      }
      const ext = file.name.split(".").pop();
      const path = `${user.id}/${step.id}/${Date.now()}-${i}.${ext}`;
      const { error: upErr } = await supabase.storage.from("trip-private").upload(path, file);
      if (!upErr) {
        const { data: signed } = await supabase.storage
          .from("trip-private")
          .createSignedUrl(path, 60 * 60);
        await supabase.from("step_media").insert({
          step_id: step.id,
          user_id: user.id,
          media_url: signed?.signedUrl ?? "",
          storage_path: path,
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
            <Label htmlFor="milestone-edit" className="flex cursor-pointer items-center gap-1.5">
              <Star className="h-3.5 w-3.5 text-accent" />
              Markeren als mijlpaal
            </Label>
          </div>
          <div>
            <Label>Verhaal</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
          </div>

          <div className="rounded-lg border p-3 space-y-3 bg-secondary/30">
            <Label className="flex items-center gap-1.5 text-sm font-semibold">
              <BriefcaseBusiness className="h-3.5 w-3.5 text-muted-foreground" />
              Aannemer (optioneel)
            </Label>
            <div>
              <Label className="text-xs">Naam / bedrijf</Label>
              <Input value={contractorName} onChange={(e) => setContractorName(e.target.value)} placeholder="Bijv. Aannemingsbedrijf Jansen" />
            </div>
            <div>
              <Label className="text-xs">Notities</Label>
              <Textarea value={contractorNotes} onChange={(e) => setContractorNotes(e.target.value)} rows={2} placeholder="Bijv. offerte besproken, startdatum afgesproken…" />
            </div>
          </div>

          <div className="rounded-lg border p-3 space-y-3 bg-secondary/30">
            <Label className="flex items-center gap-1.5 text-sm font-semibold">
              <Wallet className="h-3.5 w-3.5 text-muted-foreground" />
              Budget & tijd
            </Label>
            {workType !== "mixed" && (
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
            )}
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
            {workType === "mixed" && (
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">Specificeer het aandeel zelf gedaan vs uitbesteed:</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Kosten zelf gedaan (€)</Label>
                    <Input type="number" min="0" step="0.01" value={diyCost} onChange={(e) => setDiyCost(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label className="text-xs">Uren zelf gedaan</Label>
                    <Input type="number" min="0" step="0.5" value={diyHours} onChange={(e) => setDiyHours(e.target.value)} placeholder="0" />
                  </div>
                  <div>
                    <Label className="text-xs">Kosten uitbesteed (€)</Label>
                    <Input type="number" min="0" step="0.01" value={outsourcedCost} onChange={(e) => setOutsourcedCost(e.target.value)} placeholder="0,00" />
                  </div>
                  <div>
                    <Label className="text-xs">Uren uitbesteed</Label>
                    <Input type="number" min="0" step="0.5" value={outsourcedHours} onChange={(e) => setOutsourcedHours(e.target.value)} placeholder="0" />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="flex items-baseline justify-between">
              <Label>Bestaande foto's</Label>
              <p className="text-[10px] text-muted-foreground">Markeer 1 als <strong>Voor</strong> en 1 als <strong>Na</strong> voor de vergelijking-slider.</p>
            </div>
            {existingMedia.length === 0 ? (
              <p className="text-xs text-muted-foreground mt-1">Geen foto's</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 mt-2 sm:grid-cols-4 md:grid-cols-5">
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
                    <div
                      key={m.id}
                      className={`select-none rounded-lg border bg-background p-1.5 transition ${dragIdx === i ? "opacity-30" : ""} ${dragOverIdx === i && dragIdx !== i ? "ring-2 ring-primary" : ""}`}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; setDragIdx(i); }}
                      onDragOver={(e) => { e.preventDefault(); setDragOverIdx(i); }}
                      onDragLeave={() => setDragOverIdx(null)}
                      onDrop={() => {
                        if (dragIdx === null || dragIdx === i) return;
                        setExistingMedia((prev) => {
                          const next = [...prev];
                          const [moved] = next.splice(dragIdx, 1);
                          next.splice(i, 0, moved);
                          return next;
                        });
                        setDragIdx(null);
                        setDragOverIdx(null);
                      }}
                      onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                    >
                      <div className={`relative aspect-square cursor-grab active:cursor-grabbing overflow-hidden rounded-md bg-muted ${role ? "ring-2 ring-accent" : ""}`}>
                        {m.media_type === "video" ? (
                          <video src={m.media_url} className="h-full w-full object-contain" />
                        ) : m.media_type === "pdf" ? (
                          <span className="flex h-full flex-col items-center justify-center gap-1 px-1 text-center text-[10px] leading-tight text-muted-foreground">
                            <FileText className="h-4 w-4" />
                            PDF
                          </span>
                        ) : (
                          <img src={m.media_url} alt="" className="h-full w-full object-contain" />
                        )}
                        {role && (
                          <span className="absolute left-1 top-1 rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-foreground">
                            {role === "before" ? "Voor" : "Na"}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => removeExisting(m)}
                          className="absolute right-1 top-1 rounded-full bg-destructive p-1 text-destructive-foreground shadow"
                          aria-label="Foto verwijderen"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                      <div className="mt-1 rounded bg-muted py-0.5 text-center text-[10px] font-medium text-muted-foreground">
                        {i + 1}
                      </div>
                      {m.media_type !== "pdf" && m.media_type !== "video" && (
                        <div className="mt-1 grid grid-cols-2 gap-1">
                          <button type="button" onClick={() => setRole(role === "before" ? null : "before")} className={`rounded py-1 text-[11px] ${role === "before" ? "bg-accent text-accent-foreground" : "bg-muted hover:bg-muted-foreground/20"}`}>Voor</button>
                          <button type="button" onClick={() => setRole(role === "after" ? null : "after")} className={`rounded py-1 text-[11px] ${role === "after" ? "bg-accent text-accent-foreground" : "bg-muted hover:bg-muted-foreground/20"}`}>Na</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {existingMedia.some((m) => m.compare_role) && (
              <p className="text-[10px] text-muted-foreground mt-2">Vergelijking-slider wordt automatisch getoond in de tijdlijn.</p>
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
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-contain bg-muted" />
                      ) : f.type === "application/pdf" ? (
                        <span className="flex flex-col items-center gap-1 text-[10px] leading-tight text-muted-foreground">
                          <FileText className="h-4 w-4" />
                          PDF
                        </span>
                      ) : (
                        <Video className="h-5 w-5 text-muted-foreground" />
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

          {floorplans.length > 0 && (() => {
            const activeFloor = floorplans.find((f) => f.id === selectedFloorId) ?? floorplans[0];
            return (
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
              {floorplans.length > 1 && (
                <div className="flex gap-2 mt-2 mb-2 flex-wrap">
                  {floorplans.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSelectedFloorId(f.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selectedFloorId === f.id ? "bg-accent text-accent-foreground border-accent font-medium" : "bg-muted border-border hover:border-accent"}`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-1 mb-2">Klik op de plattegrond om de pin te plaatsen of te verplaatsen.</p>
              <div className="relative w-full bg-muted rounded-lg overflow-hidden border-2 border-border cursor-crosshair" onClick={handlePinClick}>
                <img src={activeFloor.url} alt="Plattegrond" className="w-full h-auto block select-none" />
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
            );
          })()}

          <Button type="submit" className="w-full bg-accent text-accent-foreground hover:bg-accent/90" disabled={loading}>
            {loading ? "Opslaan..." : "Opslaan"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default EditStepDialog;
